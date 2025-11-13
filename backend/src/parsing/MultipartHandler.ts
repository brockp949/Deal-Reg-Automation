/**
 * Multipart Handler - Phase 2 Implementation
 * Handles multipart email content and extracts best text representation
 */

import { ParsedMail } from 'mailparser';
import logger from '../utils/logger';
import { TextContent } from './types';
import { HtmlToTextConverter } from './HtmlToTextConverter';

export class MultipartHandler {
  private htmlConverter: HtmlToTextConverter;

  constructor() {
    this.htmlConverter = new HtmlToTextConverter();
  }

  /**
   * Extract best text content from email
   * Prefers plain text, falls back to HTML→text conversion
   */
  extractBestTextContent(message: ParsedMail): TextContent {
    // Preference 1: text/plain
    if (message.text && message.text.trim().length > 0) {
      logger.debug('Using text/plain content');
      return {
        text: message.text,
        source: 'plain',
      };
    }

    // Preference 2: text/html → convert to plain text
    if (message.html) {
      logger.debug('Converting HTML to plain text');
      const htmlString = String(message.html);
      const plainText = this.htmlConverter.convert(htmlString);

      return {
        text: plainText,
        source: 'html',
      };
    }

    // No content found
    logger.warn('No text content found in message', {
      messageId: message.messageId,
    });

    return {
      text: '',
      source: 'plain',
    };
  }

  /**
   * Extract all text parts from multipart message
   */
  extractAllTextParts(message: ParsedMail): string[] {
    const parts: string[] = [];

    // Add text/plain if present
    if (message.text) {
      parts.push(message.text);
    }

    // Add converted HTML if present
    if (message.html) {
      const htmlString = String(message.html);
      const plainText = this.htmlConverter.convert(htmlString);
      if (plainText.trim().length > 0) {
        parts.push(plainText);
      }
    }

    return parts;
  }

  /**
   * Decode content based on encoding
   * (mailparser already handles this, but keeping for API consistency)
   */
  decodeContent(content: string, encoding: string): string {
    // mailparser already decodes content, so we just return it
    return content;
  }

  /**
   * Check if message has HTML content
   */
  hasHtmlContent(message: ParsedMail): boolean {
    return !!(message.html && String(message.html).trim().length > 0);
  }

  /**
   * Check if message has plain text content
   */
  hasPlainTextContent(message: ParsedMail): boolean {
    return !!(message.text && message.text.trim().length > 0);
  }

  /**
   * Get content type summary
   */
  getContentSummary(message: ParsedMail): {
    has_plain: boolean;
    has_html: boolean;
    has_attachments: boolean;
    attachment_count: number;
  } {
    return {
      has_plain: this.hasPlainTextContent(message),
      has_html: this.hasHtmlContent(message),
      has_attachments:
        !!message.attachments && message.attachments.length > 0,
      attachment_count: message.attachments?.length || 0,
    };
  }
}
