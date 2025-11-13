/**
 * Unit Tests for GmailLabelFilter - Phase 1
 */

import { GmailLabelFilter, DEFAULT_LABEL_CONFIG } from '../../ingestion/GmailLabelFilter';
import { ParsedMail } from 'mailparser';

describe('GmailLabelFilter', () => {
  let filter: GmailLabelFilter;

  beforeEach(() => {
    filter = new GmailLabelFilter();
  });

  describe('extract_labels_from_text', () => {
    it('should extract labels from X-Gmail-Labels header', () => {
      const emailText = `From: test@example.com
To: recipient@example.com
X-Gmail-Labels: SENT,IMPORTANT,INBOX
Subject: Test Email

Body content`;

      const labels = filter.extract_labels_from_text(emailText);

      expect(labels).toEqual(['SENT', 'IMPORTANT', 'INBOX']);
    });

    it('should handle labels with spaces and quotes', () => {
      const emailText = `X-Gmail-Labels: "SENT", " IMPORTANT ", INBOX`;

      const labels = filter.extract_labels_from_text(emailText);

      expect(labels).toEqual(['SENT', 'IMPORTANT', 'INBOX']);
    });

    it('should return empty array if no X-Gmail-Labels header', () => {
      const emailText = `From: test@example.com
Subject: Test Email`;

      const labels = filter.extract_labels_from_text(emailText);

      expect(labels).toEqual([]);
    });

    it('should handle case-insensitive header matching', () => {
      const emailText = `x-gmail-labels: sent,inbox`;

      const labels = filter.extract_labels_from_text(emailText);

      expect(labels).toEqual(['SENT', 'INBOX']);
    });
  });

  describe('calculate_priority', () => {
    it('should calculate positive score for high-value labels', () => {
      const labels = ['SENT', 'IMPORTANT'];
      const score = filter.calculate_priority(labels);

      // SENT = 50, IMPORTANT = 40
      expect(score).toBe(90);
    });

    it('should calculate negative score for low-value labels', () => {
      const labels = ['SPAM'];
      const score = filter.calculate_priority(labels);

      // SPAM = -100
      expect(score).toBe(-100);
    });

    it('should calculate mixed score for combined labels', () => {
      const labels = ['SENT', 'CATEGORY_PROMOTIONS'];
      const score = filter.calculate_priority(labels);

      // SENT = 50, CATEGORY_PROMOTIONS = -30
      expect(score).toBe(20);
    });

    it('should return 0 for unknown labels', () => {
      const labels = ['UNKNOWN_LABEL'];
      const score = filter.calculate_priority(labels);

      expect(score).toBe(0);
    });

    it('should handle empty labels array', () => {
      const labels: string[] = [];
      const score = filter.calculate_priority(labels);

      expect(score).toBe(0);
    });
  });

  describe('should_process_text', () => {
    it('should accept SENT emails above threshold', () => {
      const emailText = `X-Gmail-Labels: SENT`;

      const result = filter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(true);
      expect(result.score).toBe(50);
      expect(result.labels).toEqual(['SENT']);
    });

    it('should accept IMPORTANT emails above threshold', () => {
      const emailText = `X-Gmail-Labels: IMPORTANT`;

      const result = filter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(true);
      expect(result.score).toBe(40);
    });

    it('should accept INBOX emails at threshold', () => {
      const emailText = `X-Gmail-Labels: INBOX`;

      const result = filter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(true);
      expect(result.score).toBe(30);
    });

    it('should reject SPAM emails', () => {
      const emailText = `X-Gmail-Labels: SPAM`;

      const result = filter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(false);
      expect(result.score).toBe(-100);
    });

    it('should reject PROMOTIONS emails below threshold', () => {
      const emailText = `X-Gmail-Labels: CATEGORY_PROMOTIONS`;

      const result = filter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(false);
      expect(result.score).toBe(-30);
    });

    it('should accept emails with mixed labels if net score above threshold', () => {
      const emailText = `X-Gmail-Labels: SENT,CATEGORY_PROMOTIONS`;

      const result = filter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(false); // 50 + (-30) = 20, below default 30
    });

    it('should use custom threshold when provided', () => {
      const emailText = `X-Gmail-Labels: STARRED`;

      const result = filter.should_process_text(emailText, 20);

      expect(result.shouldProcess).toBe(true); // STARRED = 25, above 20
      expect(result.score).toBe(25);
    });

    it('should reject emails with no labels', () => {
      const emailText = `From: test@example.com`;

      const result = filter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(false);
      expect(result.score).toBe(0);
      expect(result.labels).toEqual([]);
    });
  });

  describe('get_priority_breakdown', () => {
    it('should provide detailed breakdown for labels', () => {
      const labels = ['SENT', 'IMPORTANT', 'UNKNOWN'];
      const breakdown = filter.get_priority_breakdown(labels);

      expect(breakdown).toHaveLength(3);
      expect(breakdown[0]).toEqual({
        label: 'SENT',
        score: 50,
        reason: 'High value label',
      });
      expect(breakdown[1]).toEqual({
        label: 'IMPORTANT',
        score: 40,
        reason: 'High value label',
      });
      expect(breakdown[2]).toEqual({
        label: 'UNKNOWN',
        score: 0,
        reason: 'Unknown label',
      });
    });

    it('should include low-value labels in breakdown', () => {
      const labels = ['SPAM', 'TRASH'];
      const breakdown = filter.get_priority_breakdown(labels);

      expect(breakdown).toHaveLength(2);
      expect(breakdown[0]).toEqual({
        label: 'SPAM',
        score: -100,
        reason: 'Low value label',
      });
      expect(breakdown[1]).toEqual({
        label: 'TRASH',
        score: -100,
        reason: 'Low value label',
      });
    });
  });

  describe('custom configuration', () => {
    it('should accept custom high-value labels', () => {
      const customFilter = new GmailLabelFilter({
        high_value_labels: [
          { label: 'CUSTOM_HIGH', score: 100 },
        ],
        low_value_labels: [],
        min_priority_score: 50,
      });

      const score = customFilter.calculate_priority(['CUSTOM_HIGH']);

      expect(score).toBe(100);
    });

    it('should accept custom min priority score', () => {
      const customFilter = new GmailLabelFilter({
        min_priority_score: 10,
      });

      const emailText = `X-Gmail-Labels: STARRED`;

      const result = customFilter.should_process_text(emailText);

      expect(result.shouldProcess).toBe(true); // STARRED = 25, above 10
    });
  });

  describe('edge cases', () => {
    it('should handle malformed label headers gracefully', () => {
      const emailText = `X-Gmail-Labels: `;

      const labels = filter.extract_labels_from_text(emailText);

      expect(labels).toEqual([]);
    });

    it('should handle labels with special characters', () => {
      const emailText = `X-Gmail-Labels: CATEGORY_PRIMARY,Label/WithSlash`;

      const labels = filter.extract_labels_from_text(emailText);

      expect(labels).toContain('CATEGORY_PRIMARY');
      expect(labels).toContain('LABEL/WITHSLASH');
    });

    it('should normalize case consistently', () => {
      const score1 = filter.calculate_priority(['sent']);
      const score2 = filter.calculate_priority(['SENT']);
      const score3 = filter.calculate_priority(['SeNt']);

      expect(score1).toBe(score2);
      expect(score2).toBe(score3);
      expect(score1).toBe(50);
    });
  });
});
