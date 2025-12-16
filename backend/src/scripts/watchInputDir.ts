/**
 * Watch Input Directory Script
 *
 * This script starts the FileWatcher service to monitor the input_transcripts
 * directory for new files and process them automatically.
 *
 * Usage:
 *   npm run transcript:watch
 *   npm run transcript:watch -- --no-process-existing
 */

import { createFileWatcher, WatchedFile } from '../services/ingestion/FileWatcher';
import { ensureDirectories, PATHS } from '../config/paths';
import logger from '../utils/logger';

// Parse command line arguments
const args = process.argv.slice(2);
const processExisting = !args.includes('--no-process-existing');

async function main() {
  logger.info('=== Input Directory Watcher ===');
  logger.info(`Watching: ${PATHS.INPUT_ROOT}`);

  // Ensure directories exist
  ensureDirectories();
  logger.info('Directory structure verified');

  // Create file watcher
  const watcher = createFileWatcher({
    processExisting,
    debounceMs: 1000,
    pollingInterval: 10000,
  });

  // Set up event handlers
  watcher.on('ready', () => {
    logger.info('FileWatcher is ready and monitoring directories');
    logger.info('Press Ctrl+C to stop');
    console.log('');
  });

  watcher.on('file:added', (file: WatchedFile) => {
    console.log('');
    logger.info(`New file detected: ${file.name}`);
    logger.info(`  Path: ${file.path}`);
    logger.info(`  Size: ${formatBytes(file.size)}`);
    logger.info(`  Source: ${file.source}`);
    logger.info(`  Type: ${file.extension}`);

    // In a full implementation, this would trigger the BatchProcessor
    // For now, just log the detection
    logger.info('  Status: Queued for processing');
    logger.info('  Run "npm run transcript:process" to process all queued files');
    console.log('');
  });

  watcher.on('file:changed', (file: WatchedFile) => {
    logger.info(`File modified: ${file.name}`);
  });

  watcher.on('file:removed', (filePath: string) => {
    logger.info(`File removed: ${filePath}`);
  });

  watcher.on('error', (error: Error) => {
    logger.error('FileWatcher error:', error);
  });

  // Start watching
  await watcher.start();

  // Display initial file count
  const knownFiles = watcher.getKnownFiles();
  if (knownFiles.length > 0) {
    console.log('');
    logger.info(`Found ${knownFiles.length} existing file(s) in input directories:`);
    for (const file of knownFiles) {
      logger.info(`  - ${file.name} (${file.source}, ${formatBytes(file.size)})`);
    }
    console.log('');
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('');
    logger.info('Received SIGINT, stopping watcher...');
    watcher.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, stopping watcher...');
    watcher.stop();
    process.exit(0);
  });
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run the script
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
