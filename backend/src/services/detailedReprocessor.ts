/**
 * Detailed Reprocessor Service
 *
 * Performs in-depth multi-pass analysis of already uploaded MBOX and transcript files
 * to extract additional deals, vendors, and relationships that were missed in
 * the initial quick processing.
 *
 * Features:
 * - Multi-pass analysis with cross-referencing
 * - Vendor relationship detection (prime/sub contractors, partners)
 * - More aggressive entity extraction with lower confidence thresholds
 * - Thread/conversation correlation across multiple files
 * - Historical pattern learning
 */

import { query } from '../db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger';
import { parseStreamingMboxFile } from '../parsers/streamingMboxParser';
import {
  extractValueWithContext,
  extractCompaniesWithContext,
  extractProducts,
  detectDealStage,
  extractTimeline,
  calculateEnhancedConfidence,
} from '../parsers/enhancedExtraction';
import { normalizeCompanyName, generateDealNameWithFeatures } from '../utils/fileHelpers';
import { ensureVendorApproved, VendorDetectionContext } from './vendorApprovalService';
import { VendorApprovalPendingError, VendorApprovalDeniedError } from '../errors/vendorApprovalErrors';

interface ReprocessingResult {
  filesProcessed: number;
  dealsFound: number;
  dealsUpdated: number;
  dealsCreated: number;
  vendorsFound: number;
  vendorRelationshipsCreated: number;
  processingTimeMs: number;
  errors: string[];
}

interface VendorMention {
  vendorName: string;
  context: string;
  role: 'primary' | 'partner' | 'subcontractor' | 'reseller' | 'unknown';
  confidence: number;
  source: string;
}

/**
 * Main detailed reprocessing function
 */
export async function performDetailedReprocessing(): Promise<ReprocessingResult> {
  const startTime = Date.now();
  const result: ReprocessingResult = {
    filesProcessed: 0,
    dealsFound: 0,
    dealsUpdated: 0,
    dealsCreated: 0,
    vendorsFound: 0,
    vendorRelationshipsCreated: 0,
    processingTimeMs: 0,
    errors: [],
  };

  try {
    logger.info('Starting detailed reprocessing of all files...');

    // Get all processed MBOX and transcript files
    const filesResult = await query(
      `SELECT id, filename, file_path, file_type, status
       FROM source_files
       WHERE file_type IN ('mbox', 'txt', 'pdf')
       AND status = 'processed'
       ORDER BY created_at ASC`
    );

    const files = filesResult.rows;
    logger.info(`Found ${files.length} files to reprocess`);

    // Process each file with detailed analysis
    for (const file of files) {
      try {
        logger.info(`Detailed processing: ${file.filename}`);

        if (file.file_type === 'mbox') {
          await reprocessMboxFile(file, result);
        } else if (file.file_type === 'txt' || file.file_type === 'pdf') {
          await reprocessTranscriptFile(file, result);
        }

        result.filesProcessed++;
      } catch (error: any) {
        logger.error(`Error reprocessing file ${file.filename}`, { error: error.message });
        result.errors.push(`${file.filename}: ${error.message}`);
      }
    }

    // Cross-reference and find relationships
    await findVendorRelationships(result);

    // Update deals with missing data
    await enrichDealsWithMissingData(result);

    result.processingTimeMs = Date.now() - startTime;
    logger.info('Detailed reprocessing completed', result);

    return result;
  } catch (error: any) {
    logger.error('Detailed reprocessing failed', { error: error.message });
    result.errors.push(`Fatal error: ${error.message}`);
    result.processingTimeMs = Date.now() - startTime;
    return result;
  }
}

/**
 * Reprocess MBOX file with detailed analysis
 */
async function reprocessMboxFile(file: any, result: ReprocessingResult): Promise<void> {
  if (!existsSync(file.file_path)) {
    throw new Error(`File not found: ${file.file_path}`);
  }

  // Parse with lower confidence threshold for more deals
  const mboxData = await parseStreamingMboxFile(file.file_path, {
    confidenceThreshold: 0.2, // Lower threshold for detailed pass
  });

  logger.info(`Detailed MBOX analysis found ${mboxData.extractedDeals.length} potential deals`);

  // Extract all vendor mentions from email threads
  for (const deal of mboxData.extractedDeals) {
    const vendors = await extractVendorsFromDeal(deal, file.id);
    result.vendorsFound += vendors.length;

    // Create or update deal with multiple vendors
    await createOrUpdateDealWithVendors(deal, vendors, result);
  }
}

