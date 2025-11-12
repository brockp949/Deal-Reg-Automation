import { query } from '../db';
import { parseMboxFile, extractInfoFromEmails } from '../parsers/mboxParser';
import { parseStreamingMboxFile } from '../parsers/streamingMboxParser';
import { parseCSVFile, normalizeVTigerData, parseGenericCSV } from '../parsers/csvParser';
import { parseTextTranscript, extractInfoFromTranscript } from '../parsers/transcriptParser';
import { parseEnhancedTranscript } from '../parsers/enhancedTranscriptParser';
import { parsePDFTranscript } from '../parsers/pdfParser';
import { domainToCompanyName, generateDealName, normalizeCompanyName } from '../utils/fileHelpers';
import logger from '../utils/logger';
import type { FileType } from '../types';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { ensureVendorApproved } from './vendorApprovalService';
import { VendorApprovalPendingError, VendorApprovalDeniedError } from '../errors/vendorApprovalErrors';
import { extractEntitiesWithAI } from './aiExtractor';
import { validateAndEnrichDealData } from './validationService';

interface ProcessingResult {
  vendorsCreated: number;
  dealsCreated: number;
  contactsCreated: number;
  errors: string[];
}

/**
 * Update file processing progress
 */
async function updateFileProgress(fileId: string, progress: number) {
  await query(
    `UPDATE source_files
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{progress}', $1::text::jsonb)
     WHERE id = $2`,
    [progress.toString(), fileId]
  );
}

/**
 * Main file processing function
 * Processes uploaded file and creates vendors, deals, and contacts
 */
