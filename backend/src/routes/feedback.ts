/**
 * Feedback Routes
 *
 * Endpoints for collecting user feedback and corrections
 * to improve extraction accuracy through continuous learning.
 */

import { Router, Request, Response } from 'express';
import { getLearningAgent, type FeedbackEvent } from '../agents/ContinuousLearningAgent';
import { requireRole } from '../api/middleware/apiKeyAuth';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/feedback
 * Submit a correction or feedback event
 */
router.post('/', requireRole(['write', 'admin']), async (req: Request, res: Response) => {
  try {
    const { type, entity, fileId, fileName, metadata } = req.body;

    // Validate request
    if (!type || !entity || !fileId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, entity, fileId',
      });
    }

    if (!['correction', 'validation', 'rejection'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Must be: correction, validation, or rejection',
      });
    }

    if (!entity.type || !entity.extracted) {
      return res.status(400).json({
        success: false,
        error: 'entity must include type and extracted data',
      });
    }

    if (!['vendor', 'deal', 'contact'].includes(entity.type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity.type. Must be: vendor, deal, or contact',
      });
    }

    // For corrections, corrected data is required
    if (type === 'correction' && !entity.corrected) {
      return res.status(400).json({
        success: false,
        error: 'Corrected data is required for correction feedback',
      });
    }

    // Build feedback event
    const feedbackEvent: FeedbackEvent = {
      type,
      entity: {
        type: entity.type,
        extracted: entity.extracted,
        corrected: entity.corrected,
      },
      fileId,
      fileName,
      userId: req.header('x-user-id') || req.header('x-operator-id') || 'anonymous',
      timestamp: new Date(),
      metadata,
    };

    // Record feedback
    const learningAgent = getLearningAgent();
    await learningAgent.recordFeedback(feedbackEvent);

    logger.info('Feedback recorded', {
      type,
      entityType: entity.type,
      fileId,
      userId: feedbackEvent.userId,
    });

    return res.status(201).json({
      success: true,
      message: 'Feedback recorded successfully',
      data: {
        type,
        entityType: entity.type,
        timestamp: feedbackEvent.timestamp,
      },
    });
  } catch (error: any) {
    logger.error('Failed to record feedback', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to record feedback',
      message: error.message,
    });
  }
});

/**
 * POST /api/feedback/batch
 * Submit multiple feedback events at once
 */
router.post('/batch', requireRole(['write', 'admin']), async (req: Request, res: Response) => {
  try {
    const { feedbacks } = req.body;

    if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'feedbacks must be a non-empty array',
      });
    }

    const learningAgent = getLearningAgent();
    const results: Array<{ success: boolean; error?: string }> = [];

    for (const feedback of feedbacks) {
      try {
        const feedbackEvent: FeedbackEvent = {
          type: feedback.type,
          entity: {
            type: feedback.entity.type,
            extracted: feedback.entity.extracted,
            corrected: feedback.entity.corrected,
          },
          fileId: feedback.fileId,
          fileName: feedback.fileName,
          userId: req.header('x-user-id') || req.header('x-operator-id') || 'anonymous',
          timestamp: new Date(),
          metadata: feedback.metadata,
        };

        await learningAgent.recordFeedback(feedbackEvent);
        results.push({ success: true });
      } catch (error: any) {
        results.push({ success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    logger.info('Batch feedback recorded', {
      total: feedbacks.length,
      successful: successCount,
      failed: feedbacks.length - successCount,
    });

    return res.status(200).json({
      success: true,
      message: `Recorded ${successCount}/${feedbacks.length} feedback events`,
      data: {
        total: feedbacks.length,
        successful: successCount,
        failed: feedbacks.length - successCount,
        results,
      },
    });
  } catch (error: any) {
    logger.error('Failed to record batch feedback', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to record batch feedback',
      message: error.message,
    });
  }
});

/**
 * GET /api/feedback/insights
 * Get learned insights from feedback
 */
router.get('/insights', requireRole(['read', 'write', 'admin']), async (req: Request, res: Response) => {
  try {
    const learningAgent = getLearningAgent();
    const insights = learningAgent.getInsights();

    return res.status(200).json({
      success: true,
      data: {
        insights,
        count: insights.length,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get insights', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to get insights',
      message: error.message,
    });
  }
});

/**
 * POST /api/feedback/analyze
 * Trigger learning analysis manually
 */
router.post('/analyze', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    logger.info('Manual learning analysis triggered');

    const learningAgent = getLearningAgent();
    const analysisResult = await learningAgent.analyzeAndLearn();

    return res.status(200).json({
      success: true,
      message: 'Learning analysis completed',
      data: analysisResult,
    });
  } catch (error: any) {
    logger.error('Failed to analyze feedback', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to analyze feedback',
      message: error.message,
    });
  }
});

export default router;
