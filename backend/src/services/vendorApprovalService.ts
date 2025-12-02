import { query } from '../db';
import { normalizeVendorName, extractEmailDomain } from '../utils/fileHelpers';
import logger from '../utils/logger';
import { VendorApprovalPendingError, VendorApprovalDeniedError } from '../errors/vendorApprovalErrors';
import { trackVendorProvenance } from './provenanceTracker';
import { config } from '../config';
import { findVendorMatch } from './vendorIntelligence';
import { promotePendingDealsForReview } from './pendingDealService';

export type VendorApprovalStatus = 'approved' | 'pending' | 'denied';

export interface VendorDetectionContext {
  source_file_id?: string;
  detection_source?: string;
  sample_text?: string;
  metadata?: Record<string, any>;
  confidence_score?: number;
  confidence_factors?: string[];
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
    confidence_score: context?.confidence_score || null,
    confidence_factors: context?.confidence_factors || [],
  };

  return payload;
}

function computeDetectionConfidence(
  vendorName: string,
  normalizedName: string,
  context?: VendorDetectionContext,
  matchConfidence?: number
): { score: number; factors: string[] } {
  let score = typeof matchConfidence === 'number' ? matchConfidence : 0.45;
  const factors: string[] = [];

  if (typeof matchConfidence === 'number') {
    factors.push(`match:${matchConfidence.toFixed(2)}`);
  }

  if (context?.detection_source === 'email' || context?.detection_source === 'transcript') {
    score += 0.1;
    factors.push(`source:${context.detection_source}`);
  }

  const domain = context?.metadata?.email_domain || context?.metadata?.domain;
  if (domain) {
    score += 0.1;
    factors.push('email_domain');
  }

  if (context?.sample_text && context.sample_text.toLowerCase().includes(normalizedName)) {
    score += 0.05;
    factors.push('mentioned_in_context');
  }

  if (context?.metadata?.known_vendor === true) {
    score += 0.1;
    factors.push('known_vendor_hint');
  }

  // Clamp between 0 and 1
  score = Math.max(0, Math.min(1, score));

  return { score, factors };
}

