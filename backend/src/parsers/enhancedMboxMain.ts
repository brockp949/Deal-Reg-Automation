/**
 * Enhanced MBOX Parser - Main Entry Point
 * Combines all layers into a complete parsing pipeline
 */

import { simpleParser, ParsedMail } from 'mailparser';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
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

// MBOX conversion report item
export interface MboxConversionItem { // Renamed for internal use, maps to ConversionReport
  id: string;
  status: 'extracted' | 'skipped' | 'failed';
  message?: string;
  details?: any;
}

export interface EnhancedMboxResult {
  threads: EmailThread[];
  extractedDeals: ExtractedDeal[];
  totalMessages: number;
  relevantMessages: number;
  processingTime: number;
  conversionReport: MboxConversionItem[]; // Added report
}

/**
 * Robust MBOX Stream Splitter
 * Uses a state machine to correctly identify "From " lines, handling variations
 * and potential escaping (e.g. ">From ").
 */
// Export for testing
export async function* streamMboxBlocks(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let currentLines: string[] = [];
  let inMessage = false;
  let lineCount = 0;

  // robust delimiter tracking
  let previousLineWasEmpty = false;

  for await (const line of rl) {
    lineCount++;
    const delimiter = isMboxDelimiterLine(line, previousLineWasEmpty);

    if (delimiter) {
      if (inMessage && currentLines.length > 0) {
        yield currentLines.join('\n');
        currentLines = [];
      }
      inMessage = true;
      // We include the From text in the block so the parser can read it if needed,
      // though typically simpleParser might expect it or ignore it.
      // Standard mbox: 'From ' line is start of message.
      currentLines.push(line);
    } else {
      if (inMessage) {
        currentLines.push(line);
      }
    }

    previousLineWasEmpty = (line.trim().length === 0);
  }

  // Yield the last message
  if (currentLines.length > 0) {
    yield currentLines.join('\n');
  }
}

