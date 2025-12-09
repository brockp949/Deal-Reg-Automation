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
    Job,
} from '../services/jobTracker';
import { getCacheStats } from '../middleware/cache';
import { getQueueStats } from '../queues/fileProcessingQueue';
import { query } from '../db';

const router = Router();

/**
 * GET /api/jobs
 * List all active and recent jobs
 */
router.get('/', async (req: Request, res: Response) => {
    const activeOnly = req.query.active === 'true';
    const limitParam = parseInt(req.query.limit as string, 10);
    const offsetParam = parseInt(req.query.offset as string, 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
    const offset = Number.isFinite(offsetParam) && offsetParam >= 0 && offsetParam <= 500 ? offsetParam : 0;

    const jobs = activeOnly ? getActiveJobs() : getRecentJobs(limit + offset).slice(offset);
    const stats = getJobStats();
    const enrichedJobs = await enrichJobListWithParserDetails(jobs);

    res.json({
        success: true,
        data: {
            jobs: enrichedJobs,
            stats,
            meta: {
                activeOnly,
                limit,
                offset,
            },
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
            queue: getQueueStats(),
        },
    });
});

/**
 * GET /api/jobs/:id
 * Get specific job status
 */
router.get('/:id', async (req: Request, res: Response) => {
    const job = getJob(req.params.id);
    const queueDetails = await getQueueJobDetails(job?.metadata?.bullJobId || req.params.id);

    if (!job && !queueDetails) {
        return res.status(404).json({
            success: false,
            error: 'Job not found',
        });
    }

    const enriched = job
        ? await enrichJobWithParserDetails(job)
        : undefined;

    res.json({
        success: true,
        data: {
            job: enriched || job,
            queue: queueDetails,
        },
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

async function getQueueJobDetails(bullJobId?: string) {
    if (!bullJobId) return null;

    try {
        const { fileProcessingQueue } = await import('../queues/fileProcessingQueue');
        const queueJob = await fileProcessingQueue.getJob(bullJobId);
        if (!queueJob) return null;

        const state = await queueJob.getState();
        const progress = queueJob.progress();
        const result = queueJob.returnvalue;
        const failedReason = queueJob.failedReason;

        return {
            id: queueJob.id,
            state,
            progress,
            result,
            failedReason,
            attemptsMade: queueJob.attemptsMade,
            processedOn: queueJob.processedOn,
            finishedOn: queueJob.finishedOn,
          };
    } catch (error: any) {
        return null;
    }
}

async function enrichJobWithParserDetails(job: Job) {
    try {
        const fileId = job.metadata?.fileId;
        if (!fileId) return job;

        const provenanceCounts = await getProvenanceCount([fileId]);
        const result = await query(
            `SELECT metadata, processing_status, error_message
             FROM source_files
             WHERE id = $1
             LIMIT 1`,
            [fileId]
        );

        if (result.rows.length === 0) return job;

        const file = result.rows[0];
        return {
            ...job,
            parserWarnings: file.metadata?.parserWarnings || [],
            progress: file.metadata?.progress ?? job.progress,
            processingStatus: file.processing_status,
            errorMessage: file.error_message,
            parserSourceTags: file.metadata?.parserSourceTags || file.metadata?.sourceTags || [],
            provenanceCount: provenanceCounts.get(fileId) || 0,
        };
    } catch (error: any) {
        return job;
    }
}

async function enrichJobListWithParserDetails(jobs: Job[]) {
    const fileIds = Array.from(
        new Set(
            jobs
                .map((j) => j.metadata?.fileId)
                .filter(Boolean) as string[]
        )
    );

    if (fileIds.length === 0) return jobs;

    const [files, provenanceCounts] = await Promise.all([
        query(
            `SELECT id, metadata, processing_status, error_message
             FROM source_files
             WHERE id = ANY($1::uuid[])`,
            [fileIds]
        ).then((r) => r.rows),
        getProvenanceCount(fileIds),
    ]);

    const byId = new Map(files.map((f: any) => [f.id, f]));

    return jobs.map((job) => {
        const fileId = job.metadata?.fileId;
        if (!fileId) return job;
        const file = byId.get(fileId);
        if (!file) return job;

        return {
            ...job,
            parserWarnings: file.metadata?.parserWarnings || [],
            parserSourceTags: file.metadata?.parserSourceTags || file.metadata?.sourceTags || [],
            progress: file.metadata?.progress ?? job.progress,
            processingStatus: file.processing_status,
            errorMessage: file.error_message,
            provenanceCount: provenanceCounts.get(fileId) || 0,
        };
    });
}

async function getProvenanceCount(fileIds: string[]) {
    if (!fileIds.length) return new Map<string, number>();
    const result = await query(
        `SELECT source_file_id, COUNT(*)::int AS count
         FROM field_provenance
         WHERE source_file_id = ANY($1::uuid[])
         GROUP BY source_file_id`,
        [fileIds]
    );
    return new Map<string, number>(result.rows.map((r: any) => [r.source_file_id, r.count]));
}