function extractCandidateDomains(context?: VendorDetectionContext): string[] {
  const domains = new Set<string>();
  const vendorMeta = (context?.metadata as any)?.vendor || {};

  const domainHints = [vendorMeta.email_domain, vendorMeta.emailDomain, vendorMeta.domain];

  domainHints.forEach((domain: string | undefined) => {
    if (typeof domain === 'string' && domain.trim()) {
      domains.add(domain.trim().toLowerCase());
    }
  });

  if (typeof vendorMeta.email === 'string') {
    const parsed = extractEmailDomain(vendorMeta.email);
    if (parsed) {
      domains.add(parsed);
    }
  }

  if (typeof vendorMeta.website === 'string') {
    try {
      const url = vendorMeta.website.startsWith('http') ? vendorMeta.website : `https://${vendorMeta.website}`;
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      if (hostname) {
        domains.add(hostname.toLowerCase());
      }
    } catch (err) {
      logger.debug('Skipping invalid vendor website for domain extraction', {
        website: vendorMeta.website,
        error: (err as Error).message,
      });
    }
  }

  return Array.from(domains);
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

async function findVendorByAlias(
  normalizedAlias: string
): Promise<(VendorReviewItem & { vendor_id: string; alias_id: string; alias_type?: string; confidence?: number; approval_status?: VendorApprovalStatus | null }) | null> {
  const result = await query(
    `SELECT v.id as vendor_id, v.approval_status, va.id as alias_id, va.alias as alias_name, va.alias_type, va.confidence
     FROM vendor_aliases va
     JOIN vendors v ON v.id = va.vendor_id
     WHERE va.normalized_alias = $1
     ORDER BY va.confidence DESC, va.last_used_at DESC NULLS LAST
     LIMIT 1`,
    [normalizedAlias]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

async function findVendorByDomain(
  domain: string
): Promise<{ id: string; approval_status: VendorApprovalStatus | null } | null> {
  const result = await query(
    `SELECT id, approval_status
     FROM vendors
     WHERE $1 = ANY(email_domains)
     ORDER BY match_count DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [domain.toLowerCase()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

async function recordAliasUsage(
  vendorId: string,
  alias: string,
  normalizedAlias: string,
  aliasType: string,
  confidence = 0.9
) {
  await query(
    `INSERT INTO vendor_aliases (
      vendor_id, alias, normalized_alias, alias_type, confidence, source, usage_count, last_used_at
    )
    VALUES ($1, $2, $3, $4, $5, 'auto_ingest', 1, NOW())
    ON CONFLICT (vendor_id, normalized_alias)
    DO UPDATE
      SET usage_count = vendor_aliases.usage_count + 1,
          last_used_at = NOW(),
          confidence = GREATEST(vendor_aliases.confidence, EXCLUDED.confidence)`,
    [vendorId, alias, normalizedAlias, aliasType, confidence]
  );
}

async function resolveExistingVendor(
  vendor: { id: string; approval_status?: VendorApprovalStatus | null },
  vendorName: string,
  normalizedName: string,
  allowAuto: boolean,
  context?: VendorDetectionContext,
  aliasMeta?: { alias: string; normalizedAlias: string; aliasType: string; confidence?: number }
): Promise<string> {
  const status = vendor.approval_status;

  if (!status || status === 'approved') {
    if (aliasMeta) {
      await recordAliasUsage(
        vendor.id,
        aliasMeta.alias,
        aliasMeta.normalizedAlias,
        aliasMeta.aliasType,
        aliasMeta.confidence ?? 0.9
      );
    }
    return vendor.id;
  }

  if (status === 'denied') {
    throw new VendorApprovalDeniedError(vendorName);
  }

  if (allowAuto) {
    await query(
      `UPDATE vendors
       SET approval_status = 'approved',
           approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
           approval_notes = COALESCE(approval_notes, 'Auto-approved by system')
       WHERE id = $1`,
      [vendor.id]
    );
    logger.info('Auto-approved existing vendor', {
      vendor: vendorName,
      vendorId: vendor.id,
      reason: aliasMeta ? 'matched_alias_or_domain' : 'normalized_match',
    });

    if (aliasMeta) {
      await recordAliasUsage(
        vendor.id,
        aliasMeta.alias,
        aliasMeta.normalizedAlias,
        aliasMeta.aliasType,
        aliasMeta.confidence ?? 0.9
      );
    }

    return vendor.id;
  }

  const alias = await upsertVendorReviewCandidate(vendorName, normalizedName, context);
  throw new VendorApprovalPendingError(vendorName, alias.id);
}

export async function ensureVendorApproved(
  vendorName: string,
  context?: VendorDetectionContext
): Promise<string> {
  if (!vendorName || !vendorName.trim()) {
    throw new Error('Vendor name is required');
  }

  const normalizedName = normalizeVendorName(vendorName);
  const match = await findVendorMatch(vendorName).catch(() => null);
  const detection = computeDetectionConfidence(vendorName, normalizedName, context, match?.confidence);
  const contextWithConfidence: VendorDetectionContext = {
    ...context,
    confidence_score: detection.score,
    confidence_factors: detection.factors,
    metadata: {
      ...(context?.metadata || {}),
      confidence_score: detection.score,
      confidence_factors: detection.factors,
    },
  };
  const allowAuto = config.vendor.autoApprove || detection.score >= 0.85;
  const needsReview = detection.score >= 0.6;
  const candidateDomains = extractCandidateDomains(context);

  // Check existing vendors
  const existingResult = await query(
    `SELECT id, approval_status
     FROM vendors
     WHERE normalized_name = $1
     LIMIT 1`,
    [normalizedName]
  );

  if (existingResult.rows.length > 0) {
    return resolveExistingVendor(
      existingResult.rows[0],
      vendorName,
      normalizedName,
      allowAuto,
      contextWithConfidence
    );
  }

  // Try alias match
  const aliasMatch = await findVendorByAlias(normalizedName);
  if (aliasMatch) {
    return resolveExistingVendor(
      { id: aliasMatch.vendor_id, approval_status: aliasMatch.approval_status },
      vendorName,
      normalizedName,
      allowAuto,
      contextWithConfidence,
      {
        alias: aliasMatch.alias_name || vendorName,
        normalizedAlias: normalizeVendorName(aliasMatch.alias_name || vendorName),
        aliasType: aliasMatch.alias_type || 'alias',
        confidence: aliasMatch.confidence || 0.9,
      }
    );
  }

  // Try domain match from context metadata
  for (const domain of candidateDomains) {
    const domainMatch = await findVendorByDomain(domain);
    if (domainMatch) {
      return resolveExistingVendor(domainMatch, vendorName, normalizedName, allowAuto, contextWithConfidence, {
        alias: domain,
        normalizedAlias: normalizeVendorName(domain),
        aliasType: 'domain',
        confidence: 0.8,
      });
    }
  }

  // Attempt match by intelligence map (fuzzy/alias)
  if (match?.vendor_id) {
    const matchedVendorResult = await query(
      `SELECT id, approval_status FROM vendors WHERE id = $1 LIMIT 1`,
      [match.vendor_id]
    );

    if (matchedVendorResult.rows.length > 0) {
      const vendor = matchedVendorResult.rows[0];
      return resolveExistingVendor(
        vendor,
        vendorName,
        normalizedName,
        allowAuto,
        contextWithConfidence,
        {
          alias: vendorName,
          normalizedAlias: normalizedName,
          aliasType: 'alias',
          confidence: match.confidence,
        }
      );
    }
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

    await upsertVendorReviewCandidate(vendorName, normalizedName, contextWithConfidence);
    throw new VendorApprovalPendingError(vendorName, review.id);
  }

  if (allowAuto) {
    const insertResult = await query(
      `INSERT INTO vendors (name, normalized_name, status, approval_status, approved_at, origin)
       VALUES ($1, $2, 'active', 'approved', CURRENT_TIMESTAMP, 'auto-ingest')
       RETURNING id`,
      [vendorName, normalizedName]
    );

    const vendorId = insertResult.rows[0].id;

    // Register any domain aliases for future matches
    for (const domain of candidateDomains) {
      await recordAliasUsage(
        vendorId,
        domain,
        normalizeVendorName(domain),
        'domain',
        0.75
      );
    }

    logger.info('Auto-approved new vendor', {
      vendor: vendorName,
      vendorId,
      domains: candidateDomains,
      score: detection.score,
    });
    return vendorId;
  }

  if (needsReview) {
    const alias = await upsertVendorReviewCandidate(vendorName, normalizedName, contextWithConfidence);
    logger.info('Vendor requires approval before use', {
      vendor: vendorName,
      reviewId: alias.id,
      confidence: detection.score,
    });
    throw new VendorApprovalPendingError(vendorName, alias.id);
  }

  const alias = await upsertVendorReviewCandidate(vendorName, normalizedName, {
    ...contextWithConfidence,
    metadata: {
      ...(contextWithConfidence.metadata || {}),
      quarantined: true,
    },
  });
  logger.warn('Vendor quarantined for low confidence, pending review', {
    vendor: vendorName,
    reviewId: alias.id,
    confidence: detection.score,
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
     ORDER BY
       COALESCE((metadata->>'potential_value')::numeric, 0) DESC,
       detection_count DESC,
       CASE
         WHEN latest_context->>'detection_source' IN ('email','transcript') THEN 2
         WHEN latest_context->>'detection_source' = 'csv' THEN 1
         ELSE 0
       END DESC,
       last_detected_at DESC
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

  // When denying a vendor suggestion, deals remain in pending state
  // No automatic promotion needed on denial

  return denyResult.rows[0];
}