export function isMboxDelimiterLine(line: string, previousLineWasEmpty: boolean): boolean {
  // 1. Basic check: must start with "From "
  if (!line.startsWith('From ')) {
    return false;
  }

  // 2. "From:" header check (common false positive)
  if (line.startsWith('From:')) {
    return false;
  }

  const parts = line.split(' ');

  // 4. Check for typical date/time patterns ANYWHERE in line (Strong Match)
  // Pattern: includes year (4 digits) and time (HH:MM)
  const hasYear = /\d{4}/.test(line);
  const hasTime = /\d{1,2}:\d{2}/.test(line);

  // If it looks like a standard From line with date, trust it regardless of previous line.
  // We expect at least "From <address> <date_part>" (length >= 3) for a strong match with date.
  if (parts.length >= 3 && hasYear && hasTime) {
    return true;
  }

  // 5. Fallback: Weak match based on Structure
  // Standard strict mbox requires the empty line before the delimiter.
  if (previousLineWasEmpty) {
    // If previous line was empty, we are more permissive.
    // We accept "From <address>" (length >= 2) even if date parsing fails.
    // Valid: "From user@example.com"
    // Invalid: "From " (trailing space only, length 2 in split if space at end? split(' ') gives ['', ''] for ' ', 'From ' -> ['From', ''])
    // 'From user'.split(' ') -> ['From', 'user'] (length 2)
    if (parts.length >= 2 && parts[1].trim() !== '') {
      return true;
    }
  }

  return false;
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

  const conversionReport: MboxConversionItem[] = [];

  logger.info('Starting enhanced MBOX parsing (Robust Mode)', {
    file: filePath,
    vendorDomains,
    confidenceThreshold,
  });

  try {
    const relevantMessages: ParsedEmailMessage[] = [];
    let totalMessages = 0;

    // PHASE 1: Parse and pre-process all messages
    let i = 0;
    for await (const block of streamMboxBlocks(filePath)) {
      if (!block.trim()) {
        continue;
      }

      totalMessages += 1;
      let messageId = `unknown-${i}`;

      try {
        // Parse email
        const parsed: ParsedMail = await simpleParser(block);

        // Extract metadata
        messageId = parsed.messageId || `generated-${i}-${Date.now()}`;
        const from = extractEmailAddress(parsed.from);
        const to = extractEmailAddresses(parsed.to);
        const cc = extractEmailAddresses(parsed.cc);
        const subject = parsed.subject || '';
        const date = parsed.date || new Date();
        const inReplyTo = parsed.inReplyTo || undefined;
        const references = parsed.references || [];

        // Get body text
        const bodyText = parsed.text || '';
        const bodyHtml = parsed.html ? String(parsed.html) : undefined;

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
          body_text: '', // Optimized: exclude raw text
          body_html: undefined, // Optimized: exclude raw html
          in_reply_to: inReplyTo,
          references: Array.isArray(references) ? references : [references],
          cleaned_body: cleanedBody,
          tier1_matches: [],
          tier2_matches: [],
          tier3_matches: [],
        };

        if (isRelevantEmail(parsedMsg, vendorDomains)) {
          relevantMessages.push(parsedMsg);
          // Status determined after full processing, but for now it's "candidate"
        } else {
          conversionReport.push({
            id: messageId,
            status: 'skipped',
            message: 'Irrelevant sender or domain',
            details: { from, subject }
          });
        }

      } catch (error: any) {
        logger.warn('Failed to parse individual email', {
          error: error.message,
          blockIndex: i,
        });
        conversionReport.push({
          id: messageId,
          status: 'failed',
          message: error.message,
          details: { blockIndex: i }
        });
      }

      i += 1;
    }

    logger.info('MBOX parsing pass complete', {
      totalMessages,
      relevantMessages: relevantMessages.length,
    });

    // PHASE 3: Thread Correlation
    let threads: EmailThread[] = [];
    try {
      threads = correlateThreads(relevantMessages);
      logger.info(`Correlated messages into ${threads.length} threads`);
    } catch (err: any) {
      logger.error('Thread correlation failed', err);
      throw new Error(`Thread correlation failed: ${err.message}`);
    }

    // PHASE 4: Layer 2 & 3 - Extract deals from threads
    const allDeals: ExtractedDeal[] = [];

    for (const thread of threads) {
      // logger.info(`Processing thread: "${thread.subject_normalized}"`); // Reduced log spam

      const deals = await processThread(thread);

      // Filter by confidence threshold
      const highConfidenceDeals = deals.filter(
        deal => deal.confidence_score >= confidenceThreshold
      );

      const discardedDeals = deals.filter(
        deal => deal.confidence_score < confidenceThreshold
      );

      // Track conversion report for extracted deals
      highConfidenceDeals.forEach(deal => {
        conversionReport.push({
          id: deal.source_email_id,
          status: 'extracted',
          message: 'Deal extracted successfully',
          details: { dealName: deal.deal_name, confidence: deal.confidence_score }
        });
      });

      // Report discarded low-confidence deals
      discardedDeals.forEach(deal => {
        conversionReport.push({
          id: deal.source_email_id,
          status: 'skipped',
          message: 'Low confidence score',
          details: { confidence: deal.confidence_score, threshold: confidenceThreshold }
        });
      });

      // Mark messages in thread that didn't yield deals as processed/skipped-context
      thread.messages.forEach(msg => {
        const reportExists = conversionReport.find(r => r.id === msg.message_id);
        if (!reportExists) {
          conversionReport.push({
            id: msg.message_id,
            status: 'skipped',
            message: 'Contextual message (no standalone deal)'
          });
        }
      });

      allDeals.push(...highConfidenceDeals);
    }

    // Sort deals by confidence score (highest first)
    allDeals.sort((a, b) => b.confidence_score - a.confidence_score);

    const processingTime = Date.now() - startTime;

    logger.info('Enhanced MBOX parsing complete', {
      totalMessages,
      relevantMessages: relevantMessages.length,
      threads: threads.length,
      dealsExtracted: allDeals.length,
      processingTimeMs: processingTime,
    });

    return {
      threads,
      extractedDeals: allDeals,
      totalMessages,
      relevantMessages: relevantMessages.length,
      processingTime,
      conversionReport,
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
