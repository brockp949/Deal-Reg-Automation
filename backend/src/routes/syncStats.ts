/**
 * Sync Statistics Routes
 *
 * API endpoints for sync dashboard statistics.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/sync/stats
 * Get sync statistics for dashboard
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Get count of active (enabled) sync configurations
    const activeConfigsResult = await query(
      `SELECT COUNT(*) as count FROM sync_configurations WHERE enabled = true`,
      []
    );
    const activeConfigs = parseInt(activeConfigsResult.rows[0]?.count || '0', 10);

    // Get last sync timestamp across all configs
    const lastSyncResult = await query(
      `SELECT MAX(completed_at) as last_sync_at FROM sync_runs WHERE status = 'completed'`,
      []
    );
    const lastSyncAt = lastSyncResult.rows[0]?.last_sync_at || null;

    // Get recent sync runs (last 10)
    const recentRunsResult = await query(
      `SELECT sr.*, sc.name as config_name, sc.service_type
       FROM sync_runs sr
       JOIN sync_configurations sc ON sr.config_id = sc.id
       ORDER BY sr.started_at DESC
       LIMIT 10`,
      []
    );
    const recentRuns = recentRunsResult.rows;

    // Get total items synced (from completed sync runs)
    const totalItemsResult = await query(
      `SELECT COALESCE(SUM(items_processed), 0) as total FROM sync_runs WHERE status = 'completed'`,
      []
    );
    const totalItemsSynced = parseInt(totalItemsResult.rows[0]?.total || '0', 10);

    // Get next scheduled sync
    const nextSyncResult = await query(
      `SELECT MIN(next_sync_at) as next_sync_at
       FROM sync_configurations
       WHERE enabled = true AND sync_frequency != 'manual' AND next_sync_at > NOW()`,
      []
    );
    const nextSyncAt = nextSyncResult.rows[0]?.next_sync_at || null;

    res.json({
      success: true,
      data: {
        activeConfigs,
        lastSyncAt,
        nextSyncAt,
        recentRuns,
        totalItemsSynced,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get sync stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/sync/stats/summary
 * Get a quick summary for KPI display
 */
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
        (SELECT COUNT(*) FROM sync_configurations WHERE enabled = true) as active_configs,
        (SELECT MAX(completed_at) FROM sync_runs WHERE status = 'completed') as last_sync_at,
        (SELECT COUNT(*) FROM sync_runs WHERE status = 'running') as running_syncs`,
      []
    );

    const row = result.rows[0] || {};

    res.json({
      success: true,
      data: {
        activeConfigs: parseInt(row.active_configs || '0', 10),
        lastSyncAt: row.last_sync_at || null,
        runningSyncs: parseInt(row.running_syncs || '0', 10),
      },
    });
  } catch (error: any) {
    logger.error('Failed to get sync summary', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