export async function processFile(fileId: string): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    vendorsCreated: 0,
    dealsCreated: 0,
    contactsCreated: 0,
    errors: [],
  };

  try {
    // Get file details
    const fileResult = await query('SELECT * FROM source_files WHERE id = $1', [fileId]);

    if (fileResult.rows.length === 0) {
      throw new Error('File not found');
    }

    const file = fileResult.rows[0];

    // Update status to processing with 0% progress
    await query(
      'UPDATE source_files SET processing_status = $1, processing_started_at = CURRENT_TIMESTAMP, metadata = jsonb_set(COALESCE(metadata, \'{}\'), \'{progress}\', \'0\') WHERE id = $2',
      ['processing', fileId]
    );

    logger.info(`Processing file: ${file.filename} (${file.file_type})`);

    // Parse file based on type
    let extractedData: any = null;

    try {
      // Progress: 10% - Starting to parse
      await updateFileProgress(fileId, 10);

      switch (file.file_type) {
        case 'mbox':
          extractedData = await processMboxFile(file.storage_path, fileId);
          break;
        case 'csv':
        case 'vtiger_csv':
          extractedData = await processCSVFile(file.storage_path);
          break;
        case 'txt':
        case 'transcript':
          extractedData = await processTranscriptFile(file.storage_path);
          break;
        case 'pdf':
          extractedData = await processPDFTranscriptFile(file.storage_path);
          break;
        default:
          throw new Error(`Unsupported file type: ${file.file_type}`);
      }

      // Progress: 40% - Parsing complete
      await updateFileProgress(fileId, 40);
    } catch (parseError: any) {
      result.errors.push(`Parse error: ${parseError.message}`);
      throw parseError;
    }

    if (!extractedData) {
      throw new Error('No data extracted from file');
    }

    // Create vendors, deals, and contacts
    const { vendors, deals, contacts } = extractedData;
    const totalItems = vendors.length + deals.length + contacts.length;
    let processedItems = 0;

    // Progress: 50% - Starting to create records
    await updateFileProgress(fileId, 50);

    // Process vendors
    const vendorMap = new Map<string, string>(); // Map vendor name to ID

    for (const vendorData of vendors) {
      try {
        const vendorId = await findOrCreateVendor(vendorData, fileId);
        vendorMap.set(vendorData.name, vendorId);
        result.vendorsCreated++;
        processedItems++;

        // Update progress: 50% to 70%
        const progress = 50 + Math.round((processedItems / totalItems) * 20);
        await updateFileProgress(fileId, progress);
      } catch (error: any) {
        if (error instanceof VendorApprovalPendingError) {
          const message = `Vendor "${vendorData.name}" pending approval (review ${error.aliasId})`;
          result.errors.push(message);
          logger.warn(message, { vendor: vendorData.name, reviewId: error.aliasId });
        } else if (error instanceof VendorApprovalDeniedError) {
          const message = `Vendor "${vendorData.name}" denied by user policy; skipping`;
          result.errors.push(message);
          logger.warn(message, { vendor: vendorData.name });
        } else {
          result.errors.push(`Vendor error (${vendorData.name}): ${error.message}`);
          logger.error('Error creating vendor', { vendor: vendorData.name, error });
        }
      }
    }

    // Progress: 70% - Vendors created
    await updateFileProgress(fileId, 70);

    // Process deals
    for (const dealData of deals) {
      try {
        let vendorId = vendorMap.get(dealData.vendor_name);

        if (!vendorId && dealData.vendor_name) {
          try {
            vendorId = await findOrCreateVendor({ name: dealData.vendor_name }, fileId);
            vendorMap.set(dealData.vendor_name, vendorId);
          } catch (error: any) {
            if (error instanceof VendorApprovalPendingError) {
              result.errors.push(`Deal "${dealData.deal_name}" skipped: vendor "${dealData.vendor_name}" pending approval (review ${error.aliasId})`);
              logger.warn('Skipping deal because vendor pending approval', {
                deal: dealData.deal_name,
                vendor: dealData.vendor_name,
                reviewId: error.aliasId,
              });
              continue;
            }
            if (error instanceof VendorApprovalDeniedError) {
              result.errors.push(`Deal "${dealData.deal_name}" skipped: vendor "${dealData.vendor_name}" denied`);
              logger.warn('Skipping deal because vendor denied', {
                deal: dealData.deal_name,
                vendor: dealData.vendor_name,
              });
              continue;
            }
            throw error;
          }
        }

        if (vendorId) {
          await createDeal(dealData, vendorId, fileId);
          result.dealsCreated++;
        } else {
          result.errors.push(`No vendor found for deal: ${dealData.deal_name}`);
        }
        processedItems++;

        const progress = 70 + Math.round((processedItems / totalItems) * 15);
        await updateFileProgress(fileId, progress);
      } catch (error: any) {
        result.errors.push(`Deal error (${dealData.deal_name}): ${error.message}`);
        logger.error('Error creating deal', { deal: dealData.deal_name, error });
      }
    }

    // Progress: 85% - Deals created
    await updateFileProgress(fileId, 85);

    // Process contacts
    for (const contactData of contacts) {
      try {
        let vendorId = vendorMap.get(contactData.vendor_name);

        if (!vendorId && contactData.vendor_name) {
          try {
            vendorId = await findOrCreateVendor({ name: contactData.vendor_name }, fileId);
            vendorMap.set(contactData.vendor_name, vendorId);
          } catch (error: any) {
            if (error instanceof VendorApprovalPendingError) {
              result.errors.push(`Contact "${contactData.name}" skipped: vendor "${contactData.vendor_name}" pending approval`);
              logger.warn('Skipping contact because vendor pending approval', {
                contact: contactData.name,
                vendor: contactData.vendor_name,
              });
              continue;
            }
            if (error instanceof VendorApprovalDeniedError) {
              result.errors.push(`Contact "${contactData.name}" skipped: vendor "${contactData.vendor_name}" denied`);
              logger.warn('Skipping contact because vendor denied', {
                contact: contactData.name,
                vendor: contactData.vendor_name,
              });
              continue;
            }
            throw error;
          }
        }

        if (vendorId) {
          await createContact(contactData, vendorId);
          result.contactsCreated++;
        }
        processedItems++;

        const progress = 85 + Math.round((processedItems / totalItems) * 10);
        await updateFileProgress(fileId, progress);
      } catch (error: any) {
        result.errors.push(`Contact error (${contactData.name}): ${error.message}`);
        logger.error('Error creating contact', { contact: contactData.name, error });
      }
    }

    // Progress: 95% - All records created
    await updateFileProgress(fileId, 95);

    // Update file status to completed with 100% progress
    await query(
      `UPDATE source_files
       SET processing_status = $1,
           processing_completed_at = CURRENT_TIMESTAMP,
           metadata = jsonb_set($2::jsonb, '{progress}', '100')
       WHERE id = $3`,
      ['completed', JSON.stringify(result), fileId]
    );

    logger.info('File processing completed', { fileId, result });

    return result;
  } catch (error: any) {
    logger.error('File processing failed', { fileId, error: error.message });

    // Update file status to failed
    await query(
      'UPDATE source_files SET processing_status = $1, error_message = $2 WHERE id = $3',
      ['failed', error.message, fileId]
    );

    throw error;
  }
}

