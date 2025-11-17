import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import {
  DriveConnector,
  DriveFileSummary,
  GmailConnector,
  GmailMessageSummary,
  CRMCSVConnector,
  CRMCSVFile,
} from '../connectors';
import {
  DriveFileContent,
  DriveSearchQuery,
  GmailMessagePayload,
  GmailSearchQuery,
  SourceMetadata,
  CRMCSVFileSummary,
} from '../connectors/types';
import { SourceType } from '../types/parsing';

export interface GmailSyncConfig {
  enabled: boolean;
  userId: string;
  daysBack: number;
  maxResults?: number;
  queries: GmailSearchQuery[];
}

export interface DriveSyncConfig {
  enabled: boolean;
  pageSize?: number;
  queries: DriveSearchQuery[];
}

export interface CRMCSVSyncConfig {
  enabled: boolean;
  directory: string;
  pattern?: RegExp;
  maxFiles?: number;
}

export interface SourceSyncOptions {
  spoolDirectory: string;
  gmail?: GmailSyncConfig;
  drive?: DriveSyncConfig;
  crmCsv?: CRMCSVSyncConfig;
}

export interface GmailSyncResult {
  query: GmailSearchQuery;
  messages: GmailMessageSummary[];
  spoolFiles: string[];
}

export interface DriveSyncResult {
  query: DriveSearchQuery;
  files: DriveFileSummary[];
  spoolFiles: string[];
}

export interface CRMCSVSyncResult {
  files: CRMCSVFile[];
  spoolFiles: string[];
}

export interface SourceSyncReport {
  gmail: GmailSyncResult[];
  drive: DriveSyncResult[];
  crmCsv: CRMCSVSyncResult[];
  manifest: SourceManifestEntry[];
}

export interface SourceManifestEntry {
  filePath: string;
  metadataPath: string;
  parser: 'StandardizedMboxParser' | 'StandardizedTranscriptParser' | 'StandardizedCSVParser';
  sourceType: SourceType;
  connector: 'gmail' | 'drive' | 'crm_csv';
  queryName?: string;
  recordedAt: string;
  sourceMetadata: SourceMetadata;
}

export class SourceSyncService {
  constructor(
    private readonly options: SourceSyncOptions,
    private readonly connectors: {
      gmail?: GmailConnector;
      drive?: DriveConnector;
      crmCsv?: CRMCSVConnector;
    } = {}
  ) {}

  async syncAll(): Promise<SourceSyncReport> {
    const report: SourceSyncReport = { gmail: [], drive: [], crmCsv: [], manifest: [] };

    if (this.options.gmail?.enabled && this.connectors.gmail) {
      const gmailResults = await this.syncGmail();
      report.gmail = gmailResults.results;
      report.manifest.push(...gmailResults.manifestEntries);
    }

    if (this.options.drive?.enabled && this.connectors.drive) {
      const driveResults = await this.syncDrive();
      report.drive = driveResults.results;
      report.manifest.push(...driveResults.manifestEntries);
    }

    if (this.options.crmCsv?.enabled && this.connectors.crmCsv) {
      const crmCsvResults = await this.syncCRMCSV();
      report.crmCsv = crmCsvResults.results;
      report.manifest.push(...crmCsvResults.manifestEntries);
    }

    return report;
  }

  async syncGmail(): Promise<{ results: GmailSyncResult[]; manifestEntries: SourceManifestEntry[] }> {
    if (!this.options.gmail || !this.connectors.gmail) {
      return { results: [], manifestEntries: [] };
    }

    const results: GmailSyncResult[] = [];
    const manifestEntries: SourceManifestEntry[] = [];
    const baseDir = path.join(this.options.spoolDirectory, 'gmail');
    await fs.mkdir(baseDir, { recursive: true });

    const dateFilter = this.buildDateFilter(this.options.gmail.daysBack);

    for (const query of this.options.gmail.queries) {
      const finalQuery = [query.query, dateFilter].filter(Boolean).join(' ');

      const searchResult = await this.connectors.gmail.searchMessages({
        userId: this.options.gmail.userId,
        query: finalQuery,
        labelIds: query.labelIds,
        includeSpamTrash: query.includeSpamTrash,
        maxResults: this.options.gmail.maxResults,
      });

      const spoolFiles: string[] = [];
      const queryDir = path.join(baseDir, query.name);
      await fs.mkdir(queryDir, { recursive: true });

      for (const message of searchResult.messages) {
        try {
          const payload = await this.connectors.gmail.fetchMessageRaw(
            this.options.gmail.userId,
            message.id
          );
          const filePath = path.join(queryDir, `${message.id}.eml`);
          await fs.writeFile(filePath, payload.raw);
          const metadata: SourceMetadata = {
            connector: 'gmail',
            queryName: query.name,
            message: payload.summary,
          };
          const metadataPath = await this.writeMetadata(filePath, metadata);
          manifestEntries.push(
            this.createManifestEntry({
              filePath,
              metadataPath,
              parser: 'StandardizedMboxParser',
              sourceType: 'email',
              sourceMetadata: metadata,
            })
          );
          spoolFiles.push(filePath);
        } catch (error: any) {
          logger.error('Failed to fetch Gmail message, skipping', {
            messageId: message.id,
            queryName: query.name,
            error: error.message,
          });
          // Continue with next message instead of failing entire sync
        }
      }

      results.push({
        query,
        messages: searchResult.messages,
        spoolFiles,
      });

      logger.info('Gmail sync complete for query', {
        query: query.name,
        messagesFetched: searchResult.messages.length,
      });
    }

    return { results, manifestEntries };
  }

