/**
 * Google Sync Service
 *
 * Core service for syncing content from Gmail and Google Drive.
 * Creates source_file records and routes through existing file processor.
 */

import { query } from '../db';
import { config } from '../config';
import { processFile } from './fileProcessor';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { GmailOAuth2Connector } from '../connectors/GmailOAuth2Connector';
import { DriveOAuth2Connector } from '../connectors/DriveOAuth2Connector';
import { SyncJobResult } from '../queues/syncProcessingQueue';

// Progress callback type
type ProgressCallback = (progress: number, status: string) => void;

// Sync configuration from database
interface SyncConfig {
  id: string;
  token_id: string;
  name: string;
  service_type: 'gmail' | 'drive';
  enabled: boolean;
  gmail_label_ids?: string[];
  gmail_date_from?: Date;
  gmail_date_to?: Date;
  drive_folder_id?: string;
  drive_folder_url?: string;
  drive_include_subfolders?: boolean;
  sync_frequency: string;
  last_sync_at?: Date;
  next_sync_at?: Date;
}

// Sync run record
interface SyncRun {
  id: string;
  config_id: string;
  status: 'running' | 'completed' | 'failed';
  started_at: Date;
  completed_at?: Date;
  items_found: number;
  items_processed: number;
  deals_created: number;
  errors_count: number;
  error_message?: string;
  trigger_type: 'manual' | 'scheduled';
}

/**
 * Get sync configuration by ID
 */
async function getSyncConfig(configId: string): Promise<SyncConfig | null> {
  const result = await query(
    `SELECT * FROM sync_configurations WHERE id = $1`,
    [configId]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Create a new sync run record
 */
async function createSyncRun(
  configId: string,
  triggerType: 'manual' | 'scheduled'
): Promise<string> {
  const result = await query(
    `INSERT INTO sync_runs (config_id, status, trigger_type, started_at)
     VALUES ($1, 'running', $2, NOW())
     RETURNING id`,
    [configId, triggerType]
  );

  return result.rows[0].id;
}

/**
 * Update sync run with progress
 */
async function updateSyncRun(
  runId: string,
  updates: Partial<SyncRun>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramCount++}`);
    values.push(updates.status);
  }
  if (updates.items_found !== undefined) {
    fields.push(`items_found = $${paramCount++}`);
    values.push(updates.items_found);
  }
  if (updates.items_processed !== undefined) {
    fields.push(`items_processed = $${paramCount++}`);
    values.push(updates.items_processed);
  }
  if (updates.deals_created !== undefined) {
    fields.push(`deals_created = $${paramCount++}`);
    values.push(updates.deals_created);
  }
  if (updates.errors_count !== undefined) {
    fields.push(`errors_count = $${paramCount++}`);
    values.push(updates.errors_count);
  }
  if (updates.error_message !== undefined) {
    fields.push(`error_message = $${paramCount++}`);
    values.push(updates.error_message);
  }
  if (updates.completed_at !== undefined) {
    fields.push(`completed_at = $${paramCount++}`);
    values.push(updates.completed_at);
  }

  if (fields.length === 0) return;

  values.push(runId);
  await query(
    `UPDATE sync_runs SET ${fields.join(', ')} WHERE id = $${paramCount}`,
    values
  );
}

/**
 * Check if an item has already been synced
 */
async function isItemSynced(configId: string, externalId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM synced_items WHERE config_id = $1 AND external_id = $2`,
    [configId, externalId]
  );
  return result.rows.length > 0;
}

/**
 * Mark an item as synced
 */
async function markItemSynced(
  configId: string,
  externalId: string,
  sourceFileId: string
): Promise<void> {
  await query(
    `INSERT INTO synced_items (config_id, external_id, source_file_id, synced_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (config_id, external_id) DO UPDATE SET synced_at = NOW()`,
    [configId, externalId, sourceFileId]
  );
}

/**
 * Create source_file record for synced content
 */