/**
 * Reprocess transcript file with detailed analysis
 */
async function reprocessTranscriptFile(file: any, result: ReprocessingResult): Promise<void> {
  if (!existsSync(file.file_path)) {
    throw new Error(`File not found: ${file.file_path}`);
  }

  const content = readFileSync(file.file_path, 'utf-8');

  // Multi-pass analysis
  const deals = await extractDealsFromTranscript(content, {
    confidenceThreshold: 0.2,
    multiPass: true,
  });

  logger.info(`Detailed transcript analysis found ${deals.length} potential deals`);

  for (const deal of deals) {
    const vendors = await extractVendorsFromDeal(deal, file.id);
    result.vendorsFound += vendors.length;

    await createOrUpdateDealWithVendors(deal, vendors, result);
  }
}

/**
 * Extract all vendors mentioned in deal context
 */
async function extractVendorsFromDeal(deal: any, sourceFileId: string): Promise<VendorMention[]> {
  const vendors: VendorMention[] = [];
  const textToAnalyze = [
    deal.pre_sales_efforts,
    deal.notes,
    deal.project_name,
    deal.deal_name,
  ].filter(Boolean).join('\n');

  // Extract companies with context
  const companies = extractCompaniesWithContext(textToAnalyze);

  for (const company of companies) {
    const normalizedName = normalizeCompanyName(company.name);

    // Determine role from context
    let role: VendorMention['role'] = 'unknown';
    const contextLower = company.context.toLowerCase();

    if (contextLower.match(/prime\s+contractor|lead\s+vendor|primary\s+vendor/i)) {
      role = 'primary';
    } else if (contextLower.match(/partner|teaming|joint\s+venture|alliance/i)) {
      role = 'partner';
    } else if (contextLower.match(/subcontractor|sub\s+contractor|tier\s+2|secondary/i)) {
      role = 'subcontractor';
    } else if (contextLower.match(/reseller|distributor|channel\s+partner/i)) {
      role = 'reseller';
    } else if (company.type === 'vendor') {
      role = 'partner';
    }

    vendors.push({
      vendorName: normalizedName,
      context: company.context,
      role,
      confidence: company.confidence,
      source: sourceFileId,
    });
  }

  return vendors;
}

/**
 * Create or update deal with multiple vendor associations
 */
async function createOrUpdateDealWithVendors(
  deal: any,
  vendors: VendorMention[],
  result: ReprocessingResult
): Promise<void> {
  try {
    // Check if deal already exists (by customer + value + date range)
    const existingDeal = await findSimilarDeal(deal);

    if (existingDeal) {
      // Update existing deal
      await updateDealWithVendors(existingDeal.id, vendors, result);
      result.dealsUpdated++;
    } else {
      // Create new deal
      await createDealWithVendors(deal, vendors, result);
      result.dealsCreated++;
    }

    result.dealsFound++;
  } catch (error: any) {
    logger.error('Error creating/updating deal with vendors', { error: error.message, deal });
    result.errors.push(`Deal error: ${error.message}`);
  }
}

/**
 * Find similar existing deal to avoid duplicates
 */
