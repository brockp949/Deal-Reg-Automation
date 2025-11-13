/**
 * Unit Tests for CleaningPipeline - Phase 3
 */

import { CleaningPipeline } from '../../cleaning/CleaningPipeline';
import { CleanedContent } from '../../cleaning/types';

describe('CleaningPipeline', () => {
  let pipeline: CleaningPipeline;

  beforeEach(() => {
    pipeline = new CleaningPipeline();
  });

  describe('clean', () => {
    it('should clean email with all components', () => {
      const rawText = `Thanks for the update!

> On Jan 15, 2024, John wrote:
> Previous message content here
> More quoted content

--
Jane Doe
Sales Manager
Acme Corp
jane.doe@example.com
(555) 123-4567`;

      const result = pipeline.clean(rawText);

      expect(result.cleaned_body).toContain('Thanks for the update!');
      expect(result.cleaned_body).not.toContain('Previous message content');
      expect(result.cleaned_body).not.toContain('Jane Doe');
      expect(result.signature).toBeDefined();
      expect(result.signature?.email).toBe('jane.doe@example.com');
      expect(result.had_quoted_replies).toBe(true);
      expect(result.had_signature).toBe(true);
      expect(result.has_minimum_content).toBe(true);
    });

    it('should handle text with only body content', () => {
      const rawText = 'Just a simple message with no extras.';

      const result = pipeline.clean(rawText);

      expect(result.cleaned_body).toContain('simple message');
      expect(result.signature).toBeUndefined();
      expect(result.had_quoted_replies).toBe(false);
      expect(result.had_signature).toBe(false);
      expect(result.has_minimum_content).toBe(true);
    });

    it('should handle empty text', () => {
      const result = pipeline.clean('');

      expect(result.cleaned_body).toBe('');
      expect(result.original_length).toBe(0);
      expect(result.cleaned_length).toBe(0);
      expect(result.has_minimum_content).toBe(false);
    });

    it('should normalize whitespace', () => {
      const rawText = 'Text    with    lots    of    spaces\n\n\n\nAnd many newlines';

      const result = pipeline.clean(rawText);

      expect(result.cleaned_body).not.toContain('    ');
      expect(result.cleaned_body.split('\n\n\n').length).toBe(1);
    });

    it('should respect min_content_length option', () => {
      const customPipeline = new CleaningPipeline({ min_content_length: 50 });
      const shortText = 'Short';

      const result = customPipeline.clean(shortText);

      expect(result.has_minimum_content).toBe(false);
    });

    it('should track processing time', () => {
      const result = pipeline.clean('Test message');

      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
      expect(result.processing_time_ms).toBeLessThan(1000);
    });

    it('should calculate length reduction', () => {
      const rawText = `Message

> Quote 1
> Quote 2
> Quote 3

--
Signature
Lines`;

      const result = pipeline.clean(rawText);

      expect(result.original_length).toBeGreaterThan(result.cleaned_length);
      expect(result.cleaned_length).toBeGreaterThan(0);
    });
  });

  describe('cleanBatch', () => {
    it('should clean multiple messages', () => {
      const texts = [
        'Message 1 with content',
        'Message 2 with content',
        'Message 3 with content',
      ];

      const results = pipeline.cleanBatch(texts);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.cleaned_body).toBeTruthy();
        expect(result.has_minimum_content).toBe(true);
      });
    });

    it('should handle errors in batch gracefully', () => {
      const texts = ['Valid message', '', 'Another valid message'];

      const results = pipeline.cleanBatch(texts);

      expect(results).toHaveLength(3);
      expect(results[0].has_minimum_content).toBe(true);
      expect(results[1].has_minimum_content).toBe(false);
      expect(results[2].has_minimum_content).toBe(true);
    });

    it('should handle empty batch', () => {
      const results = pipeline.cleanBatch([]);

      expect(results).toHaveLength(0);
    });
  });

  describe('cleanBodyOnly', () => {
    it('should remove quotes but keep signature', () => {
      const rawText = `My response

> Quoted text

--
Signature`;

      const result = pipeline.cleanBodyOnly(rawText);

      expect(result).toContain('My response');
      expect(result).not.toContain('Quoted text');
      expect(result).toContain('Signature');
    });

    it('should handle empty text', () => {
      const result = pipeline.cleanBodyOnly('');

      expect(result).toBe('');
    });
  });

  describe('extractSignatureOnly', () => {
    it('should extract signature without other cleaning', () => {
      const rawText = `Message content

> Quoted text

--
John Doe
john@example.com`;

      const { body, signature } = pipeline.extractSignatureOnly(rawText);

      expect(body).toContain('> Quoted text'); // Quotes preserved
      expect(signature).toBeDefined();
      expect(signature?.email).toBe('john@example.com');
    });
  });

  describe('removeQuotesOnly', () => {
    it('should remove only quotes', () => {
      const rawText = `Text    with    spaces

> Quoted content

--
Signature`;

      const result = pipeline.removeQuotesOnly(rawText);

      expect(result).not.toContain('Quoted content');
      expect(result).toContain('Signature');
      expect(result).toContain('    '); // Whitespace preserved
    });
  });

  describe('normalizeOnly', () => {
    it('should normalize only whitespace', () => {
      const rawText = `Text    with    spaces

> Quote
> More quote

--
Signature`;

      const result = pipeline.normalizeOnly(rawText);

      expect(result).not.toContain('    ');
      expect(result).toContain('> Quote'); // Quotes preserved
      expect(result).toContain('Signature'); // Signature preserved
    });
  });

  describe('getBatchStatistics', () => {
    it('should calculate statistics for batch', () => {
      const results: CleanedContent[] = [
        {
          original_text: 'Test 1 with quotes\n> Quote',
          cleaned_body: 'Test 1 with quotes',
          signature: undefined,
          had_quoted_replies: true,
          had_signature: false,
          original_length: 25,
          cleaned_length: 18,
          processing_time_ms: 10,
          has_minimum_content: true,
        },
        {
          original_text: 'Test 2\n--\nSig',
          cleaned_body: 'Test 2',
          signature: { raw_text: 'Sig' },
          had_quoted_replies: false,
          had_signature: true,
          original_length: 14,
          cleaned_length: 6,
          processing_time_ms: 8,
          has_minimum_content: true,
        },
      ];

      const stats = pipeline.getBatchStatistics(results);

      expect(stats.total_messages).toBe(2);
      expect(stats.total_original_chars).toBe(39);
      expect(stats.total_cleaned_chars).toBe(24);
      expect(stats.chars_removed).toBe(15);
      expect(stats.messages_with_quotes).toBe(1);
      expect(stats.messages_with_signatures).toBe(1);
      expect(stats.messages_with_min_content).toBe(2);
      expect(parseFloat(stats.reduction_percent)).toBeGreaterThan(0);
      expect(parseFloat(stats.avg_processing_time_ms)).toBeGreaterThan(0);
    });

    it('should handle empty results', () => {
      const stats = pipeline.getBatchStatistics([]);

      expect(stats.total_messages).toBe(0);
      expect(isNaN(parseFloat(stats.avg_processing_time_ms))).toBe(true);
    });
  });

  describe('validateResult', () => {
    it('should validate good result', () => {
      const result: CleanedContent = {
        original_text: 'Original text here',
        cleaned_body: 'Cleaned text',
        signature: undefined,
        had_quoted_replies: false,
        had_signature: false,
        original_length: 18,
        cleaned_length: 12,
        processing_time_ms: 5,
        has_minimum_content: true,
      };

      expect(pipeline.validateResult(result)).toBe(true);
    });

    it('should invalidate result with no minimum content', () => {
      const result: CleanedContent = {
        original_text: 'Short',
        cleaned_body: 'Short',
        signature: undefined,
        had_quoted_replies: false,
        had_signature: false,
        original_length: 5,
        cleaned_length: 5,
        processing_time_ms: 1,
        has_minimum_content: false,
      };

      expect(pipeline.validateResult(result)).toBe(false);
    });

    it('should invalidate result with empty cleaned body', () => {
      const result: CleanedContent = {
        original_text: 'Text',
        cleaned_body: '   ',
        signature: undefined,
        had_quoted_replies: false,
        had_signature: false,
        original_length: 4,
        cleaned_length: 3,
        processing_time_ms: 1,
        has_minimum_content: true,
      };

      expect(pipeline.validateResult(result)).toBe(false);
    });

    it('should invalidate result where cleaned is longer than original', () => {
      const result: CleanedContent = {
        original_text: 'Short',
        cleaned_body: 'Much longer text somehow',
        signature: undefined,
        had_quoted_replies: false,
        had_signature: false,
        original_length: 5,
        cleaned_length: 24,
        processing_time_ms: 1,
        has_minimum_content: true,
      };

      expect(pipeline.validateResult(result)).toBe(false);
    });
  });

  describe('updateOptions', () => {
    it('should update options at runtime', () => {
      pipeline.updateOptions({ min_content_length: 100 });

      const options = pipeline.getOptions();

      expect(options.min_content_length).toBe(100);
    });

    it('should update partial options', () => {
      const originalOptions = pipeline.getOptions();

      pipeline.updateOptions({ remove_quoted_replies: false });

      const newOptions = pipeline.getOptions();

      expect(newOptions.remove_quoted_replies).toBe(false);
      expect(newOptions.extract_signatures).toBe(originalOptions.extract_signatures);
    });
  });

  describe('getOptions', () => {
    it('should return current options', () => {
      const options = pipeline.getOptions();

      expect(options).toBeDefined();
      expect(options.remove_quoted_replies).toBeDefined();
      expect(options.extract_signatures).toBeDefined();
      expect(options.normalize_text).toBeDefined();
      expect(options.preserve_structure).toBeDefined();
      expect(options.min_content_length).toBeDefined();
    });

    it('should return copy of options', () => {
      const options1 = pipeline.getOptions();
      options1.min_content_length = 999;

      const options2 = pipeline.getOptions();

      expect(options2.min_content_length).not.toBe(999);
    });
  });

  describe('configuration options', () => {
    it('should disable quote removal when configured', () => {
      const customPipeline = new CleaningPipeline({ remove_quoted_replies: false });
      const rawText = 'Message\n> Quote';

      const result = customPipeline.clean(rawText);

      expect(result.cleaned_body).toContain('> Quote');
      expect(result.had_quoted_replies).toBe(false);
    });

    it('should disable signature extraction when configured', () => {
      const customPipeline = new CleaningPipeline({ extract_signatures: false });
      const rawText = 'Message\n--\nSignature';

      const result = customPipeline.clean(rawText);

      expect(result.cleaned_body).toContain('Signature');
      expect(result.signature).toBeUndefined();
      expect(result.had_signature).toBe(false);
    });

    it('should disable text normalization when configured', () => {
      const customPipeline = new CleaningPipeline({ normalize_text: false });
      const rawText = 'Text    with    spaces';

      const result = customPipeline.clean(rawText);

      expect(result.cleaned_body).toContain('    ');
    });
  });

  describe('edge cases', () => {
    it('should handle very long emails', () => {
      const longBody = 'Test content. '.repeat(1000);
      const longQuote = '> Quote line\n'.repeat(100);
      const rawText = `${longBody}\n\n${longQuote}\n--\nSignature`;

      const startTime = Date.now();
      const result = pipeline.clean(rawText);
      const endTime = Date.now();

      expect(result.cleaned_body).toBeTruthy();
      expect(endTime - startTime).toBeLessThan(1000); // Should be fast
    });

    it('should handle text with only whitespace', () => {
      const result = pipeline.clean('   \n\n\t\t   ');

      expect(result.cleaned_body.trim()).toBe('');
      expect(result.has_minimum_content).toBe(false);
    });

    it('should handle text with only quotes', () => {
      const rawText = '> Quote 1\n> Quote 2\n> Quote 3';

      const result = pipeline.clean(rawText);

      expect(result.cleaned_body.trim()).toBe('');
      expect(result.had_quoted_replies).toBe(true);
      expect(result.has_minimum_content).toBe(false);
    });

    it('should handle text with only signature', () => {
      const rawText = `--
John Doe
john@example.com`;

      const result = pipeline.clean(rawText);

      expect(result.cleaned_body.trim()).toBe('');
      expect(result.signature).toBeDefined();
      expect(result.has_minimum_content).toBe(false);
    });

    it('should handle complex real-world email', () => {
      const rawText = `Hi Team,

Please review the attached proposal    and let me know your thoughts.

Thanks!!!!!

On Mon, Jan 15, 2024 at 10:00 AM Jane Smith <jane@example.com> wrote:
> Thanks for sending this over.
> I'll take a look and get back to you.
>
> Best,
> Jane

--
John Doe
Senior Account Executive
Acme Corporation
john.doe@acme.com | (555) 123-4567
www.acme.com

CONFIDENTIAL: This email is intended only for the recipient.`;

      const result = pipeline.clean(rawText);

      expect(result.cleaned_body).toContain('Hi Team');
      expect(result.cleaned_body).toContain('review the attached proposal');
      expect(result.cleaned_body).not.toContain('Jane Smith');
      expect(result.cleaned_body).not.toContain("I'll take a look");
      expect(result.cleaned_body).not.toContain('John Doe');
      expect(result.signature).toBeDefined();
      expect(result.signature?.name).toContain('John Doe');
      expect(result.signature?.email).toBe('john.doe@acme.com');
      expect(result.signature?.disclaimer).toContain('CONFIDENTIAL');
      expect(result.had_quoted_replies).toBe(true);
      expect(result.had_signature).toBe(true);
      expect(result.has_minimum_content).toBe(true);
      expect(result.cleaned_body).not.toContain('!!!!!');
      expect(result.cleaned_body).not.toContain('    ');
    });
  });
});
