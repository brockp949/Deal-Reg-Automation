/**
 * Vendor Alias Learning Service
 * 
 * Automatically learns vendor aliases from user corrections and data patterns.
 */

import { query } from '../db';
import logger from '../utils/logger';

export interface VendorAlias {
    id: string;
    vendorId: string;
    alias: string;
    normalizedAlias: string;
    aliasType: 'user_correction' | 'auto_learned' | 'abbreviation' | 'domain' | 'subsidiary';
    confidence: number;
    usageCount: number;
    createdAt: Date;
    lastUsedAt: Date;
    learnedFrom?: string;
}

/**
 * Record a user correction that creates/reinforces an alias
 */
export async function recordUserCorrection(
    originalVendorName: string,
    correctedVendorId: string,
    userId?: string
): Promise<VendorAlias | null> {
    const normalizedAlias = normalizeAlias(originalVendorName);

    try {
        // Check if this alias already exists
        const existing = await query(
            `SELECT * FROM vendor_aliases WHERE normalized_alias = $1 AND vendor_id = $2`,
            [normalizedAlias, correctedVendorId]
        );

        if (existing.rows.length > 0) {
            // Reinforce existing alias
            await query(
                `UPDATE vendor_aliases 
         SET usage_count = usage_count + 1, 
             last_used_at = CURRENT_TIMESTAMP,
             confidence = LEAST(1.0, confidence + 0.1)
         WHERE id = $1`,
                [existing.rows[0].id]
            );

            logger.info('Vendor alias reinforced', {
                alias: originalVendorName,
                vendorId: correctedVendorId,
                newConfidence: Math.min(1.0, existing.rows[0].confidence + 0.1),
            });

            return existing.rows[0];
        }

        // Create new alias from user correction
        const result = await query(
            `INSERT INTO vendor_aliases (
        vendor_id, alias, normalized_alias, alias_type, confidence, 
        usage_count, learned_from, created_at, last_used_at
      ) VALUES ($1, $2, $3, 'user_correction', 0.9, 1, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
            [correctedVendorId, originalVendorName, normalizedAlias, userId || 'system']
        );

        logger.info('New vendor alias learned from user correction', {
            alias: originalVendorName,
            vendorId: correctedVendorId,
        });

        return result.rows[0];
    } catch (error: any) {
        logger.error('Failed to record user correction', { error: error.message });
        return null;
    }
}

/**
 * Auto-learn an alias from data patterns (e.g., email domains, product names)
 */
export async function autoLearnAlias(
    vendorId: string,
    potentialAlias: string,
    aliasType: 'abbreviation' | 'domain' | 'subsidiary',
    confidence: number = 0.7
): Promise<VendorAlias | null> {
    const normalizedAlias = normalizeAlias(potentialAlias);

    // Don't learn very short aliases
    if (normalizedAlias.length < 2) {
        return null;
    }

    try {
        // Check if alias already exists for any vendor
        const existing = await query(
            `SELECT * FROM vendor_aliases WHERE normalized_alias = $1`,
            [normalizedAlias]
        );

        if (existing.rows.length > 0) {
            // Alias already exists, maybe for a different vendor
            if (existing.rows[0].vendor_id === vendorId) {
                // Same vendor, just update
                await query(
                    `UPDATE vendor_aliases SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [existing.rows[0].id]
                );
            }
            return existing.rows[0];
        }

        // Create new auto-learned alias
        const result = await query(
            `INSERT INTO vendor_aliases (
        vendor_id, alias, normalized_alias, alias_type, confidence, 
        usage_count, learned_from, created_at, last_used_at
      ) VALUES ($1, $2, $3, $4, $5, 1, 'auto_learn', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
            [vendorId, potentialAlias, normalizedAlias, aliasType, confidence]
        );

        logger.debug('Auto-learned vendor alias', {
            alias: potentialAlias,
            vendorId,
            type: aliasType,
            confidence,
        });

        return result.rows[0];
    } catch (error: any) {
        logger.debug('Failed to auto-learn alias', { error: error.message });
        return null;
    }
}

/**
 * Find vendor by alias
 */
export async function findVendorByAlias(alias: string): Promise<{
    vendorId: string;
    vendorName: string;
    confidence: number;
    aliasType: string;
} | null> {
    const normalizedAlias = normalizeAlias(alias);

    try {
        const result = await query(
            `SELECT va.*, v.vendor_name 
       FROM vendor_aliases va
       JOIN vendors v ON v.id = va.vendor_id
       WHERE va.normalized_alias = $1 OR va.alias ILIKE $2
       ORDER BY va.confidence DESC, va.usage_count DESC
       LIMIT 1`,
            [normalizedAlias, `%${alias}%`]
        );

        if (result.rows.length > 0) {
            const row = result.rows[0];

            // Update usage stats
            await query(
                `UPDATE vendor_aliases SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [row.id]
            );

            return {
                vendorId: row.vendor_id,
                vendorName: row.vendor_name,
                confidence: row.confidence,
                aliasType: row.alias_type,
            };
        }

        return null;
    } catch (error: any) {
        logger.debug('Alias lookup failed', { error: error.message });
        return null;
    }
}

