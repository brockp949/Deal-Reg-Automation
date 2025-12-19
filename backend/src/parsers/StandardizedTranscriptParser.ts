/**
 * Standardized Transcript Parser
 *
 * Wraps existing transcript parsing logic (text, PDF, DOCX) and returns standardized output.
 * Supports both basic and enhanced transcript parsing.
 */

import { BaseParser } from './BaseParser';
import { parseTextTranscript, extractInfoFromTranscript } from './transcriptParser';
import { parseEnhancedTranscript } from './enhancedTranscriptParser';
import { parsePDFTranscript } from './pdfParser';
import { parseDocxTranscript } from './docxParser';
import {
  StandardizedParserOutput,
  TranscriptParserOptions,
  NormalizedVendor,
  NormalizedDeal,
  NormalizedContact,
  ParsingErrorSeverity,
  FileType,
  RfqSignals,
} from '../types/parsing';
import { stat, readFile } from 'fs/promises';
import logger from '../utils/logger';
import { loadSourceMetadata } from '../utils/sourceMetadata';
import {
  analyzeOpportunitySignals,
  extractSemanticSections,
  inferDealStage,
} from '../utils/opportunitySignals';

export class StandardizedTranscriptParser extends BaseParser {
  constructor() {
    super('StandardizedTranscriptParser', '2.0.0', ['txt', 'pdf', 'docx', 'transcript']);
  }

  protected getCapabilities(): string[] {
    return [
      'transcript_parsing',
      'text_parsing',
      'pdf_parsing',
      'docx_parsing',
      'enhanced_extraction',
      'vendor_extraction',
      'deal_extraction',
      'contact_extraction',
    ];
  }

