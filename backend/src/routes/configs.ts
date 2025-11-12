import { Router, Request, Response } from 'express';
import { query } from '../db';
import logger from '../utils/logger';
import { recordFileSecurityEvent } from '../services/fileSecurity';

const router = Router();

router.get('/snapshots', async (req: Request, res: Response) => {
  try {
    const { limit = '50' } = req.query;
    const result = await query(
      `SELECT *
       FROM config_snapshots
       ORDER BY created_at DESC
       LIMIT $1`,
      [parseInt(limit as string, 10)]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Failed to fetch config snapshots', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch config snapshots',
    });
  }
});

router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const totalResult = await query('SELECT COUNT(*)::int AS count FROM config_snapshots');
    const appliedResult = await query(
      'SELECT COUNT(*)::int AS count FROM config_snapshots WHERE applied_at IS NOT NULL'
    );

    res.json({
      success: true,
      data: {
        totalSnapshots: totalResult.rows[0]?.count ?? 0,
        appliedSnapshots: appliedResult.rows[0]?.count ?? 0,
        pendingSnapshots:
          (totalResult.rows[0]?.count ?? 0) - (appliedResult.rows[0]?.count ?? 0),
      },
    });
  } catch (error: any) {
    logger.error('Failed to fetch config metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch config metrics',
    });
  }
});

router.post('/snapshots/:id/apply', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const appliedBy = req.body?.appliedBy || 'skip-operator';
    const notes = req.body?.notes || null;

    const result = await query(
      `UPDATE config_snapshots
       SET applied_by = $1,
           applied_at = CURRENT_TIMESTAMP,
           applied_notes = $3
       WHERE id = $2
       RETURNING *`,
      [appliedBy, id, notes]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot not found',
      });
    }

    const snapshot = result.rows[0];
    if (snapshot.source_file_id) {
      await recordFileSecurityEvent({
        fileId: snapshot.source_file_id,
        eventType: 'config_applied',
        actor: appliedBy,
        details: {
          snapshotId: snapshot.id,
          notes,
        },
      });
    }

    res.json({
      success: true,
      data: snapshot,
      message: `Config ${snapshot.config_name} applied`,
    });
  } catch (error: any) {
    logger.error('Failed to apply config snapshot', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to apply config snapshot',
    });
  }
});

export default router;
