/**
 * Configuration for Phase 3: Content Cleaning
 */

import { CleaningOptions } from '../cleaning/types';
import { NormalizationOptions } from '../cleaning/TextNormalizer';

export interface CleaningConfig {
  cleaning: CleaningOptions;
  normalization: NormalizationOptions;
}

const DEFAULT_CLEANING_CONFIG: CleaningConfig = {
  cleaning: {
    remove_quoted_replies: true,
    extract_signatures: true,
    normalize_text: true,
    preserve_structure: false,
    min_content_length: 10,
  },
  normalization: {
    unicode_normalization: 'NFC',
    remove_control_chars: true,
    normalize_whitespace: true,
    lowercase: false,
    remove_excessive_punctuation: true,
    max_consecutive_newlines: 2,
    trim_lines: true,
  },
};

/**
 * Get cleaning configuration from environment or defaults
 */
export function getCleaningConfig(override?: Partial<CleaningConfig>): CleaningConfig {
  const config: CleaningConfig = {
    cleaning: {
      remove_quoted_replies:
        process.env.CLEANING_REMOVE_QUOTES === 'false'
          ? false
          : DEFAULT_CLEANING_CONFIG.cleaning.remove_quoted_replies,
      extract_signatures:
        process.env.CLEANING_EXTRACT_SIGNATURES === 'false'
          ? false
          : DEFAULT_CLEANING_CONFIG.cleaning.extract_signatures,
      normalize_text:
        process.env.CLEANING_NORMALIZE_TEXT === 'false'
          ? false
          : DEFAULT_CLEANING_CONFIG.cleaning.normalize_text,
      preserve_structure:
        process.env.CLEANING_PRESERVE_STRUCTURE === 'true'
          ? true
          : DEFAULT_CLEANING_CONFIG.cleaning.preserve_structure,
      min_content_length: process.env.CLEANING_MIN_CONTENT_LENGTH
        ? parseInt(process.env.CLEANING_MIN_CONTENT_LENGTH, 10)
        : DEFAULT_CLEANING_CONFIG.cleaning.min_content_length,
    },
    normalization: {
      unicode_normalization:
        (process.env.NORM_UNICODE as NormalizationOptions['unicode_normalization']) ||
        DEFAULT_CLEANING_CONFIG.normalization.unicode_normalization,
      remove_control_chars:
        process.env.NORM_REMOVE_CONTROL_CHARS === 'false'
          ? false
          : DEFAULT_CLEANING_CONFIG.normalization.remove_control_chars,
      normalize_whitespace:
        process.env.NORM_WHITESPACE === 'false'
          ? false
          : DEFAULT_CLEANING_CONFIG.normalization.normalize_whitespace,
      lowercase:
        process.env.NORM_LOWERCASE === 'true'
          ? true
          : DEFAULT_CLEANING_CONFIG.normalization.lowercase,
      remove_excessive_punctuation:
        process.env.NORM_REMOVE_EXCESS_PUNCT === 'false'
          ? false
          : DEFAULT_CLEANING_CONFIG.normalization.remove_excessive_punctuation,
      max_consecutive_newlines: process.env.NORM_MAX_NEWLINES
        ? parseInt(process.env.NORM_MAX_NEWLINES, 10)
        : DEFAULT_CLEANING_CONFIG.normalization.max_consecutive_newlines,
      trim_lines:
        process.env.NORM_TRIM_LINES === 'false'
          ? false
          : DEFAULT_CLEANING_CONFIG.normalization.trim_lines,
    },
  };

  // Apply overrides
  if (override) {
    if (override.cleaning) {
      config.cleaning = { ...config.cleaning, ...override.cleaning };
    }
    if (override.normalization) {
      config.normalization = { ...config.normalization, ...override.normalization };
    }
  }

  return config;
}

/**
 * Validate cleaning configuration
 */
export function validateCleaningConfig(config: CleaningConfig): boolean {
  // Validate min_content_length
  if (config.cleaning.min_content_length < 0) {
    throw new Error('min_content_length must be >= 0');
  }

  // Validate max_consecutive_newlines
  if (config.normalization.max_consecutive_newlines < 1) {
    throw new Error('max_consecutive_newlines must be >= 1');
  }

  // Validate unicode_normalization
  const validUnicodeModes = ['NFC', 'NFD', 'NFKC', 'NFKD', 'none'];
  if (!validUnicodeModes.includes(config.normalization.unicode_normalization)) {
    throw new Error(
      `unicode_normalization must be one of: ${validUnicodeModes.join(', ')}`
    );
  }

  return true;
}

export { DEFAULT_CLEANING_CONFIG };
