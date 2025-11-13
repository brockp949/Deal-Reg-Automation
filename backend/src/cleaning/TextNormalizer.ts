/**
 * Text Normalizer - Phase 3 Implementation
 * Normalizes text: Unicode, whitespace, control characters
 */

import logger from '../utils/logger';

export interface NormalizationOptions {
  unicode_normalization?: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' | 'none';
  remove_control_chars?: boolean;
  normalize_whitespace?: boolean;
  lowercase?: boolean;
  remove_excessive_punctuation?: boolean;
  max_consecutive_newlines?: number;
  trim_lines?: boolean;
}

export class TextNormalizer {
  private options: Required<NormalizationOptions>;

  // Control characters pattern (excluding common whitespace)
  private controlCharsPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

  // Excessive punctuation patterns
  private excessivePunctuationPatterns = [
    { pattern: /!{3,}/g, replacement: '!!' },      // Multiple exclamations
    { pattern: /\?{3,}/g, replacement: '??' },     // Multiple question marks
    { pattern: /\.{4,}/g, replacement: '...' },    // More than 3 dots
    { pattern: /-{4,}/g, replacement: '---' },     // More than 3 dashes
  ];

  constructor(options: NormalizationOptions = {}) {
    this.options = {
      unicode_normalization: options.unicode_normalization || 'NFC',
      remove_control_chars: options.remove_control_chars !== false,
      normalize_whitespace: options.normalize_whitespace !== false,
      lowercase: options.lowercase || false,
      remove_excessive_punctuation: options.remove_excessive_punctuation !== false,
      max_consecutive_newlines: options.max_consecutive_newlines || 2,
      trim_lines: options.trim_lines !== false,
    };
  }

  /**
   * Normalize text with all configured options
   */
  normalize(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    let normalized = text;

    // Step 1: Unicode normalization
    if (this.options.unicode_normalization !== 'none') {
      normalized = this.normalizeUnicode(normalized);
    }

    // Step 2: Remove control characters
    if (this.options.remove_control_chars) {
      normalized = this.removeControlCharacters(normalized);
    }

    // Step 3: Normalize whitespace
    if (this.options.normalize_whitespace) {
      normalized = this.normalizeWhitespace(normalized);
    }

    // Step 4: Remove excessive punctuation
    if (this.options.remove_excessive_punctuation) {
      normalized = this.removeExcessivePunctuation(normalized);
    }

    // Step 5: Limit consecutive newlines
    normalized = this.limitConsecutiveNewlines(
      normalized,
      this.options.max_consecutive_newlines
    );

    // Step 6: Trim lines
    if (this.options.trim_lines) {
      normalized = this.trimLines(normalized);
    }

    // Step 7: Lowercase (if requested)
    if (this.options.lowercase) {
      normalized = normalized.toLowerCase();
    }

    // Step 8: Final trim
    normalized = normalized.trim();

    logger.debug('Text normalized', {
      original_length: text.length,
      normalized_length: normalized.length,
      reduction: text.length - normalized.length,
    });

    return normalized;
  }

  /**
   * Normalize Unicode characters
   */
  normalizeUnicode(text: string): string {
    try {
      switch (this.options.unicode_normalization) {
        case 'NFC':
          return text.normalize('NFC');
        case 'NFD':
          return text.normalize('NFD');
        case 'NFKC':
          return text.normalize('NFKC');
        case 'NFKD':
          return text.normalize('NFKD');
        default:
          return text;
      }
    } catch (error) {
      logger.warn('Unicode normalization failed, using original text', {
        error: error instanceof Error ? error.message : String(error),
      });
      return text;
    }
  }

  /**
   * Remove control characters (except newlines, tabs)
   */
  removeControlCharacters(text: string): string {
    return text.replace(this.controlCharsPattern, '');
  }

