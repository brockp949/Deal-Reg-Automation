/**
 * Email Parser - Phase 2 Implementation
 * Extracts structured metadata from parsed email messages
 */

import { ParsedMail, AddressObject, Attachment } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import {
  EmailAddress,
  AttachmentMetadata,
  ParsedEmailMetadata,
} from './types';

export class EmailParser {
  /**
   * Parse email message and extract all metadata
   */
  parse(message: ParsedMail): ParsedEmailMetadata {
    try {
      const metadata: ParsedEmailMetadata = {
        message_id: this.extractMessageId(message),
        from: this.extractFrom(message),
        to: this.extractAddresses(message.to),
        cc: this.extractAddresses(message.cc),
        bcc: this.extractAddresses(message.bcc),
        subject: this.extractSubject(message),
        date: this.extractDate(message),
        references: this.extractReferences(message),
        in_reply_to: this.extractInReplyTo(message),
        gmail_thread_id: this.extractGmailThreadId(message),
        body_text: message.text || null,
        body_html: message.html ? String(message.html) : null,
        attachments: this.extractAttachmentMetadata(message),
        headers: this.extractHeaders(message),
      };

      return metadata;
    } catch (error: any) {
      logger.error('Error parsing email', {
        error: error.message,
        messageId: message.messageId,
      });
      throw error;
    }
  }

  /**
   * Extract Message-ID (generate if missing)
   */
  private extractMessageId(message: ParsedMail): string {
    if (message.messageId) {
      return message.messageId;
    }

    // Generate synthetic Message-ID
    const syntheticId = `<generated-${uuidv4()}@synthetic>`;
    logger.debug('Generated synthetic Message-ID', { syntheticId });
    return syntheticId;
  }

  /**
   * Extract From address
   */
  private extractFrom(message: ParsedMail): EmailAddress {
    if (!message.from) {
      return { email: 'unknown@unknown.com', name: 'Unknown' };
    }

    const addresses = this.extractAddresses(message.from);
    return addresses[0] || { email: 'unknown@unknown.com', name: 'Unknown' };
  }

  /**
   * Extract email addresses from AddressObject
   */
  extractAddresses(addressObj: AddressObject | AddressObject[] | undefined): EmailAddress[] {
    if (!addressObj) {
      return [];
    }

    const addresses: EmailAddress[] = [];

    // Handle array of AddressObject
    const addressArray = Array.isArray(addressObj) ? addressObj : [addressObj];

    for (const obj of addressArray) {
      if (obj.value) {
        for (const addr of obj.value) {
          addresses.push({
            email: addr.address?.toLowerCase() || '',
            name: addr.name || undefined,
          });
        }
      }
    }

    return addresses.filter((addr) => addr.email.length > 0);
  }

  /**
   * Extract subject (decoded and normalized)
   */
  private extractSubject(message: ParsedMail): string {
    if (!message.subject) {
      return '';
    }

    // mailparser already decodes the subject
    return message.subject.trim();
  }

  /**
   * Extract date (with fallback to current date)
   */
  private extractDate(message: ParsedMail): Date {
    if (message.date) {
      return message.date;
    }

    // Fallback to current date
    logger.warn('Email missing date header, using current date');
    return new Date();
  }

  /**
   * Extract References header (array of message IDs)
   */
  private extractReferences(message: ParsedMail): string[] {
    const references = message.references;

    if (!references) {
      return [];
    }

    if (Array.isArray(references)) {
      return references.filter((ref) => ref && ref.length > 0);
    }

    if (typeof references === 'string') {
      return [references].filter((ref) => ref && ref.length > 0);
    }

    return [];
  }

  /**
   * Extract In-Reply-To header
   */
  private extractInReplyTo(message: ParsedMail): string | null {
    if (message.inReplyTo) {
      return message.inReplyTo;
    }

    return null;
  }

  /**
   * Extract Gmail thread ID (X-GM-THRID header)
   */
  private extractGmailThreadId(message: ParsedMail): string | null {
    const header = message.headers.get('x-gm-thrid');

    if (!header) {
      return null;
    }

    const threadId = typeof header === 'string' ? header : String(header);
    return threadId.trim() || null;
  }

  /**
   * Extract attachment metadata (without loading content)
   */
  extractAttachmentMetadata(message: ParsedMail): AttachmentMetadata[] {
    if (!message.attachments || message.attachments.length === 0) {
      return [];
    }

    return message.attachments.map((attachment: Attachment) => {
      const metadata: AttachmentMetadata = {
        filename: attachment.filename || 'unnamed',
        content_type: attachment.contentType || 'application/octet-stream',
        size_bytes: attachment.size || 0,
        content_id: attachment.contentId || undefined,
        is_inline: attachment.contentDisposition === 'inline',
      };

      return metadata;
    });
  }

  /**
   * Extract all headers as key-value pairs
   */
  extractHeaders(message: ParsedMail): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {};

    for (const [key, value] of message.headers) {
      if (Array.isArray(value)) {
        headers[key] = value.map((v) => String(v));
      } else {
        headers[key] = String(value);
      }
    }

    return headers;
  }

  /**
   * Normalize email address (lowercase email, preserve name)
   */
  static normalizeAddress(address: EmailAddress): EmailAddress {
    return {
      email: address.email.toLowerCase(),
      name: address.name,
    };
  }

  /**
   * Get unique email addresses (deduplicate by email)
   */
  static getUniqueAddresses(addresses: EmailAddress[]): EmailAddress[] {
    const seen = new Set<string>();
    const unique: EmailAddress[] = [];

    for (const addr of addresses) {
      const email = addr.email.toLowerCase();
      if (!seen.has(email)) {
        seen.add(email);
        unique.push(addr);
      }
    }

    return unique;
  }
}
