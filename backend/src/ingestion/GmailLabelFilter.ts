/**
 * Gmail Label Prefilter - Phase 1 Implementation
 * Filters and prioritizes emails based on Gmail labels (X-Gmail-Labels header)
 */

import { ParsedMail } from 'mailparser';
import logger from '../utils/logger';

export interface LabelPriority {
  label: string;
  score: number;
}

export interface LabelConfig {
  high_value_labels: LabelPriority[];
  low_value_labels: LabelPriority[];
  min_priority_score: number;
}

export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  high_value_labels: [
    { label: 'SENT', score: 50 },
    { label: 'IMPORTANT', score: 40 },
    { label: 'INBOX', score: 30 },
    { label: 'STARRED', score: 25 },
    { label: 'CATEGORY_PRIMARY', score: 20 },
  ],
  low_value_labels: [
    { label: 'SPAM', score: -100 },
    { label: 'TRASH', score: -100 },
    { label: 'CATEGORY_PROMOTIONS', score: -30 },
    { label: 'CATEGORY_FORUMS', score: -20 },
    { label: 'CATEGORY_SOCIAL', score: -15 },
    { label: 'CATEGORY_UPDATES', score: -10 },
    { label: 'DRAFT', score: -5 },
  ],
  min_priority_score: 30,
};

export class GmailLabelFilter {
  private config: LabelConfig;
  private highValueMap: Map<string, number>;
  private lowValueMap: Map<string, number>;

  constructor(config: Partial<LabelConfig> = {}) {
    this.config = {
      ...DEFAULT_LABEL_CONFIG,
      ...config,
    };

    // Build lookup maps for fast scoring
    this.highValueMap = new Map(
      this.config.high_value_labels.map((lp) => [lp.label, lp.score])
    );
    this.lowValueMap = new Map(
      this.config.low_value_labels.map((lp) => [lp.label, lp.score])
    );
  }

  /**
   * Extract Gmail labels from X-Gmail-Labels header
   */
  extract_labels(message: ParsedMail): string[] {
    const labelHeader = message.headers.get('x-gmail-labels');

    if (!labelHeader) {
      return [];
    }

    const labelString =
      typeof labelHeader === 'string'
        ? labelHeader
        : Array.isArray(labelHeader)
          ? labelHeader[0]
          : String(labelHeader);

    if (!labelString) {
      return [];
    }

    // Parse comma-separated labels
    const labels = String(labelString)
      .split(',')
      .map((label: string) => this.normalizeLabel(label))
      .filter((label: string) => label.length > 0);

    return labels;
  }

  /**
   * Extract labels from raw email text (for MBOX format)
   */
  extract_labels_from_text(emailText: string): string[] {
    // Look for X-Gmail-Labels header in raw email text
    const labelMatch = emailText.match(/^X-Gmail-Labels:\s*(.+)$/im);

    if (!labelMatch) {
      return [];
    }

    const labelString = labelMatch[1];

    const labels = labelString
      .split(',')
      .map((label) => this.normalizeLabel(label))
      .filter((label) => label.length > 0);

    return labels;
  }

  /**
   * Normalize label (uppercase, trim, remove quotes)
   */
  private normalizeLabel(label: string): string {
    return label
      .trim() // Trim whitespace first
      .replace(/^["']+|["']+$/g, '') // Remove quotes from start/end
      .trim() // Trim again in case there was whitespace inside quotes
      .toUpperCase(); // Then uppercase
  }

  /**
   * Calculate priority score based on labels
   */
  calculate_priority(labels: string[]): number {
    let score = 0;

    for (const label of labels) {
      const normalizedLabel = this.normalizeLabel(label);

      // Check high value labels
      if (this.highValueMap.has(normalizedLabel)) {
        score += this.highValueMap.get(normalizedLabel)!;
      }

      // Check low value labels
      if (this.lowValueMap.has(normalizedLabel)) {
        score += this.lowValueMap.get(normalizedLabel)!;
      }
    }

    return score;
  }

  /**
   * Determine if message should be processed based on priority score
   */
  should_process(
    message: ParsedMail,
    minPriority?: number
  ): { shouldProcess: boolean; score: number; labels: string[] } {
    const labels = this.extract_labels(message);
    const score = this.calculate_priority(labels);
    const threshold = minPriority ?? this.config.min_priority_score;

    const shouldProcess = score >= threshold;

    logger.debug('Label priority check', {
      labels,
      score,
      threshold,
      shouldProcess,
    });

    return {
      shouldProcess,
      score,
      labels,
    };
  }

  /**
   * Determine if message should be processed (from raw text)
   */
  should_process_text(
    emailText: string,
    minPriority?: number
  ): { shouldProcess: boolean; score: number; labels: string[] } {
    const labels = this.extract_labels_from_text(emailText);
    const score = this.calculate_priority(labels);
    const threshold = minPriority ?? this.config.min_priority_score;

    const shouldProcess = score >= threshold;

    return {
      shouldProcess,
      score,
      labels,
    };
  }

  /**
   * Get detailed priority breakdown for debugging
   */
  get_priority_breakdown(
    labels: string[]
  ): { label: string; score: number; reason: string }[] {
    return labels.map((label) => {
      const normalizedLabel = this.normalizeLabel(label);
      let score = 0;
      let reason = 'Unknown label';

      if (this.highValueMap.has(normalizedLabel)) {
        score = this.highValueMap.get(normalizedLabel)!;
        reason = 'High value label';
      } else if (this.lowValueMap.has(normalizedLabel)) {
        score = this.lowValueMap.get(normalizedLabel)!;
        reason = 'Low value label';
      }

      return {
        label: normalizedLabel,
        score,
        reason,
      };
    });
  }

  /**
   * Filter a batch of messages by priority
   */
  filter_batch(messages: ParsedMail[], minPriority?: number): {
    filtered: ParsedMail[];
    rejected: ParsedMail[];
    stats: {
      total: number;
      accepted: number;
      rejected: number;
      avg_score: number;
    };
  } {
    const filtered: ParsedMail[] = [];
    const rejected: ParsedMail[] = [];
    let totalScore = 0;

    for (const message of messages) {
      const { shouldProcess, score } = this.should_process(
        message,
        minPriority
      );
      totalScore += score;

      if (shouldProcess) {
        filtered.push(message);
      } else {
        rejected.push(message);
      }
    }

    const stats = {
      total: messages.length,
      accepted: filtered.length,
      rejected: rejected.length,
      avg_score: messages.length > 0 ? totalScore / messages.length : 0,
    };

    logger.info('Batch filtering complete', stats);

    return {
      filtered,
      rejected,
      stats,
    };
  }
}
