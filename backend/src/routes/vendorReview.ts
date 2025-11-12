import { Router, Request, Response } from 'express';
import {
  listVendorReviewQueue,
  getVendorReviewItem,
  resolveVendorReviewItem,
  ResolveVendorReviewPayload,
} from '../services/vendorApprovalService';
import { ApiResponse } from '../types';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/vendor-review
 * List vendor suggestions awaiting approval
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'pending';
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '20', 10);

    const { data, total } = await listVendorReviewQueue({ status: status as any, page, limit });

    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    logger.error('Failed to list vendor review queue', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to load vendor review queue',
    });
  }
});

/**
 * GET /api/vendor-review/:id
 * Fetch a single vendor review item
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await getVendorReviewItem(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Review item not found',
      });
    }

    const response: ApiResponse = {
      success: true,
      data: item,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Failed to fetch vendor review item', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch review item',
    });
  }
});

/**
 * POST /api/vendor-review/:id/decision
 * Approve or deny a vendor suggestion
 */
router.post('/:id/decision', async (req: Request, res: Response) => {
  try {
    const payload: ResolveVendorReviewPayload = req.body;

    if (!payload || !payload.action) {
      return res.status(400).json({
        success: false,
        error: 'Action is required (approve or deny)',
      });
    }

    if (payload.action === 'approve' && !payload.vendor_id && !payload.vendor) {
      return res.status(400).json({
        success: false,
        error: 'Provide an existing vendor_id or vendor details to approve',
      });
    }

    const updated = await resolveVendorReviewItem(req.params.id, payload);

    res.json({
      success: true,
      data: updated,
      message: `Vendor ${payload.action}d successfully`,
    });
  } catch (error: any) {
    logger.error('Failed to resolve vendor review item', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to resolve review item',
    });
  }
});

export default router;
