/**
 * Cleaning Pipeline - Phase 3 Implementation
 * Orchestrates all content cleaning steps
 */

import logger from '../utils/logger';
import { QuotedReplyRemover } from './QuotedReplyRemover';
import { SignatureExtractor } from './SignatureExtractor';
import { TextNormalizer, NormalizationOptions } from './TextNormalizer';
import { CleanedContent, CleaningOptions } from './types';

export class CleaningPipeline {
  private quotedReplyRemover: QuotedReplyRemover;
  private signatureExtractor: SignatureExtractor;
  private textNormalizer: TextNormalizer;
  private options: Required<CleaningOptions>;

  constructor(options: CleaningOptions = {}) {
    this.options = {
      remove_quoted_replies: options.remove_quoted_replies !== false,
      extract_signatures: options.extract_signatures !== false,
      normalize_text: options.normalize_text !== false,
      preserve_structure: options.preserve_structure !== false,
      min_content_length: options.min_content_length || 10,
    };

    // Initialize cleaning components
    this.quotedReplyRemover = new QuotedReplyRemover();
    this.signatureExtractor = new SignatureExtractor();

    // Configure text normalizer
    const normOptions: NormalizationOptions = {
      unicode_normalization: 'NFC',
      remove_control_chars: true,
      normalize_whitespace: true,
      lowercase: false,
      remove_excessive_punctuation: true,
      max_consecutive_newlines: 2,
      trim_lines: true,
    };
    this.textNormalizer = new TextNormalizer(normOptions);
  }

  /**
   * Clean email content through full pipeline
   */
  clean(rawText: string): CleanedContent {
    if (!rawText || rawText.trim().length === 0) {
      return this.createEmptyResult(rawText);
    }

    const startTime = Date.now();
    let currentText = rawText;

    logger.debug('Starting cleaning pipeline', {
      original_length: rawText.length,
      options: this.options,
    });

    // Step 1: Remove quoted replies
    let hasQuotes = false;
    if (this.options.remove_quoted_replies) {
      const beforeQuoteRemoval = currentText;
      currentText = this.quotedReplyRemover.removeQuotedReplies(currentText);
      hasQuotes = beforeQuoteRemoval.length !== currentText.length;

      logger.debug('Removed quoted replies', {
        had_quotes: hasQuotes,
        removed_chars: beforeQuoteRemoval.length - currentText.length,
      });
    }

    // Step 2: Extract signature
    let signature = null;
    if (this.options.extract_signatures) {
      const { body, signature: extractedSig } =
        this.signatureExtractor.extractSignature(currentText);

      if (extractedSig) {
        signature = extractedSig;
        currentText = body;

        logger.debug('Extracted signature', {
          has_contact_info: !!(extractedSig.email || extractedSig.phone),
          signature_length: extractedSig.raw_text.length,
        });
      }
    }

    // Step 3: Normalize text
    let normalizedBody = currentText;
    if (this.options.normalize_text) {
      normalizedBody = this.textNormalizer.normalize(currentText);

      // Additional specific normalizations
      normalizedBody = this.textNormalizer.removeZeroWidthCharacters(normalizedBody);
      normalizedBody = this.textNormalizer.normalizeQuotes(normalizedBody);
      normalizedBody = this.textNormalizer.normalizeDashes(normalizedBody);

      logger.debug('Normalized text', {
        original_length: currentText.length,
        normalized_length: normalizedBody.length,
      });
    }

    // Step 4: Validate minimum content length
    const hasMinimumContent = normalizedBody.trim().length >= this.options.min_content_length;

    const processingTime = Date.now() - startTime;

    const result: CleanedContent = {
      original_text: rawText,
      cleaned_body: normalizedBody,
      signature: signature || undefined,
      had_quoted_replies: hasQuotes,
      had_signature: !!signature,
      original_length: rawText.length,
      cleaned_length: normalizedBody.length,
      processing_time_ms: processingTime,
      has_minimum_content: hasMinimumContent,
    };

    logger.info('Cleaning pipeline complete', {
      original_length: result.original_length,
      cleaned_length: result.cleaned_length,
      reduction_percent: (
        ((result.original_length - result.cleaned_length) / result.original_length) *
        100
      ).toFixed(2),
      had_quotes: result.had_quoted_replies,
      had_signature: result.had_signature,
      processing_time_ms: result.processing_time_ms,
    });

    return result;
  }

