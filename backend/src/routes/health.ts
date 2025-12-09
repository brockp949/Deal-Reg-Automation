import { Router, Request, Response } from 'express';
import pool from '../db';
import { createClient } from 'redis';
import { config } from '../config';

const router = Router();

/**
 * GET /healthz (liveness)
 */
router.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/**
 * GET /readyz (readiness: DB + Redis)
 */
router.get('/readyz', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');

    // Optional Redis check
    const client = createClient({ url: config.redisUrl });
    await client.connect();
    await client.ping();
    await client.quit();

    res.json({ status: 'ready' });
  } catch (error: any) {
    res.status(503).json({ status: 'unready', error: error.message });
  }
});

export default router;