  async syncDrive(): Promise<{ results: DriveSyncResult[]; manifestEntries: SourceManifestEntry[] }> {
    if (!this.options.drive || !this.connectors.drive) {
      return { results: [], manifestEntries: [] };
    }

    const results: DriveSyncResult[] = [];
    const manifestEntries: SourceManifestEntry[] = [];
    const baseDir = path.join(this.options.spoolDirectory, 'drive');
    await fs.mkdir(baseDir, { recursive: true });

    for (const query of this.options.drive.queries) {
      const driveQuery = this.buildDriveQuery(query);
      const files = await this.connectors.drive.searchFiles({
        q: driveQuery,
        pageSize: this.options.drive.pageSize,
      });

      const spoolFiles: string[] = [];
      const queryDir = path.join(baseDir, query.name);
      await fs.mkdir(queryDir, { recursive: true });

      for (const file of files) {
        try {
          const payload = await this.connectors.drive.fetchFileContent(file);
          const filePath = path.join(queryDir, `${file.id}${payload.fileExtension}`);
          await fs.writeFile(filePath, payload.content);
          const metadata: SourceMetadata = {
            connector: 'drive',
            queryName: query.name,
            file,
          };
          const metadataPath = await this.writeMetadata(filePath, metadata);
          manifestEntries.push(
            this.createManifestEntry({
              filePath,
              metadataPath,
              parser: this.getParserForDriveFile(payload),
              sourceType: this.getSourceTypeForDriveFile(payload),
              sourceMetadata: metadata,
            })
          );
          spoolFiles.push(filePath);
        } catch (error: any) {
          logger.error('Failed to fetch Drive file, skipping', {
            fileId: file.id,
            fileName: file.name,
            queryName: query.name,
            error: error.message,
          });
          // Continue with next file instead of failing entire sync
        }
      }

      results.push({
        query,
        files,
        spoolFiles,
      });

      logger.info('Drive sync complete for query', {
        query: query.name,
        filesFetched: files.length,
      });
    }

    return { results, manifestEntries };
  }