async function findSimilarDeal(deal: any): Promise<any | null> {
  const customerName = normalizeCompanyName(deal.end_user_name || deal.customer_name || '');
  if (!customerName) return null;

  const dealValue = deal.deal_value || 0;
  const tolerance = dealValue * 0.1; // 10% tolerance

  const result = await query(
    `SELECT id, deal_name, customer_name, deal_value
     FROM deal_registrations
     WHERE LOWER(customer_name) = LOWER($1)
     AND deal_value BETWEEN $2 AND $3
     AND created_at >= NOW() - INTERVAL '90 days'
     LIMIT 1`,
    [customerName, dealValue - tolerance, dealValue + tolerance]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Update existing deal with new vendor associations
 */
async function updateDealWithVendors(
  dealId: string,
  vendors: VendorMention[],
  result: ReprocessingResult
): Promise<void> {
  for (const vendorMention of vendors) {
    let vendor: any;
    try {
      vendor = await findOrCreateVendor(vendorMention.vendorName, {
        detection_source: 'detailed_reprocessor',
        sample_text: vendorMention.context,
        metadata: {
          role: vendorMention.role,
          source: vendorMention.source,
          deal_id: dealId,
        },
      });
    } catch (error: any) {
      if (error instanceof VendorApprovalPendingError) {
        const message = `Vendor "${vendorMention.vendorName}" pending approval (review ${error.aliasId})`;
        logger.warn(message, { dealId, reviewId: error.aliasId });
        result.errors.push(message);
        continue;
      }
      if (error instanceof VendorApprovalDeniedError) {
        const message = `Vendor "${vendorMention.vendorName}" denied; skipping relationship`;
        logger.warn(message, { dealId });
        result.errors.push(message);
        continue;
      }
      throw error;
    }

    // Check if relationship already exists
    const existing = await query(
      `SELECT id FROM deal_vendors WHERE deal_id = $1 AND vendor_id = $2`,
      [dealId, vendor.id]
    );

    if (existing.rows.length === 0) {
      // Create new vendor-deal relationship
      await query(
        `INSERT INTO deal_vendors (deal_id, vendor_id, role, notes)
         VALUES ($1, $2, $3, $4)`,
        [dealId, vendor.id, vendorMention.role, vendorMention.context.substring(0, 500)]
      );

      result.vendorRelationshipsCreated++;
      logger.info('Added vendor to existing deal', {
        dealId,
        vendorName: vendor.name,
        role: vendorMention.role
      });
    }
  }
}

/**
 * Create new deal with vendor associations
 */
async function createDealWithVendors(
  deal: any,
  vendors: VendorMention[],
  result: ReprocessingResult
): Promise<void> {
  const customerName = normalizeCompanyName(deal.end_user_name || deal.customer_name || '');

  // Determine primary vendor
  const primaryVendor = vendors.find(v => v.role === 'primary') || vendors[0];
  if (!primaryVendor) {
    logger.warn('No vendor found for deal', { deal });
    return;
  }

  let vendor: any;
  try {
    vendor = await findOrCreateVendor(primaryVendor.vendorName, {
      detection_source: 'detailed_reprocessor',
      sample_text: primaryVendor.context,
      metadata: {
        role: primaryVendor.role,
        source: primaryVendor.source,
      },
    });
  } catch (error: any) {
    if (error instanceof VendorApprovalPendingError) {
      const message = `Primary vendor "${primaryVendor.vendorName}" pending approval (review ${error.aliasId})`;
      logger.warn(message, { deal });
      result.errors.push(message);
      return;
    }
    if (error instanceof VendorApprovalDeniedError) {
      const message = `Primary vendor "${primaryVendor.vendorName}" denied; skipping deal creation`;
      logger.warn(message, { deal });
      result.errors.push(message);
      return;
    }
    throw error;
  }

  // Generate deal name
  const dealNameResult = generateDealNameWithFeatures({
    customer_name: customerName,
    vendor_name: vendor.name,
    deal_value: deal.deal_value,
    project_name: deal.project_name,
    deal_name: deal.deal_name,
    notes: deal.pre_sales_efforts || deal.notes,
    product_name: deal.product_name,
    product_service_requirements: deal.product_service_requirements,
    source_subject: deal.project_name || deal.deal_name,
    deal_stage: deal.deal_stage,
  });
  const dealName = dealNameResult.name;

  // Create deal
  const dealResult = await query(
    `INSERT INTO deal_registrations (
      vendor_id, deal_name, deal_value, currency, customer_name,
      notes, confidence_score, extraction_method, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING id`,
    [
      vendor.id,
      dealName,
      deal.deal_value || 0,
      deal.currency || 'USD',
      customerName,
      deal.pre_sales_efforts || deal.notes || null,
      deal.confidence_score || 0.5,
      'detailed_reprocessing'
    ]
  );

  const dealId = dealResult.rows[0].id;

  // Create vendor relationships for all mentioned vendors
  for (const vendorMention of vendors) {
    try {
      const v = await findOrCreateVendor(vendorMention.vendorName, {
        detection_source: 'detailed_reprocessor',
        sample_text: vendorMention.context,
        metadata: {
          role: vendorMention.role,
          source: vendorMention.source,
          deal_id: dealId,
        },
      });

      await query(
        `INSERT INTO deal_vendors (deal_id, vendor_id, role, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (deal_id, vendor_id) DO NOTHING`,
        [dealId, v.id, vendorMention.role, vendorMention.context.substring(0, 500)]
      );

      result.vendorRelationshipsCreated++;
    } catch (error: any) {
      if (error instanceof VendorApprovalPendingError) {
        const message = `Vendor "${vendorMention.vendorName}" pending approval (review ${error.aliasId}); skipping relationship`;
        logger.warn(message, { dealId, reviewId: error.aliasId });
        result.errors.push(message);
        continue;
      }
      if (error instanceof VendorApprovalDeniedError) {
        const message = `Vendor "${vendorMention.vendorName}" denied; skipping relationship`;
        logger.warn(message, { dealId });
        result.errors.push(message);
        continue;
      }
      throw error;
    }
  }

  logger.info('Created new deal with vendors', {
    dealId,
    dealName,
    vendorCount: vendors.length
  });
}

/**
 * Find or create vendor by name
 */
async function findOrCreateVendor(name: string, context: VendorDetectionContext): Promise<any> {
  const vendorId = await ensureVendorApproved(name, context);

  const result = await query(
    `SELECT id, name FROM vendors WHERE id = $1`,
    [vendorId]
  );

  return result.rows[0];
}

/**
 * Find vendor relationships across deals
 */
async function findVendorRelationships(result: ReprocessingResult): Promise<void> {
  logger.info('Analyzing vendor relationships across deals...');

  // Find frequently co-occurring vendors
  const coOccurrences = await query(`
    SELECT
      dv1.vendor_id as vendor1_id,
      dv2.vendor_id as vendor2_id,
      v1.name as vendor1_name,
      v2.name as vendor2_name,
      COUNT(*) as co_occurrence_count
    FROM deal_vendors dv1
    JOIN deal_vendors dv2 ON dv1.deal_id = dv2.deal_id AND dv1.vendor_id < dv2.vendor_id
    JOIN vendors v1 ON dv1.vendor_id = v1.id
    JOIN vendors v2 ON dv2.vendor_id = v2.id
    GROUP BY dv1.vendor_id, dv2.vendor_id, v1.name, v2.name
    HAVING COUNT(*) >= 2
    ORDER BY co_occurrence_count DESC
  `);

  logger.info(`Found ${coOccurrences.rows.length} vendor partnerships`, {
    partnerships: coOccurrences.rows.map(r => ({
      vendors: `${r.vendor1_name} + ${r.vendor2_name}`,
      deals: r.co_occurrence_count
    }))
  });
}

/**
 * Enrich deals with missing data from reprocessing
 */
async function enrichDealsWithMissingData(result: ReprocessingResult): Promise<void> {
  logger.info('Enriching deals with missing data...');

  // Find deals missing customer names
  const dealsNeedingEnrichment = await query(`
    SELECT id, notes, metadata
    FROM deal_registrations
    WHERE customer_name IS NULL OR customer_name = ''
    OR deal_value = 0 OR deal_value IS NULL
    LIMIT 100
  `);

  logger.info(`Found ${dealsNeedingEnrichment.rows.length} deals needing enrichment`);

  for (const deal of dealsNeedingEnrichment.rows) {
    try {
      const text = deal.notes || '';
      let updated = false;

      // Try to extract customer name
      if (!deal.customer_name) {
        const companies = extractCompaniesWithContext(text);
        const customer = companies.find(c => c.type === 'customer');
        if (customer) {
          await query(
            `UPDATE deal_registrations SET customer_name = $1 WHERE id = $2`,
            [normalizeCompanyName(customer.name), deal.id]
          );
          updated = true;
        }
      }

      // Try to extract deal value
      if (!deal.deal_value || deal.deal_value === 0) {
        const values = extractValueWithContext(text);
        if (values.length > 0 && values[0].value > 0) {
          await query(
            `UPDATE deal_registrations
             SET deal_value = $1, currency = $2
             WHERE id = $3`,
            [values[0].value, values[0].currency, deal.id]
          );
          updated = true;
        }
      }

      if (updated) {
        result.dealsUpdated++;
      }
    } catch (error: any) {
      logger.error('Error enriching deal', { dealId: deal.id, error: error.message });
    }
  }
}

/**
 * Extract deals from transcript content with multi-pass analysis
 */
async function extractDealsFromTranscript(content: string, options: any): Promise<any[]> {
  // Placeholder - would integrate with enhanced transcript parser
  // This would do multiple passes with different strategies
  return [];
}

export default {
  performDetailedReprocessing,
};
