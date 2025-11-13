/**
 * Message Stream Iterator - Phase 1 Implementation
 * Efficiently streams messages from MBOX chunks with resumability
 */

import { createReadStream, statSync } from 'fs';
import { createInterface } from 'readline';
import { simpleParser, ParsedMail } from 'mailparser';
import logger from '../utils/logger';

export interface IteratorOptions {
  resume_position?: number;
  buffer_size_kb?: number;
  skip_malformed?: boolean;
  onProgress?: (position: number, total: number) => void;
}

export interface IteratorState {
  position: number;
  messages_processed: number;
  bytes_read: number;
  errors: number;
}

export class MessageStreamIterator {
  private chunkPath: string;
  private resumePosition: number;
  private bufferSizeKB: number;
  private skipMalformed: boolean;
  private onProgress?: (position: number, total: number) => void;

  private currentPosition: number = 0;
  private messagesProcessed: number = 0;
  private bytesRead: number = 0;
  private errors: number = 0;
  private fileSize: number = 0;

  constructor(chunkPath: string, options: IteratorOptions = {}) {
    this.chunkPath = chunkPath;
    this.resumePosition = options.resume_position || 0;
    this.bufferSizeKB = options.buffer_size_kb || 4;
    this.skipMalformed = options.skip_malformed !== false;
    this.onProgress = options.onProgress;

    // Get file size for progress reporting
    try {
      const stats = statSync(chunkPath);
      this.fileSize = stats.size;
    } catch (error) {
      logger.error('Error getting chunk file stats', { error, chunkPath });
      this.fileSize = 0;
    }

    logger.debug('MessageStreamIterator initialized', {
      chunkPath,
      resumePosition: this.resumePosition,
      fileSizeMB: Math.round(this.fileSize / (1024 * 1024)),
    });
  }

  /**
   * Iterate through messages in the chunk
   */
  async *iterate(): AsyncGenerator<ParsedMail, void, unknown> {
    const emailBlocks: string[] = [];
    let currentEmailLines: string[] = [];
    let isFirstEmail = true;
    let currentByteOffset = 0;
    let skippedBytes = 0;

    const stream = createReadStream(this.chunkPath, {
      encoding: 'utf-8',
      highWaterMark: this.bufferSizeKB * 1024,
    });

    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    // Collect all email blocks first
    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line + '\n', 'utf-8');
      currentByteOffset += lineBytes;

      // Skip to resume position if needed
      if (currentByteOffset < this.resumePosition) {
        skippedBytes = currentByteOffset;
        continue;
      }

      // Detect start of new email
      if (line.startsWith('From ')) {
        if (!isFirstEmail && currentEmailLines.length > 0) {
          emailBlocks.push(currentEmailLines.join('\n'));
          currentEmailLines = [];
        }
        isFirstEmail = false;
      }

      currentEmailLines.push(line);
    }

    // Add last email block
    if (currentEmailLines.length > 0) {
      emailBlocks.push(currentEmailLines.join('\n'));
    }

    logger.info('Email blocks collected', {
      total: emailBlocks.length,
      skippedBytes,
      resumePosition: this.resumePosition,
    });

    // Process each email block
    for (let i = 0; i < emailBlocks.length; i++) {
      const block = emailBlocks[i];

      try {
        // Parse the email block
        const parsedMail = await this.parseEmailBlock(block, i);

        if (parsedMail) {
          this.messagesProcessed++;
          this.currentPosition = currentByteOffset;
          this.bytesRead += Buffer.byteLength(block, 'utf-8');

          // Report progress
          if (this.onProgress && this.fileSize > 0) {
            this.onProgress(this.bytesRead, this.fileSize);
          }

          yield parsedMail;
        }
      } catch (error: any) {
        this.errors++;

        if (this.skipMalformed) {
          logger.warn('Skipping malformed email', {
            index: i,
            error: error.message,
          });
          continue;
        } else {
          logger.error('Error parsing email', { index: i, error });
          throw error;
        }
      }
    }

    logger.info('Message iteration complete', {
      messagesProcessed: this.messagesProcessed,
      errors: this.errors,
      bytesRead: this.bytesRead,
    });
  }

  /**
   * Parse a single email block
   */
  private async parseEmailBlock(
    block: string,
    index: number
  ): Promise<ParsedMail | null> {
    if (!block.trim()) {
      return null;
    }

    try {
      // Remove the "From " line
      const emailContent = block.replace(/^From .*\n/, '');

      // Parse email with mailparser
      const parsed = await simpleParser(emailContent);

      return parsed;
    } catch (error: any) {
      logger.debug('Failed to parse email block', {
        index,
        error: error.message,
        blockPreview: block.substring(0, 200),
      });
      throw error;
    }
  }

  /**
   * Get current iterator state
   */
  get_state(): IteratorState {
    return {
      position: this.currentPosition,
      messages_processed: this.messagesProcessed,
      bytes_read: this.bytesRead,
      errors: this.errors,
    };
  }

  /**
   * Get current position (for resumability)
   */
  get_position(): number {
    return this.currentPosition;
  }

  /**
   * Process all messages with a callback
   */
  async process_all(
    callback: (message: ParsedMail, index: number) => Promise<void>
  ): Promise<IteratorState> {
    let index = 0;

    for await (const message of this.iterate()) {
      await callback(message, index);
      index++;
    }

    return this.get_state();
  }

  /**
   * Collect all messages into an array (use carefully - can consume memory)
   */
  async collect_all(): Promise<ParsedMail[]> {
    const messages: ParsedMail[] = [];

    for await (const message of this.iterate()) {
      messages.push(message);
    }

    return messages;
  }

  /**
   * Count messages without fully parsing
   */
  async count_messages(): Promise<number> {
    let count = 0;

    for await (const _ of this.iterate()) {
      count++;
    }

    return count;
  }

  /**
   * Get file info
   */
  get_file_info(): {
    path: string;
    size_bytes: number;
    size_mb: number;
  } {
    return {
      path: this.chunkPath,
      size_bytes: this.fileSize,
      size_mb: Math.round((this.fileSize / (1024 * 1024)) * 100) / 100,
    };
  }
}

/**
 * Helper function to create and use iterator in one go
 */
export async function stream_mbox_chunk(
  chunkPath: string,
  callback: (message: ParsedMail, index: number) => Promise<void>,
  options: IteratorOptions = {}
): Promise<IteratorState> {
  const iterator = new MessageStreamIterator(chunkPath, options);
  return iterator.process_all(callback);
}
