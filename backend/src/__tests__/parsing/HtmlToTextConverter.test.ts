/**
 * Unit Tests for HtmlToTextConverter - Phase 2
 */

import { HtmlToTextConverter } from '../../parsing/HtmlToTextConverter';

describe('HtmlToTextConverter', () => {
  let converter: HtmlToTextConverter;

  beforeEach(() => {
    converter = new HtmlToTextConverter();
  });

  describe('convert', () => {
    it('should convert simple HTML to plain text', () => {
      const html = '<p>Hello, world!</p>';
      const text = converter.convert(html);

      expect(text).toContain('Hello, world!');
    });

    it('should remove script tags', () => {
      const html = '<script>alert("bad");</script><p>Content</p>';
      const text = converter.convert(html);

      expect(text).not.toContain('alert');
      expect(text).not.toContain('script');
      expect(text).toContain('Content');
    });

    it('should remove style tags', () => {
      const html = '<style>body { color: red; }</style><p>Content</p>';
      const text = converter.convert(html);

      expect(text).not.toContain('color');
      expect(text).not.toContain('style');
      expect(text).toContain('Content');
    });

    it('should convert br tags to newlines', () => {
      const html = 'Line 1<br>Line 2';
      const text = converter.convert(html);

      expect(text).toMatch(/Line 1[\n\s]*Line 2/);
    });

    it('should convert paragraph tags', () => {
      const html = '<p>Paragraph 1</p><p>Paragraph 2</p>';
      const text = converter.convert(html);

      expect(text).toContain('Paragraph 1');
      expect(text).toContain('Paragraph 2');
    });

    it('should preserve links', () => {
      const html = '<a href="https://example.com">Click here</a>';
      const text = converter.convert(html);

      expect(text).toContain('Click here');
      expect(text).toContain('example.com');
    });

    it('should convert lists to bullet points', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const text = converter.convert(html);

      expect(text).toContain('Item 1');
      expect(text).toContain('Item 2');
    });

    it('should handle empty HTML', () => {
      const text = converter.convert('');

      expect(text).toBe('');
    });

    it('should handle malformed HTML gracefully', () => {
      const html = '<p>Unclosed paragraph<div>Mixed tags';
      const text = converter.convert(html);

      expect(text).toContain('Unclosed paragraph');
      expect(text).toContain('Mixed tags');
    });
  });

  describe('stripHtmlTags', () => {
    it('should strip all HTML tags', () => {
      const html = '<div><p>Hello <strong>world</strong>!</p></div>';
      const text = converter.stripHtmlTags(html);

      expect(text).toContain('Hello world!');
      expect(text).not.toContain('<');
      expect(text).not.toContain('>');
    });

    it('should convert br to newlines', () => {
      const html = 'Line 1<br/>Line 2';
      const text = converter.stripHtmlTags(html);

      expect(text).toMatch(/Line 1\s+Line 2/);
    });

    it('should decode HTML entities', () => {
      const html = 'Hello &amp; goodbye &lt;test&gt;';
      const text = converter.stripHtmlTags(html);

      expect(text).toContain('Hello & goodbye <test>');
    });

    it('should handle nbsp entities', () => {
      const html = 'Word&nbsp;with&nbsp;spaces';
      const text = converter.stripHtmlTags(html);

      expect(text).toContain('Word with spaces');
    });
  });

  describe('isHtml', () => {
    it('should detect HTML content', () => {
      expect(HtmlToTextConverter.isHtml('<p>Test</p>')).toBe(true);
      expect(HtmlToTextConverter.isHtml('<div>Test</div>')).toBe(true);
      expect(HtmlToTextConverter.isHtml('<br/>')).toBe(true);
    });

    it('should not detect plain text as HTML', () => {
      expect(HtmlToTextConverter.isHtml('Plain text')).toBe(false);
      expect(HtmlToTextConverter.isHtml('No tags here')).toBe(false);
    });

    it('should handle empty string', () => {
      expect(HtmlToTextConverter.isHtml('')).toBe(false);
    });

    it('should handle angle brackets in text', () => {
      expect(HtmlToTextConverter.isHtml('5 < 10')).toBe(false);
      expect(HtmlToTextConverter.isHtml('x > y')).toBe(false);
    });
  });

  describe('getTextLength', () => {
    it('should get length of plain text', () => {
      const text = 'Hello, world!';
      const length = converter.getTextLength(text);

      expect(length).toBe(13);
    });

    it('should get length after HTML conversion', () => {
      const html = '<p>Hello</p>';
      const length = converter.getTextLength(html);

      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThan(html.length); // Should be less than HTML length
    });
  });

  describe('preserveLinks', () => {
    it('should preserve links in markdown format', () => {
      const html = '<a href="https://example.com">Example</a>';
      const text = converter.preserveLinks(html);

      expect(text).toBe('[Example](https://example.com)');
    });

    it('should handle multiple links', () => {
      const html =
        '<a href="https://example.com">Link1</a> and <a href="https://test.com">Link2</a>';
      const text = converter.preserveLinks(html);

      expect(text).toContain('[Link1](https://example.com)');
      expect(text).toContain('[Link2](https://test.com)');
    });
  });

  describe('edge cases', () => {
    it('should handle deeply nested HTML', () => {
      const html =
        '<div><div><div><p><strong><em>Nested content</em></strong></p></div></div></div>';
      const text = converter.convert(html);

      expect(text).toContain('Nested content');
    });

    it('should normalize excessive whitespace', () => {
      const html = '<p>Too    many    spaces</p>';
      const text = converter.convert(html);

      expect(text).toMatch(/Too\s+many\s+spaces/);
      expect(text).not.toMatch(/    /); // Should not have 4 consecutive spaces
    });

    it('should handle mixed content types', () => {
      const html = `
        <div>
          Text with <strong>bold</strong> and <em>italic</em>.
          <br/>
          <a href="https://example.com">A link</a>
          <ul>
            <li>List item 1</li>
            <li>List item 2</li>
          </ul>
        </div>
      `;
      const text = converter.convert(html);

      expect(text).toContain('bold');
      expect(text).toContain('italic');
      expect(text).toContain('example.com');
      expect(text).toContain('List item 1');
      expect(text).toContain('List item 2');
    });

    it('should handle special characters', () => {
      const html = '<p>&copy; 2024 &mdash; All rights reserved &trade;</p>';
      const text = converter.stripHtmlTags(html);

      expect(text).toContain('©');
      expect(text).toContain('—');
      expect(text).toContain('™');
    });
  });
});
