/**
 * Gmail Sync Routes
 *
 * API endpoints for Gmail sync configuration and management.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db';
import logger from '../utils/logger';
import { GmailOAuth2Connector } from '../connectors/GmailOAuth2Connector';
import { addGmailSyncJob, getSyncJobStatus, getJobsForConfig } from '../queues/syncProcessingQueue';
import { previewGmailMessages, getSyncHistory } from '../services/googleSyncService';
import { updateSyncSchedule, calculateNextSyncTime } from '../services/syncScheduler';

const router = Router();

/**
 * GET /api/sync/gmail/labels
 * List Gmail labels for a connected account
 */
router.get('/labels', async (req: Request, res: Response) => {
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
       WHERE id = $1 AND service_type = 'gmail' AND revoked_at IS NULL`,
      [tokenId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Gmail account not found or token has been revoked',
      });
    }

    const gmail = new GmailOAuth2Connector({ tokenId });
    const accountEmail = await gmail.getAccountEmail();
    const labels = await gmail.listLabels();

    res.json({
      success: true,
      data: {
        accountEmail,
        labels,
      },
    });
  } catch (error: any) {
    logger.error('Failed to list Gmail labels', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/gmail/configs
 * List Gmail sync configurations
 */
router.get('/configs', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT sc.*, got.account_email
       FROM sync_configurations sc
       JOIN google_oauth_tokens got ON sc.token_id = got.id
       WHERE sc.service_type = 'gmail'
       ORDER BY sc.created_at DESC`,
      []
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Failed to list Gmail sync configs', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/gmail/configs/:id
 * Get a specific Gmail sync configuration
 */
router.get('/configs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT sc.*, got.account_email
       FROM sync_configurations sc
       JOIN google_oauth_tokens got ON sc.token_id = got.id
       WHERE sc.id = $1 AND sc.service_type = 'gmail'`,
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
    logger.error('Failed to get Gmail sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/gmail/configs
 * Create a new Gmail sync configuration
 */
router.post('/configs', async (req: Request, res: Response) => {
  try {
    const {
      tokenId,
      name,
      labelIds,
      dateFrom,
      dateTo,
      syncFrequency = 'manual',
    } = req.body;

    // Validate required fields
    if (!tokenId || !name) {
      return res.status(400).json({
        success: false,
        error: 'tokenId and name are required',
      });
    }

    // Verify token exists
    const tokenResult = await query(
      `SELECT id FROM google_oauth_tokens
       WHERE id = $1 AND service_type = 'gmail' AND revoked_at IS NULL`,
      [tokenId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Gmail token',
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
        gmail_label_ids, gmail_date_from, gmail_date_to,
        sync_frequency, next_sync_at
      ) VALUES ($1, $2, 'gmail', true, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        tokenId,
        name,
        labelIds || null,
        dateFrom ? new Date(dateFrom) : null,
        dateTo ? new Date(dateTo) : null,
        syncFrequency,
        nextSyncAt,
      ]
    );

    logger.info('Created Gmail sync configuration', {
      configId: result.rows[0].id,
      name,
      tokenId,
    });

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Failed to create Gmail sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/sync/gmail/configs/:id
 * Update a Gmail sync configuration
 */
router.put('/configs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      labelIds,
      dateFrom,
      dateTo,
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
    if (labelIds !== undefined) {
      updates.push(`gmail_label_ids = $${paramCount++}`);
      values.push(labelIds);
    }
    if (dateFrom !== undefined) {
      updates.push(`gmail_date_from = $${paramCount++}`);
      values.push(dateFrom ? new Date(dateFrom) : null);
    }
    if (dateTo !== undefined) {
      updates.push(`gmail_date_to = $${paramCount++}`);
      values.push(dateTo ? new Date(dateTo) : null);
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
       WHERE id = $${paramCount} AND service_type = 'gmail'
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

    logger.info('Updated Gmail sync configuration', { configId: id });

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Failed to update Gmail sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/sync/gmail/configs/:id
 * Delete a Gmail sync configuration
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
      `DELETE FROM sync_configurations WHERE id = $1 AND service_type = 'gmail' RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
      });
    }

    logger.info('Deleted Gmail sync configuration', { configId: id });

    res.json({
      success: true,
      message: 'Configuration deleted',
    });
  } catch (error: any) {
    logger.error('Failed to delete Gmail sync config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/gmail/configs/:id/trigger
 * Manually trigger a Gmail sync
 */
router.post('/configs/:id/trigger', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify config exists and is enabled
    const configResult = await query(
      `SELECT * FROM sync_configurations WHERE id = $1 AND service_type = 'gmail'`,
      [id]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
      });
    }

    // Add job to queue
    const job = await addGmailSyncJob(id, 'manual');

    logger.info('Triggered manual Gmail sync', { configId: id, jobId: job.id });

    res.json({
      success: true,
      data: {
        jobId: job.id,
        message: 'Sync job queued',
      },
    });
  } catch (error: any) {
    logger.error('Failed to trigger Gmail sync', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/gmail/configs/:id/history
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
    logger.error('Failed to get Gmail sync history', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/gmail/configs/:id/jobs
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
    logger.error('Failed to get Gmail sync jobs', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/gmail/preview
 * Preview emails matching configuration without syncing
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const {
      tokenId,
      labelIds,
      dateFrom,
      dateTo,
      maxResults = 10,
    } = req.body;

    if (!tokenId) {
      return res.status(400).json({
        success: false,
        error: 'tokenId is required',
      });
    }

    const preview = await previewGmailMessages(tokenId, {
      labelIds,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      maxResults,
    });

    res.json({
      success: true,
      data: preview,
    });
  } catch (error: any) {
    logger.error('Failed to preview Gmail messages', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/gmail/job/:jobId
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
