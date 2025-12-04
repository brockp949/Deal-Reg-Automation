/**
 * Vendor Import Service
 * 
 * Handles bulk import of vendors from CSV/JSON data
 */

import { query } from '../db';
import logger from '../utils/logger';
import { normalizeName } from './vendorMatcher';

export interface VendorImportRecord {
    name: string;
    emailDomains?: string[];
    productKeywords?: string[];
    tier?: string;
    status?: string;
    website?: string;
    description?: string;
}

export interface ImportResult {
    total: number;
    created: number;
    updated: number;
    failed: number;
    errors: Array<{ row: number; name: string; error: string }>;
}

/**
 * Import vendors in bulk
 */
export async function importVendors(
    vendors: VendorImportRecord[],
    options: { updateExisting?: boolean; dryRun?: boolean } = {}
): Promise<ImportResult> {
    const result: ImportResult = {
        total: vendors.length,
        created: 0,
        updated: 0,
        failed: 0,
        errors: []
    };

    const { updateExisting = false, dryRun = false } = options;

    logger.info(`Starting bulk vendor import: ${vendors.length} records`, options);

    for (let i = 0; i < vendors.length; i++) {
        const record = vendors[i];

        try {
            if (!record.name) {
                throw new Error('Vendor name is required');
            }

            // Check if vendor exists
            const existing = await findVendorByName(record.name);

            if (existing) {
                if (updateExisting) {
                    if (!dryRun) {
                        await updateVendor(existing.id, record);
                    }
                    result.updated++;
                } else {
                    // Skip existing
                }
            } else {
                if (!dryRun) {
                    await createVendor(record);
                }
                result.created++;
            }
        } catch (error: any) {
            result.failed++;
            result.errors.push({
                row: i + 1,
                name: record.name || 'Unknown',
                error: error.message
            });
        }
    }

    logger.info('Bulk vendor import completed', result);
    return result;
}

/**
 * Find vendor by name (exact or normalized)
 */
async function findVendorByName(name: string): Promise<any> {
    const normalized = normalizeName(name);

    const result = await query(
        `SELECT * FROM vendors 
     WHERE name ILIKE $1 OR normalized_name = $2`,
        [name, normalized]
    );

    return result.rows[0];
}

/**
 * Create new vendor
 */
async function createVendor(record: VendorImportRecord): Promise<void> {
    const normalized = normalizeName(record.name);

    await query(
        `INSERT INTO vendors (
      name, normalized_name, email_domains, product_keywords, 
      tier, status, website, description, created_at, updated_at
    ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
            record.name,
            normalized,
            JSON.stringify(record.emailDomains || []),
            JSON.stringify(record.productKeywords || []),
            record.tier || 'standard',
            record.status || 'active',
            record.website,
            record.description
        ]
    );
}

/**
 * Update existing vendor
 */
async function updateVendor(id: string, record: VendorImportRecord): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [id];
    let paramIndex = 2;

    if (record.emailDomains) {
        updates.push(`email_domains = $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(record.emailDomains));
    }

    if (record.productKeywords) {
        updates.push(`product_keywords = $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(record.productKeywords));
    }

    if (record.tier) {
        updates.push(`tier = $${paramIndex++}`);
        values.push(record.tier);
    }

    if (record.website) {
        updates.push(`website = $${paramIndex++}`);
        values.push(record.website);
    }

    if (updates.length > 0) {
        updates.push(`updated_at = CURRENT_TIMESTAMP`);

        await query(
            `UPDATE vendors SET ${updates.join(', ')} WHERE id = $1`,
            values
        );
    }
}

export default {
    importVendors
};