  /**
   * Parse transcript file and return standardized output
   */
  async parse(filePath: string, options?: TranscriptParserOptions): Promise<StandardizedParserOutput> {
    const startTime = Date.now();
    const fileName = filePath.split('/').pop() || 'unknown.txt';
    const ext = fileName.split('.').pop()?.toLowerCase() || 'txt';

    // Determine file type
    let fileType: FileType = 'txt';
    if (ext === 'pdf') fileType = 'pdf';
    else if (ext === 'docx') fileType = 'docx';
    else if (fileName.includes('transcript')) fileType = 'transcript';

    // Get file size
    let fileSize: number | undefined;
    try {
      const stats = await stat(filePath);
      fileSize = stats.size;
    } catch (error) {
      // File size is optional, continue without it
    }

    // Create output skeleton
    const output = this.createOutputSkeleton(fileName, 'transcript', fileType, fileSize);

    try {
      logger.info('Starting transcript parsing', { fileName, fileType, fileSize });

      let tempFilePath: string | null = null;
      let filePathToProcess = filePath;

      // Handle PDF files - extract text to temp file first
      if (fileType === 'pdf') {
        const { writeFile } = await import('fs/promises');
        const pdfText = await parsePDFTranscript(filePath);
        tempFilePath = filePath + '.txt';
        await writeFile(tempFilePath, pdfText, 'utf-8');
        filePathToProcess = tempFilePath;
        logger.info('Extracted PDF text to temporary file', { tempFilePath });
      }

      // Handle DOCX files - extract text to temp file first
      if (fileType === 'docx') {
        const { writeFile } = await import('fs/promises');
        const docxText = await parseDocxTranscript(filePath);
        tempFilePath = filePath + '.txt';
        await writeFile(tempFilePath, docxText, 'utf-8');
        filePathToProcess = tempFilePath;
        logger.info('Extracted DOCX text to temporary file', { tempFilePath });
      }

      let extractedData: any;
      let transcriptText: string = '';
      let opportunityAnalysis: ReturnType<typeof analyzeOpportunitySignals> | undefined;
      let lowSignal = false;
      const buyingSignalThreshold = options?.buyingSignalThreshold ?? 0.35;

      try {
        // Use enhanced parsing if requested (default)
        if (options?.useEnhancedParsing !== false) {
          // parseEnhancedTranscript expects filePath and reads the file itself
          const enhancedResult = await parseEnhancedTranscript(filePathToProcess, {
            buyingSignalThreshold,
            confidenceThreshold: options?.confidenceThreshold || 0.6,
            allowLowSignal: true,
          });

          // Read the transcript text for line count
          transcriptText = await readFile(filePathToProcess, 'utf-8');
          output.statistics.linesProcessed = transcriptText.split('\n').length;

          // Convert enhanced transcript result to standard format
          if (!enhancedResult.deal) {
            logger.warn('Transcript did not yield a deal', { buyingSignalScore: enhancedResult.buyingSignalScore });
            extractedData = { vendors: [], deals: [], contacts: [] };
          } else {
            lowSignal = !enhancedResult.isRegisterable;
            if (lowSignal) {
              this.addWarning(
                output,
                `Low buying signal score (${enhancedResult.buyingSignalScore.toFixed(2)})`,
                undefined,
                'Review transcript-derived deal details before approval.'
              );
            }

            // Convert the enhanced deal data to our format
            const deal = enhancedResult.deal;
            const vendors = deal.partner_company_name ? [{ name: deal.partner_company_name }] : [];
            const contacts = [];

            if (deal.partner_contact_name && deal.partner_email && deal.partner_company_name) {
              contacts.push({
                name: deal.partner_contact_name,
                email: deal.partner_email,
                phone: deal.partner_phone,
                role: deal.partner_role || 'Partner',
                vendor_name: deal.partner_company_name,
                is_primary: true,
              });
            }

            extractedData = {
              vendors,
              deals: [deal],
              contacts,
            };
          }
        } else {
          // Basic parsing - read text and extract
          const parsedTranscript = parseTextTranscript(filePathToProcess);
          transcriptText = parsedTranscript.text;
          output.statistics.linesProcessed = transcriptText.split('\n').length;
          extractedData = extractInfoFromTranscript(parsedTranscript);
        }

        opportunityAnalysis = analyzeOpportunitySignals(transcriptText || '');
        output.semanticSections = extractSemanticSections(transcriptText || '', opportunityAnalysis);
      } finally {
        // Clean up temp file if created
        if (tempFilePath) {
          const { unlink } = await import('fs/promises');
          try {
            await unlink(tempFilePath);
            logger.info('Cleaned up temporary file', { tempFilePath });
          } catch (err: any) {
            logger.warn('Failed to clean up temp file', { tempFilePath, error: err.message });
          }
        }
      }

      // Load source metadata if available
      const sourceMetadata = await loadSourceMetadata(filePath);
      if (sourceMetadata) {
        output.metadata.sourceMetadata = sourceMetadata;
        const metadataTags: string[] = [];
        metadataTags.push('source:transcript');
        if (sourceMetadata.queryName) {
          metadataTags.push(`query:${sourceMetadata.queryName}`);
        }
        if (sourceMetadata.connector === 'drive') {
          metadataTags.push(`doc:${sourceMetadata.file.id}`);
          metadataTags.push(`doc-name:${sourceMetadata.file.name}`);
          if (sourceMetadata.file.createdTime) {
            metadataTags.push(`doc-created:${sourceMetadata.file.createdTime}`);
          }
          if (sourceMetadata.file.modifiedTime) {
            metadataTags.push(`doc-modified:${sourceMetadata.file.modifiedTime}`);
          }
          sourceMetadata.file.owners?.forEach((owner) => {
            const ownerLabel = owner.displayName || owner.emailAddress;
            if (ownerLabel) {
              metadataTags.push(`doc-owner:${ownerLabel}`);
            }
          });
        }
        output.metadata.sourceTags = Array.from(
          new Set(
            metadataTags.filter((tag) => Boolean(tag && tag.trim())).map((tag) => tag.trim())
          )
        );
      }

      const baseTags = new Set(output.metadata.sourceTags ?? []);
      if (!baseTags.size) {
        baseTags.add('source:transcript');
      }
      const aggregateTags = new Set(baseTags);
      const sharedSignalTags = new Set(baseTags);

      if (lowSignal) {
        sharedSignalTags.add('signal:low');
        aggregateTags.add('signal:low');
      }

      if (opportunityAnalysis) {
        opportunityAnalysis.opportunityTags.forEach((tag) => {
          const normalizedTag = `opportunity:${tag}`;
          sharedSignalTags.add(normalizedTag);
          aggregateTags.add(normalizedTag);
        });
        opportunityAnalysis.stageHints.forEach((hint) => {
          const normalizedHint = `stage-hint:${hint}`;
          sharedSignalTags.add(normalizedHint);
          aggregateTags.add(normalizedHint);
        });
      }

      // Convert to standardized format
      const { vendors, deals, contacts } = extractedData;

      // Map vendors
      output.entities.vendors = vendors.map((v: any) => this.normalizeVendor(v));

      // Map deals
      const normalizedDeals: NormalizedDeal[] = deals.map((d: any) => this.normalizeDeal(d));

      if (opportunityAnalysis) {
        const hasSignals =
          opportunityAnalysis.rfqSignals.quantities.length > 0 ||
          opportunityAnalysis.rfqSignals.priceTargets.length > 0 ||
          opportunityAnalysis.rfqSignals.timelineRequests.length > 0 ||
          opportunityAnalysis.rfqSignals.marginNotes.length > 0 ||
          opportunityAnalysis.rfqSignals.actorMentions.length > 0;

        normalizedDeals.forEach((deal: NormalizedDeal) => {
          const dealTags = new Set(sharedSignalTags);
          if (hasSignals) {
            const rfqSignals: RfqSignals = {
              quantities: [...opportunityAnalysis!.rfqSignals.quantities],
              priceTargets: [...opportunityAnalysis!.rfqSignals.priceTargets],
              timelineRequests: [...opportunityAnalysis!.rfqSignals.timelineRequests],
              marginNotes: [...opportunityAnalysis!.rfqSignals.marginNotes],
              actorMentions: [...opportunityAnalysis!.rfqSignals.actorMentions],
            };
            deal.rfq_signals = rfqSignals;
            rfqSignals.actorMentions.forEach((actor) =>
              dealTags.add(`actor:${actor.replace(/\s+/g, '-')}`)
            );
          }

          if (opportunityAnalysis!.stageHints.length > 0) {
            const mergedHints = new Set([
              ...(deal.stage_hints ?? []),
              ...opportunityAnalysis!.stageHints,
            ]);
            deal.stage_hints = Array.from(mergedHints);
          }

          const inferredStage = inferDealStage(
            opportunityAnalysis!.stageHints,
            output.metadata.sourceMetadata?.queryName,
            deal.project_name || deal.deal_name
          );
          if (inferredStage && !deal.deal_stage) {
            deal.deal_stage = inferredStage;
          }

          deal.source_tags = Array.from(dealTags);
          dealTags.forEach((tag) => aggregateTags.add(tag));
        });
      } else {
        normalizedDeals.forEach((deal: NormalizedDeal) => {
          deal.source_tags = Array.from(sharedSignalTags);
        });
      }

      output.entities.deals = normalizedDeals;

      // Map contacts
      const normalizedContacts: NormalizedContact[] = contacts.map((c: any) =>
        this.normalizeContact(c)
      );
      normalizedContacts.forEach((contact: NormalizedContact) => {
        contact.source_tags = Array.from(sharedSignalTags);
      });
      output.entities.contacts = normalizedContacts;

      output.metadata.sourceTags = Array.from(aggregateTags);

      // Add normalized text if requested
      if (options?.includeNormalizedText) {
        output.normalizedText = this.normalizeText(transcriptText);
      }

      // Add raw data if requested
      if (options?.includeRawData) {
        output.rawData = {
          transcriptText,
          extractedData,
        };
      }

      // Filter by confidence threshold
      if (options?.confidenceThreshold) {
        this.filterByConfidence(output, options.confidenceThreshold);
      }

      // Finalize output
      const finalOutput = this.finalizeOutput(output, startTime);

      // Log summary
      this.logParsingSummary(finalOutput);

      return finalOutput;
    } catch (error: any) {
      this.addError(
        output,
        `Failed to parse transcript file: ${error.message}`,
        ParsingErrorSeverity.CRITICAL,
        undefined,
        { error: error.stack },
        false
      );

      return this.finalizeOutput(output, startTime);
    }
  }

