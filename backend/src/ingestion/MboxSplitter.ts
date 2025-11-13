/**
 * MBOX Splitter - Phase 1 Implementation
 * Splits large MBOX files into manageable chunks while maintaining message integrity
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import logger from '../utils/logger';

export interface ChunkMetadata {
  chunk_id: string;
  path: string;
  size_bytes: number;
  message_count: number;
  date_range: {
    start: string | null;
    end: string | null;
  };
  hash: string;
  labels: string[];
}

export interface SplitMetadata {
  original_file: string;
  original_size_bytes: number;
  original_hash: string;
  chunks: ChunkMetadata[];
  split_timestamp: string;
}

export interface SplitterOptions {
  chunk_size_mb?: number;
  output_dir?: string;
  preserve_labels?: boolean;
}

export class MboxSplitter {
  private chunkSizeMB: number;
  private outputDir: string;
  private preserveLabels: boolean;

  constructor(options: SplitterOptions = {}) {
    this.chunkSizeMB = options.chunk_size_mb || 500;
    this.outputDir = options.output_dir || './data/chunks';
    this.preserveLabels = options.preserve_labels !== false;
  }

  /**
   * Split MBOX file into chunks
   */
  async split_mbox(filePath: string): Promise<SplitMetadata> {
    const startTime = Date.now();
    logger.info('Starting MBOX split', {
      file: filePath,
      chunkSizeMB: this.chunkSizeMB,
    });

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Get original file stats
    const stats = fs.statSync(filePath);
    const originalSizeBytes = stats.size;
    const originalHash = await this.calculateFileHash(filePath);

    const baseName = path.basename(filePath, '.mbox');
    const chunkSizeBytes = this.chunkSizeMB * 1024 * 1024;

    const chunks: ChunkMetadata[] = [];
    let currentChunkIndex = 1;
    let currentChunkLines: string[] = [];
    let currentChunkSize = 0;
    let currentChunkMessages = 0;
    let currentChunkStart: Date | null = null;
    let currentChunkEnd: Date | null = null;
    let currentMessageLines: string[] = [];
    let isFirstMessage = true;

    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      const writeCurrentChunk = async () => {
        if (currentChunkLines.length === 0) return;

        const chunkId = `${baseName}_chunk_${String(currentChunkIndex).padStart(3, '0')}`;
        const chunkPath = path.join(this.outputDir, `${chunkId}.mbox`);

        // Write chunk to file
        fs.writeFileSync(chunkPath, currentChunkLines.join('\n'), 'utf-8');

        // Calculate chunk hash
        const chunkHash = await this.calculateFileHash(chunkPath);
        const chunkSize = fs.statSync(chunkPath).size;

        // Create chunk metadata
        const metadata: ChunkMetadata = {
          chunk_id: chunkId,
          path: chunkPath,
          size_bytes: chunkSize,
          message_count: currentChunkMessages,
          date_range: {
            start: currentChunkStart?.toISOString() || null,
            end: currentChunkEnd?.toISOString() || null,
          },
          hash: chunkHash,
          labels: [], // Will be populated during processing
        };

        chunks.push(metadata);

        logger.info('Chunk written', {
          chunkId,
          messages: currentChunkMessages,
          sizeKB: Math.round(chunkSize / 1024),
        });

        // Reset for next chunk
        currentChunkIndex++;
        currentChunkLines = [];
        currentChunkSize = 0;
        currentChunkMessages = 0;
        currentChunkStart = null;
        currentChunkEnd = null;
      };

      rl.on('line', (line: string) => {
        // Detect start of new message
        if (line.startsWith('From ')) {
          // If we have a previous message, add it to the chunk
          if (currentMessageLines.length > 0) {
            const messageText = currentMessageLines.join('\n');
            const messageSize = Buffer.byteLength(messageText, 'utf-8');

            // Check if adding this message would exceed chunk size
            if (
              currentChunkSize + messageSize > chunkSizeBytes &&
              currentChunkMessages > 0
            ) {
              // Write current chunk (async, but we'll handle it)
              writeCurrentChunk().catch((err) => {
                logger.error('Error writing chunk', { error: err });
              });
            }

            // Add message to current chunk
            currentChunkLines.push(...currentMessageLines);
            currentChunkSize += messageSize;
            currentChunkMessages++;

            // Extract date from message for date range tracking
            const dateMatch = currentMessageLines.find((l) =>
              l.startsWith('Date:')
            );
            if (dateMatch) {
              const dateStr = dateMatch.substring(5).trim();
              try {
                const msgDate = new Date(dateStr);
                if (!currentChunkStart || msgDate < currentChunkStart) {
                  currentChunkStart = msgDate;
                }
                if (!currentChunkEnd || msgDate > currentChunkEnd) {
                  currentChunkEnd = msgDate;
                }
              } catch (err) {
                // Ignore date parsing errors
              }
            }
          }

          // Start new message
          currentMessageLines = [line];
          isFirstMessage = false;
        } else {
          // Add line to current message
          currentMessageLines.push(line);
        }
      });

      rl.on('close', async () => {
        try {
          // Add the last message
          if (currentMessageLines.length > 0) {
            currentChunkLines.push(...currentMessageLines);
            currentChunkMessages++;
          }

          // Write the final chunk
          await writeCurrentChunk();

          const processingTime = Date.now() - startTime;

          const metadata: SplitMetadata = {
            original_file: filePath,
            original_size_bytes: originalSizeBytes,
            original_hash: originalHash,
            chunks,
            split_timestamp: new Date().toISOString(),
          };

          // Write metadata file
          const metadataPath = path.join(
            this.outputDir,
            `${baseName}_metadata.json`
          );
          fs.writeFileSync(
            metadataPath,
            JSON.stringify(metadata, null, 2),
            'utf-8'
          );

          logger.info('MBOX split completed', {
            originalSizeMB: Math.round(originalSizeBytes / (1024 * 1024)),
            chunks: chunks.length,
            totalMessages: chunks.reduce((sum, c) => sum + c.message_count, 0),
            processingTimeMs: processingTime,
          });

          resolve(metadata);
        } catch (error) {
          logger.error('Error finalizing MBOX split', { error });
          reject(error);
        }
      });

      rl.on('error', (error) => {
        logger.error('Error reading MBOX file', { error });
        reject(error);
      });
    });
  }

  /**
   * Validate that chunks can be reconstructed to match original file
   */
  async validate_split(
    originalPath: string,
    chunkPaths: string[]
  ): Promise<boolean> {
    logger.info('Validating MBOX split', {
      original: originalPath,
      chunks: chunkPaths.length,
    });

    try {
      // Calculate original hash
      const originalHash = await this.calculateFileHash(originalPath);

      // Concatenate chunks and calculate combined hash
      const tempReconstructedPath = path.join(
        this.outputDir,
        `_temp_reconstructed_${Date.now()}.mbox`
      );
      const writeStream = createWriteStream(tempReconstructedPath);

      for (const chunkPath of chunkPaths) {
        const chunkContent = fs.readFileSync(chunkPath, 'utf-8');
        writeStream.write(chunkContent);
      }

      writeStream.end();

      await new Promise<void>((resolve) => writeStream.on('finish', () => resolve()));

      const reconstructedHash = await this.calculateFileHash(
        tempReconstructedPath
      );

      // Clean up temp file
      fs.unlinkSync(tempReconstructedPath);

      const isValid = originalHash === reconstructedHash;

      logger.info('Split validation result', {
        isValid,
        originalHash,
        reconstructedHash,
      });

      return isValid;
    } catch (error) {
      logger.error('Error validating split', { error });
      return false;
    }
  }

  /**
   * Calculate SHA256 hash of a file
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Get chunk metadata from a split operation
   */
  async getChunkMetadata(baseName: string): Promise<SplitMetadata | null> {
    const metadataPath = path.join(
      this.outputDir,
      `${baseName}_metadata.json`
    );

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    const content = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content) as SplitMetadata;
  }
}