/**
 * Process mbox file using streaming parser for large files
 */
async function processMboxFile(filePath: string, fileId: string) {
  logger.info('Processing MBOX file with streaming parser', { filePath });

  // Load all existing vendors from database to use as knowledge base
  const existingVendorsResult = await query(
    'SELECT id, name, email_domains FROM vendors ORDER BY name'
  );
  const existingVendors = existingVendorsResult.rows;

  logger.info('Loaded existing vendors for matching', { count: existingVendors.length });

  // Use streaming parser to handle large MBOX files without loading into memory
  const result = await parseStreamingMboxFile(filePath, {
    confidenceThreshold: 0.15,
    onProgress: async (processed, total) => {
      if (processed % 100 === 0) {
        logger.info(`Processed ${processed} emails from MBOX file`);

        // Update progress: 10% to 40% during parsing
        if (total) {
          const parseProgress = 10 + Math.round((processed / total) * 30);
          await updateFileProgress(fileId, parseProgress);
        }
      }
    },
  });

  logger.info('MBOX streaming parse complete', {
    totalMessages: result.totalMessages,
    relevantMessages: result.relevantMessages,
    threads: result.threads.length,
    deals: result.extractedDeals.length,
  });

  // Map extracted deals to file processor format
  const vendors: any[] = [];
  const deals: any[] = [];
  const contacts: any[] = [];
  const vendorSet = new Set<string>();
  const vendorsToCreate = new Set<string>(); // Only vendors with deals

  // Helper function to find matching vendor
  function findMatchingVendor(companyName: string): string | null {
    if (!companyName || companyName === 'Unknown Vendor') return null;

    const normalizedSearch = companyName.toLowerCase().trim();

    // Exact match
    for (const vendor of existingVendors) {
      if (vendor.name.toLowerCase().trim() === normalizedSearch) {
        return vendor.name;
      }
    }

    // Partial match (company name contains vendor name or vice versa)
    for (const vendor of existingVendors) {
      const normalizedVendor = vendor.name.toLowerCase().trim();
      if (normalizedSearch.includes(normalizedVendor) || normalizedVendor.includes(normalizedSearch)) {
        logger.info('Fuzzy matched vendor', { searched: companyName, matched: vendor.name });
        return vendor.name;
      }
    }

    return null;
  }

  for (const extractedDeal of result.extractedDeals) {
    // Phase 1: AI-powered extraction and validation
    if (extractedDeal.pre_sales_efforts) {
      try {
        const aiResult = await extractEntitiesWithAI(extractedDeal.pre_sales_efforts);
        if (aiResult) {
          logger.info('AI extraction from MBOX successful', { 
            dealName: aiResult.dealName, 
            customerName: aiResult.customerName,
            confidence: aiResult.confidenceScore 
          });
          
          const validatedDeal = await validateAndEnrichDealData(aiResult);
          logger.info('AI MBOX deal data validated', { dealName: validatedDeal.dealName, customerName: validatedDeal.customerName });
          // TODO: In the next step, merge validatedDeal with the extractedDeal object
        }
      } catch (error: any) {
        logger.error('AI extraction from MBOX failed', { error: error.message });
        // Continue with non-AI-enhanced data
      }
    }

    // Extract vendor from email sender domain
    let extractedVendorName: string | null = null;
    let emailDomain: string | null = null;

    if (extractedDeal.source_email_domain) {
      emailDomain = extractedDeal.source_email_domain;
      extractedVendorName = domainToCompanyName(emailDomain);
      logger.info('Extracted vendor from email domain', {
        domain: emailDomain,
        vendor: extractedVendorName,
        from: extractedDeal.source_email_from
      });
    }

    // Fallback to end_user_name if no email domain available
    if (!extractedVendorName && extractedDeal.end_user_name) {
      extractedVendorName = extractedDeal.end_user_name;
      logger.info('Using end_user_name as vendor fallback', {
        vendor: extractedVendorName
      });
    }

    // Skip if no vendor name found
    if (!extractedVendorName || extractedVendorName === 'Unknown Vendor' || extractedVendorName === 'Unknown') {
      logger.warn('Skipping deal without vendor name', {
        project: extractedDeal.project_name,
        email_from: extractedDeal.source_email_from
      });
      continue;
    }

    // Try to match to existing vendor first
    const matchedVendor = findMatchingVendor(extractedVendorName);
    const vendorName = matchedVendor || extractedVendorName;

    // Only create new vendor if there's NO match AND we haven't added it yet
    if (!matchedVendor && !vendorSet.has(vendorName)) {
      vendors.push({
        name: vendorName,
        email_domain: emailDomain,
      });
      vendorSet.add(vendorName);
      vendorsToCreate.add(vendorName);
      logger.info('New vendor will be created (has deal)', {
        vendor: vendorName,
        domain: emailDomain
      });
    } else if (matchedVendor) {
      logger.info('Deal matched to existing vendor', {
        extracted: extractedVendorName,
        matched: matchedVendor
      });
    }

    // Normalize customer name
    const normalizedCustomerName = extractedDeal.end_user_name
      ? normalizeCompanyName(extractedDeal.end_user_name)
      : undefined;

    // Generate descriptive deal name
    const dealName = generateDealName({
      customer_name: normalizedCustomerName,
      vendor_name: vendorName,
      project_name: extractedDeal.project_name,
      deal_name: extractedDeal.deal_name,
      deal_value: extractedDeal.deal_value,
      registration_date: extractedDeal.registration_date,
      notes: extractedDeal.pre_sales_efforts,
      product_name: extractedDeal.product_name,
      product_service_requirements: extractedDeal.product_service_requirements,
    });

    // Create deal record
    deals.push({
      deal_name: dealName,
      deal_value: extractedDeal.deal_value || 0,
      currency: extractedDeal.currency || 'USD',
      vendor_name: vendorName,
      customer_name: normalizedCustomerName,
      notes: extractedDeal.pre_sales_efforts || null,
      confidence_score: extractedDeal.confidence_score || 0.5,
      extraction_method: 'mbox_email_thread',
      expected_close_date: extractedDeal.expected_close_date || null,
      product_name: extractedDeal.product_name || null,
    });

    // Extract contacts
    if (extractedDeal.decision_maker_contact && extractedDeal.decision_maker_email) {
      contacts.push({
        name: extractedDeal.decision_maker_contact,
        email: extractedDeal.decision_maker_email,
        phone: extractedDeal.decision_maker_phone || null,
        vendor_name: vendorName,
      });
    }
  }

  logger.info('Vendor matching complete', {
    totalDeals: result.extractedDeals.length,
    existingVendorsMatched: deals.length - vendorsToCreate.size,
    newVendorsToCreate: vendorsToCreate.size,
    dealsCreated: deals.length,
  });

  return { vendors, deals, contacts };
}

