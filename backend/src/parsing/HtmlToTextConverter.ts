/**
 * HTML to Text Converter - Phase 2 Implementation
 * Converts HTML email content to plain text while preserving structure
 */

import { convert as htmlToText, HtmlToTextOptions } from 'html-to-text';
import logger from '../utils/logger';

export interface ConverterOptions {
  preserve_links?: boolean;
  convert_lists?: boolean;
  max_line_length?: number;
  word_wrap?: boolean;
}

const DEFAULT_OPTIONS: ConverterOptions = {
  preserve_links: true,
  convert_lists: true,
  max_line_length: 80,
  word_wrap: false,
};

export class HtmlToTextConverter {
  private options: ConverterOptions;

  constructor(options: ConverterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Convert HTML to plain text
   */
  convert(html: string): string {
    if (!html || html.trim().length === 0) {
      return '';
    }

    try {
      const htmlToTextOptions: HtmlToTextOptions = {
        wordwrap: this.options.word_wrap ? this.options.max_line_length : false,
        preserveNewlines: true,
        selectors: [
          // Remove script and style tags
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'head', format: 'skip' },

          // Format links
          {
            selector: 'a',
            options: {
              ignoreHref: !this.options.preserve_links,
            },
          },

          // Format lists
          {
            selector: 'ul',
            options: {
              itemPrefix: '  • ',
            },
          },
          {
            selector: 'ol',
            options: {
              itemPrefix: '  ',
            },
          },

          // Format blocks
          { selector: 'p', options: { leadingLineBreaks: 2, trailingLineBreaks: 2 } },
          { selector: 'br', format: 'lineBreak' },
          { selector: 'div', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        ],
      };

      const text = htmlToText(html, htmlToTextOptions);

      // Normalize whitespace
      const normalized = this.normalizeWhitespace(text);

      return normalized;
    } catch (error: any) {
      logger.warn('Error converting HTML to text', {
        error: error.message,
        htmlPreview: html.substring(0, 100),
      });

      // Fallback: strip tags manually
      return this.stripHtmlTags(html);
    }
  }

  /**
   * Strip HTML tags (simple fallback method)
   */
  stripHtmlTags(html: string): string {
    if (!html) return '';

    let text = html;

    // Remove script and style tags with content
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Convert br and p tags to newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<p[^>]*>/gi, '');

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Normalize whitespace
    text = this.normalizeWhitespace(text);

    return text;
  }

  /**
   * Decode common HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&hellip;': '...',
      '&mdash;': '—',
      '&ndash;': '–',
      '&copy;': '©',
      '&reg;': '®',
      '&trade;': '™',
    };

    let result = text;

    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'gi'), char);
    }

    // Decode numeric entities
    result = result.replace(/&#(\d+);/g, (match, dec) => {
      return String.fromCharCode(parseInt(dec, 10));
    });

    result = result.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    return result;
  }

  /**
   * Normalize whitespace (collapse multiple spaces, trim lines)
   */
  private normalizeWhitespace(text: string): string {
    // Collapse multiple spaces into one
    let normalized = text.replace(/[ \t]+/g, ' ');

    // Collapse multiple newlines (max 2 consecutive)
    normalized = normalized.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace from each line
    normalized = normalized
      .split('\n')
      .map((line) => line.trim())
      .join('\n');

    // Trim overall
    normalized = normalized.trim();

    return normalized;
  }

  /**
   * Preserve links by extracting URLs
   */
  preserveLinks(html: string): string {
    // Extract links in markdown format: [text](url)
    const withLinks = html.replace(
      /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
      (match, url, text) => {
        return `[${text}](${url})`;
      }
    );

    return withLinks;
  }

  /**
   * Check if text appears to be HTML
   */
  static isHtml(text: string): boolean {
    if (!text) return false;

    // Simple heuristic: contains HTML tags
    return /<[a-z][\s\S]*>/i.test(text);
  }

  /**
   * Get text length (after conversion if HTML)
   */
  getTextLength(content: string): number {
    if (HtmlToTextConverter.isHtml(content)) {
      const text = this.convert(content);
      return text.length;
    }

    return content.length;
  }
}
