/**
 * Centralized path configuration for file ingestion and processing.
 *
 * This module provides standardized paths for:
 * - Input transcripts (mbox, pdf, docx, txt)
 * - Processed file archives
 * - Output files (csv, logs)
 */

import path from 'path';
import fs from 'fs';

/**
 * Get the project root directory (one level up from backend)
 */
function getProjectRoot(): string {
  // When running from backend/src, go up to project root
  const currentDir = process.cwd();
  if (currentDir.endsWith('backend')) {
    return path.resolve(currentDir, '..');
  }
  return currentDir;
}

const PROJECT_ROOT = getProjectRoot();

/**
 * All standardized paths for the transcript processing pipeline
 */
export const PATHS = {
  // Project root
  PROJECT_ROOT,

  // Input directories for raw files
  INPUT_ROOT: path.resolve(PROJECT_ROOT, 'input_transcripts'),
  INPUT_MBOX: path.resolve(PROJECT_ROOT, 'input_transcripts/mbox'),
  INPUT_PDF: path.resolve(PROJECT_ROOT, 'input_transcripts/pdf'),
  INPUT_DOCX: path.resolve(PROJECT_ROOT, 'input_transcripts/docx'),
  INPUT_TXT: path.resolve(PROJECT_ROOT, 'input_transcripts/txt'),

  // Processed files archive
  PROCESSED: path.resolve(PROJECT_ROOT, 'input_transcripts/processed'),

  // Output directories
  OUTPUT_ROOT: path.resolve(PROJECT_ROOT, 'output'),
  OUTPUT_CSV: path.resolve(PROJECT_ROOT, 'output/csv'),
  OUTPUT_LOGS: path.resolve(PROJECT_ROOT, 'output/logs'),

  // Backend specific paths
  BACKEND_ROOT: path.resolve(PROJECT_ROOT, 'backend'),
  UPLOADS: path.resolve(PROJECT_ROOT, 'backend/uploads'),
} as const;

/**
 * Supported file extensions and their corresponding input directories
 */
export const FILE_TYPE_DIRECTORIES: Record<string, string> = {
  '.mbox': PATHS.INPUT_MBOX,
  '.pdf': PATHS.INPUT_PDF,
  '.docx': PATHS.INPUT_DOCX,
  '.doc': PATHS.INPUT_DOCX,
  '.txt': PATHS.INPUT_TXT,
};

/**
 * All supported file extensions for transcript processing
 */
export const SUPPORTED_EXTENSIONS = Object.keys(FILE_TYPE_DIRECTORIES);

/**
 * Ensure all required directories exist.
 * Creates them recursively if they don't exist.
 */
export function ensureDirectories(): void {
  const directories = [
    PATHS.INPUT_ROOT,
    PATHS.INPUT_MBOX,
    PATHS.INPUT_PDF,
    PATHS.INPUT_DOCX,
    PATHS.INPUT_TXT,
    PATHS.PROCESSED,
    PATHS.OUTPUT_ROOT,
    PATHS.OUTPUT_CSV,
    PATHS.OUTPUT_LOGS,
  ];

  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
}

/**
 * Get the appropriate input directory for a file based on its extension.
 * @param filePath - The file path or filename
 * @returns The input directory path for that file type
 */
export function getInputDirectoryForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return FILE_TYPE_DIRECTORIES[ext] || PATHS.INPUT_ROOT;
}

/**
 * Get the processed archive path for a specific date.
 * Creates a date-based subdirectory structure.
 * @param date - Optional date (defaults to today)
 * @returns Path to the processed directory for that date
 */
export function getProcessedDirectory(date: Date = new Date()): string {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const processedDir = path.join(PATHS.PROCESSED, dateStr);

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  return processedDir;
}

/**
 * Generate the output CSV path with timestamp.
 * @param prefix - Optional prefix for the filename
 * @returns Full path to the output CSV file
 */
export function getOutputCsvPath(prefix: string = 'deals'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(PATHS.OUTPUT_CSV, `${prefix}_${timestamp}.csv`);
}

/**
 * Generate a log file path.
 * @param name - Name of the log file
 * @returns Full path to the log file
 */
export function getLogFilePath(name: string = 'processing'): string {
  const timestamp = new Date().toISOString().split('T')[0];
  return path.join(PATHS.OUTPUT_LOGS, `${name}_${timestamp}.log`);
}

/**
 * Check if a file extension is supported for processing.
 * @param filePath - The file path or filename to check
 * @returns True if the file type is supported
 */
export function isSupportedFileType(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * List all files in the input directories.
 * @param includeSubdirs - Whether to include files in subdirectories
 * @returns Array of file paths
 */
export function listInputFiles(includeSubdirs: boolean = false): string[] {
  const files: string[] = [];

  const scanDirectory = (dir: string, depth: number = 0) => {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile() && isSupportedFileType(entry.name)) {
        files.push(fullPath);
      } else if (entry.isDirectory() && includeSubdirs && depth < 2) {
        // Don't descend into 'processed' directory
        if (entry.name !== 'processed') {
          scanDirectory(fullPath, depth + 1);
        }
      }
    }
  };

  // Scan each input directory
  for (const dir of Object.values(FILE_TYPE_DIRECTORIES)) {
    scanDirectory(dir);
  }

  // Also scan the root input directory for misplaced files
  scanDirectory(PATHS.INPUT_ROOT);

  // Remove duplicates (in case files are in root and type-specific dirs)
  return [...new Set(files)];
}

/**
 * Move a file to the processed archive.
 * @param filePath - Path to the file to archive
 * @param date - Optional date for the archive directory
 * @returns New path of the archived file
 */
export function archiveProcessedFile(filePath: string, date: Date = new Date()): string {
  const processedDir = getProcessedDirectory(date);
  const fileName = path.basename(filePath);
  const newPath = path.join(processedDir, fileName);

  // Handle name collisions by appending a counter
  let finalPath = newPath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    finalPath = path.join(processedDir, `${base}_${counter}${ext}`);
    counter++;
  }

  fs.renameSync(filePath, finalPath);
  return finalPath;
}

export default PATHS;
