import { query } from '../db';
import { normalizeVendorName } from '../utils/fileHelpers';
import logger from '../utils/logger';
import { VendorApprovalPendingError, VendorApprovalDeniedError } from '../errors/vendorApprovalErrors';
import { trackVendorProvenance } from './provenanceTracker';

export type VendorApprovalStatus = 'approved' | 'pending' | 'denied';

export interface VendorDetectionContext {
  source_file_id?: string;
  detection_source?: string;
  sample_text?: string;
  metadata?: Record<string, any>;
}

export interface VendorReviewItem {
  id: string;
  alias_name: string;
  normalized_alias: string;
  status: VendorApprovalStatus;
  detection_count: number;
  first_detected_at: Date;
  last_detected_at: Date;
  latest_context: Record<string, any>;
  metadata: Record<string, any>;
  approved_vendor_id?: string;
  decision_notes?: string;
  resolved_at?: Date;
  resolved_by?: string;
}

export interface VendorReviewQueryParams {
  status?: VendorApprovalStatus;
  page?: number;
  limit?: number;
}

export interface ResolveVendorReviewPayload {
  action: 'approve' | 'deny';
  vendor_id?: string;
  vendor?: {
    name: string;
    email_domains?: string[];
    website?: string;
    industry?: string;
    notes?: string;
  };
  notes?: string;
  resolved_by?: string;
}

function buildContextPayload(context?: VendorDetectionContext) {
  const payload = {
    source_file_id: context?.source_file_id || null,
    detection_source: context?.detection_source || 'unknown',
    sample_text: context?.sample_text || null,
    metadata: context?.metadata || null,
    observed_at: new Date().toISOString(),
  };

  return payload;
}

async function upsertVendorReviewCandidate(
  aliasName: string,
  normalizedAlias: string,
  context?: VendorDetectionContext
) {
  const latestContext = buildContextPayload(context);

  const result = await query(
    `
    INSERT INTO vendor_review_queue (
      alias_name, normalized_alias, latest_context, metadata
    )
    VALUES ($1, $2, $3::jsonb, $3::jsonb)
    ON CONFLICT (normalized_alias)
    DO UPDATE
      SET detection_count = vendor_review_queue.detection_count + 1,
          last_detected_at = CURRENT_TIMESTAMP,
          latest_context = $3::jsonb,
          metadata = vendor_review_queue.metadata || $3::jsonb
    RETURNING *
    `,
    [aliasName, normalizedAlias, JSON.stringify(latestContext)]
  );

  return result.rows[0];
}

export async function ensureVendorApproved(
  vendorName: string,
  context?: VendorDetectionContext
): Promise<string> {
  if (!vendorName || !vendorName.trim()) {
    throw new Error('Vendor name is required');
  }

  const normalizedName = normalizeVendorName(vendorName);

  // Check existing vendors
  const existingResult = await query(
    `SELECT id, approval_status
     FROM vendors
     WHERE normalized_name = $1
     LIMIT 1`,
    [normalizedName]
  );

  if (existingResult.rows.length > 0) {
    const vendor = existingResult.rows[0];

    if (!vendor.approval_status || vendor.approval_status === 'approved') {
      return vendor.id;
    }

    if (vendor.approval_status === 'denied') {
      throw new VendorApprovalDeniedError(vendorName);
    }

    const alias = await upsertVendorReviewCandidate(vendorName, normalizedName, context);
    throw new VendorApprovalPendingError(vendorName, alias.id);
  }

  // Check review queue
  const reviewResult = await query(
    `SELECT *
     FROM vendor_review_queue
     WHERE normalized_alias = $1
     LIMIT 1`,
    [normalizedName]
  );

  if (reviewResult.rows.length > 0) {
    const review = reviewResult.rows[0];

    if (review.status === 'approved' && review.approved_vendor_id) {
      return review.approved_vendor_id;
    }

    if (review.status === 'denied') {
      throw new VendorApprovalDeniedError(vendorName);
    }

    await upsertVendorReviewCandidate(vendorName, normalizedName, context);
    throw new VendorApprovalPendingError(vendorName, review.id);
  }

  const alias = await upsertVendorReviewCandidate(vendorName, normalizedName, context);
  logger.info('Vendor requires approval before use', {
    vendor: vendorName,
    reviewId: alias.id,
  });
  throw new VendorApprovalPendingError(vendorName, alias.id);
}

