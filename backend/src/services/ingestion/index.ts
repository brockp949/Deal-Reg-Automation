/**
 * Ingestion services for transcript processing pipeline.
 *
 * This module provides services for:
 * - File watching (monitoring input directories)
 * - Batch processing (processing multiple files)
 */

export {
  FileWatcher,
  createFileWatcher,
  type FileWatcherOptions,
  type FileWatcherEvents,
  type WatchedFile,
} from './FileWatcher';

export {
  BatchProcessor,
  createBatchProcessor,
  type BatchProcessorOptions,
  type FileProcessingResult,
  type BatchProcessingResult,
  type ProcessingStatus,
  type FileProcessorCallback,
} from './BatchProcessor';