  /**
   * Clean multiple messages in batch
   */
  cleanBatch(texts: string[]): CleanedContent[] {
    logger.info('Starting batch cleaning', { count: texts.length });

    const results = texts.map((text, index) => {
      try {
        return this.clean(text);
      } catch (error) {
        logger.error('Error cleaning message in batch', {
          index,
          error: error instanceof Error ? error.message : String(error),
        });

        return this.createEmptyResult(text);
      }
    });

    logger.info('Batch cleaning complete', {
      total: results.length,
      successful: results.filter((r) => r.has_minimum_content).length,
    });

    return results;
  }

  /**
   * Clean only body (remove quotes but keep signature)
   */
  cleanBodyOnly(rawText: string): string {
    if (!rawText || rawText.trim().length === 0) {
      return rawText;
    }

    let cleaned = rawText;

    // Remove quoted replies
    if (this.options.remove_quoted_replies) {
      cleaned = this.quotedReplyRemover.removeQuotedReplies(cleaned);
    }

    // Normalize
    if (this.options.normalize_text) {
      cleaned = this.textNormalizer.normalize(cleaned);
    }

    return cleaned;
  }

  /**
   * Extract signature only (no other cleaning)
   */
  extractSignatureOnly(rawText: string) {
    return this.signatureExtractor.extractSignature(rawText);
  }

  /**
   * Remove quoted replies only
   */
  removeQuotesOnly(rawText: string): string {
    return this.quotedReplyRemover.removeQuotedReplies(rawText);
  }

  /**
   * Normalize text only
   */
  normalizeOnly(rawText: string): string {
    return this.textNormalizer.normalize(rawText);
  }

  /**
   * Get pipeline statistics for a batch
   */
  getBatchStatistics(results: CleanedContent[]) {
    const totalOriginal = results.reduce((sum, r) => sum + r.original_length, 0);
    const totalCleaned = results.reduce((sum, r) => sum + r.cleaned_length, 0);
    const withQuotes = results.filter((r) => r.had_quoted_replies).length;
    const withSignatures = results.filter((r) => r.had_signature).length;
    const withMinContent = results.filter((r) => r.has_minimum_content).length;
    const totalTime = results.reduce((sum, r) => sum + r.processing_time_ms, 0);

    return {
      total_messages: results.length,
      total_original_chars: totalOriginal,
      total_cleaned_chars: totalCleaned,
      chars_removed: totalOriginal - totalCleaned,
      reduction_percent: ((totalOriginal - totalCleaned) / totalOriginal * 100).toFixed(2),
      messages_with_quotes: withQuotes,
      messages_with_signatures: withSignatures,
      messages_with_min_content: withMinContent,
      total_processing_time_ms: totalTime,
      avg_processing_time_ms: (totalTime / results.length).toFixed(2),
    };
  }

  /**
   * Validate cleaning result
   */
  validateResult(result: CleanedContent): boolean {
    return (
      result.has_minimum_content &&
      result.cleaned_body.trim().length > 0 &&
      result.cleaned_length <= result.original_length
    );
  }

  /**
   * Create empty result for invalid input
   */
  private createEmptyResult(originalText: string): CleanedContent {
    return {
      original_text: originalText,
      cleaned_body: originalText,
      signature: undefined,
      had_quoted_replies: false,
      had_signature: false,
      original_length: originalText.length,
      cleaned_length: originalText.length,
      processing_time_ms: 0,
      has_minimum_content: originalText.trim().length >= this.options.min_content_length,
    };
  }

  /**
   * Update cleaning options at runtime
   */
  updateOptions(options: Partial<CleaningOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };

    logger.debug('Updated cleaning options', { options: this.options });
  }

  /**
   * Get current options
   */
  getOptions(): Required<CleaningOptions> {
    return { ...this.options };
  }
}
