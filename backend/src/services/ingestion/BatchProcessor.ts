/**
 * BatchProcessor service for processing all files in input directories.
 *
 * This service handles:
 * - Batch processing of multiple transcript files
 * - Progress tracking and reporting
 * - Error handling and recovery
 * - File archival after processing
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  PATHS,
  listInputFiles,
  archiveProcessedFile,
  getOutputCsvPath,
  getLogFilePath,
  isSupportedFileType,
} from '../../config/paths';
import { parseFileName } from '../../utils/fileNaming';
import logger from '../../utils/logger';
import crypto from 'crypto';

/**
 * Processing status for a single file
 */
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

/**
 * Result of processing a single file
 */
export interface FileProcessingResult {
  filePath: string;
  fileName: string;
  status: ProcessingStatus;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  error?: string;
  dealsExtracted?: number;
  checksum?: string;
  archived?: boolean;
  archivedPath?: string;
}

/**
 * Batch processing summary
 */
export interface BatchProcessingResult {
  batchId: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  totalFiles: number;
  processed: number;
  failed: number;
  skipped: number;
  totalDealsExtracted: number;
  files: FileProcessingResult[];
  outputPath?: string;
}

/**
 * Options for batch processing
 */
export interface BatchProcessorOptions {
  /** Archive files after successful processing */
  archiveAfterProcessing?: boolean;
  /** Continue processing on errors */
  continueOnError?: boolean;
  /** Maximum concurrent file processing */
  concurrency?: number;
  /** Skip files that have already been processed (by checksum) */
  skipDuplicates?: boolean;
  /** Custom file filter function */
  fileFilter?: (filePath: string) => boolean;
  /** Dry run mode - don't actually process */
  dryRun?: boolean;
}

const DEFAULT_OPTIONS: Required<BatchProcessorOptions> = {
  archiveAfterProcessing: true,
  continueOnError: true,
  concurrency: 1, // Process one at a time by default
  skipDuplicates: true,
  fileFilter: () => true,
  dryRun: false,
};

/**
 * File processor callback type
 * Implement this to handle actual file parsing
 */
export type FileProcessorCallback = (
  filePath: string,
  metadata: Record<string, any>
) => Promise<{ dealsExtracted: number; data?: any }>;

/**
 * BatchProcessor class for processing transcript files
 */
export class BatchProcessor extends EventEmitter {
  private options: Required<BatchProcessorOptions>;
  private processedChecksums: Set<string> = new Set();
  private isRunning: boolean = false;
  private currentBatchId: string | null = null;