/**
 * Process CSV file
 */
async function processCSVFile(filePath: string) {
  const rows = await parseCSVFile(filePath);

  // Try vTiger format first
  const extracted = normalizeVTigerData(rows);

  if (extracted.vendors.length === 0 && extracted.deals.length === 0) {
    // Fallback to generic CSV parsing
    const genericExtracted = parseGenericCSV(rows);
    return genericExtracted;
  }

  return extracted;
}

/**
 * Process transcript file using enhanced NLP pipeline
 */
async function processTranscriptFile(filePath: string) {
  logger.info('Processing transcript with enhanced NLP pipeline', { filePath });

  // Phase 1: AI-powered extraction and validation
  try {
    const fileContent = await readFile(filePath, 'utf-8');
    const aiResult = await extractEntitiesWithAI(fileContent);
    if (aiResult) {
      logger.info('AI extraction successful', { 
        dealName: aiResult.dealName, 
        customerName: aiResult.customerName,
        confidence: aiResult.confidenceScore 
      });
      
      const validatedDeal = await validateAndEnrichDealData(aiResult);
      logger.info('AI deal data validated', { dealName: validatedDeal.dealName, customerName: validatedDeal.customerName });
      // TODO: In the next step, merge validatedDeal with the 'deal' object below
    }
  } catch (error: any) {
    logger.error('AI extraction and validation step failed', { error: error.message });
    // We continue with the old logic as a fallback
  }

  // Load all existing vendors from database to use as knowledge base
  const existingVendorsResult = await query(
    'SELECT id, name, email_domains FROM vendors ORDER BY name'
  );
  const existingVendors = existingVendorsResult.rows;

  logger.info('Loaded existing vendors for matching', { count: existingVendors.length });

  // Helper function to find matching vendor
  function findMatchingVendor(companyName: string): string | null {
    if (!companyName || companyName === 'Unknown' || companyName === 'Unknown Vendor') return null;

    const normalizedSearch = companyName.toLowerCase().trim();

    // Exact match
    for (const vendor of existingVendors) {
      if (vendor.name.toLowerCase().trim() === normalizedSearch) {
        return vendor.name;
      }
    }

    // Partial match (company name contains vendor name or vice versa)
    for (const vendor of existingVendors) {
      const normalizedVendor = vendor.name.toLowerCase().trim();
      if (normalizedSearch.includes(normalizedVendor) || normalizedVendor.includes(normalizedSearch)) {
        logger.info('Fuzzy matched vendor (transcript)', { searched: companyName, matched: vendor.name });
        return vendor.name;
      }
    }

    return null;
  }

  // Use enhanced 5-stage NLP parser
  const { deal, turns, isRegisterable, buyingSignalScore } = await parseEnhancedTranscript(filePath, {
    buyingSignalThreshold: 0.5,
    confidenceThreshold: 0.6,
  });

  logger.info('Enhanced transcript parsing complete', {
    isRegisterable,
    buyingSignalScore: buyingSignalScore.toFixed(2),
    confidenceScore: deal?.confidence_score?.toFixed(2) || 'N/A',
    turnCount: turns.length,
  });

  // If deal is not registerable, return empty data
  if (!deal || !isRegisterable) {
    logger.warn('Transcript does not contain registerable deal', {
      buyingSignalScore: buyingSignalScore.toFixed(2),
      reason: buyingSignalScore < 0.5 ? 'Low buying signal score' : 'Failed confidence threshold',
    });

    return {
      vendors: [],
      deals: [],
      contacts: [],
    };
  }

  // Map enhanced deal data to file processor format
  const vendors = [];
  const deals = [];
  const contacts = [];
  const vendorsToCreate = new Set<string>(); // Track vendors we'll create
  const vendorSet = new Set<string>(); // Track all vendors (existing + new)

  // Variables to store matched vendor names
  let partnerVendorName: string | null = null;
  let prospectVendorName: string | null = null;

  // Extract partner/vendor information
  if (deal.partner_company_name) {
    // Try to match to existing vendor first
    const matchedVendor = findMatchingVendor(deal.partner_company_name);
    partnerVendorName = matchedVendor || deal.partner_company_name;

    // Only create new vendor if there's NO match AND we haven't added it yet
    if (!matchedVendor && !vendorSet.has(partnerVendorName)) {
      vendors.push({
        name: partnerVendorName,
        email_domain: deal.partner_email ? deal.partner_email.split('@')[1] : null,
        website: null,
        industry: null,
      });
      vendorSet.add(partnerVendorName);
      vendorsToCreate.add(partnerVendorName);
      logger.info('New partner vendor will be created (has deal)', { vendor: partnerVendorName });
    } else if (matchedVendor) {
      logger.info('Partner matched to existing vendor', {
        extracted: deal.partner_company_name,
        matched: matchedVendor
      });
    }

    // Add partner contact
    if (deal.partner_contact_name && deal.partner_email) {
      contacts.push({
        name: deal.partner_contact_name,
        email: deal.partner_email,
        phone: deal.partner_phone || null,
        role: deal.partner_role || 'Partner Representative',
        vendor_name: partnerVendorName,
        is_primary: true,
      });
    }
  }

  // Extract prospect/customer vendor (if different from partner)
  if (deal.prospect_company_name && deal.prospect_company_name !== deal.partner_company_name) {
    // Try to match to existing vendor first
    const matchedVendor = findMatchingVendor(deal.prospect_company_name);
    prospectVendorName = matchedVendor || deal.prospect_company_name;

    // Only create new vendor if there's NO match, it's different from partner, and we haven't added it yet
    if (!matchedVendor && prospectVendorName !== partnerVendorName && !vendorSet.has(prospectVendorName)) {
      vendors.push({
        name: prospectVendorName,
        email_domain: deal.prospect_website ? new URL(deal.prospect_website).hostname : null,
        website: deal.prospect_website || null,
        industry: deal.industry || null,
      });
      vendorSet.add(prospectVendorName);
      vendorsToCreate.add(prospectVendorName);
      logger.info('New prospect vendor will be created (has deal)', { vendor: prospectVendorName });
    } else if (matchedVendor) {
      logger.info('Prospect matched to existing vendor', {
        extracted: deal.prospect_company_name,
        matched: matchedVendor
      });
    }

    // Add prospect contact
    if (deal.prospect_contact_name && deal.prospect_contact_email) {
      contacts.push({
        name: deal.prospect_contact_name,
        email: deal.prospect_contact_email,
        phone: deal.prospect_contact_phone || null,
        role: deal.prospect_job_title || 'Decision Maker',
        vendor_name: prospectVendorName,
        is_primary: true,
      });
    }
  }

  // Create deal record
  const customerName = prospectVendorName || deal.end_user_company_name || 'Unknown';
  const vendorNameForDeal = partnerVendorName || prospectVendorName || 'Unknown';
  const projectNameForDeal = deal.deal_description?.substring(0, 100) || deal.product_service_requirements?.substring(0, 50);

  // Normalize customer name
  const normalizedCustomerName = customerName ? normalizeCompanyName(customerName) : undefined;

  // Generate descriptive deal name
  const dealName = generateDealName({
    customer_name: normalizedCustomerName,
    vendor_name: vendorNameForDeal,
    project_name: projectNameForDeal,
    deal_name: deal.deal_name || deal.deal_description,
    deal_value: deal.estimated_deal_value,
    registration_date: new Date(),
    notes: deal.deal_description || deal.product_service_requirements,
    product_name: deal.product_line || deal.product_service_requirements,
    product_service_requirements: deal.product_service_requirements,
  });

  const dealRecord: any = {
    deal_name: dealName,
    deal_value: deal.estimated_deal_value || 0,
    currency: deal.currency || 'USD',
    customer_name: normalizedCustomerName,
    customer_industry: deal.industry || null,
    registration_date: new Date(),
    expected_close_date: deal.expected_close_date || null,
    status: 'registered',
    deal_stage: null,
    probability: Math.round(deal.confidence_score * 100), // Convert 0-1 to 0-100
    notes: deal.deal_description || null,
    vendor_name: vendorNameForDeal,

    // Enhanced fields from migration 002
    end_user_address: deal.end_user_address || deal.prospect_address || null,
    decision_maker_contact: deal.prospect_contact_name || null,
    decision_maker_email: deal.prospect_contact_email || null,
    decision_maker_phone: deal.prospect_contact_phone || null,
    pre_sales_efforts: deal.substantiated_presales_efforts || null,
    confidence_score: deal.confidence_score,

    // Transcript-specific fields from migration 003
    buying_signal_score: buyingSignalScore,
    extraction_method: 'transcript_nlp',
    source_transcript_id: filePath, // Reference to source transcript file

    // Prospect/Customer fields
    prospect_company_name: deal.prospect_company_name || null,
    prospect_website: deal.prospect_website || null,
    prospect_address: deal.prospect_address || null,
    prospect_contact_name: deal.prospect_contact_name || null,
    prospect_contact_email: deal.prospect_contact_email || null,
    prospect_contact_phone: deal.prospect_contact_phone || null,
    prospect_job_title: deal.prospect_job_title || null,
    company_size: deal.company_size || null,
    tax_id: deal.tax_id || null,

    // Partner/Vendor representative fields
    partner_company_name: deal.partner_company_name || null,
    partner_contact_name: deal.partner_contact_name || null,
    partner_contact_email: deal.partner_email || null,
    partner_contact_phone: deal.partner_phone || null,
    partner_role: deal.partner_role || null,

    // Contextual sales intelligence
    current_vendor: deal.current_vendor || null,
    reason_for_change: deal.reason_for_change || null,
    identified_competitors: deal.identified_competitors || null,
    potential_challenges: deal.potential_challenges || null,
    requested_support: deal.requested_support || null,

    // Deal specifics
    deal_expiration_date: deal.deal_expiration_date || null,
    product_service_requirements: deal.product_service_requirements || null,
    new_or_existing_customer: deal.new_or_existing_customer || null,

    // Store comprehensive enhanced data in metadata
    enhanced_transcript_data: {
      ...deal,
      buying_signal_score: buyingSignalScore,
      extraction_method: 'transcript_nlp',
      turn_count: turns.length,
      speaker_attributions: deal.speaker_attributions || {},
    },
  };

  deals.push(dealRecord);

  logger.info('Transcript vendor matching complete', {
    partnerVendor: partnerVendorName,
    prospectVendor: prospectVendorName,
    existingVendorsMatched: (partnerVendorName ? 1 : 0) + (prospectVendorName ? 1 : 0) - vendorsToCreate.size,
    newVendorsToCreate: vendorsToCreate.size,
  });

  logger.info('Transcript data extracted successfully', {
    vendorCount: vendors.length,
    dealCount: deals.length,
    contactCount: contacts.length,
  });

  return {
    vendors,
    deals,
    contacts,
  };
}

