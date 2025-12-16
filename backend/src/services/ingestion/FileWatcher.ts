/**
 * FileWatcher service for monitoring the input_transcripts directory.
 *
 * This service watches for new files added to the input directories
 * and triggers processing when new files are detected.
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { PATHS, isSupportedFileType, FILE_TYPE_DIRECTORIES } from '../../config/paths';
import { parseFileName, detectFileSource } from '../../utils/fileNaming';
import logger from '../../utils/logger';

/**
 * Event types emitted by the FileWatcher
 */
export interface FileWatcherEvents {
  'file:added': (file: WatchedFile) => void;
  'file:changed': (file: WatchedFile) => void;
  'file:removed': (filePath: string) => void;
  'error': (error: Error) => void;
  'ready': () => void;
}

/**
 * Information about a watched file
 */
export interface WatchedFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: Date;
  createdAt: Date;
  source: string;
  metadata: Record<string, string | null>;
}

/**
 * Configuration options for the FileWatcher
 */
export interface FileWatcherOptions {
  /** Debounce time in ms for file change events */
  debounceMs?: number;
  /** Whether to process existing files on startup */
  processExisting?: boolean;
  /** Polling interval in ms (fallback for systems without native watch) */
  pollingInterval?: number;
  /** File extensions to watch (defaults to all supported) */
  extensions?: string[];
}

const DEFAULT_OPTIONS: Required<FileWatcherOptions> = {
  debounceMs: 500,
  processExisting: true,
  pollingInterval: 5000,
  extensions: Object.keys(FILE_TYPE_DIRECTORIES),
};

/**
 * FileWatcher class for monitoring input directories
 */
export class FileWatcher extends EventEmitter {
  private options: Required<FileWatcherOptions>;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private knownFiles: Map<string, WatchedFile> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pollingTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(options: FileWatcherOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start watching the input directories
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('FileWatcher is already running');
      return;
    }

    logger.info('Starting FileWatcher service');
    this.isRunning = true;

    // Ensure directories exist
    this.ensureDirectories();

    // Get directories to watch
    const directoriesToWatch = this.getDirectoriesToWatch();

    // Start watching each directory
    for (const dir of directoriesToWatch) {
      try {
        this.watchDirectory(dir);
      } catch (error) {
        logger.error(`Failed to watch directory ${dir}:`, error);
      }
    }

    // Process existing files if configured
    if (this.options.processExisting) {
      await this.scanExistingFiles();
    }

    // Start polling as a fallback
    this.startPolling();

