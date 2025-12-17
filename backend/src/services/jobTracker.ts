/**
 * Job Tracker Service
 * 
 * Tracks async processing jobs (file processing, reprocessing, exports)
 * with status, progress, and results.
 */

import logger from '../utils/logger';

export type JobType = 'file_processing' | 'reprocess' | 'export' | 'ai_extraction' | 'sync_processing';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Job {
    id: string;
    type: JobType;
    status: JobStatus;
    progress: number;
    message?: string;
    metadata?: Record<string, any>;
    startedAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    result?: any;
    error?: string;
}

// In-memory job store (consider Redis for production clustering)
const jobs = new Map<string, Job>();
const MAX_COMPLETED_JOBS = 100;

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
    return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new job
 */
export function createJob(type: JobType, metadata?: Record<string, any>): string {
    const id = generateJobId();
    const now = new Date();

    const job: Job = {
        id,
        type,
        status: 'queued',
        progress: 0,
        metadata,
        startedAt: now,
        updatedAt: now,
    };

    jobs.set(id, job);
    logger.info(`Job created: ${id}`, { type, metadata });

    // Cleanup old completed jobs if over limit
    cleanupOldJobs();

    return id;
}

/**
 * Start processing a job
 */
export function startJob(jobId: string, message?: string): void {
    const job = jobs.get(jobId);
    if (!job) {
        logger.warn(`Job not found: ${jobId}`);
        return;
    }

    job.status = 'processing';
    job.message = message;
    job.updatedAt = new Date();
    logger.debug(`Job started: ${jobId}`, { message });
}

/**
 * Update job progress
 */
export function updateJobProgress(jobId: string, progress: number, message?: string): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.progress = Math.min(100, Math.max(0, progress));
    job.status = 'processing';
    if (message) job.message = message;
    job.updatedAt = new Date();
}

/**
 * Complete a job successfully
 */
export function completeJob(jobId: string, result?: any): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.completedAt = new Date();
    job.updatedAt = new Date();

    logger.info(`Job completed: ${jobId}`, {
        duration: job.completedAt.getTime() - job.startedAt.getTime()
    });
}

/**
 * Fail a job
 */
export function failJob(jobId: string, error: string): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.error = error;
    job.completedAt = new Date();
    job.updatedAt = new Date();

    logger.error(`Job failed: ${jobId}`, { error });
}

/**
 * Cancel a job
 */
export function cancelJob(jobId: string): boolean {
    const job = jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed') {
        return false;
    }

    job.status = 'cancelled';
    job.completedAt = new Date();
    job.updatedAt = new Date();

    logger.info(`Job cancelled: ${jobId}`);
    return true;
}

/**
 * Get a specific job
 */
export function getJob(jobId: string): Job | undefined {
    return jobs.get(jobId);
}

/**
 * Get all active (non-completed) jobs
 */
export function getActiveJobs(): Job[] {
    return Array.from(jobs.values())
        .filter(job => job.status === 'queued' || job.status === 'processing')
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

/**
 * Get recent jobs (including completed)
 */
export function getRecentJobs(limit = 20): Job[] {
    return Array.from(jobs.values())
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit);
}

/**
 * Get job statistics
 */
export function getJobStats() {
    const allJobs = Array.from(jobs.values());
    return {
        total: allJobs.length,
        queued: allJobs.filter(j => j.status === 'queued').length,
        processing: allJobs.filter(j => j.status === 'processing').length,
        completed: allJobs.filter(j => j.status === 'completed').length,
        failed: allJobs.filter(j => j.status === 'failed').length,
        cancelled: allJobs.filter(j => j.status === 'cancelled').length,
    };
}

/**
 * Cleanup old completed jobs
 */
function cleanupOldJobs(): void {
    const completedJobs = Array.from(jobs.values())
        .filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled')
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Remove oldest completed jobs if over limit
    if (completedJobs.length > MAX_COMPLETED_JOBS) {
        const toRemove = completedJobs.slice(MAX_COMPLETED_JOBS);
        toRemove.forEach(job => jobs.delete(job.id));
    }
}

export default {
    createJob,
    startJob,
    updateJobProgress,
    completeJob,
    failJob,
    cancelJob,
    getJob,
    getActiveJobs,
    getRecentJobs,
    getJobStats,
};