/**
 * Process PDF transcript file
 */
async function processPDFTranscriptFile(filePath: string) {
  logger.info('Processing PDF transcript file', { filePath });

  // Extract text from PDF
  const pdfText = await parsePDFTranscript(filePath);

  // Create a temporary text file for processing
  const tempFilePath = join(filePath + '.txt');

  try {
    // Write extracted text to temporary file
    await writeFile(tempFilePath, pdfText, 'utf-8');
    logger.info('Created temporary text file from PDF', { tempFilePath });

    // Process the temporary file as a transcript
    const result = await processTranscriptFile(tempFilePath);

    return result;
  } finally {
    // Clean up temporary file
    try {
      await unlink(tempFilePath);
      logger.info('Cleaned up temporary text file', { tempFilePath });
    } catch (err: any) {
      logger.warn('Failed to clean up temporary file', { tempFilePath, error: err.message });
    }
  }
}

/**
 * Find or create a vendor
 */
async function findOrCreateVendor(vendorData: any, sourceFileId: string): Promise<string> {
  if (!vendorData?.name) {
    throw new Error('Vendor name is required');
  }

  return ensureVendorApproved(vendorData.name, {
    source_file_id: sourceFileId,
    detection_source: 'file_processor',
    metadata: {
      vendor: vendorData,
    },
  });
}

/**
 * Create a deal
 */
async function createDeal(dealData: any, vendorId: string, sourceFileId: string): Promise<string> {
  // Prepare metadata with enhanced transcript data if available
  const metadata = {
    source_file_id: sourceFileId,
    ...dealData,
  };

  // Remove enhanced_transcript_data from top level if it exists (will be in metadata)
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

  return result.rows[0].id;
}

/**
 * Create a contact
 */
async function createContact(contactData: any, vendorId: string): Promise<string> {
  // Check if contact already exists
  const existingResult = await query(
    'SELECT id FROM contacts WHERE vendor_id = $1 AND email = $2',
    [vendorId, contactData.email]
  );

  if (existingResult.rows.length > 0) {
    return existingResult.rows[0].id;
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

  return result.rows[0].id;
}