/**
 * Get all aliases for a vendor
 */
export async function getVendorAliases(vendorId: string): Promise<VendorAlias[]> {
    try {
        const result = await query(
            `SELECT * FROM vendor_aliases 
       WHERE vendor_id = $1 
       ORDER BY confidence DESC, usage_count DESC`,
            [vendorId]
        );
        return result.rows;
    } catch (error: any) {
        return [];
    }
}

/**
 * Get alias suggestions based on patterns
 */
export async function getAliasSuggestions(vendorId: string): Promise<string[]> {
    try {
        // Get vendor details
        const vendorResult = await query(
            `SELECT * FROM vendors WHERE id = $1`,
            [vendorId]
        );

        if (vendorResult.rows.length === 0) return [];

        const vendor = vendorResult.rows[0];
        const suggestions: string[] = [];

        // Extract abbreviation
        const words = vendor.vendor_name.split(/\s+/);
        if (words.length > 1) {
            const abbreviation = words.map((w: string) => w[0]?.toUpperCase()).join('');
            if (abbreviation.length >= 2) {
                suggestions.push(abbreviation);
            }
        }

        // Extract from email domains
        if (vendor.email_domains) {
            const domains = Array.isArray(vendor.email_domains)
                ? vendor.email_domains
                : JSON.parse(vendor.email_domains || '[]');

            for (const domain of domains) {
                const domainName = domain.split('.')[0];
                if (domainName && domainName.length > 2) {
                    suggestions.push(domainName);
                }
            }
        }

        return [...new Set(suggestions)];
    } catch (error: any) {
        return [];
    }
}

/**
 * Delete a vendor alias
 */
export async function deleteAlias(aliasId: string): Promise<boolean> {
    try {
        await query(`DELETE FROM vendor_aliases WHERE id = $1`, [aliasId]);
        return true;
    } catch (error: any) {
        return false;
    }
}

/**
 * Normalize alias for comparison
 */
function normalizeAlias(alias: string): string {
    return alias
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 100);
}

/**
 * Learn aliases from email domains in batch
 */
export async function learnAliasesFromDomains(): Promise<number> {
    try {
        const vendors = await query(
            `SELECT id, vendor_name, email_domains FROM vendors WHERE email_domains IS NOT NULL`
        );

        let learned = 0;

        for (const vendor of vendors.rows) {
            const domains = Array.isArray(vendor.email_domains)
                ? vendor.email_domains
                : JSON.parse(vendor.email_domains || '[]');

            for (const domain of domains) {
                const domainName = domain.split('.')[0];
                if (domainName && domainName.length > 2) {
                    const result = await autoLearnAlias(vendor.id, domainName, 'domain', 0.6);
                    if (result) learned++;
                }
            }
        }

        logger.info(`Learned ${learned} aliases from email domains`);
        return learned;
    } catch (error: any) {
        logger.error('Failed to learn aliases from domains', { error: error.message });
        return 0;
    }
}

export default {
    recordUserCorrection,
    autoLearnAlias,
    findVendorByAlias,
    getVendorAliases,
    getAliasSuggestions,
    deleteAlias,
    learnAliasesFromDomains,
};