async function createSourceFile(
  filename: string,
  fileType: string,
  storagePath: string,
  fileSize: number,
  metadata: Record<string, any>
): Promise<string> {
  const result = await query(
    `INSERT INTO source_files (
      filename, file_type, storage_path, file_size,
      processing_status, scan_status, metadata, uploaded_at
    ) VALUES ($1, $2, $3, $4, 'pending', 'passed', $5, NOW())
    RETURNING id`,
    [filename, fileType, storagePath, fileSize, JSON.stringify(metadata)]
  );

  return result.rows[0].id;
}

/**
 * Ensure storage directory exists
 */
async function ensureStorageDir(): Promise<string> {
  const storageDir = join(config.upload.directory || './uploads', 'sync');
  if (!existsSync(storageDir)) {
    await mkdir(storageDir, { recursive: true });
  }
  return storageDir;
}

/**
 * Build Gmail search query from config
 */
function buildGmailQuery(syncConfig: SyncConfig): string {
  const parts: string[] = [];

  // Add date range
  if (syncConfig.gmail_date_from) {
    const fromDate = new Date(syncConfig.gmail_date_from);
    parts.push(`after:${fromDate.toISOString().split('T')[0].replace(/-/g, '/')}`);
  }
  if (syncConfig.gmail_date_to) {
    const toDate = new Date(syncConfig.gmail_date_to);
    parts.push(`before:${toDate.toISOString().split('T')[0].replace(/-/g, '/')}`);
  }

  return parts.join(' ');
}

/**
 * Sync Gmail messages for a configuration
 */
