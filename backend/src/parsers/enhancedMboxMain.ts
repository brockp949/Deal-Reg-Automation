/**
 * Enhanced MBOX Parser - Main Entry Point
 * Combines all layers into a complete parsing pipeline
 */

import { simpleParser, ParsedMail } from 'mailparser';
import { readFileSync } from 'fs';
import {
  preprocessEmail,
  correlateThreads,
  isRelevantEmail,
  ExtractedDeal,
  ParsedEmailMessage,
  EmailThread,
  extractEmailAddress,
  extractEmailAddresses,
} from './enhancedMboxParser';
import { processThread } from './enhancedMboxParserLayers';
import logger from '../utils/logger';

export interface EnhancedMboxResult {
  threads: EmailThread[];
  extractedDeals: ExtractedDeal[];
  totalMessages: number;
  relevantMessages: number;
  processingTime: number;
}

/**
 * Main enhanced MBOX parsing function
 */
export async function parseEnhancedMboxFile(
  filePath: string,
  options: {
    vendorDomains?: string[];
    confidenceThreshold?: number;
  } = {}
): Promise<EnhancedMboxResult> {
  const startTime = Date.now();
  const {
    vendorDomains = [],
    confidenceThreshold = 0.3,
  } = options;

  logger.info('Starting enhanced MBOX parsing', {
    file: filePath,
    vendorDomains,
    confidenceThreshold,
  });

  try {
    // Read MBOX file
    const mboxContent = readFileSync(filePath, 'utf-8');

    // Split into individual email blocks
    const emailBlocks = mboxContent.split(/\n(?=From )/);
    logger.info(`Found ${emailBlocks.length} email blocks in MBOX file`);

    const parsedMessages: ParsedEmailMessage[] = [];

    // PHASE 1: Parse and pre-process all messages
    for (let i = 0; i < emailBlocks.length; i++) {
      const block = emailBlocks[i];
      if (!block.trim()) continue;

      try {
        // Remove the "From " line
        const emailContent = block.replace(/^From .*\n/, '');

        // Parse email
        const parsed: ParsedMail = await simpleParser(emailContent);

        // Extract metadata
        const messageId = parsed.messageId || `generated-${i}-${Date.now()}`;
        const from = extractEmailAddress(parsed.from);
        const to = extractEmailAddresses(parsed.to);
        const cc = extractEmailAddresses(parsed.cc);
        const subject = parsed.subject || '';
        const date = parsed.date || new Date();
        const inReplyTo = parsed.inReplyTo || undefined;
        const references = parsed.references || [];

        // Get body text
        let bodyText = parsed.text || '';
        let bodyHtml = parsed.html ? String(parsed.html) : undefined;

        // Pre-process the body
        const cleanedBody = preprocessEmail(
          bodyHtml || bodyText,
          !!bodyHtml
        );

        // Create parsed message object
        const parsedMsg: ParsedEmailMessage = {
          message_id: messageId,
          from,
          to,
          cc,
          subject,
          date,
          body_text: bodyText,
          body_html: bodyHtml,
          in_reply_to: inReplyTo,
          references: Array.isArray(references) ? references : [references],
          cleaned_body: cleanedBody,
          tier1_matches: [],
          tier2_matches: [],
          tier3_matches: [],
        };

        parsedMessages.push(parsedMsg);

      } catch (error: any) {
        logger.warn('Failed to parse individual email', {
          error: error.message,
          blockIndex: i,
        });
      }
    }

    logger.info(`Successfully parsed ${parsedMessages.length} messages`);

    // PHASE 2: Layer 1 - High-Speed Triage
    const relevantMessages = parsedMessages.filter(msg =>
      isRelevantEmail(msg, vendorDomains)
    );

    logger.info(`Filtered to ${relevantMessages.length} relevant messages using Layer 1 triage`);

    // PHASE 3: Thread Correlation
    const threads = correlateThreads(relevantMessages);

    logger.info(`Correlated messages into ${threads.length} threads`);

    // PHASE 4: Layer 2 & 3 - Extract deals from threads
    const allDeals: ExtractedDeal[] = [];

    for (const thread of threads) {
      logger.info(`Processing thread: "${thread.subject_normalized}" (${thread.messages.length} messages)`);

      const deals = processThread(thread);

      // Filter by confidence threshold
      const highConfidenceDeals = deals.filter(
        deal => deal.confidence_score >= confidenceThreshold
      );

      allDeals.push(...highConfidenceDeals);

      logger.info(`Extracted ${highConfidenceDeals.length} high-confidence deals from thread`);
    }

    // Sort deals by confidence score (highest first)
    allDeals.sort((a, b) => b.confidence_score - a.confidence_score);

    const processingTime = Date.now() - startTime;

    logger.info('Enhanced MBOX parsing complete', {
      totalMessages: parsedMessages.length,
      relevantMessages: relevantMessages.length,
      threads: threads.length,
      dealsExtracted: allDeals.length,
      processingTimeMs: processingTime,
    });

    return {
      threads,
      extractedDeals: allDeals,
      totalMessages: parsedMessages.length,
      relevantMessages: relevantMessages.length,
      processingTime,
    };

  } catch (error: any) {
    logger.error('Enhanced MBOX parsing failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Parse MBOX file and return just the extracted deals (simplified API)
 */
export async function extractDealsFromMbox(
  filePath: string,
  vendorDomains: string[] = []
): Promise<ExtractedDeal[]> {
  const result = await parseEnhancedMboxFile(filePath, { vendorDomains });
  return result.extractedDeals;
}

export default {
  parseEnhancedMboxFile,
  extractDealsFromMbox,
};
