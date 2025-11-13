/**
 * Unit Tests for QuotedReplyRemover - Phase 3
 */

import { QuotedReplyRemover } from '../../cleaning/QuotedReplyRemover';

describe('QuotedReplyRemover', () => {
  let remover: QuotedReplyRemover;

  beforeEach(() => {
    remover = new QuotedReplyRemover();
  });

  describe('removeQuotedReplies', () => {
    it('should remove simple quoted replies with >', () => {
      const text = `This is my response.

> This is the quoted text
> from the previous email`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('This is my response.');
      expect(cleaned).not.toContain('> This is the quoted text');
      expect(cleaned).not.toContain('from the previous email');
    });

    it('should remove nested quoted replies', () => {
      const text = `My reply here.

> First level quote
>> Second level quote
>>> Third level quote`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('My reply here.');
      expect(cleaned).not.toContain('First level quote');
      expect(cleaned).not.toContain('Second level quote');
      expect(cleaned).not.toContain('Third level quote');
    });

    it('should remove "On ... wrote:" style quotes', () => {
      const text = `Thanks for the info!

On Mon, Jan 15, 2024 at 10:00 AM John Doe <john@example.com> wrote:
This is the quoted content from the previous message.`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('Thanks for the info!');
      expect(cleaned).not.toContain('On Mon, Jan 15');
      expect(cleaned).not.toContain('This is the quoted content');
    });

    it('should remove forwarded message blocks', () => {
      const text = `Please review this.

---------- Forwarded message ---------
From: sender@example.com
Date: Mon, Jan 15, 2024
Subject: Important Info

The forwarded content goes here.`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('Please review this.');
      expect(cleaned).not.toContain('Forwarded message');
      expect(cleaned).not.toContain('forwarded content');
    });

    it('should remove Outlook-style forwarded messages', () => {
      const text = `FYI

From: John Doe
Sent: Monday, January 15, 2024 10:00 AM
To: Jane Smith
Subject: RE: Meeting

Original message content.`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('FYI');
      expect(cleaned).not.toContain('From: John Doe');
      expect(cleaned).not.toContain('Original message content');
    });

    it('should preserve text that looks like quotes but is not', () => {
      const text = `Here's a quote from Shakespeare:
"To be or not to be"

And some code with > operator:
if (x > y) { return true; }`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('quote from Shakespeare');
      expect(cleaned).toContain('To be or not to be');
      expect(cleaned).toContain('x > y');
    });

    it('should handle empty text', () => {
      expect(remover.removeQuotedReplies('')).toBe('');
    });

    it('should handle text with no quotes', () => {
      const text = 'This is a simple message with no quoted content.';
      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toBe(text);
    });

    it('should handle multiple quote blocks', () => {
      const text = `My first point.

> Quote block 1
> More of quote 1

My second point.

> Quote block 2
> More of quote 2`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('My first point.');
      expect(cleaned).toContain('My second point.');
      expect(cleaned).not.toContain('Quote block 1');
      expect(cleaned).not.toContain('Quote block 2');
    });
  });

  describe('detectQuoteBlocks', () => {
    it('should detect quote blocks with confidence scores', () => {
      const text = `Original content.

> Quoted line 1
> Quoted line 2

More original content.`;

      const blocks = remover.detectQuoteBlocks(text);

      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].start_line).toBeGreaterThan(0);
      expect(blocks[0].confidence).toBeGreaterThan(0);
    });

    it('should detect "On ... wrote:" blocks', () => {
      const text = `Reply here.

On Jan 15, 2024, at 10:00 AM, user@example.com wrote:
Quoted content.`;

      const blocks = remover.detectQuoteBlocks(text);

      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].quote_type).toBe('on_wrote');
    });
  });

  describe('extractOriginalContent', () => {
    it('should extract only original content', () => {
      const text = `This is my response.

> This is quoted
> More quoted text

Another original line.`;

      const original = remover.extractOriginalContent(text);

      expect(original).toContain('This is my response.');
      expect(original).toContain('Another original line.');
      expect(original).not.toContain('This is quoted');
    });
  });

  describe('hasQuotedContent', () => {
    it('should detect quoted content', () => {
      const withQuotes = '> This has quotes';
      const withoutQuotes = 'This has no quotes';

      expect(remover.hasQuotedContent(withQuotes)).toBe(true);
      expect(remover.hasQuotedContent(withoutQuotes)).toBe(false);
    });

    it('should detect "On ... wrote:" pattern', () => {
      const text = 'On Jan 15, 2024, John wrote:\nQuoted text';

      expect(remover.hasQuotedContent(text)).toBe(true);
    });

    it('should detect forwarded messages', () => {
      const text = '---------- Forwarded message ---------';

      expect(remover.hasQuotedContent(text)).toBe(true);
    });
  });

  describe('getQuoteRatio', () => {
    it('should calculate quote ratio correctly', () => {
      const text = `Original line 1
Original line 2
> Quoted line 1
> Quoted line 2
> Quoted line 3`;

      const ratio = remover.getQuoteRatio(text);

      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
      // 3 quoted lines out of 5 total = 0.6
      expect(ratio).toBeCloseTo(0.6, 1);
    });

    it('should return 0 for text with no quotes', () => {
      const text = 'No quotes here\nJust plain text';

      expect(remover.getQuoteRatio(text)).toBe(0);
    });

    it('should return 1 for text that is all quotes', () => {
      const text = '> All quoted\n> Every line\n> Is quoted';

      expect(remover.getQuoteRatio(text)).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle mixed quote styles', () => {
      const text = `My response.

> Standard quote

On Jan 15, user wrote:
Another quote type

---------- Forwarded message ---------
Forwarded content`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('My response.');
      expect(cleaned).not.toContain('Standard quote');
      expect(cleaned).not.toContain('Another quote type');
      expect(cleaned).not.toContain('Forwarded content');
    });

    it('should handle quotes at the start of message', () => {
      const text = `> Quoted first line
> Quoted second line

My actual response comes after.`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain('My actual response');
      expect(cleaned).not.toContain('Quoted first line');
    });

    it('should preserve code blocks that might look like quotes', () => {
      const text = `Here's the code:

\`\`\`
if (x > y) {
  return x;
}
\`\`\`

That should work.`;

      const cleaned = remover.removeQuotedReplies(text);

      expect(cleaned).toContain("Here's the code:");
      expect(cleaned).toContain('That should work.');
    });
  });
});