    this.emit('ready');
    logger.info('FileWatcher service started');
  }

  /**
   * Stop watching directories
   */
  stop(): void {
    logger.info('Stopping FileWatcher service');
    this.isRunning = false;

    // Close all watchers
    for (const [dir, watcher] of this.watchers) {
      watcher.close();
      logger.debug(`Closed watcher for ${dir}`);
    }
    this.watchers.clear();

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Stop polling
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    logger.info('FileWatcher service stopped');
  }

  /**
   * Get list of currently known files
   */
  getKnownFiles(): WatchedFile[] {
    return Array.from(this.knownFiles.values());
  }

  /**
   * Manually trigger a scan of existing files
   */
  async rescan(): Promise<WatchedFile[]> {
    return this.scanExistingFiles();
  }

  /**
   * Check if a specific file is being watched
   */
  isWatching(filePath: string): boolean {
    return this.knownFiles.has(filePath);
  }

  // Private methods

  private ensureDirectories(): void {
    const dirs = [
      PATHS.INPUT_ROOT,
      PATHS.INPUT_MBOX,
      PATHS.INPUT_PDF,
      PATHS.INPUT_DOCX,
      PATHS.INPUT_TXT,
      PATHS.PROCESSED,
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.debug(`Created directory: ${dir}`);
      }
    }
  }

  private getDirectoriesToWatch(): string[] {
    return [
      PATHS.INPUT_ROOT,
      PATHS.INPUT_MBOX,
      PATHS.INPUT_PDF,
      PATHS.INPUT_DOCX,
      PATHS.INPUT_TXT,
    ];
  }

  private watchDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      logger.warn(`Directory does not exist: ${dir}`);
      return;
    }

    try {
      const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
        if (!filename) return;

        const filePath = path.join(dir, filename);
        this.handleFileEvent(eventType, filePath);
      });

      watcher.on('error', (error) => {
        logger.error(`Watcher error for ${dir}:`, error);
        this.emit('error', error);
      });

      this.watchers.set(dir, watcher);
      logger.debug(`Watching directory: ${dir}`);
    } catch (error) {
      logger.error(`Failed to create watcher for ${dir}:`, error);
    }
  }

  private handleFileEvent(eventType: string, filePath: string): void {
    // Skip if not a supported file type
    if (!isSupportedFileType(filePath)) {
      return;
    }

    // Skip processed directory
    if (filePath.includes(path.sep + 'processed' + path.sep)) {
      return;
    }

    // Debounce the event
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processFileEvent(filePath);
    }, this.options.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  private async processFileEvent(filePath: string): Promise<void> {
    try {
      const exists = fs.existsSync(filePath);

      if (!exists) {
        // File was removed
        if (this.knownFiles.has(filePath)) {
          this.knownFiles.delete(filePath);
          this.emit('file:removed', filePath);
          logger.info(`File removed: ${filePath}`);
        }
        return;
      }

      const stats = fs.statSync(filePath);

      // Skip directories
      if (stats.isDirectory()) {
        return;
      }

      const watchedFile = this.createWatchedFile(filePath, stats);

      if (this.knownFiles.has(filePath)) {
        // File was changed
        const existing = this.knownFiles.get(filePath)!;
        if (existing.modifiedAt.getTime() !== watchedFile.modifiedAt.getTime()) {
          this.knownFiles.set(filePath, watchedFile);
          this.emit('file:changed', watchedFile);
          logger.info(`File changed: ${filePath}`);
        }
      } else {
        // New file
        this.knownFiles.set(filePath, watchedFile);
        this.emit('file:added', watchedFile);
        logger.info(`New file detected: ${filePath}`);
      }
    } catch (error) {
      logger.error(`Error processing file event for ${filePath}:`, error);
    }
  }

  private async scanExistingFiles(): Promise<WatchedFile[]> {
    const newFiles: WatchedFile[] = [];
    const directories = this.getDirectoriesToWatch();

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        continue;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const filePath = path.join(dir, entry.name);

        if (!isSupportedFileType(filePath)) {
          continue;
        }

        if (this.knownFiles.has(filePath)) {
          continue;
        }

        try {
          const stats = fs.statSync(filePath);
          const watchedFile = this.createWatchedFile(filePath, stats);

          this.knownFiles.set(filePath, watchedFile);
          newFiles.push(watchedFile);
          this.emit('file:added', watchedFile);
          logger.debug(`Found existing file: ${filePath}`);
        } catch (error) {
          logger.error(`Error scanning file ${filePath}:`, error);
        }
      }
    }

    if (newFiles.length > 0) {
      logger.info(`Found ${newFiles.length} existing file(s) in input directories`);
    }

    return newFiles;
  }

  private createWatchedFile(filePath: string, stats: fs.Stats): WatchedFile {
    const fileName = path.basename(filePath);
    const parsed = parseFileName(fileName);

    // Try to detect source from filename or by peeking at content
    let source = parsed.source;
    if (source === 'unknown') {
      source = detectFileSource(fileName);
    }

    return {
      path: filePath,
      name: fileName,
      extension: parsed.extension,
      size: stats.size,
      modifiedAt: stats.mtime,
      createdAt: stats.birthtime,
      source,
      metadata: {
        source: parsed.source,
        date: parsed.date,
        description: parsed.description,
        format: parsed.isStandardFormat ? 'standard' : 'non-standard',
      },
    };
  }

  private startPolling(): void {
    // Polling as a fallback for systems where fs.watch is unreliable
    this.pollingTimer = setInterval(() => {
      if (!this.isRunning) {
        return;
      }

      this.scanExistingFiles().catch((error) => {
        logger.error('Error during polling scan:', error);
      });
    }, this.options.pollingInterval);
  }
}

/**
 * Create and start a FileWatcher instance
 */
export function createFileWatcher(options?: FileWatcherOptions): FileWatcher {
  const watcher = new FileWatcher(options);
  return watcher;
}

export default FileWatcher;
