/**
 * Vendor Intelligence Service
 * Provides intelligent vendor matching, discovery, and domain-based filtering
 */

import { query } from '../db';
import { normalizeVendorName, extractDomain } from '../parsers/vendorImporter';
import logger from '../utils/logger';

export interface VendorMatch {
  vendor_id: string;
  vendor_name: string;
  confidence: number; // 0.0 to 1.0
  match_method: 'exact' | 'normalized' | 'domain' | 'fuzzy' | 'new';
  matched_on?: string; // What field/value matched
}

export interface VendorIntelligence {
  knownVendors: Map<string, string>; // normalized_name -> vendor_id
  vendorDomains: Map<string, string[]>; // domain -> vendor_ids
  vendorNameMap: Map<string, string>; // vendor_id -> vendor_name
}

/**
 * Load all vendors and build intelligence maps
 */
export async function loadVendorIntelligence(): Promise<VendorIntelligence> {
  logger.info('Loading vendor intelligence...');

  const intelligence: VendorIntelligence = {
    knownVendors: new Map(),
    vendorDomains: new Map(),
    vendorNameMap: new Map(),
  };

  try {
    // Load all active vendors
    const result = await query(
      `SELECT id, name, normalized_name, email_domains
       FROM vendors
       WHERE status = 'active' OR status IS NULL`,
      []
    );

    for (const row of result.rows) {
      const vendorId = row.id;
      const normalizedName = row.normalized_name;
      const vendorName = row.name;

      // Map normalized name to vendor ID
      intelligence.knownVendors.set(normalizedName, vendorId);
      intelligence.vendorNameMap.set(vendorId, vendorName);

      // Map email domains to vendor IDs
      if (row.email_domains && Array.isArray(row.email_domains)) {
        for (const domain of row.email_domains) {
          if (!domain) continue;
          const cleanDomain = domain.toLowerCase().trim();

          if (!intelligence.vendorDomains.has(cleanDomain)) {
            intelligence.vendorDomains.set(cleanDomain, []);
          }
          intelligence.vendorDomains.get(cleanDomain)!.push(vendorId);
        }
      }
    }

    logger.info('Vendor intelligence loaded', {
      vendorCount: intelligence.knownVendors.size,
      domainCount: intelligence.vendorDomains.size,
    });

    return intelligence;

  } catch (error: any) {
    logger.error('Failed to load vendor intelligence', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Find or match vendor by name (with fuzzy matching)
 */
export async function findVendorMatch(
  vendorName: string,
  intelligence?: VendorIntelligence
): Promise<VendorMatch | null> {
  if (!vendorName || !vendorName.trim()) {
    return null;
  }

  // Load intelligence if not provided
  if (!intelligence) {
    intelligence = await loadVendorIntelligence();
  }

  const normalized = normalizeVendorName(vendorName);

  // Try exact normalized match first
  if (intelligence.knownVendors.has(normalized)) {
    const vendorId = intelligence.knownVendors.get(normalized)!;
    return {
      vendor_id: vendorId,
      vendor_name: intelligence.vendorNameMap.get(vendorId)!,
      confidence: 1.0,
      match_method: 'normalized',
      matched_on: vendorName,
    };
  }

  // Try partial matching (if input contains a known vendor name)
  for (const [knownNormalized, vendorId] of intelligence.knownVendors.entries()) {
    if (normalized.includes(knownNormalized) || knownNormalized.includes(normalized)) {
      const confidence = calculateStringMatchConfidence(normalized, knownNormalized);
      if (confidence >= 0.75) {
        return {
          vendor_id: vendorId,
          vendor_name: intelligence.vendorNameMap.get(vendorId)!,
          confidence,
          match_method: 'fuzzy',
          matched_on: vendorName,
        };
      }
    }
  }

  return null; // No match found
}

/**
 * Find vendor by email domain
 */
export async function findVendorByDomain(
  email: string,
  intelligence?: VendorIntelligence
): Promise<VendorMatch | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  // Load intelligence if not provided
  if (!intelligence) {
    intelligence = await loadVendorIntelligence();
  }

  const vendorIds = intelligence.vendorDomains.get(domain);
  if (!vendorIds || vendorIds.length === 0) {
    return null;
  }

  // If multiple vendors match, return first one (could enhance with additional logic)
  const vendorId = vendorIds[0];
  return {
    vendor_id: vendorId,
    vendor_name: intelligence.vendorNameMap.get(vendorId)!,
    confidence: 0.9, // High confidence for domain match
    match_method: 'domain',
    matched_on: domain,
  };
}

/**
 * Intelligent vendor identification from text
 * Searches for vendor mentions in email body or transcript
 */
export async function identifyVendorsInText(
  text: string,
  intelligence?: VendorIntelligence
): Promise<VendorMatch[]> {
  if (!text || !text.trim()) {
    return [];
  }

  // Load intelligence if not provided
  if (!intelligence) {
    intelligence = await loadVendorIntelligence();
  }

  const matches: VendorMatch[] = [];
  const textLower = text.toLowerCase();

  // Search for known vendor names in text
  for (const [normalizedName, vendorId] of intelligence.knownVendors.entries()) {
    // Check if vendor name appears in text
    if (textLower.includes(normalizedName)) {
      const vendorName = intelligence.vendorNameMap.get(vendorId)!;

      // Check if already matched
      if (matches.some(m => m.vendor_id === vendorId)) {
        continue;
      }

      matches.push({
        vendor_id: vendorId,
        vendor_name: vendorName,
        confidence: 0.8, // Good confidence for text mention
        match_method: 'fuzzy',
        matched_on: normalizedName,
      });
    }
  }

  // Search for email domains in text
  const emailRegex = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b/g;
  const emailMatches = text.matchAll(emailRegex);

  for (const match of emailMatches) {
    const domain = match[1].toLowerCase();
    const vendorIds = intelligence.vendorDomains.get(domain);

    if (vendorIds && vendorIds.length > 0) {
      for (const vendorId of vendorIds) {
        // Check if already matched
        if (matches.some(m => m.vendor_id === vendorId)) {
          continue;
        }

        matches.push({
          vendor_id: vendorId,
          vendor_name: intelligence.vendorNameMap.get(vendorId)!,
          confidence: 0.9,
          match_method: 'domain',
          matched_on: domain,
        });
      }
    }
  }

  return matches;
}

/**
 * Get all vendor domains for filtering
 */
export async function getAllVendorDomains(): Promise<string[]> {
  const intelligence = await loadVendorIntelligence();
  return Array.from(intelligence.vendorDomains.keys());
}

/**
 * Create or match vendor intelligently
 * - First tries to match existing vendor
 * - If no match, creates new vendor
 * - Extracts domains automatically
 */
export async function createOrMatchVendor(
  vendorName: string,
  additionalData: {
    email?: string;
    website?: string;
    industry?: string;
    contact_name?: string;
    source_file_id?: string;
  } = {}
): Promise<{ vendor_id: string; is_new: boolean; confidence: number }> {
  // Try to match existing vendor
  const match = await findVendorMatch(vendorName);

  if (match && match.confidence >= 0.85) {
    logger.info('Matched existing vendor', {
      input: vendorName,
      matched: match.vendor_name,
      confidence: match.confidence,
      method: match.match_method,
    });

    return {
      vendor_id: match.vendor_id,
      is_new: false,
      confidence: match.confidence,
    };
  }

  // No good match - create new vendor
  logger.info('Creating new vendor', { name: vendorName });

  const normalizedName = normalizeVendorName(vendorName);
  const emailDomains: string[] = [];

  // Extract domains from email and website
  if (additionalData.email) {
    const domain = extractDomain(additionalData.email);
    if (domain) emailDomains.push(domain);
  }
  if (additionalData.website) {
    const domain = extractDomain(additionalData.website);
    if (domain) emailDomains.push(domain);
  }

  const insertResult = await query(
    `INSERT INTO vendors (
      name,
      normalized_name,
      email_domains,
      website,
      industry,
      status,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
    [
      vendorName,
      normalizedName,
      emailDomains.length > 0 ? emailDomains : null,
      additionalData.website || null,
      additionalData.industry || null,
      'active',
      JSON.stringify({
        auto_discovered: true,
        source_file_id: additionalData.source_file_id || null,
        contact_name: additionalData.contact_name || null,
      }),
    ]
  );

  const vendorId = insertResult.rows[0].id;

  logger.info('New vendor created', {
    vendor_id: vendorId,
    name: vendorName,
    domains: emailDomains,
  });

  return {
    vendor_id: vendorId,
    is_new: true,
    confidence: 1.0, // New vendor, exact match to input
  };
}

/**
 * Calculate string matching confidence (simple Levenshtein-like)
 */
function calculateStringMatchConfidence(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  // Check if shorter is substring of longer
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  // Simple overlap calculation
  let matches = 0;
  const minLength = Math.min(str1.length, str2.length);

  for (let i = 0; i < minLength; i++) {
    if (str1[i] === str2[i]) matches++;
  }

  return matches / longer.length;
}

/**
 * Import vendor list and merge with existing vendors
 */
export async function importAndMergeVendors(
  importedVendors: Array<{
    name: string;
    normalized_name: string;
    email_domains?: string[];
    website?: string;
    industry?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    notes?: string;
    status?: string;
    metadata?: Record<string, any>;
  }>
): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const result = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [] as string[],
  };

  const intelligence = await loadVendorIntelligence();

  for (const vendor of importedVendors) {
    try {
      // Try to find existing vendor
      const match = await findVendorMatch(vendor.name, intelligence);

      if (match && match.confidence >= 0.9) {
        // Update existing vendor with additional information
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        // Add website if not present
        if (vendor.website) {
          updateFields.push(`website = COALESCE(website, $${paramIndex})`);
          updateValues.push(vendor.website);
          paramIndex++;
        }

        // Add industry if not present
        if (vendor.industry) {
          updateFields.push(`industry = COALESCE(industry, $${paramIndex})`);
          updateValues.push(vendor.industry);
          paramIndex++;
        }

        // Merge email domains
        if (vendor.email_domains && vendor.email_domains.length > 0) {
          updateFields.push(`email_domains = array_cat(COALESCE(email_domains, '{}'), $${paramIndex}::text[])`);
          updateValues.push(vendor.email_domains);
          paramIndex++;
        }

        // Add contact info
        if (vendor.contact_name) {
          updateFields.push(`partner_contact_name = COALESCE(partner_contact_name, $${paramIndex})`);
          updateValues.push(vendor.contact_name);
          paramIndex++;
        }

        if (vendor.contact_email) {
          updateFields.push(`partner_contact_email = COALESCE(partner_contact_email, $${paramIndex})`);
          updateValues.push(vendor.contact_email);
          paramIndex++;
        }

        if (vendor.contact_phone) {
          updateFields.push(`partner_contact_phone = COALESCE(partner_contact_phone, $${paramIndex})`);
          updateValues.push(vendor.contact_phone);
          paramIndex++;
        }

        if (updateFields.length > 0) {
          updateValues.push(match.vendor_id);
          await query(
            `UPDATE vendors
             SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = $${paramIndex}`,
            updateValues
          );
          result.updated++;
        } else {
          result.skipped++;
        }

      } else {
        // Create new vendor
        await query(
          `INSERT INTO vendors (
            name, normalized_name, email_domains, website, industry,
            partner_contact_name, partner_contact_email, partner_contact_phone,
            notes, status, metadata, origin, approval_status, approved_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            vendor.name,
            vendor.normalized_name,
            vendor.email_domains || null,
            vendor.website || null,
            vendor.industry || null,
            vendor.contact_name || null,
            vendor.contact_email || null,
            vendor.contact_phone || null,
            vendor.notes || null,
            vendor.status || 'active',
            JSON.stringify({
              imported: true,
              ...vendor.metadata,
            }),
            'user_upload',
            'approved',
            new Date(),
          ]
        );
        result.imported++;
      }

    } catch (error: any) {
      result.errors.push(`${vendor.name}: ${error.message}`);
      logger.error('Error importing vendor', {
        vendor: vendor.name,
        error: error.message,
      });
    }
  }

  logger.info('Vendor import complete', result);

  return result;
}

export default {
  loadVendorIntelligence,
  findVendorMatch,
  findVendorByDomain,
  identifyVendorsInText,
  getAllVendorDomains,
  createOrMatchVendor,
  importAndMergeVendors,
};
