/**
 * Unit Tests for TextNormalizer - Phase 3
 */

import { TextNormalizer } from '../../cleaning/TextNormalizer';

describe('TextNormalizer', () => {
  let normalizer: TextNormalizer;

  beforeEach(() => {
    normalizer = new TextNormalizer();
  });

  describe('normalize', () => {
    it('should normalize text with default options', () => {
      const text = 'Hello    World\t\tTest';
      const normalized = normalizer.normalize(text);

      expect(normalized).not.toContain('\t');
      expect(normalized).not.toContain('    ');
      expect(normalized).toContain('Hello');
      expect(normalized).toContain('World');
    });

    it('should handle empty text', () => {
      expect(normalizer.normalize('')).toBe('');
    });

    it('should trim text', () => {
      const text = '  Leading and trailing spaces  ';
      const normalized = normalizer.normalize(text);

      expect(normalized).toBe('Leading and trailing spaces');
    });
  });

  describe('normalizeUnicode', () => {
    it('should normalize Unicode to NFC', () => {
      // é can be represented as single character (NFC) or e + combining accent (NFD)
      const text = 'café';
      const normalized = normalizer.normalizeUnicode(text);

      expect(normalized).toBeDefined();
      expect(normalized).toContain('café');
    });

    it('should handle different normalization forms', () => {
      const nfcNormalizer = new TextNormalizer({ unicode_normalization: 'NFC' });
      const nfdNormalizer = new TextNormalizer({ unicode_normalization: 'NFD' });

      const text = 'café';

      const nfc = nfcNormalizer.normalizeUnicode(text);
      const nfd = nfdNormalizer.normalizeUnicode(text);

      expect(nfc).toBeDefined();
      expect(nfd).toBeDefined();
    });

    it('should skip normalization when set to none', () => {
      const noNormNormalizer = new TextNormalizer({ unicode_normalization: 'none' });
      const text = 'test';

      const result = noNormNormalizer.normalizeUnicode(text);

      expect(result).toBe(text);
    });
  });

  describe('removeControlCharacters', () => {
    it('should remove control characters', () => {
      const text = 'Hello\x00\x01World\x1F';
      const cleaned = normalizer.removeControlCharacters(text);

      expect(cleaned).toBe('HelloWorld');
      expect(cleaned).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    });

    it('should preserve newlines and tabs', () => {
      const text = 'Line 1\nLine 2\tTabbed';
      const cleaned = normalizer.removeControlCharacters(text);

      expect(cleaned).toContain('\n');
      expect(cleaned).toContain('\t');
    });
  });

  describe('normalizeWhitespace', () => {
    it('should convert multiple spaces to single space', () => {
      const text = 'Too    many    spaces';
      const normalized = normalizer.normalizeWhitespace(text);

      expect(normalized).toBe('Too many spaces');
    });

    it('should convert tabs to spaces', () => {
      const text = 'Tab\there\tand\tthere';
      const normalized = normalizer.normalizeWhitespace(text);

      expect(normalized).not.toContain('\t');
      expect(normalized).toContain(' ');
    });

    it('should normalize line endings', () => {
      const text = 'Line 1\r\nLine 2\rLine 3\n';
      const normalized = normalizer.normalizeWhitespace(text);

      expect(normalized).not.toContain('\r');
      expect(normalized.split('\n')).toHaveLength(4); // 3 lines + empty at end
    });

    it('should remove trailing whitespace from lines', () => {
      const text = 'Line 1   \nLine 2  \nLine 3';
      const normalized = normalizer.normalizeWhitespace(text);

      expect(normalized).toBe('Line 1\nLine 2\nLine 3');
    });
  });

  describe('removeExcessivePunctuation', () => {
    it('should limit multiple exclamation marks', () => {
      const text = 'Wow!!!!!';
      const normalized = normalizer.removeExcessivePunctuation(text);

      expect(normalized).toBe('Wow!!');
    });

    it('should limit multiple question marks', () => {
      const text = 'Really?????';
      const normalized = normalizer.removeExcessivePunctuation(text);

      expect(normalized).toBe('Really??');
    });

    it('should limit excessive dots', () => {
      const text = 'Wait......';
      const normalized = normalizer.removeExcessivePunctuation(text);

      expect(normalized).toBe('Wait...');
    });

    it('should limit excessive dashes', () => {
      const text = 'Break------here';
      const normalized = normalizer.removeExcessivePunctuation(text);

      expect(normalized).toBe('Break---here');
    });
  });

  describe('limitConsecutiveNewlines', () => {
    it('should limit consecutive newlines to max', () => {
      const text = 'Paragraph 1\n\n\n\n\nParagraph 2';
      const normalized = normalizer.limitConsecutiveNewlines(text, 2);

      expect(normalized).toBe('Paragraph 1\n\nParagraph 2');
    });

    it('should handle custom max newlines', () => {
      const text = 'A\n\n\n\nB';
      const normalized = normalizer.limitConsecutiveNewlines(text, 3);

      expect(normalized).toBe('A\n\n\nB');
    });
  });

  describe('trimLines', () => {
    it('should trim whitespace from each line', () => {
      const text = '  Line 1  \n  Line 2  \n  Line 3  ';
      const normalized = normalizer.trimLines(text);

      expect(normalized).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should handle lines with only whitespace', () => {
      const text = 'Line 1\n   \nLine 2';
      const normalized = normalizer.trimLines(text);

      expect(normalized).toBe('Line 1\n\nLine 2');
    });
  });

  describe('removeZeroWidthCharacters', () => {
    it('should remove zero-width characters', () => {
      const text = 'Hello\u200BWorld\u200C';
      const cleaned = normalizer.removeZeroWidthCharacters(text);

      expect(cleaned).toBe('HelloWorld');
    });

    it('should remove ZWNJ and ZWJ', () => {
      const text = 'Test\u200C\u200DString';
      const cleaned = normalizer.removeZeroWidthCharacters(text);

      expect(cleaned).toBe('TestString');
    });
  });

  describe('normalizeQuotes', () => {
    it('should convert smart quotes to straight quotes', () => {
      const text = '\u201CSmart quotes\u201D and \u2018single smart quotes\u2019';
      const normalized = normalizer.normalizeQuotes(text);

      expect(normalized).toBe('"Smart quotes" and \'single smart quotes\'');
    });

    it('should normalize various quote characters', () => {
      const text = '\u2018\u2019\u201C\u201D';
      const normalized = normalizer.normalizeQuotes(text);

      expect(normalized).not.toContain('\u2018');
      expect(normalized).not.toContain('\u2019');
      expect(normalized).not.toContain('\u201C');
      expect(normalized).not.toContain('\u201D');
    });
  });

  describe('normalizeDashes', () => {
    it('should convert em dash to double hyphen', () => {
      const text = 'Text—more text';
      const normalized = normalizer.normalizeDashes(text);

      expect(normalized).toBe('Text--more text');
    });

    it('should convert en dash to single hyphen', () => {
      const text = 'Range: 1–10';
      const normalized = normalizer.normalizeDashes(text);

      expect(normalized).toBe('Range: 1-10');
    });
  });

  describe('static methods', () => {
    it('should perform full normalization', () => {
      const text = '  Hello    World!!!!!  \n\n\n\nNext  ';
      const normalized = TextNormalizer.fullNormalization(text);

      expect(normalized).not.toContain('    ');
      expect(normalized).not.toContain('!!!!!');
      expect(normalized).toBeTruthy();
    });

    it('should perform minimal normalization', () => {
      const text = '  Text    here  ';
      const normalized = TextNormalizer.minimalNormalization(text);

      expect(normalized).toBe('Text    here');
    });
  });

  describe('lowercase option', () => {
    it('should convert to lowercase when enabled', () => {
      const lowercaseNormalizer = new TextNormalizer({ lowercase: true });
      const text = 'MiXeD CaSe TeXt';
      const normalized = lowercaseNormalizer.normalize(text);

      expect(normalized).toBe('mixed case text');
    });

    it('should preserve case by default', () => {
      const text = 'MiXeD CaSe';
      const normalized = normalizer.normalize(text);

      expect(normalized).toBe('MiXeD CaSe');
    });
  });

  describe('getStatistics', () => {
    it('should calculate normalization statistics', () => {
      const original = 'Text    with    lots    of    spaces';
      const normalized = normalizer.normalize(original);
      const stats = normalizer.getStatistics(original, normalized);

      expect(stats.original_length).toBe(original.length);
      expect(stats.normalized_length).toBe(normalized.length);
      expect(stats.chars_removed).toBe(original.length - normalized.length);
      expect(parseFloat(stats.reduction_percent)).toBeGreaterThan(0);
    });

    it('should handle no changes', () => {
      const text = 'Simple text';
      const stats = normalizer.getStatistics(text, text);

      expect(stats.chars_removed).toBe(0);
      expect(stats.reduction_percent).toBe('0.00');
    });
  });

  describe('edge cases', () => {
    it('should handle text with mixed issues', () => {
      const text = '  Too    many\t\tspaces!!!!!!\n\n\n\nAnd   more  ';
      const normalized = normalizer.normalize(text);

      expect(normalized).not.toContain('\t');
      expect(normalized).not.toContain('    ');
      expect(normalized).not.toContain('!!!!!!');
      expect(normalized.split('\n\n\n').length).toBe(1);
    });

    it('should handle text with only whitespace', () => {
      const text = '   \t\n\n   ';
      const normalized = normalizer.normalize(text);

      expect(normalized).toBe('');
    });

    it('should handle very long text efficiently', () => {
      const longText = 'Test '.repeat(10000);
      const startTime = Date.now();
      const normalized = normalizer.normalize(longText);
      const endTime = Date.now();

      expect(normalized).toBeDefined();
      expect(endTime - startTime).toBeLessThan(1000); // Should be fast
    });

    it('should handle special Unicode characters', () => {
      const text = 'Hello 世界 🌍';
      const normalized = normalizer.normalize(text);

      expect(normalized).toContain('世界');
      expect(normalized).toContain('🌍');
    });
  });
});