export async function syncGmailConfig(
  configId: string,
  triggerType: 'manual' | 'scheduled',
  triggeredBy?: string,
  onProgress?: ProgressCallback
): Promise<SyncJobResult> {
  const startTime = Date.now();
  let syncRunId: string | undefined;
  let itemsFound = 0;
  let itemsProcessed = 0;
  let dealsCreated = 0;
  let errorsCount = 0;

  try {
    // Get sync configuration
    const syncConfig = await getSyncConfig(configId);
    if (!syncConfig) {
      throw new Error('Sync configuration not found');
    }

    if (syncConfig.service_type !== 'gmail') {
      throw new Error('Invalid service type for Gmail sync');
    }

    if (!syncConfig.enabled) {
      throw new Error('Sync configuration is disabled');
    }

    logger.info('Starting Gmail sync', {
      configId,
      triggerType,
      labels: syncConfig.gmail_label_ids,
    });

    // Create sync run
    syncRunId = await createSyncRun(configId, triggerType);
    onProgress?.(10, 'initializing');

    // Create Gmail connector
    const gmail = new GmailOAuth2Connector({ tokenId: syncConfig.token_id });

    // Build search query
    const searchQuery = buildGmailQuery(syncConfig);

    // Get account email for userId
    const accountEmail = await gmail.getAccountEmail();

    onProgress?.(15, 'searching_messages');

    // Search for messages
    const searchResult = await gmail.searchMessages({
      query: searchQuery,
      labelIds: syncConfig.gmail_label_ids,
      maxResults: 100, // Limit per sync
    });

    itemsFound = searchResult.messages.length;
    await updateSyncRun(syncRunId, { items_found: itemsFound });

    logger.info('Found Gmail messages', {
      configId,
      count: itemsFound,
      query: searchQuery,
    });

    if (itemsFound === 0) {
      onProgress?.(100, 'completed');
      await updateSyncRun(syncRunId, {
        status: 'completed',
        completed_at: new Date(),
      });

      // Update last sync time
      await query(
        `UPDATE sync_configurations SET last_sync_at = NOW() WHERE id = $1`,
        [configId]
      );

      return {
        configId,
        syncRunId,
        itemsFound: 0,
        itemsProcessed: 0,
        dealsCreated: 0,
        errorsCount: 0,
        duration: Date.now() - startTime,
      };
    }

    // Process each message
    const storageDir = await ensureStorageDir();
    const progressPerItem = 70 / itemsFound; // 15-85% for processing

    for (let i = 0; i < searchResult.messages.length; i++) {
      const message = searchResult.messages[i];

      try {
        // Check if already synced
        if (await isItemSynced(configId, message.id)) {
          logger.debug('Skipping already synced message', {
            messageId: message.id,
          });
          itemsProcessed++;
          continue;
        }

        onProgress?.(
          Math.round(15 + (i * progressPerItem)),
          `processing_message_${i + 1}_of_${itemsFound}`
        );

        // Fetch full message content
        const fullMessage = await gmail.fetchMessageRaw(message.id);

        // Generate unique filename
        const subject = message.headers.subject || 'no-subject';
        const safeSubject = subject.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const filename = `gmail_${message.id}_${safeSubject}.eml`;
        const filePath = join(storageDir, filename);

        // Write email content to file
        await writeFile(filePath, fullMessage.raw, 'utf-8');
        const fileSize = Buffer.byteLength(fullMessage.raw, 'utf-8');

        // Create source file record
        const sourceFileId = await createSourceFile(
          filename,
          'mbox', // Gmail messages processed as mbox format
          filePath,
          fileSize,
          {
            sync_config_id: configId,
            sync_run_id: syncRunId,
            gmail_message_id: message.id,
            gmail_thread_id: message.threadId,
            subject: message.headers.subject,
            from: message.headers.from,
            date: message.headers.date,
            labels: message.labelIds,
          }
        );

        // Process file through existing pipeline
        try {
          const result = await processFile(sourceFileId);
          dealsCreated += result.dealsCreated;

          logger.info('Processed Gmail message', {
            messageId: message.id,
            sourceFileId,
            dealsCreated: result.dealsCreated,
          });
        } catch (processError: any) {
          logger.error('Failed to process Gmail message', {
            messageId: message.id,
            error: processError.message,
          });
          errorsCount++;
        }

        // Mark as synced
        await markItemSynced(configId, message.id, sourceFileId);
        itemsProcessed++;

        // Update progress
        await updateSyncRun(syncRunId, {
          items_processed: itemsProcessed,
          deals_created: dealsCreated,
          errors_count: errorsCount,
        });

      } catch (itemError: any) {
        logger.error('Error processing Gmail message', {
          messageId: message.id,
          error: itemError.message,
        });
        errorsCount++;
      }
    }

    // Complete sync
    onProgress?.(95, 'finalizing');

    await updateSyncRun(syncRunId, {
      status: 'completed',
      completed_at: new Date(),
      items_processed: itemsProcessed,
      deals_created: dealsCreated,
      errors_count: errorsCount,
    });

    // Update last sync time
    await query(
      `UPDATE sync_configurations SET last_sync_at = NOW() WHERE id = $1`,
      [configId]
    );

    onProgress?.(100, 'completed');

    logger.info('Gmail sync completed', {
      configId,
      itemsFound,
      itemsProcessed,
      dealsCreated,
      errorsCount,
      duration: Date.now() - startTime,
    });

    return {
      configId,
      syncRunId,
      itemsFound,
      itemsProcessed,
      dealsCreated,
      errorsCount,
      duration: Date.now() - startTime,
    };

  } catch (error: any) {
    logger.error('Gmail sync failed', {
      configId,
      error: error.message,
      stack: error.stack,
    });

    if (syncRunId) {
      await updateSyncRun(syncRunId, {
        status: 'failed',
        completed_at: new Date(),
        error_message: error.message,
        items_found: itemsFound,
        items_processed: itemsProcessed,
        deals_created: dealsCreated,
        errors_count: errorsCount + 1,
      });
    }

    throw error;
  }
}

/**
 * Sync Google Drive files for a configuration
 */
