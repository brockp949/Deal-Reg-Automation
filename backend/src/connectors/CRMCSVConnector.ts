/**
 * CRM CSV Connector
 *
 * Scans uploads/crm/*.csv for nightly CRM export files and returns file summaries
 * for ingestion into the opportunity pipeline.
 *
 * Part of Phase 7.1 - CRM CSV Connector & Parsing
 */

import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';

export interface CRMCSVFile {
  filePath: string;
  fileName: string;
  fileSize: number;
  modifiedTime: Date;
  createdTime: Date;
  checksum: string;
}

export interface CRMCSVSearchOptions {
  directory: string;
  pattern?: RegExp;
  maxFiles?: number;
  includeSubdirectories?: boolean;
}

export interface CRMCSVSyncResult {
  files: CRMCSVFile[];
  totalFiles: number;
  totalSize: number;
  directory: string;
}

export class CRMCSVConnector {
  private readonly defaultDirectory: string;

  constructor(options: { directory?: string } = {}) {
    this.defaultDirectory = options.directory || 'uploads/crm';
  }

  /**
   * Scan directory for CSV files
   */
  async scanCSVFiles(options?: Partial<CRMCSVSearchOptions>): Promise<CRMCSVSyncResult> {
    const directory = options?.directory || this.defaultDirectory;
    const pattern = options?.pattern || /\.csv$/i;
    const maxFiles = options?.maxFiles || 1000;
    const includeSubdirectories = options?.includeSubdirectories ?? false;

    logger.info('Scanning CRM CSV directory', { directory, pattern: pattern.source });

    // Ensure directory exists
    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error: any) {
      logger.error('Failed to create CRM CSV directory', { directory, error: error.message });
      throw new Error(`Failed to create CRM CSV directory: ${error.message}`);
    }

    // Scan for CSV files
    const files = await this.scanDirectory(directory, pattern, maxFiles, includeSubdirectories);

    const totalSize = files.reduce((sum, file) => sum + file.fileSize, 0);

    logger.info('CRM CSV scan completed', {
      directory,
      filesFound: files.length,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
    });

    return {
      files,
      totalFiles: files.length,
      totalSize,
      directory,
    };
  }

  /**
   * Read a specific CSV file and return metadata
   */
  async getFileMetadata(filePath: string): Promise<CRMCSVFile> {
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const checksum = await this.calculateChecksum(filePath);

    return {
      filePath,
      fileName,
      fileSize: stats.size,
      modifiedTime: stats.mtime,
      createdTime: stats.birthtime,
      checksum,
    };
  }

  /**
   * Recursively scan directory for CSV files
   */
  private async scanDirectory(
    directory: string,
    pattern: RegExp,
    maxFiles: number,
    includeSubdirectories: boolean,
    files: CRMCSVFile[] = []
  ): Promise<CRMCSVFile[]> {
    let entries: string[];

    try {
      const dirEntries = await fs.readdir(directory, { withFileTypes: true });
      entries = dirEntries.map(entry => entry.name);
    } catch (error: any) {
      logger.warn('Failed to read directory, returning empty results', {
        directory,
        error: error.message,
      });
      return files;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        logger.warn('Reached max files limit', { maxFiles });
        break;
      }

      const fullPath = path.join(directory, entry);
      let stat;

      try {
        stat = await fs.stat(fullPath);
      } catch (error: any) {
        logger.warn('Failed to stat file, skipping', { fullPath, error: error.message });
        continue;
      }

      if (stat.isDirectory() && includeSubdirectories) {
        await this.scanDirectory(fullPath, pattern, maxFiles, includeSubdirectories, files);
      } else if (stat.isFile() && pattern.test(entry)) {
        try {
          const fileMetadata = await this.getFileMetadata(fullPath);
          files.push(fileMetadata);
          logger.debug('Found CRM CSV file', {
            fileName: fileMetadata.fileName,
            sizeMB: (fileMetadata.fileSize / 1024 / 1024).toFixed(2),
          });
        } catch (error: any) {
          logger.error('Failed to get file metadata, skipping', {
            fullPath,
            error: error.message,
          });
        }
      }
    }

    return files;
  }

  /**
   * Calculate file checksum (MD5)
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    const crypto = await import('crypto');
    const content = await fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Validate CSV file (basic checks)
   */
  async validateCSVFile(filePath: string): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check file exists
      await fs.access(filePath);

      // Check file size (warn if > 100MB)
      const stats = await fs.stat(filePath);
      if (stats.size > 100 * 1024 * 1024) {
        warnings.push(`Large file size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
      }

      if (stats.size === 0) {
        errors.push('File is empty');
      }

      // Check file extension
      if (!filePath.toLowerCase().endsWith('.csv')) {
        warnings.push('File does not have .csv extension');
      }

      // Basic CSV structure check (read first few lines)
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split(/\r?\n/).slice(0, 10);
      const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

      if (nonEmptyLines.length < 2) {
        errors.push(
          'File has fewer than 2 lines (header + at least one data row expected; blank lines ignored)'
        );
      }

      // Check for common CSV delimiters on header line
      const firstLine = nonEmptyLines[0] ?? '';
      const hasComma = firstLine.includes(',');
      const hasSemicolon = firstLine.includes(';');
      const hasTab = firstLine.includes('\t');

      if (!hasComma && !hasSemicolon && !hasTab) {
        warnings.push('No common CSV delimiter detected (comma, semicolon, or tab)');
      }

    } catch (error: any) {
      errors.push(`Failed to validate file: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

export default CRMCSVConnector;
