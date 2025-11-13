/**
 * Unit Tests for SignatureExtractor - Phase 3
 */

import { SignatureExtractor } from '../../cleaning/SignatureExtractor';

describe('SignatureExtractor', () => {
  let extractor: SignatureExtractor;

  beforeEach(() => {
    extractor = new SignatureExtractor();
  });

  describe('extractSignature', () => {
    it('should extract signature with RFC delimiter', () => {
      const text = `This is the email body.

--
John Doe
Senior Engineer
Tech Corp
john.doe@example.com
+1-555-0123`;

      const { body, signature } = extractor.extractSignature(text);

      expect(body).toContain('This is the email body.');
      expect(body).not.toContain('John Doe');
      expect(signature).toBeDefined();
      expect(signature?.name).toBe('John Doe');
      expect(signature?.title).toBe('Senior Engineer');
      expect(signature?.company).toBe('Tech Corp');
      expect(signature?.email).toBe('john.doe@example.com');
      expect(signature?.phone).toContain('555-0123');
    });

    it('should extract signature with closing pattern', () => {
      const text = `Thanks for your help!

Best regards,
Jane Smith
Marketing Manager
Solutions Inc.`;

      const { body, signature } = extractor.extractSignature(text);

      expect(body).toContain('Thanks for your help!');
      expect(signature).toBeDefined();
      expect(signature?.name).toBe('Jane Smith');
      expect(signature?.title).toBe('Marketing Manager');
      expect(signature?.company).toBe('Solutions Inc.');
    });

    it('should extract signature detected by contact info', () => {
      const text = `Please review the attached document.

Alice Johnson
alice@company.com
(555) 123-4567`;

      const { body, signature } = extractor.extractSignature(text);

      expect(body).toContain('Please review');
      expect(signature).toBeDefined();
      expect(signature?.email).toBe('alice@company.com');
      expect(signature?.phone).toContain('555');
    });

    it('should return null for text with no signature', () => {
      const text = 'Just a simple message with no signature.';

      const { body, signature } = extractor.extractSignature(text);

      expect(body).toBe(text);
      expect(signature).toBeNull();
    });

    it('should handle empty text', () => {
      const { body, signature } = extractor.extractSignature('');

      expect(body).toBe('');
      expect(signature).toBeNull();
    });

    it('should extract signature with disclaimer', () => {
      const text = `Message content here.

--
Bob Wilson
bob@example.com

CONFIDENTIALITY NOTICE: This email and any attachments are confidential.
If you are not the intended recipient, please delete this message.`;

      const { body, signature } = extractor.extractSignature(text);

      expect(signature).toBeDefined();
      expect(signature?.disclaimer).toBeDefined();
      expect(signature?.disclaimer).toContain('CONFIDENTIALITY NOTICE');
    });
  });

  describe('parseSignature', () => {
    it('should parse complete signature', () => {
      const sigText = `John Doe
Senior Software Engineer
Tech Solutions Inc.
john.doe@techsolutions.com
+1 (555) 123-4567`;

      const signature = extractor.parseSignature(sigText);

      expect(signature.name).toBe('John Doe');
      expect(signature.title).toContain('Engineer');
      expect(signature.company).toContain('Solutions Inc.');
      expect(signature.email).toBe('john.doe@techsolutions.com');
      expect(signature.phone).toContain('555');
    });

    it('should parse signature with only email', () => {
      const sigText = 'contact@example.com';

      const signature = extractor.parseSignature(sigText);

      expect(signature.email).toBe('contact@example.com');
      expect(signature.name).toBeUndefined();
    });

    it('should parse signature with closing', () => {
      const sigText = `Best regards,
Alice Smith
VP of Sales`;

      const signature = extractor.parseSignature(sigText);

      expect(signature.name).toBe('Alice Smith');
      expect(signature.title).toContain('VP');
    });

    it('should handle signature with disclaimer', () => {
      const sigText = `John Doe
john@example.com

This email is confidential and intended for the recipient only.`;

      const signature = extractor.parseSignature(sigText);

      expect(signature.email).toBe('john@example.com');
      expect(signature.disclaimer).toBeDefined();
      expect(signature.disclaimer).toContain('confidential');
    });
  });

  describe('detectSignatureBoundary', () => {
    it('should detect RFC delimiter with high confidence', () => {
      const text = `Email body

--
Signature`;

      const boundary = extractor.detectSignatureBoundary(text);

      expect(boundary).toBeDefined();
      expect(boundary?.confidence).toBe(1.0);
      expect(boundary?.marker_type).toBe('delimiter');
    });

    it('should detect pattern-based signature', () => {
      const text = `Email body

Best regards,
John Doe`;

      const boundary = extractor.detectSignatureBoundary(text);

      expect(boundary).toBeDefined();
      expect(boundary?.confidence).toBeGreaterThan(0);
      expect(boundary?.marker_type).toBe('pattern');
    });

    it('should detect signature by contact info heuristic', () => {
      const text = `Email body here.

Some text
john@example.com
(555) 123-4567`;

      const boundary = extractor.detectSignatureBoundary(text);

      expect(boundary).toBeDefined();
      expect(boundary?.marker_type).toBe('heuristic');
    });

    it('should return null when no signature found', () => {
      const text = 'Just plain text with no signature markers.';

      const boundary = extractor.detectSignatureBoundary(text);

      expect(boundary).toBeNull();
    });
  });

  describe('hasSignature', () => {
    it('should detect presence of signature', () => {
      const withSig = `Text\n-- \nSignature`;
      const withoutSig = 'No signature here';

      expect(extractor.hasSignature(withSig)).toBe(true);
      expect(extractor.hasSignature(withoutSig)).toBe(false);
    });
  });

  describe('getSignatureConfidence', () => {
    it('should return high confidence for RFC delimiter', () => {
      const text = `Body\n-- \nSignature`;

      const confidence = extractor.getSignatureConfidence(text);

      expect(confidence).toBe(1.0);
    });

    it('should return 0 for text with no signature', () => {
      const text = 'No signature';

      const confidence = extractor.getSignatureConfidence(text);

      expect(confidence).toBe(0);
    });

    it('should return medium confidence for pattern match', () => {
      const text = `Body\n\nBest regards,\nName`;

      const confidence = extractor.getSignatureConfidence(text);

      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThan(1.0);
    });
  });

  describe('edge cases', () => {
    it('should handle mobile signature', () => {
      const text = `Quick reply.

Sent from my iPhone`;

      const { body, signature } = extractor.extractSignature(text);

      expect(body).toContain('Quick reply.');
      expect(signature).toBeDefined();
      expect(signature?.raw_text).toContain('iPhone');
    });

    it('should handle signature with multiple phone numbers', () => {
      const text = `Message

--
John Doe
Office: (555) 123-4567
Mobile: (555) 987-6543`;

      const { signature } = extractor.extractSignature(text);

      expect(signature).toBeDefined();
      expect(signature?.phone).toBeDefined();
    });

    it('should handle signature with social media links', () => {
      const text = `Content

--
Jane Doe
LinkedIn: linkedin.com/in/janedoe
Twitter: @janedoe`;

      const { signature } = extractor.extractSignature(text);

      expect(signature).toBeDefined();
      expect(signature?.raw_text).toContain('LinkedIn');
    });

    it('should handle signature with company suffix variations', () => {
      const text = `Message

Bob Smith
Acme Corporation
bob@acme.com`;

      const { signature } = extractor.extractSignature(text);

      expect(signature).toBeDefined();
      expect(signature?.company).toContain('Corporation');
    });

    it('should not extract email addresses from body as signature', () => {
      const text = `Please contact support@example.com for help.

This is the actual message content.`;

      const { body, signature } = extractor.extractSignature(text);

      // Should not find a signature just because there's an email in the body
      expect(body).toContain('Please contact');
    });

    it('should handle very long signatures', () => {
      const text = `Short message.

--
John Doe
Senior Vice President of Engineering
Global Technology Solutions Inc.
123 Main Street, Suite 500
San Francisco, CA 94105
Phone: +1 (555) 123-4567
Fax: +1 (555) 123-4568
Email: john.doe@example.com
Web: www.example.com

CONFIDENTIALITY NOTICE: This message is intended only for the use of the individual or entity to which it is addressed.`;

      const { body, signature } = extractor.extractSignature(text);

      expect(body).toContain('Short message.');
      expect(signature).toBeDefined();
      expect(signature?.email).toBe('john.doe@example.com');
      expect(signature?.disclaimer).toBeDefined();
    });
  });
});
