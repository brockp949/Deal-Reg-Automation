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
import {
  StandardizedParserOutput,
  TranscriptParserOptions,
  NormalizedVendor,
  NormalizedDeal,
  NormalizedContact,
  ParsingErrorSeverity,
  FileType,
} from '../types/parsing';
import { stat, readFile } from 'fs/promises';
import logger from '../utils/logger';

export class StandardizedTranscriptParser extends BaseParser {
  constructor() {
    super('StandardizedTranscriptParser', '2.0.0', ['txt', 'pdf', 'docx', 'transcript']);
  }

  protected getCapabilities(): string[] {
    return [
      'transcript_parsing',
      'text_parsing',
      'pdf_parsing',
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

      let extractedData: any;
      let transcriptText: string = '';

      try {
        // Use enhanced parsing if requested (default)
        if (options?.useEnhancedParsing !== false) {
          // parseEnhancedTranscript expects filePath and reads the file itself
          const enhancedResult = await parseEnhancedTranscript(filePathToProcess, {
            buyingSignalThreshold: options?.buyingSignalThreshold || 0.5,
            confidenceThreshold: options?.confidenceThreshold || 0.6,
          });

          // Read the transcript text for line count
          transcriptText = await readFile(filePathToProcess, 'utf-8');
          output.statistics.linesProcessed = transcriptText.split('\n').length;

          // Convert enhanced transcript result to standard format
          if (!enhancedResult.deal || !enhancedResult.isRegisterable) {
            logger.warn('Transcript not registerable', { buyingSignalScore: enhancedResult.buyingSignalScore });
            extractedData = { vendors: [], deals: [], contacts: [] };
          } else {
            // Convert the enhanced deal data to our format
            const deal = enhancedResult.deal;
            extractedData = {
              vendors: [],
              deals: [deal],
              contacts: [],
            };
          }
        } else {
          // Basic parsing - read text and extract
          transcriptText = await readFile(filePathToProcess, 'utf-8');
          output.statistics.linesProcessed = transcriptText.split('\n').length;
          extractedData = extractInfoFromTranscript(transcriptText);
        }
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

      // Convert to standardized format
      const { vendors, deals, contacts } = extractedData;

      // Map vendors
      output.entities.vendors = vendors.map((v: any) => this.normalizeVendor(v));

      // Map deals
      output.entities.deals = deals.map((d: any) => this.normalizeDeal(d));

      // Map contacts
      output.entities.contacts = contacts.map((c: any) => this.normalizeContact(c));

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
      deal_name: d.deal_name || 'Untitled Deal',
      vendor_name: d.vendor_name || 'Unknown Vendor',
      deal_value: d.deal_value || 0,
      currency: d.currency || 'USD',
      customer_name: d.customer_name,
      registration_date: d.registration_date,
      expected_close_date: d.expected_close_date,
      status: d.status || 'registered',
      notes: d.notes,
      project_name: d.project_name,
      confidence_score: d.confidence_score || 0.6,
      extraction_method: 'regex',
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