  /**
   * Normalize whitespace:
   * - Multiple spaces → single space
   * - Tabs → spaces
   * - Carriage returns → newlines
   * - Mixed line endings → consistent newlines
   */
  normalizeWhitespace(text: string): string {
    let normalized = text;

    // Convert tabs to spaces
    normalized = normalized.replace(/\t/g, ' ');

    // Normalize line endings (CRLF → LF, CR → LF)
    normalized = normalized.replace(/\r\n/g, '\n');
    normalized = normalized.replace(/\r/g, '\n');

    // Remove multiple spaces (but preserve line structure)
    normalized = normalized.replace(/ {2,}/g, ' ');

    // Remove trailing whitespace from lines
    normalized = normalized.replace(/ +$/gm, '');

    // Remove leading whitespace from lines (but preserve intentional indentation)
    // Only remove if the line has excessive leading spaces (>4)
    normalized = normalized.replace(/^ {5,}/gm, '    ');

    return normalized;
  }

  /**
   * Remove excessive punctuation
   */
  removeExcessivePunctuation(text: string): string {
    let normalized = text;

    for (const { pattern, replacement } of this.excessivePunctuationPatterns) {
      normalized = normalized.replace(pattern, replacement);
    }

    return normalized;
  }

  /**
   * Limit consecutive newlines
   */
  limitConsecutiveNewlines(text: string, maxNewlines: number): string {
    const pattern = new RegExp(`\n{${maxNewlines + 1},}`, 'g');
    const replacement = '\n'.repeat(maxNewlines);
    return text.replace(pattern, replacement);
  }

  /**
   * Trim whitespace from each line
   */
  trimLines(text: string): string {
    return text
      .split('\n')
      .map((line) => line.trim())
      .join('\n');
  }

  /**
   * Remove zero-width characters
   */
  removeZeroWidthCharacters(text: string): string {
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  }

  /**
   * Normalize quotes (smart quotes → straight quotes)
   */
  normalizeQuotes(text: string): string {
    let normalized = text;

    // Normalize single quotes
    normalized = normalized.replace(/[\u2018\u2019]/g, "'");

    // Normalize double quotes
    normalized = normalized.replace(/[\u201C\u201D]/g, '"');

    // Normalize backticks/primes
    normalized = normalized.replace(/[\u2032\u2033]/g, "'");

    return normalized;
  }

  /**
   * Normalize dashes and hyphens
   */
  normalizeDashes(text: string): string {
    let normalized = text;

    // Em dash → double hyphen
    normalized = normalized.replace(/\u2014/g, '--');

    // En dash → single hyphen
    normalized = normalized.replace(/\u2013/g, '-');

    return normalized;
  }

  /**
   * Full normalization with all options enabled
   */
  static fullNormalization(text: string): string {
    const normalizer = new TextNormalizer({
      unicode_normalization: 'NFC',
      remove_control_chars: true,
      normalize_whitespace: true,
      lowercase: false,
      remove_excessive_punctuation: true,
      max_consecutive_newlines: 2,
      trim_lines: true,
    });

    let normalized = normalizer.normalize(text);

    // Additional normalizations
    normalized = normalizer.removeZeroWidthCharacters(normalized);
    normalized = normalizer.normalizeQuotes(normalized);
    normalized = normalizer.normalizeDashes(normalized);

    return normalized;
  }

  /**
   * Minimal normalization (whitespace only)
   */
  static minimalNormalization(text: string): string {
    const normalizer = new TextNormalizer({
      unicode_normalization: 'none',
      remove_control_chars: false,
      normalize_whitespace: true,
      lowercase: false,
      remove_excessive_punctuation: false,
      max_consecutive_newlines: 3,
      trim_lines: true,
    });

    return normalizer.normalize(text);
  }

  /**
   * Get text statistics before and after normalization
   */
  getStatistics(originalText: string, normalizedText: string) {
    return {
      original_length: originalText.length,
      normalized_length: normalizedText.length,
      chars_removed: originalText.length - normalizedText.length,
      reduction_percent: (
        ((originalText.length - normalizedText.length) / originalText.length) *
        100
      ).toFixed(2),
      original_lines: originalText.split('\n').length,
      normalized_lines: normalizedText.split('\n').length,
    };
  }
}