export async function listVendorReviewQueue(
  params: VendorReviewQueryParams
): Promise<{ data: VendorReviewItem[]; total: number }> {
  const status = params.status || 'pending';
  const page = params.page && params.page > 0 ? params.page : 1;
  const limit = params.limit && params.limit > 0 ? params.limit : 20;
  const offset = (page - 1) * limit;

  const countResult = await query(
    `SELECT COUNT(*) FROM vendor_review_queue WHERE status = $1`,
    [status]
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const listResult = await query(
    `SELECT * FROM vendor_review_queue
     WHERE status = $1
     ORDER BY last_detected_at DESC
     LIMIT $2 OFFSET $3`,
    [status, limit, offset]
  );

  return {
    data: listResult.rows,
    total,
  };
}

export async function getVendorReviewItem(id: string): Promise<VendorReviewItem | null> {
  const result = await query(
    `SELECT * FROM vendor_review_queue WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

async function createVendorFromAlias(alias: VendorReviewItem, vendorInput: ResolveVendorReviewPayload['vendor']) {
  if (!vendorInput) {
    throw new Error('Vendor details are required when creating a new vendor');
  }

  const normalizedName = normalizeVendorName(vendorInput.name);
  const result = await query(
    `INSERT INTO vendors (
      name, normalized_name, email_domains, website, industry,
      notes, status, origin, approval_status, approved_at, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'active', 'approved_from_queue', 'approved', NOW(), $7)
    RETURNING id`,
    [
      vendorInput.name,
      normalizedName,
      vendorInput.email_domains || null,
      vendorInput.website || null,
      vendorInput.industry || null,
      vendorInput.notes || null,
      JSON.stringify({
        created_from_alias: alias.id,
      }),
    ]
  );

  const vendorId = result.rows[0].id;

  // Track provenance for vendor fields
  try {
    const sourceFileId = alias.metadata?.source_file_id;
    const detectionSource = alias.metadata?.detection_source || 'vendor_review_queue';

    await trackVendorProvenance(
      vendorId,
      {
        name: vendorInput.name,
        normalized_name: normalizedName,
        email_domains: vendorInput.email_domains,
        website: vendorInput.website,
        industry: vendorInput.industry,
      },
      {
        sourceFileId,
        sourceType: 'manual', // Created through approval process
        sourceLocation: `Vendor Review Queue: ${alias.alias_name}`,
        extractionMethod: 'manual',
        confidence: 1.0, // Manual approval = high confidence
        extractionContext: {
          created_from_alias: alias.id,
          detection_source: detectionSource,
          approval_status: 'approved',
        },
      }
    );
  } catch (provenanceError: any) {
    logger.error('Failed to track vendor provenance', {
      vendorId,
      error: provenanceError.message,
    });
  }

  return vendorId;
}

export async function resolveVendorReviewItem(
  id: string,
  payload: ResolveVendorReviewPayload
): Promise<VendorReviewItem> {
  const review = await getVendorReviewItem(id);
  if (!review) {
    throw new Error('Vendor review item not found');
  }

  if (payload.action === 'approve') {
    let vendorId = payload.vendor_id;

    if (!vendorId) {
      vendorId = await createVendorFromAlias(review, payload.vendor);
    }

    await query(
      `UPDATE vendors
       SET approval_status = 'approved',
           approved_at = NOW(),
           approval_notes = COALESCE(approval_notes, $2),
           origin = COALESCE(origin, 'approved_from_queue')
       WHERE id = $1`,
      [vendorId, payload.notes || null]
    );

    const updateResult = await query(
      `UPDATE vendor_review_queue
       SET status = 'approved',
           approved_vendor_id = $2,
           decision_notes = $3,
           resolved_at = NOW(),
           resolved_by = $4
       WHERE id = $1
       RETURNING *`,
      [id, vendorId, payload.notes || null, payload.resolved_by || 'system']
    );

    return updateResult.rows[0];
  }

  // Deny path
  const denyResult = await query(
    `UPDATE vendor_review_queue
     SET status = 'denied',
         decision_notes = $2,
         resolved_at = NOW(),
         resolved_by = $3
     WHERE id = $1
     RETURNING *`,
    [id, payload.notes || null, payload.resolved_by || 'system']
  );

  return denyResult.rows[0];
}
