// @ts-nocheck
/**
 * Streaming MBOX Parser for Large Files
 * Processes MBOX files in chunks without loading entire file into memory
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
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

  const parsedMessages: ParsedEmailMessage[] = [];
  const emailBlocks: string[] = [];
  let currentEmailLines: string[] = [];
  let isFirstEmail = true;

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      // Detect start of new email (lines starting with "From ")
      if (line.startsWith('From ') && !isFirstEmail) {
        // Save the accumulated email block
        emailBlocks.push(currentEmailLines.join('\n'));
        currentEmailLines = [];

        if (onProgress && emailBlocks.length % 100 === 0) {
          onProgress(emailBlocks.length);
        }
      }

      if (line.startsWith('From ') && isFirstEmail) {
        isFirstEmail = false;
      }

      currentEmailLines.push(line);
    });

    rl.on('close', async () => {
      try {
        // Save the last email
        if (currentEmailLines.length > 0) {
          emailBlocks.push(currentEmailLines.join('\n'));
        }

        const totalBlocks = emailBlocks.length;
        logger.info(`Found ${totalBlocks} email blocks in MBOX file`);

        // Process emails in batches to avoid memory issues
        const batchSize = 50;
        if (onProgress) {
          onProgress(0, totalBlocks);
        }

        for (let i = 0; i < totalBlocks; i += batchSize) {
          const batch = emailBlocks.slice(i, i + batchSize);

          for (const [index, block] of batch.entries()) {
            await processEmailBlock(block, i + index);
          }

          if (onProgress) {
            onProgress(Math.min(i + batchSize, totalBlocks), totalBlocks);
          }
        }

        logger.info(`Parsed ${parsedMessages.length} email messages from MBOX file`);

        // PHASE 2: Filter relevant emails
        const relevantMessages = parsedMessages.filter((msg) =>
          isRelevantEmail(msg, vendorDomains)
        );

        logger.info('Relevant emails identified', {
          total: parsedMessages.length,
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
          totalMessages: parsedMessages.length,
          relevantMessages: relevantMessages.length,
          processingTime,
        };

        logger.info('Streaming MBOX parsing completed', {
          totalMessages: result.totalMessages,
          relevantMessages: result.relevantMessages,
          threads: result.threads.length,
          deals: result.extractedDeals.length,
          processingTime: `${processingTime}ms`,
        });

        resolve(result);
      } catch (error) {
        logger.error('Error in streaming MBOX parsing', { error });
        reject(error);
      }
    });

    rl.on('error', (error) => {
      logger.error('Error reading MBOX file', { error });
      reject(error);
    });

    async function processEmailBlock(block: string, index: number) {
      if (!block.trim()) return;

      try {
        // Remove the "From " line
        const emailContent = block.replace(/^From .*\n/, '');

        // Parse email
        const parsed: ParsedMail = await simpleParser(emailContent);

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
          index,
          error: error.message,
        });
      }
    }
  });
}
