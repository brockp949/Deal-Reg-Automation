/**
 * Jobs API Routes
 * 
 * Endpoints for tracking async job status and progress.
 */

import { Router, Request, Response } from 'express';
import {
    getJob,
    getActiveJobs,
    getRecentJobs,
    getJobStats,
    cancelJob,
} from '../services/jobTracker';
import { getCacheStats } from '../middleware/cache';

const router = Router();

/**
 * GET /api/jobs
 * List all active and recent jobs
 */
router.get('/', (req: Request, res: Response) => {
    const activeOnly = req.query.active === 'true';
    const limit = parseInt(req.query.limit as string) || 20;

    const jobs = activeOnly ? getActiveJobs() : getRecentJobs(limit);
    const stats = getJobStats();

    res.json({
        success: true,
        data: {
            jobs,
            stats,
        },
    });
});

/**
 * GET /api/jobs/stats
 * Get job and cache statistics
 */
router.get('/stats', (req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            jobs: getJobStats(),
            cache: getCacheStats(),
        },
    });
});

/**
 * GET /api/jobs/:id
 * Get specific job status
 */
router.get('/:id', (req: Request, res: Response) => {
    const job = getJob(req.params.id);

    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'Job not found',
        });
    }

    res.json({
        success: true,
        data: job,
    });
});

/**
 * DELETE /api/jobs/:id
 * Cancel a job
 */
router.delete('/:id', (req: Request, res: Response) => {
    const success = cancelJob(req.params.id);

    if (!success) {
        return res.status(400).json({
            success: false,
            error: 'Job cannot be cancelled (not found or already completed)',
        });
    }

    res.json({
        success: true,
        message: 'Job cancelled',
    });
});

export default router;
