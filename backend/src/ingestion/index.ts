/**
 * Phase 1 Ingestion Module - Export Index
 * Exports all ingestion components for easy import
 */

export { MboxSplitter, ChunkMetadata, SplitMetadata, SplitterOptions } from './MboxSplitter';
export { GmailLabelFilter, LabelConfig, LabelPriority, DEFAULT_LABEL_CONFIG } from './GmailLabelFilter';
export { ChunkIndex, ChunkRecord, ProcessingLogEntry } from './ChunkIndex';
export { MessageStreamIterator, IteratorOptions, IteratorState, stream_mbox_chunk } from './MessageStreamIterator';
export { FileLock, LockOptions, LockInfo, with_file_lock, cleanup_stale_locks } from './FileLocks';
export { DEFAULT_INGESTION_CONFIG, getIngestionConfig, loadIngestionConfigFromEnv, IngestionConfig } from '../config/ingestion';
export {
  SourceSyncService,
  SourceSyncOptions,
  GmailSyncConfig,
  DriveSyncConfig,
  SourceManifestEntry,
} from './SourceSyncService';
