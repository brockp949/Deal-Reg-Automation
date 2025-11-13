/**
 * Unit Tests for EmailParser - Phase 2
 */

import { EmailParser } from '../../parsing/EmailParser';
import { ParsedMail, AddressObject } from 'mailparser';

describe('EmailParser', () => {
  let parser: EmailParser;

  beforeEach(() => {
    parser = new EmailParser();
  });

  describe('parse', () => {
    it('should parse a complete email message', () => {
      const message = {
        messageId: '<test-123@example.com>',
        from: {
          value: [{ address: 'sender@example.com', name: 'John Doe' }],
          html: '',
          text: '',
        } as AddressObject,
        to: {
          value: [{ address: 'recipient@example.com', name: 'Jane Smith' }],
          html: '',
          text: '',
        } as AddressObject,
        subject: 'Test Subject',
        date: new Date('2024-01-15T10:00:00Z'),
        text: 'Test email body',
        html: '<p>Test email body</p>',
        headers: new Map([
          ['x-gm-thrid', '1234567890'],
          ['content-type', 'text/plain'],
        ]),
        attachments: [],
      } as unknown as ParsedMail;

      const metadata = parser.parse(message);

      expect(metadata.message_id).toBe('<test-123@example.com>');
      expect(metadata.from.email).toBe('sender@example.com');
      expect(metadata.from.name).toBe('John Doe');
      expect(metadata.to[0].email).toBe('recipient@example.com');
      expect(metadata.subject).toBe('Test Subject');
      expect(metadata.date).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(metadata.body_text).toBe('Test email body');
      expect(metadata.gmail_thread_id).toBe('1234567890');
    });

    it('should generate synthetic Message-ID if missing', () => {
      const message = {
        from: {
          value: [{ address: 'sender@example.com', name: '' }],
          html: '',
          text: '',
        } as AddressObject,
        subject: 'Test',
        date: new Date(),
        headers: new Map(),
        attachments: [],
      } as unknown as ParsedMail;

      const metadata = parser.parse(message);

      expect(metadata.message_id).toMatch(/^<generated-.*@synthetic>$/);
    });

    it('should handle missing from address gracefully', () => {
      const message = {
        messageId: '<test@example.com>',
        subject: 'Test',
        date: new Date(),
        headers: new Map(),
        attachments: [],
      } as unknown as ParsedMail;

      const metadata = parser.parse(message);

      expect(metadata.from.email).toBe('unknown@unknown.com');
      expect(metadata.from.name).toBe('Unknown');
    });

    it('should use current date if date header missing', () => {
      const beforeParse = new Date();

      const message = {
        messageId: '<test@example.com>',
        from: {
          value: [{ address: 'sender@example.com', name: '' }],
          html: '',
          text: '',
        } as AddressObject,
        subject: 'Test',
        headers: new Map(),
        attachments: [],
      } as unknown as ParsedMail;

      const metadata = parser.parse(message);

      const afterParse = new Date();

      expect(metadata.date.getTime()).toBeGreaterThanOrEqual(
        beforeParse.getTime()
      );
      expect(metadata.date.getTime()).toBeLessThanOrEqual(
        afterParse.getTime()
      );
    });
  });

  describe('extractAddresses', () => {
    it('should extract single address', () => {
      const addressObj: AddressObject = {
        value: [{ address: 'test@example.com', name: 'Test User' }],
        html: '',
        text: '',
      };

      const addresses = parser.extractAddresses(addressObj);

      expect(addresses).toHaveLength(1);
      expect(addresses[0].email).toBe('test@example.com');
      expect(addresses[0].name).toBe('Test User');
    });

    it('should extract multiple addresses', () => {
      const addressObj: AddressObject = {
        value: [
          { address: 'user1@example.com', name: 'User One' },
          { address: 'user2@example.com', name: 'User Two' },
        ],
        html: '',
        text: '',
      };

      const addresses = parser.extractAddresses(addressObj);

      expect(addresses).toHaveLength(2);
      expect(addresses[0].email).toBe('user1@example.com');
      expect(addresses[1].email).toBe('user2@example.com');
    });

    it('should normalize email to lowercase', () => {
      const addressObj: AddressObject = {
        value: [{ address: 'Test@EXAMPLE.COM', name: 'Test User' }],
        html: '',
        text: '',
      };

      const addresses = parser.extractAddresses(addressObj);

      expect(addresses[0].email).toBe('test@example.com');
    });

    it('should handle undefined address object', () => {
      const addresses = parser.extractAddresses(undefined);

      expect(addresses).toEqual([]);
    });

    it('should filter out empty email addresses', () => {
      const addressObj: AddressObject = {
        value: [
          { address: 'valid@example.com', name: 'Valid' },
          { address: '', name: 'Empty' },
        ],
        html: '',
        text: '',
      };

      const addresses = parser.extractAddresses(addressObj);

      expect(addresses).toHaveLength(1);
      expect(addresses[0].email).toBe('valid@example.com');
    });
  });

  describe('extractAttachmentMetadata', () => {
    it('should extract attachment metadata', () => {
      const message: Partial<ParsedMail> = {
        attachments: [
          {
            filename: 'document.pdf',
            contentType: 'application/pdf',
            size: 102400,
            contentId: 'abc123',
            contentDisposition: 'attachment',
          },
        ],
      } as any;

      const attachments = parser.extractAttachmentMetadata(
        message as ParsedMail
      );

      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('document.pdf');
      expect(attachments[0].content_type).toBe('application/pdf');
      expect(attachments[0].size_bytes).toBe(102400);
      expect(attachments[0].content_id).toBe('abc123');
      expect(attachments[0].is_inline).toBe(false);
    });

    it('should handle inline attachments', () => {
      const message: Partial<ParsedMail> = {
        attachments: [
          {
            filename: 'image.png',
            contentType: 'image/png',
            size: 5120,
            contentDisposition: 'inline',
          },
        ],
      } as any;

      const attachments = parser.extractAttachmentMetadata(
        message as ParsedMail
      );

      expect(attachments[0].is_inline).toBe(true);
    });

    it('should return empty array if no attachments', () => {
      const message = {
        attachments: [],
      } as unknown as ParsedMail;

      const attachments = parser.extractAttachmentMetadata(message);

      expect(attachments).toEqual([]);
    });
  });

  describe('normalizeAddress', () => {
    it('should normalize email address', () => {
      const address = {
        email: 'Test@EXAMPLE.COM',
        name: 'Test User',
      };

      const normalized = EmailParser.normalizeAddress(address);

      expect(normalized.email).toBe('test@example.com');
      expect(normalized.name).toBe('Test User');
    });
  });

  describe('getUniqueAddresses', () => {
    it('should remove duplicate addresses', () => {
      const addresses = [
        { email: 'test@example.com', name: 'Test 1' },
        { email: 'TEST@EXAMPLE.COM', name: 'Test 2' },
        { email: 'other@example.com', name: 'Other' },
      ];

      const unique = EmailParser.getUniqueAddresses(addresses);

      expect(unique).toHaveLength(2);
      expect(unique[0].email).toBe('test@example.com');
      expect(unique[1].email).toBe('other@example.com');
    });

    it('should preserve first occurrence name', () => {
      const addresses = [
        { email: 'test@example.com', name: 'First Name' },
        { email: 'test@example.com', name: 'Second Name' },
      ];

      const unique = EmailParser.getUniqueAddresses(addresses);

      expect(unique).toHaveLength(1);
      expect(unique[0].name).toBe('First Name');
    });
  });
});