  constructor(options: BatchProcessorOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Process all files in the input directories
   */
  async processAll(processor: FileProcessorCallback): Promise<BatchProcessingResult> {
    const files = listInputFiles();
    return this.processFiles(files, processor);
  }

  /**
   * Process a specific list of files
   */
  async processFiles(
    filePaths: string[],
    processor: FileProcessorCallback
  ): Promise<BatchProcessingResult> {
    if (this.isRunning) {
      throw new Error('Batch processing is already running');
    }

    this.isRunning = true;
    const batchId = this.generateBatchId();
    this.currentBatchId = batchId;

    const startTime = new Date();
    const results: FileProcessingResult[] = [];

    logger.info(`Starting batch processing (ID: ${batchId}) for ${filePaths.length} file(s)`);
    this.emit('batch:start', { batchId, totalFiles: filePaths.length });

    // Filter files
    const filesToProcess = filePaths.filter((filePath) => {
      if (!isSupportedFileType(filePath)) {
        logger.debug(`Skipping unsupported file: ${filePath}`);
        return false;
      }
      if (!this.options.fileFilter(filePath)) {
        logger.debug(`Skipping filtered file: ${filePath}`);
        return false;
      }
      return true;
    });

    // Process files (currently sequential, can be enhanced for concurrency)
    for (let i = 0; i < filesToProcess.length; i++) {
      const filePath = filesToProcess[i];

      this.emit('file:start', {
        batchId,
        filePath,
        index: i,
        total: filesToProcess.length,
      });

      try {
        const result = await this.processFile(filePath, processor);
        results.push(result);

        this.emit('file:complete', {
          batchId,
          result,
          index: i,
          total: filesToProcess.length,
        });
      } catch (error) {
        const errorResult: FileProcessingResult = {
          filePath,
          fileName: path.basename(filePath),
          status: 'failed',
          startTime: new Date(),
          endTime: new Date(),
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(errorResult);

        this.emit('file:error', {
          batchId,
          filePath,
          error,
          index: i,
          total: filesToProcess.length,
        });

        if (!this.options.continueOnError) {
          break;
        }
      }
    }

    const endTime = new Date();

    // Generate summary
    const summary: BatchProcessingResult = {
      batchId,
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
      totalFiles: filesToProcess.length,
      processed: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      totalDealsExtracted: results.reduce((sum, r) => sum + (r.dealsExtracted || 0), 0),
      files: results,
    };

    // Write processing log
    await this.writeProcessingLog(summary);

    this.isRunning = false;
    this.currentBatchId = null;

    logger.info(
      `Batch processing complete: ${summary.processed} processed, ${summary.failed} failed, ${summary.skipped} skipped`
    );
    this.emit('batch:complete', summary);

    return summary;
  }

  /**
   * Process a single file
   */
  private async processFile(
    filePath: string,
    processor: FileProcessorCallback
  ): Promise<FileProcessingResult> {
    const startTime = new Date();
    const fileName = path.basename(filePath);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return {
        filePath,
        fileName,
        status: 'skipped',
        startTime,
        endTime: new Date(),
        error: 'File not found',
      };
    }

    // Calculate checksum
    const checksum = await this.calculateChecksum(filePath);

    // Check for duplicates
    if (this.options.skipDuplicates && this.processedChecksums.has(checksum)) {
      logger.debug(`Skipping duplicate file (checksum match): ${filePath}`);
      return {
        filePath,
        fileName,
        status: 'skipped',
        startTime,
        endTime: new Date(),
        checksum,
        error: 'Duplicate file (already processed)',
      };
    }

    // Dry run mode
    if (this.options.dryRun) {
      logger.info(`[DRY RUN] Would process: ${filePath}`);
      return {
        filePath,
        fileName,
        status: 'skipped',
        startTime,
        endTime: new Date(),
        checksum,
        error: 'Dry run mode',
      };
    }

    // Get file metadata
    const parsed = parseFileName(fileName);
    const metadata = {
      source: parsed.source,
      date: parsed.date,
      description: parsed.description,
      extension: parsed.extension,
    };

    // Process the file
    logger.info(`Processing file: ${filePath}`);
    const result = await processor(filePath, metadata);

    const endTime = new Date();

    // Mark checksum as processed
    this.processedChecksums.add(checksum);

    // Archive file if configured
    let archivedPath: string | undefined;
    if (this.options.archiveAfterProcessing) {
      try {
        archivedPath = archiveProcessedFile(filePath);
        logger.debug(`Archived file to: ${archivedPath}`);
      } catch (error) {
        logger.warn(`Failed to archive file ${filePath}:`, error);
      }
    }

    return {
      filePath,
      fileName,
      status: 'completed',
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
      dealsExtracted: result.dealsExtracted,
      checksum,
      archived: !!archivedPath,
      archivedPath,
    };
  }

  /**
   * Calculate SHA256 checksum of a file
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Generate a unique batch ID
   */
  private generateBatchId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `batch_${timestamp}_${random}`;
  }

  /**
   * Write processing log to file
   */
  private async writeProcessingLog(summary: BatchProcessingResult): Promise<void> {
    const logPath = getLogFilePath(`batch_${summary.batchId}`);

    const logContent = {
      ...summary,
      generatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(logPath, JSON.stringify(logContent, null, 2));
      summary.outputPath = logPath;
      logger.debug(`Processing log written to: ${logPath}`);
    } catch (error) {
      logger.error(`Failed to write processing log:`, error);
    }
  }

  /**
   * Get the current batch ID if processing
   */
  getBatchId(): string | null {
    return this.currentBatchId;
  }

  /**
   * Check if currently processing
   */
  isProcessing(): boolean {
    return this.isRunning;
  }

  /**
   * Get list of processed checksums (for deduplication)
   */
  getProcessedChecksums(): string[] {
    return Array.from(this.processedChecksums);
  }

  /**
   * Load previously processed checksums from log files
   */
  async loadProcessedChecksums(): Promise<void> {
    const logsDir = PATHS.OUTPUT_LOGS;

    if (!fs.existsSync(logsDir)) {
      return;
    }

    const logFiles = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));

    for (const logFile of logFiles) {
      try {
        const content = fs.readFileSync(path.join(logsDir, logFile), 'utf-8');
        const data = JSON.parse(content);

        if (data.files && Array.isArray(data.files)) {
          for (const file of data.files) {
            if (file.checksum && file.status === 'completed') {
              this.processedChecksums.add(file.checksum);
            }
          }
        }
      } catch {
        // Skip invalid log files
      }
    }

    logger.debug(`Loaded ${this.processedChecksums.size} previously processed checksums`);
  }

  /**
   * Clear the processed checksums cache
   */
  clearProcessedChecksums(): void {
    this.processedChecksums.clear();
    logger.debug('Cleared processed checksums cache');
  }
}

/**
 * Create a new BatchProcessor instance
 */
export function createBatchProcessor(options?: BatchProcessorOptions): BatchProcessor {
  return new BatchProcessor(options);
}

export default BatchProcessor;
