/**
 * Drive Sync Routes
 *
 * API endpoints for Google Drive sync configuration and management.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db';
import logger from '../utils/logger';
import { DriveOAuth2Connector } from '../connectors/DriveOAuth2Connector';
import { addDriveSyncJob, getSyncJobStatus, getJobsForConfig } from '../queues/syncProcessingQueue';
import { previewDriveFiles, getSyncHistory } from '../services/googleSyncService';
import { updateSyncSchedule, calculateNextSyncTime } from '../services/syncScheduler';

const router = Router();

/**
 * GET /api/sync/drive/folders
 * List root folders for a connected Drive account
 */
router.get('/folders', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.query;

    if (!tokenId || typeof tokenId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'tokenId query parameter is required',
      });
    }

    // Verify token exists and is valid
    const tokenResult = await query(
      `SELECT id, account_email FROM google_oauth_tokens
       WHERE id = $1 AND service_type = 'drive' AND revoked_at IS NULL`,
      [tokenId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Drive account not found or token has been revoked',
      });
    }

    const drive = new DriveOAuth2Connector({ tokenId });
    const folders = await drive.listRootFolders();

    res.json({
      success: true,
      data: {
        accountEmail: tokenResult.rows[0].account_email,
        folders,
      },
    });
  } catch (error: any) {
    logger.error('Failed to list Drive folders', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/drive/folders/:id/children
 * List children of a specific folder
 */
router.get('/folders/:id/children', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tokenId, pageToken, pageSize } = req.query;

    if (!tokenId || typeof tokenId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'tokenId query parameter is required',
      });
    }

    const drive = new DriveOAuth2Connector({ tokenId });
    const result = await drive.listFolderContents(id, {
      pageToken: pageToken as string | undefined,
      pageSize: pageSize ? parseInt(pageSize as string) : undefined,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Failed to list folder children', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/drive/resolve-url
 * Parse a Google Drive URL to extract folder ID and info
 */
router.post('/resolve-url', async (req: Request, res: Response) => {
  try {
    const { url, tokenId } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'url is required',
      });
    }

    // Parse the URL to get folder ID
    const folderId = DriveOAuth2Connector.parseDriveFolderUrl(url);

    if (!folderId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Google Drive folder URL',
      });
    }

    // If tokenId provided, get folder info
    let folderInfo = null;
    if (tokenId) {
      try {
        const drive = new DriveOAuth2Connector({ tokenId });
        folderInfo = await drive.getFolderInfo(folderId);
      } catch (err: any) {
        logger.warn('Failed to get folder info', { folderId, error: err.message });
      }
    }

    res.json({
      success: true,
      data: {
        folderId,
        folderInfo,
      },
    });
  } catch (error: any) {
    logger.error('Failed to resolve Drive URL', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/drive/configs
 * List Drive sync configurations
 */
router.get('/configs', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT sc.*, got.account_email
       FROM sync_configurations sc
       JOIN google_oauth_tokens got ON sc.token_id = got.id
       WHERE sc.service_type = 'drive'
       ORDER BY sc.created_at DESC`,
      []
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Failed to list Drive sync configs', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/drive/configs/:id
 * Get a specific Drive sync configuration
 */
router.get('/configs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT sc.*, got.account_email
       FROM sync_configurations sc
       JOIN google_oauth_tokens got ON sc.token_id = got.id
       WHERE sc.id = $1 AND sc.service_type = 'drive'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Failed to get Drive sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/drive/configs
 * Create a new Drive sync configuration
 */
router.post('/configs', async (req: Request, res: Response) => {
  try {
    const {
      tokenId,
      name,
      folderUrl,
      folderId,
      includeSubfolders = true,
      syncFrequency = 'manual',
    } = req.body;

    // Validate required fields
    if (!tokenId || !name) {
      return res.status(400).json({
        success: false,
        error: 'tokenId and name are required',
      });
    }

    // Resolve folder ID from URL if not provided directly
    let resolvedFolderId = folderId;
    if (!resolvedFolderId && folderUrl) {
      resolvedFolderId = DriveOAuth2Connector.parseDriveFolderUrl(folderUrl);
      if (!resolvedFolderId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Google Drive folder URL',
        });
      }
    }

    if (!resolvedFolderId) {
      return res.status(400).json({
        success: false,
        error: 'Either folderId or folderUrl is required',
      });
    }

    // Verify token exists
    const tokenResult = await query(
      `SELECT id FROM google_oauth_tokens
       WHERE id = $1 AND service_type = 'drive' AND revoked_at IS NULL`,
      [tokenId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Drive token',
      });
    }

    // Calculate next sync time
    let nextSyncAt: Date | null = null;
    if (syncFrequency !== 'manual') {
      nextSyncAt = calculateNextSyncTime(syncFrequency);
    }

    const result = await query(
      `INSERT INTO sync_configurations (
        token_id, name, service_type, enabled,
        drive_folder_id, drive_folder_url, drive_include_subfolders,
        sync_frequency, next_sync_at
      ) VALUES ($1, $2, 'drive', true, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        tokenId,
        name,
        resolvedFolderId,
        folderUrl || null,
        includeSubfolders,
        syncFrequency,
        nextSyncAt,
      ]
    );

    logger.info('Created Drive sync configuration', {
      configId: result.rows[0].id,
      name,
      folderId: resolvedFolderId,
    });

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Failed to create Drive sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/sync/drive/configs/:id
 * Update a Drive sync configuration
 */
router.put('/configs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      folderUrl,
      folderId,
      includeSubfolders,
      syncFrequency,
      enabled,
    } = req.body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (folderId !== undefined) {
      updates.push(`drive_folder_id = $${paramCount++}`);
      values.push(folderId);
    }
    if (folderUrl !== undefined) {
      updates.push(`drive_folder_url = $${paramCount++}`);
      values.push(folderUrl);

      // If URL provided, also update folder ID
      if (folderUrl) {
        const resolvedId = DriveOAuth2Connector.parseDriveFolderUrl(folderUrl);
        if (resolvedId) {
          updates.push(`drive_folder_id = $${paramCount++}`);
          values.push(resolvedId);
        }
      }
    }
    if (includeSubfolders !== undefined) {
      updates.push(`drive_include_subfolders = $${paramCount++}`);
      values.push(includeSubfolders);
    }
    if (enabled !== undefined) {
      updates.push(`enabled = $${paramCount++}`);
      values.push(enabled);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
      });
    }

    values.push(id);
    const result = await query(
      `UPDATE sync_configurations
       SET ${updates.join(', ')}
       WHERE id = $${paramCount} AND service_type = 'drive'
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
      });
    }

    // Handle sync frequency update separately (updates next_sync_at)
    if (syncFrequency !== undefined) {
      await updateSyncSchedule(id, syncFrequency);
    }

    logger.info('Updated Drive sync configuration', { configId: id });

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Failed to update Drive sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/sync/drive/configs/:id
 * Delete a Drive sync configuration
 */
router.delete('/configs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Delete synced items first
    await query(`DELETE FROM synced_items WHERE config_id = $1`, [id]);

    // Delete sync runs
    await query(`DELETE FROM sync_runs WHERE config_id = $1`, [id]);

    // Delete the configuration
    const result = await query(
      `DELETE FROM sync_configurations WHERE id = $1 AND service_type = 'drive' RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
      });
    }

    logger.info('Deleted Drive sync configuration', { configId: id });

    res.json({
      success: true,
      message: 'Configuration deleted',
    });
  } catch (error: any) {
    logger.error('Failed to delete Drive sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/drive/configs/:id/trigger
 * Manually trigger a Drive sync
 */
router.post('/configs/:id/trigger', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify config exists
    const configResult = await query(
      `SELECT * FROM sync_configurations WHERE id = $1 AND service_type = 'drive'`,
      [id]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
      });
    }

    // Add job to queue
    const job = await addDriveSyncJob(id, 'manual');

    logger.info('Triggered manual Drive sync', { configId: id, jobId: job.id });

    res.json({
      success: true,
      data: {
        jobId: job.id,
        message: 'Sync job queued',
      },
    });
  } catch (error: any) {
    logger.error('Failed to trigger Drive sync', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/drive/configs/:id/history
 * Get sync history for a configuration
 */
router.get('/configs/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    const history = await getSyncHistory(id, limit);

    res.json({
      success: true,
      data: history,
    });
  } catch (error: any) {
    logger.error('Failed to get Drive sync history', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/drive/configs/:id/jobs
 * Get pending/active jobs for a configuration
 */
router.get('/configs/:id/jobs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const jobs = await getJobsForConfig(id);

    res.json({
      success: true,
      data: jobs.map(job => ({
        id: job.id,
        state: job.getState(),
        progress: job.progress(),
        data: job.data,
        attemptsMade: job.attemptsMade,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to get Drive sync jobs', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/drive/preview
 * Preview files in a folder without syncing
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const {
      tokenId,
      folderId,
      folderUrl,
      includeSubfolders = true,
      maxResults = 10,
    } = req.body;

    if (!tokenId) {
      return res.status(400).json({
        success: false,
        error: 'tokenId is required',
      });
    }

    // Resolve folder ID
    let resolvedFolderId = folderId;
    if (!resolvedFolderId && folderUrl) {
      resolvedFolderId = DriveOAuth2Connector.parseDriveFolderUrl(folderUrl);
    }

    if (!resolvedFolderId) {
      return res.status(400).json({
        success: false,
        error: 'Either folderId or folderUrl is required',
      });
    }

    const preview = await previewDriveFiles(tokenId, resolvedFolderId, {
      includeSubfolders,
      maxResults,
    });

    res.json({
      success: true,
      data: preview,
    });
  } catch (error: any) {
    logger.error('Failed to preview Drive files', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/drive/job/:jobId
 * Get status of a specific sync job
 */
router.get('/job/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const status = await getSyncJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    logger.error('Failed to get sync job status', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
