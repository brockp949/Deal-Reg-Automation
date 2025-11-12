/**
 * Provenance API Routes
 *
 * Endpoints for accessing field provenance data, enabling full transparency
 * of where each data value came from and how it was extracted.
 */

import { Router, Request, Response } from 'express';
import {
  getFieldProvenance,
  getCurrentProvenance,
  getProvenanceHistory,
  getSourceFileProvenanceStats,
  updateValidationStatus,
  EntityType,
  ValidationStatus,
} from '../services/provenanceTracker';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/provenance/:entityType/:entityId
 * Get current provenance for all fields of an entity
 */
router.get('/:entityType/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.params;

    // Validate entity type
    if (!['deal', 'vendor', 'contact'].includes(entityType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type. Must be deal, vendor, or contact',
      });
    }

    const provenanceMap = await getCurrentProvenance(entityType as EntityType, entityId);

    // Convert Map to object for JSON response
    const provenanceObj: Record<string, any> = {};
    provenanceMap.forEach((value, key) => {
      provenanceObj[key] = value;
    });

    res.json({
      success: true,
      data: {
        entityType,
        entityId,
        fields: provenanceObj,
        fieldCount: provenanceMap.size,
      },
    });
  } catch (error: any) {
    logger.error('Error getting current provenance', {
      error: error.message,
      params: req.params,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get provenance',
    });
  }
});

/**
 * GET /api/provenance/:entityType/:entityId/field/:fieldName
 * Get provenance history for a specific field
 */
router.get('/:entityType/:entityId/field/:fieldName', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId, fieldName } = req.params;

    if (!['deal', 'vendor', 'contact'].includes(entityType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type',
      });
    }

    const provenance = await getFieldProvenance(entityType as EntityType, entityId, fieldName);

    res.json({
      success: true,
      data: {
        entityType,
        entityId,
        fieldName,
        history: provenance,
        versionCount: provenance.length,
        currentValue: provenance.find((p) => p.isCurrent),
      },
    });
  } catch (error: any) {
    logger.error('Error getting field provenance', {
      error: error.message,
      params: req.params,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get field provenance',
    });
  }
});

/**
 * GET /api/provenance/:entityType/:entityId/history
 * Get complete provenance history for an entity (all fields, all versions)
 */
router.get('/:entityType/:entityId/history', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.params;

    if (!['deal', 'vendor', 'contact'].includes(entityType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type',
      });
    }

    const history = await getProvenanceHistory(entityType as EntityType, entityId);

    // Group by field name for easier consumption
    const byField: Record<string, any[]> = {};
    history.forEach((record) => {
      if (!byField[record.fieldName]) {
        byField[record.fieldName] = [];
      }
      byField[record.fieldName].push(record);
    });

    res.json({
      success: true,
      data: {
        entityType,
        entityId,
        totalRecords: history.length,
        fields: Object.keys(byField).length,
        history,
        byField,
      },
    });
  } catch (error: any) {
    logger.error('Error getting provenance history', {
      error: error.message,
      params: req.params,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get provenance history',
    });
  }
});

/**
 * GET /api/provenance/source-file/:fileId/stats
 * Get provenance statistics for a source file
 */
router.get('/source-file/:fileId/stats', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;

    const stats = await getSourceFileProvenanceStats(fileId);

    res.json({
      success: true,
      data: {
        sourceFileId: fileId,
        ...stats,
      },
    });
  } catch (error: any) {
    logger.error('Error getting source file provenance stats', {
      error: error.message,
      fileId: req.params.fileId,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get provenance stats',
    });
  }
});

/**
 * PATCH /api/provenance/:entityType/:entityId/field/:fieldName/validate
 * Update validation status for a field
 */
router.patch('/:entityType/:entityId/field/:fieldName/validate', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId, fieldName } = req.params;
    const { validationStatus } = req.body;

    if (!['deal', 'vendor', 'contact'].includes(entityType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type',
      });
    }

    if (!['validated', 'unvalidated', 'rejected', 'corrected'].includes(validationStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid validation status. Must be: validated, unvalidated, rejected, or corrected',
      });
    }

    await updateValidationStatus(
      entityType as EntityType,
      entityId,
      fieldName,
      validationStatus as ValidationStatus
    );

    res.json({
      success: true,
      message: 'Validation status updated',
      data: {
        entityType,
        entityId,
        fieldName,
        validationStatus,
      },
    });
  } catch (error: any) {
    logger.error('Error updating validation status', {
      error: error.message,
      params: req.params,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update validation status',
    });
  }
});

export default router;
