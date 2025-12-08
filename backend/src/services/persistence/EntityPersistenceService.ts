/**
 * Entity Persistence Service
 * Handles creation and updating of vendors, deals, and contacts.
 * Extracted from fileProcessor.ts for better separation of concerns.
 */

import { query, transaction, getClient } from '../../db';
import logger from '../../utils/logger';
import { ensureVendorApproved } from '../vendorApprovalService';
import { trackDealProvenance, trackVendorProvenance, trackContactProvenance } from '../provenanceTracker';
import {
  PersistenceError,
  VendorError,
  ValidationError,
  wrapError,
  parsePgError,
} from '../../errors';

// ============================================================================
// Types
// ============================================================================

export interface VendorData {
  name: string;
  email?: string;
  emailDomains?: string[];
  website?: string;
  industry?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface DealData {
  deal_name?: string;
  deal_value?: number;
  currency?: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: Date | string;
  expected_close_date?: Date | string;
  status?: string;
  deal_stage?: string;
  probability?: number;
  notes?: string;
  // Extended fields
  end_user_address?: string;
  decision_maker_contact?: string;
  decision_maker_email?: string;
  decision_maker_phone?: string;
  pre_sales_efforts?: string;
  confidence_score?: number;
  buying_signal_score?: number;
  extraction_method?: string;
  source_transcript_id?: string;
  // Prospect fields
  prospect_company_name?: string;
  prospect_website?: string;
  prospect_address?: string;
  prospect_contact_name?: string;
  prospect_contact_email?: string;
  prospect_contact_phone?: string;
  prospect_job_title?: string;
  company_size?: string;
  tax_id?: string;
  // Partner fields
  partner_company_name?: string;
  partner_contact_name?: string;
  partner_contact_email?: string;
  partner_contact_phone?: string;
  partner_role?: string;
  // Competition fields
  current_vendor?: string;
  reason_for_change?: string;
  identified_competitors?: string;
  potential_challenges?: string;
  requested_support?: string;
  // Other fields
  deal_expiration_date?: Date | string;
  product_service_requirements?: string;
  new_or_existing_customer?: string;
  // Metadata (stored separately)
  enhanced_transcript_data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ContactData {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_primary?: boolean;
  confidence_score?: number;
}

export interface PersistenceContext {
  sourceFileId: string;
  fileType?: string;
  sourceFilename?: string;
}

export interface PersistenceResult<T> {
  id: string;
  created: boolean;
  data: T;
}

// ============================================================================
// Entity Persistence Service
// ============================================================================

export class EntityPersistenceService {
  /**
   * Find or create a vendor, handling approval workflow.
   */
  async findOrCreateVendor(
    vendorData: VendorData,
    context: PersistenceContext
  ): Promise<PersistenceResult<VendorData>> {
    if (!vendorData.name?.trim()) {
      throw ValidationError.missingField('name', 'vendor');
    }

    try {
      const vendorId = await ensureVendorApproved(vendorData.name, {
        source_file_id: context.sourceFileId,
        detection_source: 'file_processor',
        metadata: {
          vendor: vendorData,
        },
      });

      // Check if this was an existing vendor or new
      const existingResult = await query(
        'SELECT created_at FROM vendors WHERE id = $1',
        [vendorId]
      );

      const isNew = existingResult.rows[0]?.created_at > new Date(Date.now() - 5000);

      logger.debug('Vendor resolved', {
        vendorId,
        vendorName: vendorData.name,
        isNew,
      });

      return {
        id: vendorId,
        created: isNew,
        data: vendorData,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'VendorApprovalPendingError') {
        throw VendorError.approvalPending(
          vendorData.name,
          (error as { aliasId?: string }).aliasId || 'unknown'
        );
      }
      if (error instanceof Error && error.name === 'VendorApprovalDeniedError') {
        throw VendorError.approvalDenied(vendorData.name);
      }
      throw wrapError(error, `Failed to resolve vendor: ${vendorData.name}`);
    }
  }

  /**
   * Create a deal with provenance tracking.
   */
  async createDeal(
    dealData: DealData,
    vendorId: string,
    context: PersistenceContext
  ): Promise<PersistenceResult<DealData>> {
    const { enhanced_transcript_data, metadata: existingMetadata, ...cleanDealData } = dealData;

    // Build metadata
    const metadata = {
      source_file_id: context.sourceFileId,
      ...existingMetadata,
      ...cleanDealData,
    };

    if (enhanced_transcript_data) {
      metadata.enhanced_transcript_data = enhanced_transcript_data;
    }

    try {
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

      // Track provenance asynchronously (don't fail if it errors)
      this.trackDealProvenanceAsync(dealId, cleanDealData, context);

      logger.info('Deal created', {
        dealId,
        dealName: cleanDealData.deal_name,
        vendorId,
      });

      return {
        id: dealId,
        created: true,
        data: dealData,
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        throw parsePgError(error as Error & { code?: string });
      }
      throw wrapError(error, 'Failed to create deal');
    }
  }

  /**
   * Create a contact with provenance tracking.
   * Returns existing contact ID if email matches.
   */
  async createContact(
    contactData: ContactData,
    vendorId: string,
    context: PersistenceContext
  ): Promise<PersistenceResult<ContactData>> {
    if (!contactData.name?.trim()) {
      throw ValidationError.missingField('name', 'contact');
    }

    try {
      // Check if contact already exists by email
      if (contactData.email) {
        const existingResult = await query(
          'SELECT id FROM contacts WHERE vendor_id = $1 AND email = $2',
          [vendorId, contactData.email]
        );

        if (existingResult.rows.length > 0) {
          logger.debug('Contact already exists', {
            contactId: existingResult.rows[0].id,
            email: contactData.email,
          });
          return {
            id: existingResult.rows[0].id,
            created: false,
            data: contactData,
          };
        }
      }

      const result = await query(
        `INSERT INTO contacts (vendor_id, name, email, phone, role, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          vendorId,
          contactData.name,
          contactData.email || null,
          contactData.phone || null,
          contactData.role || null,
          contactData.is_primary || false,
        ]
      );

      const contactId = result.rows[0].id;

      // Track provenance asynchronously
      this.trackContactProvenanceAsync(contactId, contactData, context);

      logger.info('Contact created', {
        contactId,
        contactName: contactData.name,
        vendorId,
      });

      return {
        id: contactId,
        created: true,
        data: contactData,
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        throw parsePgError(error as Error & { code?: string });
      }
      throw wrapError(error, 'Failed to create contact');
    }
  }

  /**
   * Create multiple entities in a single transaction.
   */
  async createEntitiesInTransaction(
    vendorData: VendorData,
    deals: DealData[],
    contacts: ContactData[],
    context: PersistenceContext
  ): Promise<{
    vendorId: string;
    dealIds: string[];
    contactIds: string[];
  }> {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Create vendor first
      const vendorResult = await this.findOrCreateVendor(vendorData, context);
      const vendorId = vendorResult.id;

      // Create deals
      const dealIds: string[] = [];
      for (const deal of deals) {
        const dealResult = await this.createDeal(deal, vendorId, context);
        dealIds.push(dealResult.id);
      }

      // Create contacts
      const contactIds: string[] = [];
      for (const contact of contacts) {
        const contactResult = await this.createContact(contact, vendorId, context);
        contactIds.push(contactResult.id);
      }

      await client.query('COMMIT');

      return { vendorId, dealIds, contactIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async trackDealProvenanceAsync(
    dealId: string,
    dealData: DealData,
    context: PersistenceContext
  ): Promise<void> {
    try {
      const sourceType = this.determineSourceType(context.fileType);
      const extractionMethod = this.determineExtractionMethod(context.fileType, dealData.extraction_method);

      await trackDealProvenance(
        dealId,
        {
          deal_name: dealData.deal_name,
          deal_value: dealData.deal_value,
          currency: dealData.currency,
          customer_name: dealData.customer_name,
          customer_industry: dealData.customer_industry,
          expected_close_date: dealData.expected_close_date,
          status: dealData.status,
          deal_stage: dealData.deal_stage,
          probability: dealData.probability,
          decision_maker_contact: dealData.decision_maker_contact,
          decision_maker_email: dealData.decision_maker_email,
          decision_maker_phone: dealData.decision_maker_phone,
          end_user_address: dealData.end_user_address,
        },
        {
          sourceFileId: context.sourceFileId,
          sourceType,
          sourceLocation: `File: ${context.sourceFilename || 'unknown'}`,
          extractionMethod,
          confidence: dealData.confidence_score || 0.5,
        }
      );

      logger.debug('Deal provenance tracked', { dealId, sourceFileId: context.sourceFileId });
    } catch (error) {
      logger.error('Failed to track deal provenance', {
        dealId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async trackContactProvenanceAsync(
    contactId: string,
    contactData: ContactData,
    context: PersistenceContext
  ): Promise<void> {
    try {
      const sourceType = this.determineSourceType(context.fileType);
      const extractionMethod = this.determineExtractionMethod(context.fileType);

      await trackContactProvenance(
        contactId,
        {
          name: contactData.name,
          email: contactData.email,
          phone: contactData.phone,
          role: contactData.role,
        },
        {
          sourceFileId: context.sourceFileId,
          sourceType,
          sourceLocation: `File: ${context.sourceFilename || 'unknown'}`,
          extractionMethod,
          confidence: contactData.confidence_score || 0.7,
        }
      );
    } catch (error) {
      logger.error('Failed to track contact provenance', {
        contactId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private determineSourceType(fileType?: string): 'email' | 'transcript' | 'csv' | 'manual' {
    if (fileType === 'mbox') return 'email';
    if (fileType === 'txt' || fileType === 'pdf' || fileType === 'transcript') return 'transcript';
    if (fileType === 'csv' || fileType === 'vtiger_csv') return 'csv';
    return 'csv';
  }

  private determineExtractionMethod(
    fileType?: string,
    explicitMethod?: string
  ): 'regex' | 'keyword' | 'ai' | 'manual' {
    if (explicitMethod === 'ai') return 'ai';
    if (explicitMethod === 'enhanced_mbox') return 'keyword';
    if (fileType === 'csv' || fileType === 'vtiger_csv') return 'manual';
    return 'regex';
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultService: EntityPersistenceService | null = null;

export function getEntityPersistenceService(): EntityPersistenceService {
  if (!defaultService) {
    defaultService = new EntityPersistenceService();
  }
  return defaultService;
}

export function resetEntityPersistenceService(): void {
  defaultService = null;
}

export default EntityPersistenceService;
