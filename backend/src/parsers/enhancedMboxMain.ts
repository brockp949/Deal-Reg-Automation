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

export interface EnhancedMboxResult {
  threads: EmailThread[];
  extractedDeals: ExtractedDeal[];
  totalMessages: number;
  relevantMessages: number;
  processingTime: number;
}

function isMboxDelimiterLine(line: string): boolean {
  if (!line.startsWith('From ')) {
    return false;
  }

  // Avoid false positives on headers like "From:"
  if (line.startsWith('From:')) {
    return false;
  }

  // Heuristic: typical mbox delimiter lines include a time token and a year token.
  const parts = line.split(' ').filter(Boolean);
  if (parts.length < 2) {
    return false;
  }

  const hasTime = parts.some((part) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part));
  const hasYear = parts.some((part) => /^\d{4}$/.test(part));

  return hasTime && hasYear;
}

async function* streamMboxBlocks(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let currentLines: string[] = [];

  for await (const line of rl) {
    if (isMboxDelimiterLine(line) && currentLines.length > 0) {
      yield currentLines.join('\n');
      currentLines = [];
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    yield currentLines.join('\n');
  }
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
    const relevantMessages: ParsedEmailMessage[] = [];
    let totalMessages = 0;

    // PHASE 1: Parse and pre-process all messages
    let i = 0;
    for await (const block of streamMboxBlocks(filePath)) {
      if (!block.trim()) {
        continue;
      }

      totalMessages += 1;
      try {
        // Remove the "From " line
        const emailContent = block.replace(/^From .*\r?\n/, '');

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
          // Raw bodies are not used by downstream extraction; keep minimal to reduce memory.
          body_text: '',
          body_html: undefined,
          in_reply_to: inReplyTo,
          references: Array.isArray(references) ? references : [references],
          cleaned_body: cleanedBody,
          tier1_matches: [],
          tier2_matches: [],
          tier3_matches: [],
        };

        if (isRelevantEmail(parsedMsg, vendorDomains)) {
          relevantMessages.push(parsedMsg);
        }

      } catch (error: any) {
        logger.warn('Failed to parse individual email', {
          error: error.message,
          blockIndex: i,
        });
      }

      i += 1;
    }

    logger.info('MBOX parsing pass complete', {
      totalMessages,
      relevantMessages: relevantMessages.length,
    });

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
