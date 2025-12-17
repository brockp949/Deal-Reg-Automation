import { simpleParser, ParsedMail } from 'mailparser';
import { readFileSync } from 'fs';
import { ParsedEmail } from '../types';
import logger from '../utils/logger';
import { extractEntitiesWithAI, extractContactWithAI, extractDealValueWithAI } from './aiEnhancedExtraction';
import { config } from '../config';

/**
 * Parse .mbox file into individual emails
 */
export async function parseMboxFile(filePath: string): Promise<ParsedEmail[]> {
  try {
    const mboxContent = readFileSync(filePath, 'utf-8');
    const emails: ParsedEmail[] = [];

    // Split mbox into individual email blocks
    // Mbox format: emails are separated by lines starting with "From "
    const emailBlocks = mboxContent.split(/\n(?=From )/);

    logger.info(`Found ${emailBlocks.length} email blocks in mbox file`);

    for (const block of emailBlocks) {
      if (!block.trim()) continue;

      try {
        // Remove the "From " line if present
        const emailContent = block.replace(/^From .*\n/, '');

        const parsed: ParsedMail = await simpleParser(emailContent);

        const toAddress = Array.isArray(parsed.to) ? parsed.to[0]?.text || '' : parsed.to?.text || '';

        emails.push({
          from: parsed.from?.text || '',
          to: toAddress,
          subject: parsed.subject || '',
          date: parsed.date || new Date(),
          body: parsed.text || '',
          html: parsed.html as string || undefined,
        });
      } catch (emailError: any) {
        logger.warn('Failed to parse individual email', { error: emailError.message });
        // Continue processing other emails
      }
    }

    logger.info(`Successfully parsed ${emails.length} emails from mbox file`);
    return emails;
  } catch (error: any) {
    logger.error('Error parsing mbox file', { error: error.message, filePath });
    throw new Error(`Failed to parse mbox file: ${error.message}`);
  }
}

/**
 * Extract vendor and deal information from parsed emails
 * Enhanced with AI-powered extraction when enabled, with fallback to regex
 */
export async function extractInfoFromEmails(emails: ParsedEmail[]): Promise<{
  vendors: any[];
  deals: any[];
  contacts: any[];
}> {
  const vendors: any[] = [];
  const deals: any[] = [];
  const contacts: any[] = [];

  for (const email of emails) {
    // Combine subject and body for analysis
    const text = `${email.subject} ${email.body}`;
    const textLower = text.toLowerCase();

    // Look for deal registration keywords
    const dealKeywords = ['deal registration', 'deal reg', 'opportunity', 'quote', 'proposal'];
    const hasDealKeyword = dealKeywords.some((keyword) => textLower.includes(keyword));

    if (hasDealKeyword) {
      try {
        // === AI-ENHANCED ENTITY EXTRACTION ===
        // Extract all entities using AI (vendor, deal, contact, value)
        const extractedEntities = await extractEntitiesWithAI<{
          vendor_name?: string;
          deal_name?: string;
          contact_name?: string;
          contact_email?: string;
          contact_phone?: string;
          deal_value?: number;
          currency?: string;
        }>(
          text,
          ['vendor', 'organization', 'deal', 'contact', 'person', 'email', 'phone', 'value', 'currency'],
          {
            documentType: 'email',
            language: 'en',
          },
          () => {
            // Fallback to regex-based extraction
            const fromMatch = email.from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            const domain = fromMatch ? fromMatch[1] : '';
            const vendorName = domain ? domain.split('.')[0] : '';
            const nameMatch = email.from.match(/^([^<]+)</);
            const valueMatch = textLower.match(/\$([0-9,]+)/);

            return {
              vendor_name: vendorName,
              deal_name: email.subject,
              contact_name: nameMatch ? nameMatch[1].trim() : undefined,
              contact_email: email.from.match(/<(.+)>/)?.[1] || email.from,
              deal_value: valueMatch ? parseFloat(valueMatch[1].replace(/,/g, '')) : undefined,
              currency: 'USD',
            };
          }
        );

        // === BUILD VENDOR RECORD ===
        if (extractedEntities.vendor_name) {
          // Extract domain as fallback
          const fromMatch = email.from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          const domain = fromMatch ? fromMatch[1] : '';

          vendors.push({
            name: extractedEntities.vendor_name,
            email_domain: domain,
            source: 'email',
            extraction_method: config.featureFlags.semanticEntityExtraction ? 'ai' : 'regex',
          });
        }

        // === BUILD CONTACT RECORD ===
        if (extractedEntities.contact_name || extractedEntities.contact_email) {
          contacts.push({
            name: extractedEntities.contact_name,
            email: extractedEntities.contact_email || email.from.match(/<(.+)>/)?.[1] || email.from,
            phone: extractedEntities.contact_phone,
            vendor_name: extractedEntities.vendor_name,
            extraction_method: config.featureFlags.semanticEntityExtraction ? 'ai' : 'regex',
          });
        }

        // === BUILD DEAL RECORD ===
        if (extractedEntities.deal_name || extractedEntities.deal_value) {
          deals.push({
            deal_name: extractedEntities.deal_name || email.subject,
            deal_value: extractedEntities.deal_value,
            currency: extractedEntities.currency || 'USD',
            registration_date: email.date,
            source: 'email',
            source_email_subject: email.subject,
            extraction_method: config.featureFlags.semanticEntityExtraction ? 'ai' : 'regex',
          });
        }

        logger.debug('AI-enhanced email extraction completed', {
          emailSubject: email.subject,
          hasVendor: !!extractedEntities.vendor_name,
          hasDeal: !!extractedEntities.deal_name,
          hasContact: !!extractedEntities.contact_name,
          hasDealValue: !!extractedEntities.deal_value,
        });
      } catch (error: any) {
        logger.error('AI extraction failed, using fallback', {
          error: error.message,
          emailSubject: email.subject,
        });

        // === FALLBACK TO LEGACY REGEX EXTRACTION ===
        const fromMatch = email.from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (fromMatch) {
          const domain = fromMatch[1];
          const vendorName = domain.split('.')[0];

          vendors.push({
            name: vendorName,
            email_domain: domain,
            source: 'email',
            extraction_method: 'regex_fallback',
          });

          const nameMatch = email.from.match(/^([^<]+)</);
          if (nameMatch) {
            contacts.push({
              name: nameMatch[1].trim(),
              email: email.from.match(/<(.+)>/)?.[1] || email.from,
              vendor_name: vendorName,
              extraction_method: 'regex_fallback',
            });
          }
        }

        const valueMatch = textLower.match(/\$([0-9,]+)/);
        if (valueMatch) {
          deals.push({
            deal_name: email.subject,
            deal_value: parseFloat(valueMatch[1].replace(/,/g, '')),
            registration_date: email.date,
            source: 'email',
            extraction_method: 'regex_fallback',
          });
        }
      }
    }
  }

  logger.info('Email extraction completed', {
    totalEmails: emails.length,
    vendorsExtracted: vendors.length,
    dealsExtracted: deals.length,
    contactsExtracted: contacts.length,
  });

  return { vendors, deals, contacts };
}