export async function syncDriveConfig(
  configId: string,
  triggerType: 'manual' | 'scheduled',
  triggeredBy?: string,
  onProgress?: ProgressCallback
): Promise<SyncJobResult> {
  const startTime = Date.now();
  let syncRunId: string | undefined;
  let itemsFound = 0;
  let itemsProcessed = 0;
  let dealsCreated = 0;
  let errorsCount = 0;

  try {
    // Get sync configuration
    const syncConfig = await getSyncConfig(configId);
    if (!syncConfig) {
      throw new Error('Sync configuration not found');
    }

    if (syncConfig.service_type !== 'drive') {
      throw new Error('Invalid service type for Drive sync');
    }

    if (!syncConfig.enabled) {
      throw new Error('Sync configuration is disabled');
    }

    if (!syncConfig.drive_folder_id) {
      throw new Error('No Drive folder configured');
    }

    logger.info('Starting Drive sync', {
      configId,
      triggerType,
      folderId: syncConfig.drive_folder_id,
      includeSubfolders: syncConfig.drive_include_subfolders,
    });

    // Create sync run
    syncRunId = await createSyncRun(configId, triggerType);
    onProgress?.(10, 'initializing');

    // Create Drive connector
    const drive = new DriveOAuth2Connector({ tokenId: syncConfig.token_id });

    onProgress?.(15, 'searching_files');

    // Search for Google Docs files
    const files = await drive.searchFiles(syncConfig.drive_folder_id, {
      mimeTypes: ['application/vnd.google-apps.document'], // Google Docs only
      includeSubfolders: syncConfig.drive_include_subfolders !== false,
      maxResults: 100, // Limit per sync
    });

    itemsFound = files.length;
    await updateSyncRun(syncRunId, { items_found: itemsFound });

    logger.info('Found Drive files', {
      configId,
      count: itemsFound,
    });

    if (itemsFound === 0) {
      onProgress?.(100, 'completed');
      await updateSyncRun(syncRunId, {
        status: 'completed',
        completed_at: new Date(),
      });

      // Update last sync time
      await query(
        `UPDATE sync_configurations SET last_sync_at = NOW() WHERE id = $1`,
        [configId]
      );

      return {
        configId,
        syncRunId,
        itemsFound: 0,
        itemsProcessed: 0,
        dealsCreated: 0,
        errorsCount: 0,
        duration: Date.now() - startTime,
      };
    }

    // Process each file
    const storageDir = await ensureStorageDir();
    const progressPerItem = 70 / itemsFound; // 15-85% for processing

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // Check if already synced
        if (await isItemSynced(configId, file.id)) {
          logger.debug('Skipping already synced file', {
            fileId: file.id,
            fileName: file.name,
          });
          itemsProcessed++;
          continue;
        }

        onProgress?.(
          Math.round(15 + (i * progressPerItem)),
          `processing_file_${i + 1}_of_${itemsFound}`
        );

        // Fetch file content (exported as text for Google Docs)
        const fileContent = await drive.fetchFileContent(file);

        // Generate unique filename
        const safeName = file.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const filename = `drive_${file.id}_${safeName}${fileContent.fileExtension}`;
        const filePath = join(storageDir, filename);

        // Write content to file
        await writeFile(filePath, fileContent.content);
        const fileSize = fileContent.content.length;

        // Determine file type based on export format
        let fileType = 'txt';
        if (fileContent.fileExtension === '.csv') {
          fileType = 'csv';
        } else if (fileContent.fileExtension === '.pdf') {
          fileType = 'pdf';
        }

        // Create source file record
        const sourceFileId = await createSourceFile(
          filename,
          fileType,
          filePath,
          fileSize,
          {
            sync_config_id: configId,
            sync_run_id: syncRunId,
            drive_file_id: file.id,
            original_name: file.name,
            original_mime_type: file.mimeType,
            modified_time: file.modifiedTime,
            owners: file.owners,
          }
        );

        // Process file through existing pipeline
        try {
          const result = await processFile(sourceFileId);
          dealsCreated += result.dealsCreated;

          logger.info('Processed Drive file', {
            fileId: file.id,
            fileName: file.name,
            sourceFileId,
            dealsCreated: result.dealsCreated,
          });
        } catch (processError: any) {
          logger.error('Failed to process Drive file', {
            fileId: file.id,
            fileName: file.name,
            error: processError.message,
          });
          errorsCount++;
        }

        // Mark as synced
        await markItemSynced(configId, file.id, sourceFileId);
        itemsProcessed++;

        // Update progress
        await updateSyncRun(syncRunId, {
          items_processed: itemsProcessed,
          deals_created: dealsCreated,
          errors_count: errorsCount,
        });

      } catch (itemError: any) {
        logger.error('Error processing Drive file', {
          fileId: file.id,
          fileName: file.name,
          error: itemError.message,
        });
        errorsCount++;
      }
    }

    // Complete sync
    onProgress?.(95, 'finalizing');

    await updateSyncRun(syncRunId, {
      status: 'completed',
      completed_at: new Date(),
      items_processed: itemsProcessed,
      deals_created: dealsCreated,
      errors_count: errorsCount,
    });

    // Update last sync time
    await query(
      `UPDATE sync_configurations SET last_sync_at = NOW() WHERE id = $1`,
      [configId]
    );

    onProgress?.(100, 'completed');

    logger.info('Drive sync completed', {
      configId,
      itemsFound,
      itemsProcessed,
      dealsCreated,
      errorsCount,
      duration: Date.now() - startTime,
    });

    return {
      configId,
      syncRunId,
      itemsFound,
      itemsProcessed,
      dealsCreated,
      errorsCount,
      duration: Date.now() - startTime,
    };

  } catch (error: any) {
    logger.error('Drive sync failed', {
      configId,
      error: error.message,
      stack: error.stack,
    });

    if (syncRunId) {
      await updateSyncRun(syncRunId, {
        status: 'failed',
        completed_at: new Date(),
        error_message: error.message,
        items_found: itemsFound,
        items_processed: itemsProcessed,
        deals_created: dealsCreated,
        errors_count: errorsCount + 1,
      });
    }

    throw error;
  }
}

