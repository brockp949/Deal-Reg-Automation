/**
 * Batch Duplicate Detection API Routes
 */

import { Router, Request, Response } from 'express';
import { detectDuplicateDeals } from '../services/duplicateDetector';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/duplicates/batch
 * Batch detect duplicates for multiple entities
 */
router.post('/batch', async (req: Request, res: Response) => {
    try {
        const { entities, entityType = 'deal', options = {} } = req.body;

        if (!Array.isArray(entities) || entities.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'entities array is required',
            });
        }

        if (entities.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 100 entities per batch',
            });
        }

        const parallelism = Math.min(options.parallelism || 5, 10);
        const results: any[] = [];

        // Process in parallel batches
        for (let i = 0; i < entities.length; i += parallelism) {
            const batch = entities.slice(i, i + parallelism);
            const batchResults = await Promise.all(
                batch.map(async (entity) => {
                    try {
                        const result = await detectDuplicateDeals(entity);
                        return {
                            entity: entity.dealName || entity.vendorName || entity.name,
                            ...result,
                        };
                    } catch (error: any) {
                        return {
                            entity: entity.dealName || entity.vendorName || entity.name,
                            error: error.message,
                            isDuplicate: false,
                            matches: [],
                        };
                    }
                })
            );
            results.push(...batchResults);
        }

        // Summary statistics
        const summary = {
            total: results.length,
            duplicatesFound: results.filter(r => r.isDuplicate).length,
            errors: results.filter(r => r.error).length,
            uniqueEntities: results.filter(r => !r.isDuplicate && !r.error).length,
        };

        logger.info('Batch duplicate detection completed', summary);

        res.json({
            success: true,
            data: results,
            summary,
        });
    } catch (error: any) {
        logger.error('Batch duplicate detection failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/duplicates/find-similar
 * Find entities similar to a given entity
 */
router.post('/find-similar', async (req: Request, res: Response) => {
    try {
        const { entity, entityType = 'deal', limit = 10, minSimilarity = 0.5 } = req.body;

        if (!entity) {
            return res.status(400).json({
                success: false,
                error: 'entity is required',
            });
        }

        const result = await detectDuplicateDeals(entity);
        const similar = result.matches || [];

        // Filter by minimum similarity
        const filtered = similar.filter((s: any) => s.similarityScore >= minSimilarity);

        res.json({
            success: true,
            data: filtered,
            count: filtered.length,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
