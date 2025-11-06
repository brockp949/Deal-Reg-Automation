import { simpleParser, ParsedMail } from 'mailparser';
import { readFileSync } from 'fs';
import { ParsedEmail } from '../types';
import logger from '../utils/logger';

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
 * This is a simplified version - Phase 2 will use AI for better extraction
 */
export function extractInfoFromEmails(emails: ParsedEmail[]): {
  vendors: any[];
  deals: any[];
  contacts: any[];
} {
  const vendors: any[] = [];
  const deals: any[] = [];
  const contacts: any[] = [];

  emails.forEach((email) => {
    // Simple keyword-based extraction
    const text = `${email.subject} ${email.body}`.toLowerCase();

    // Look for deal registration keywords
    const dealKeywords = ['deal registration', 'deal reg', 'opportunity', 'quote', 'proposal'];
    const hasDealKeyword = dealKeywords.some((keyword) => text.includes(keyword));

    if (hasDealKeyword) {
      // Extract potential vendor from email domain
      const fromMatch = email.from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (fromMatch) {
        const domain = fromMatch[1];
        const vendorName = domain.split('.')[0]; // Simplified extraction

        vendors.push({
          name: vendorName,
          email_domain: domain,
          source: 'email',
        });

        // Extract potential contact
        const nameMatch = email.from.match(/^([^<]+)</);
        if (nameMatch) {
          contacts.push({
            name: nameMatch[1].trim(),
            email: email.from.match(/<(.+)>/)?.[1] || email.from,
            vendor_name: vendorName,
          });
        }
      }

      // Try to extract deal value
      const valueMatch = text.match(/\$([0-9,]+)/);
      if (valueMatch) {
        deals.push({
          deal_name: email.subject,
          deal_value: parseFloat(valueMatch[1].replace(/,/g, '')),
          registration_date: email.date,
          source: 'email',
        });
      }
    }
  });

  return { vendors, deals, contacts };
}