/**
 * Preview Gmail messages without syncing (for configuration UI)
 */
export async function previewGmailMessages(
  tokenId: string,
  options: {
    labelIds?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    maxResults?: number;
  }
): Promise<{
  count: number;
  sample: Array<{
    id: string;
    subject: string;
    from: string;
    date: string;
  }>;
}> {
  const gmail = new GmailOAuth2Connector({ tokenId });
  const accountEmail = await gmail.getAccountEmail();

  // Build search query
  const queryParts: string[] = [];
  if (options.dateFrom) {
    queryParts.push(`after:${options.dateFrom.toISOString().split('T')[0].replace(/-/g, '/')}`);
  }
  if (options.dateTo) {
    queryParts.push(`before:${options.dateTo.toISOString().split('T')[0].replace(/-/g, '/')}`);
  }

  const searchResult = await gmail.searchMessages({
    query: queryParts.join(' '),
    labelIds: options.labelIds,
    maxResults: options.maxResults || 10,
  });

  return {
    count: searchResult.messages.length,
    sample: searchResult.messages.map((msg) => ({
      id: msg.id,
      subject: msg.headers.subject || '(no subject)',
      from: msg.headers.from || '',
      date: msg.headers.date || '',
    })),
  };
}

/**
 * Preview Drive files without syncing (for configuration UI)
 */
export async function previewDriveFiles(
  tokenId: string,
  folderId: string,
  options: {
    includeSubfolders?: boolean;
    maxResults?: number;
  }
): Promise<{
  count: number;
  sample: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
  }>;
}> {
  const drive = new DriveOAuth2Connector({ tokenId });

  const files = await drive.searchFiles(folderId, {
    mimeTypes: ['application/vnd.google-apps.document'],
    includeSubfolders: options.includeSubfolders !== false,
    maxResults: options.maxResults || 10,
  });

  return {
    count: files.length,
    sample: files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
    })),
  };
}

/**
 * Get sync run history for a configuration
 */
export async function getSyncHistory(
  configId: string,
  limit: number = 20
): Promise<SyncRun[]> {
  const result = await query(
    `SELECT * FROM sync_runs
     WHERE config_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [configId, limit]
  );

  return result.rows;
}

/**
 * Delete a sync configuration and its history
 */
export async function deleteSyncConfig(configId: string): Promise<void> {
  // Delete synced items first (cascade should handle this, but be explicit)
  await query(`DELETE FROM synced_items WHERE config_id = $1`, [configId]);

  // Delete sync runs
  await query(`DELETE FROM sync_runs WHERE config_id = $1`, [configId]);

  // Delete the configuration
  await query(`DELETE FROM sync_configurations WHERE id = $1`, [configId]);

  logger.info('Deleted sync configuration', { configId });
}

export default {
  syncGmailConfig,
  syncDriveConfig,
  previewGmailMessages,
  previewDriveFiles,
  getSyncHistory,
  deleteSyncConfig,
};
