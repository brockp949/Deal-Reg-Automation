/**
 * Quoted Reply Remover - Phase 3 Implementation
 * Removes quoted/forwarded content from email text
 */

import logger from '../utils/logger';
import { QuoteBlock } from './types';

export class QuotedReplyRemover {
  private quoteMarkers: RegExp[];
  private forwardMarkers: RegExp[];
  private headerPattern: RegExp;

  constructor() {
    // Common quote markers
    this.quoteMarkers = [
      /^>/,                                    // Standard > quotes
      /^>>/,                                   // Nested >> quotes
      /^On .+ wrote:/i,                        // "On DATE, PERSON wrote:"
      /^From:.+Sent:.+To:.+Subject:/is,        // Forwarded message header
      /^-+\s*Original Message\s*-+/i,          // Outlook original message
      /^-+\s*Forwarded [Mm]essage\s*-+/i,      // Forwarded message marker
    ];

    // Forward-specific markers
    this.forwardMarkers = [
      /^-+\s*Forwarded [Mm]essage\s*-+/i,
      /^Begin forwarded message:/i,
      /^---------- Forwarded message ---------/i,
    ];

    // Email header pattern (From/To/Cc/Subject)
    this.headerPattern = /^(From|To|Cc|Bcc|Subject|Date|Sent):\s*.+$/i;
  }

  /**
   * Remove quoted replies from text
   */
  removeQuotedReplies(text: string): string {
    if (!text || text.trim().length === 0) {
      return text;
    }

    const lines = text.split('\n');
    const quoteBlocks = this.detectQuoteBlocks(lines);

    if (quoteBlocks.length === 0) {
      return text;
    }

    // Remove quote blocks
    const cleanedLines = this.removeQuoteBlocks(lines, quoteBlocks);

    // Clean up excessive newlines
    let cleaned = cleanedLines.join('\n');
    cleaned = this.cleanupNewlines(cleaned);

    logger.debug('Removed quoted replies', {
      original_lines: lines.length,
      cleaned_lines: cleanedLines.length,
      quote_blocks_removed: quoteBlocks.length,
    });

    return cleaned;
  }

  /**
   * Detect quote markers in text
   */
  detectQuoteMarkers(text: string): number[] {
    const lines = text.split('\n');
    const quoteLineNumbers: number[] = [];

    lines.forEach((line, index) => {
      if (this.isQuoteLine(line)) {
        quoteLineNumbers.push(index);
      }
    });

    return quoteLineNumbers;
  }

  /**
   * Extract original content (non-quoted)
   */
  extractOriginalContent(text: string): string {
    return this.removeQuotedReplies(text);
  }

  /**
   * Detect quote blocks in lines
   */
  private detectQuoteBlocks(lines: string[]): QuoteBlock[] {
    const blocks: QuoteBlock[] = [];
    let inQuoteBlock = false;
    let blockStart = -1;
    let consecutiveQuotes = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isQuote = this.isQuoteLine(line);

      if (isQuote) {
        consecutiveQuotes++;

        if (!inQuoteBlock && consecutiveQuotes >= 1) {
          inQuoteBlock = true;
          blockStart = i;
        }
      } else {
        // Check if this is part of a forwarded message header block
        const isHeaderLine = this.headerPattern.test(line.trim());

        if (inQuoteBlock) {
          // Allow a few non-quote lines within a quote block
          if (consecutiveQuotes > 0 && (isHeaderLine || line.trim().length === 0)) {
            // Continue the quote block
            continue;
          } else {
            // End the quote block
            blocks.push({
              start_line: blockStart,
              end_line: i - 1,
              content: lines.slice(blockStart, i).join('\n'),
              quote_type: this.determineQuoteType(lines.slice(blockStart, i)),
            });

            inQuoteBlock = false;
            consecutiveQuotes = 0;
          }
        }
      }
    }

    // Handle quote block at end of text
    if (inQuoteBlock && blockStart >= 0) {
      blocks.push({
        start_line: blockStart,
        end_line: lines.length - 1,
        content: lines.slice(blockStart).join('\n'),
        quote_type: this.determineQuoteType(lines.slice(blockStart)),
      });
    }

    return blocks;
  }

  /**
   * Check if line is a quote line
   */
  private isQuoteLine(line: string): boolean {
    const trimmed = line.trim();

    // Empty lines are not quotes
    if (trimmed.length === 0) {
      return false;
    }

    // Check quote markers
    for (const marker of this.quoteMarkers) {
      if (marker.test(trimmed)) {
        return true;
      }
    }

    // Check if line starts with >
    if (trimmed.startsWith('>')) {
      return true;
    }

    // Check for forwarded message headers
    if (this.isForwardedMessageHeader(trimmed)) {
      return true;
    }

    return false;
  }

  /**
   * Check if line is a forwarded message header
   */
  private isForwardedMessageHeader(line: string): boolean {
    for (const marker of this.forwardMarkers) {
      if (marker.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine quote type
   */
  private determineQuoteType(lines: string[]): 'reply' | 'forward' | 'inline' {
    const content = lines.join('\n');

    // Check for forward markers
    for (const marker of this.forwardMarkers) {
      if (marker.test(content)) {
        return 'forward';
      }
    }

    // Check for reply patterns
    if (/^On .+ wrote:/im.test(content)) {
      return 'reply';
    }

    // Default to inline quote
    return 'inline';
  }

  /**
   * Remove quote blocks from lines
   */
  private removeQuoteBlocks(lines: string[], blocks: QuoteBlock[]): string[] {
    if (blocks.length === 0) {
      return lines;
    }

    const result: string[] = [];
    let blockIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      if (blockIndex < blocks.length) {
        const block = blocks[blockIndex];

        if (i >= block.start_line && i <= block.end_line) {
          // Skip this line (it's in a quote block)
          if (i === block.end_line) {
            blockIndex++;
          }
          continue;
        }
      }

      result.push(lines[i]);
    }

    return result;
  }

  /**
   * Clean up excessive newlines
   */
  private cleanupNewlines(text: string): string {
    // Collapse multiple newlines (max 2 consecutive)
    let cleaned = text.replace(/\n{3,}/g, '\n\n');

    // Trim leading/trailing whitespace
    cleaned = cleaned.trim();

    return cleaned;
  }

  /**
   * Get statistics about quotes in text
   */
  getQuoteStats(text: string): {
    total_lines: number;
    quote_lines: number;
    quote_percentage: number;
  } {
    const lines = text.split('\n');
    const quoteLines = this.detectQuoteMarkers(text);

    return {
      total_lines: lines.length,
      quote_lines: quoteLines.length,
      quote_percentage: lines.length > 0
        ? (quoteLines.length / lines.length) * 100
        : 0,
    };
  }
}
