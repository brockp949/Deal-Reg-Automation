// @ts-nocheck
/**
 * Streaming MBOX Parser for Large Files
 * Processes MBOX files in chunks without loading entire file into memory
 */

import { simpleParser, ParsedMail } from 'mailparser';
import {
  preprocessEmail,
  correlateThreads,
  isRelevantEmail,
  ParsedEmailMessage,
  EmailThread,
  ExtractedDeal,
  extractEmailAddress,
  extractEmailAddresses
} from './enhancedMboxParser';
import { streamMboxBlocks } from './enhancedMboxMain';
import { processThread } from './enhancedMboxParserLayers';
import logger from '../utils/logger';

export interface StreamingMboxResult {
  threads: EmailThread[];
  extractedDeals: ExtractedDeal[];
  totalMessages: number;
  relevantMessages: number;
  processingTime: number;
}

/**
 * Parse large MBOX file using streaming approach
 */
export async function parseStreamingMboxFile(
  filePath: string,
  options: {
    vendorDomains?: string[];
    confidenceThreshold?: number;
    onProgress?: (processed: number, total?: number) => void;
  } = {}
): Promise<StreamingMboxResult> {
  const startTime = Date.now();
  const {
    vendorDomains = [],
    confidenceThreshold = 0.3,
    onProgress,
  } = options;

  logger.info('Starting streaming MBOX parsing', {
    file: filePath,
    vendorDomains,
    confidenceThreshold,
  });

  const relevantMessages: ParsedEmailMessage[] = [];
  let totalMessages = 0;
  let relevantCount = 0;

  for await (const block of streamMboxBlocks(filePath)) {
    if (!block.trim()) {
      continue;
    }

    const index = totalMessages;
    totalMessages += 1;

    if (onProgress && totalMessages % 100 === 0) {
      onProgress(totalMessages);
    }

    try {
      // Parse email
      const parsed: ParsedMail = await simpleParser(block);

      // Extract metadata
      const messageId = parsed.messageId || `generated-${index}-${Date.now()}`;
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
        relevantCount += 1;
      }
    } catch (error: any) {
      logger.warn('Failed to parse individual email', {
        index,
        error: error.message,
      });
    }
  }

  logger.info(`Parsed ${totalMessages} email messages from MBOX file`);

  logger.info('Relevant emails identified', {
    total: totalMessages,
    relevant: relevantMessages.length,
  });

  // PHASE 3: Correlate into threads
  const threads = correlateThreads(relevantMessages);
  logger.info('Email threads created', { count: threads.length });

  // PHASE 4: Extract deals from threads
  const extractedDeals: ExtractedDeal[] = [];

  for (const thread of threads) {
    const threadDeals = await processThread(thread);
    if (Array.isArray(threadDeals)) {
      extractedDeals.push(...threadDeals);
    } else if (threadDeals) {
      logger.warn('Unexpected thread deals payload', {
        type: typeof threadDeals,
      });
    }
  }

  logger.info('Deal extraction completed', {
    deals: extractedDeals.length,
  });

  const processingTime = Date.now() - startTime;

  const result: StreamingMboxResult = {
    threads,
    extractedDeals,
    totalMessages,
    relevantMessages: relevantCount,
    processingTime,
  };

  logger.info('Streaming MBOX parsing completed', {
    totalMessages: result.totalMessages,
    relevantMessages: result.relevantMessages,
    threads: result.threads.length,
    deals: result.extractedDeals.length,
    processingTime: `${processingTime}ms`,
  });

  return result;
}