  private buildDateFilter(daysBack: number): string {
    if (!daysBack || daysBack <= 0) {
      return '';
    }
    const afterDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const year = afterDate.getUTCFullYear();
    const month = String(afterDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(afterDate.getUTCDate()).padStart(2, '0');
    return `after:${year}/${month}/${day}`;
  }

  private buildDriveQuery(query: DriveSearchQuery): string {
    const clauses: string[] = [];

    if (query.query) {
      clauses.push(`fullText contains '${query.query.replace(/'/g, "\\'")}'`);
    }

    if (query.mimeTypes?.length) {
      const mimeClause = query.mimeTypes
        .map((mime) => `mimeType='${mime}'`)
        .join(' or ');
      clauses.push(`(${mimeClause})`);
    }

    if (query.folderIds?.length) {
      const folderClause = query.folderIds
        .map((folderId) => `'${folderId}' in parents`)
        .join(' or ');
      clauses.push(`(${folderClause})`);
    }

    return clauses.join(' and ') || "fullText contains '4IEC'";
  }

  private async writeMetadata(filePath: string, metadata: SourceMetadata): Promise<string> {
    const metadataPath = `${filePath}.json`;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    return metadataPath;
  }

  async syncCRMCSV(): Promise<{ results: CRMCSVSyncResult[]; manifestEntries: SourceManifestEntry[] }> {
    if (!this.options.crmCsv || !this.connectors.crmCsv) {
      return { results: [], manifestEntries: [] };
    }

    const manifestEntries: SourceManifestEntry[] = [];
    const baseDir = path.join(this.options.spoolDirectory, 'crm');
    await fs.mkdir(baseDir, { recursive: true });

    // Scan for CSV files in the configured directory
    const scanResult = await this.connectors.crmCsv.scanCSVFiles({
      directory: this.options.crmCsv.directory,
      pattern: this.options.crmCsv.pattern,
      maxFiles: this.options.crmCsv.maxFiles,
    });

    const spoolFiles: string[] = [];

    for (const file of scanResult.files) {
      try {
        // Copy CSV file to spool directory (preserving original)
        const destPath = path.join(baseDir, file.fileName);
        await fs.copyFile(file.filePath, destPath);

        // Create metadata
        const metadata: SourceMetadata = {
          connector: 'crm_csv',
          file: {
            fileName: file.fileName,
            filePath: destPath,
            fileSize: file.fileSize,
            modifiedTime: file.modifiedTime.toISOString(),
            createdTime: file.createdTime.toISOString(),
            checksum: file.checksum,
          },
        };

        const metadataPath = await this.writeMetadata(destPath, metadata);
        manifestEntries.push(
          this.createManifestEntry({
            filePath: destPath,
            metadataPath,
            parser: 'StandardizedCSVParser',
            sourceType: 'csv',
            sourceMetadata: metadata,
          })
        );
        spoolFiles.push(destPath);

        logger.info('CRM CSV file synced', {
          fileName: file.fileName,
          sizeMB: (file.fileSize / 1024 / 1024).toFixed(2),
        });
      } catch (error: any) {
        logger.error('Failed to sync CRM CSV file, skipping', {
          fileName: file.fileName,
          error: error.message,
        });
        // Continue with next file instead of failing entire sync
      }
    }

    const result: CRMCSVSyncResult = {
      files: scanResult.files,
      spoolFiles,
    };

    logger.info('CRM CSV sync complete', {
      filesSynced: scanResult.files.length,
      totalSizeMB: (scanResult.totalSize / 1024 / 1024).toFixed(2),
    });

    return { results: [result], manifestEntries };
  }

  private createManifestEntry(params: {
    filePath: string;
    metadataPath: string;
    parser: 'StandardizedMboxParser' | 'StandardizedTranscriptParser' | 'StandardizedCSVParser';
    sourceType: SourceType;
    sourceMetadata: SourceMetadata;
  }): SourceManifestEntry {
    return {
      filePath: params.filePath,
      metadataPath: params.metadataPath,
      parser: params.parser,
      sourceType: params.sourceType,
      connector: params.sourceMetadata.connector,
      queryName: params.sourceMetadata.connector === 'gmail' || params.sourceMetadata.connector === 'drive'
        ? params.sourceMetadata.queryName
        : undefined,
      recordedAt: new Date().toISOString(),
      sourceMetadata: params.sourceMetadata,
    };
  }

  private getParserForDriveFile(file: DriveFileContent): 'StandardizedTranscriptParser' | 'StandardizedMboxParser' {
    // Currently, all Drive files use the transcript parser
    // Future: Add logic to detect MBOX files if they exist in Drive
    return 'StandardizedTranscriptParser';
  }

  private getSourceTypeForDriveFile(file: DriveFileContent): SourceType {
    const extension = file.fileExtension.toLowerCase();
    const mimeType = file.summary.mimeType.toLowerCase();

    // Map known file types by extension
    const extensionMap: Record<string, SourceType> = {
      '.pdf': 'pdf',
      '.docx': 'docx',
      '.doc': 'docx',
      '.txt': 'transcript',
    };

    // Check extension first
    if (extensionMap[extension]) {
      return extensionMap[extension];
    }

    // Fallback to mime type detection
    if (mimeType.includes('pdf')) {
      return 'pdf';
    }
    if (mimeType.includes('wordprocessing') || mimeType.includes('msword')) {
      return 'docx';
    }
    if (mimeType.includes('text/plain')) {
      return 'transcript';
    }

    // Default to transcript for unknown types
    logger.warn('Unknown file type detected, defaulting to transcript', {
      extension,
      mimeType,
      fileName: file.summary.name,
    });
    return 'transcript';
  }
}

export default SourceSyncService;