  /**
   * Normalize text by removing extra whitespace, etc.
   */
  private normalizeText(text: string): string {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
  }

  /**
   * Normalize vendor from transcript parser output
   */
  private normalizeVendor(v: any): NormalizedVendor {
    return {
      name: v.name || v.vendor_name,
      normalized_name: (v.name || v.vendor_name).toLowerCase().replace(/[^\w\s]/g, '').trim(),
      email_domains: v.email_domain ? [v.email_domain] : undefined,
      origin: 'extracted',
      confidence: 0.6, // Medium confidence for transcript extraction
      source_location: 'Transcript',
    };
  }

  /**
   * Normalize deal from transcript parser output
   */
  private normalizeDeal(d: any): NormalizedDeal {
    return {
      deal_name: d.deal_name || d.deal_description?.substring(0, 100) || 'Untitled Deal',
      vendor_name: d.vendor_name || d.partner_company_name || 'Unknown Vendor',
      deal_value: d.deal_value ?? d.estimated_deal_value ?? 0,
      currency: d.currency || 'USD',
      customer_name: d.customer_name || d.prospect_company_name || d.end_user_company_name,
      registration_date: d.registration_date,
      expected_close_date: d.expected_close_date,
      status: d.status || 'registered',
      notes: d.notes || d.deal_description,
      project_name: d.project_name || d.deal_name,
      objections: d.objections,
      competitor_insights: d.competitor_insights,
      identified_competitors: d.identified_competitors,
      confidence_score: d.confidence_score ?? d.confidence ?? 0.6,
      extraction_method: d.extraction_method || 'transcript_nlp',
      source_location: 'Transcript',
    };
  }

  /**
   * Normalize contact from transcript parser output
   */
  private normalizeContact(c: any): NormalizedContact {
    return {
      name: c.name,
      vendor_name: c.vendor_name,
      email: c.email,
      phone: c.phone,
      role: c.role,
      source_location: 'Transcript',
    };
  }
}
