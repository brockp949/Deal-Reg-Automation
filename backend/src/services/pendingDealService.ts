import { query } from '../db';
import logger from '../utils/logger';
import { trackDealProvenance } from './provenanceTracker';

type PendingDealStatus = 'pending' | 'resolved' | 'failed';

let pendingTableEnsured = false;

async function ensurePendingTable() {
  if (pendingTableEnsured) return;

  await query(`
    CREATE TABLE IF NOT EXISTS pending_deal_registrations (
      id BIGSERIAL PRIMARY KEY,
      vendor_name TEXT NOT NULL,
      review_id UUID NULL,
      source_file_id UUID NULL,
      deal_data JSONB NOT NULL,
      status TEXT DEFAULT 'pending',
      last_error TEXT NULL,
      resolved_deal_id UUID NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_pending_deal_review ON pending_deal_registrations(review_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pending_deal_vendor ON pending_deal_registrations((lower(vendor_name)));`);

  pendingTableEnsured = true;
}

export async function queuePendingDeal(params: {
  vendorName: string;
  reviewId?: string | null;
  sourceFileId?: string | null;
  dealData: any;
  reason?: string;
}) {
  await ensurePendingTable();

  await query(
    `INSERT INTO pending_deal_registrations (vendor_name, review_id, source_file_id, deal_data, status, last_error)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [
      params.vendorName,
      params.reviewId || null,
      params.sourceFileId || null,
      JSON.stringify({
        ...params.dealData,
        pending_vendor_review_id: params.reviewId || null,
        pending_vendor_name: params.vendorName,
        pending_reason: params.reason || 'vendor_pending_approval',
      }),
      params.reason || null,
    ]
  );

  logger.info('Queued pending deal awaiting vendor approval', {
    vendor: params.vendorName,
    reviewId: params.reviewId,
  });
}

async function insertDealForVendor(dealData: any, vendorId: string, sourceFileId?: string | null): Promise<string> {
  const metadata = {
    source_file_id: sourceFileId || null,
    ...dealData,
  };

  const { enhanced_transcript_data, ...cleanDealData } = dealData;
  if (enhanced_transcript_data) {
    metadata.enhanced_transcript_data = enhanced_transcript_data;
  }

  const result = await query(
    `INSERT INTO deal_registrations (
      vendor_id, deal_name, deal_value, currency, customer_name,
      customer_industry, registration_date, expected_close_date,
      status, deal_stage, probability, notes, metadata,
      end_user_address, decision_maker_contact, decision_maker_email,
      decision_maker_phone, pre_sales_efforts, confidence_score,
      buying_signal_score, extraction_method, source_transcript_id,
      prospect_company_name, prospect_website, prospect_address,
      prospect_contact_name, prospect_contact_email, prospect_contact_phone,
      prospect_job_title, company_size, tax_id,
      partner_company_name, partner_contact_name, partner_contact_email,
      partner_contact_phone, partner_role,
      current_vendor, reason_for_change, identified_competitors,
      potential_challenges, requested_support,
      deal_expiration_date, product_service_requirements, new_or_existing_customer
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44)
    RETURNING id`,
    [
      vendorId,
      cleanDealData.deal_name || 'Untitled Deal',
      cleanDealData.deal_value || 0,
      cleanDealData.currency || 'USD',
      cleanDealData.customer_name || null,
      cleanDealData.customer_industry || null,
      cleanDealData.registration_date || new Date(),
      cleanDealData.expected_close_date || null,
      cleanDealData.status || 'registered',
      cleanDealData.deal_stage || null,
      cleanDealData.probability || null,
      cleanDealData.notes || null,
      JSON.stringify(metadata),
      cleanDealData.end_user_address || null,
      cleanDealData.decision_maker_contact || null,
      cleanDealData.decision_maker_email || null,
      cleanDealData.decision_maker_phone || null,
      cleanDealData.pre_sales_efforts || null,
      cleanDealData.confidence_score || null,
      cleanDealData.buying_signal_score || null,
      cleanDealData.extraction_method || null,
      cleanDealData.source_transcript_id || null,
      cleanDealData.prospect_company_name || null,
      cleanDealData.prospect_website || null,
      cleanDealData.prospect_address || null,
      cleanDealData.prospect_contact_name || null,
      cleanDealData.prospect_contact_email || null,
      cleanDealData.prospect_contact_phone || null,
      cleanDealData.prospect_job_title || null,
      cleanDealData.company_size || null,
      cleanDealData.tax_id || null,
      cleanDealData.partner_company_name || null,
      cleanDealData.partner_contact_name || null,
      cleanDealData.partner_contact_email || null,
      cleanDealData.partner_contact_phone || null,
      cleanDealData.partner_role || null,
      cleanDealData.current_vendor || null,
      cleanDealData.reason_for_change || null,
      cleanDealData.identified_competitors || null,
      cleanDealData.potential_challenges || null,
      cleanDealData.requested_support || null,
      cleanDealData.deal_expiration_date || null,
      cleanDealData.product_service_requirements || null,
      cleanDealData.new_or_existing_customer || null,
    ]
  );

  const dealId = result.rows[0].id;

  try {
    const fileResult = sourceFileId
      ? await query('SELECT filename, file_type FROM source_files WHERE id = $1', [sourceFileId])
      : { rows: [] as any[] };
    const sourceFilename = fileResult.rows[0]?.filename || 'unknown';
    const fileType = fileResult.rows[0]?.file_type || 'unknown';

    let sourceType: 'email' | 'transcript' | 'csv' | 'manual' = 'csv';
    let extractionMethod: 'regex' | 'keyword' | 'ai' | 'manual' = 'regex';

    if (fileType === 'mbox') {
      sourceType = 'email';
      extractionMethod = cleanDealData.extraction_method === 'enhanced_mbox' ? 'keyword' : 'regex';
    } else if (fileType === 'txt' || fileType === 'pdf' || fileType === 'transcript') {
      sourceType = 'transcript';
      extractionMethod = 'regex';
    } else if (fileType === 'csv' || fileType === 'vtiger_csv') {
      sourceType = 'csv';
      extractionMethod = 'manual';
    }

    await trackDealProvenance(
      dealId,
      {
        deal_name: cleanDealData.deal_name,
        deal_value: cleanDealData.deal_value,
        currency: cleanDealData.currency,
        customer_name: cleanDealData.customer_name,
        customer_industry: cleanDealData.customer_industry,
        expected_close_date: cleanDealData.expected_close_date,
        status: cleanDealData.status,
        deal_stage: cleanDealData.deal_stage,
        probability: cleanDealData.probability,
        decision_maker_contact: cleanDealData.decision_maker_contact,
        decision_maker_email: cleanDealData.decision_maker_email,
        decision_maker_phone: cleanDealData.decision_maker_phone,
        end_user_address: cleanDealData.end_user_address,
      },
      {
        sourceFileId: sourceFileId || undefined,
        sourceType,
        sourceLocation: `File: ${sourceFilename}`,
        extractionMethod,
        confidence: cleanDealData.confidence_score || 0.5,
      }
    );
  } catch (provenanceError: any) {
    logger.error('Failed to track deal provenance from pending queue', {
      dealId,
      error: provenanceError.message,
    });
  }

  return dealId;
}

export async function promotePendingDealsForReview(reviewId: string, vendorId: string): Promise<{ created: number; failed: number; errors: string[] }> {
  await ensurePendingTable();

  const pending = await query(
    `SELECT * FROM pending_deal_registrations
     WHERE review_id = $1 AND status = 'pending'`,
    [reviewId]
  );

  if (pending.rows.length === 0) {
    return { created: 0, failed: 0, errors: [] };
  }

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of pending.rows) {
    try {
      const dealId = await insertDealForVendor(row.deal_data, vendorId, row.source_file_id);

      await query(
        `UPDATE pending_deal_registrations
         SET status = 'resolved',
             resolved_deal_id = $2,
             resolved_at = NOW()
         WHERE id = $1`,
        [row.id, dealId]
      );

      created++;
      logger.info('Promoted pending deal after vendor approval', {
        pendingId: row.id,
        reviewId,
        vendorId,
        dealId,
      });
    } catch (error: any) {
      failed++;
      errors.push(`Pending deal ${row.id}: ${error.message}`);
      logger.error('Failed to promote pending deal', {
        pendingId: row.id,
        reviewId,
        vendorId,
        error: error.message,
      });

      await query(
        `UPDATE pending_deal_registrations
         SET status = 'failed',
             last_error = $2
         WHERE id = $1`,
        [row.id, error.message]
      );
    }
  }

  return { created, failed, errors };
}

export async function getPendingDealCount(): Promise<number> {
  await ensurePendingTable();
  const result = await query(
    `SELECT COUNT(*) FROM pending_deal_registrations WHERE status = 'pending'`
  );
  return parseInt(result.rows[0].count, 10);
}

export default {
  queuePendingDeal,
  promotePendingDealsForReview,
  getPendingDealCount,
};
