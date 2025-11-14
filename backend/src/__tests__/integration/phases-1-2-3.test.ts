/**
 * Integration Tests - Phases 1, 2, and 3
 * End-to-end testing of the email processing pipeline
 */

import { EmailParser } from '../../parsing/EmailParser';
import { CleaningPipeline } from '../../cleaning/CleaningPipeline';
import { MboxSplitter } from '../../ingestion/MboxSplitter';
import { simpleParser } from 'mailparser';

describe('Phase 1+2+3 Integration Tests', () => {
  let emailParser: EmailParser;
  let cleaningPipeline: CleaningPipeline;

  beforeAll(() => {
    emailParser = new EmailParser();
    cleaningPipeline = new CleaningPipeline();
  });

  describe('End-to-End Email Processing', () => {
    it('should process a complete email through parsing and cleaning', async () => {
      // Test email with quotes, signature, and business content
      const testEmail = `From: john.doe@example.com
To: jane.smith@company.com
Subject: Deal Registration - Acme Corp
Date: Mon, 15 Jan 2024 10:00:00 -0800
Message-ID: <test-message-id@example.com>
Content-Type: text/plain; charset=utf-8

Hi Jane,

I'd like to register a new deal for Acme Corporation    with the following details:

Deal Size: $50,000
Expected Close Date: Q2 2024

Thanks!!!!!

On Mon, Jan 15, 2024 at 9:00 AM Support <support@example.com> wrote:
> Thanks for reaching out.
> We'll process this shortly.
>
> Best,
> Support Team

--
John Doe
Senior Account Executive
Example Corp
john.doe@example.com | (555) 123-4567

This email is confidential and intended for the recipient only.`;

      // Phase 2: Parse the email
      const parsedMail = await simpleParser(testEmail);
      const parseResult = emailParser.parse(parsedMail);

      expect(parseResult).toBeDefined();
      expect(parseResult.from?.email).toBe('john.doe@example.com');
      expect(parseResult.to.length).toBeGreaterThan(0);
      expect(parseResult.subject).toBe('Deal Registration - Acme Corp');
      expect(parseResult.body_text).toBeTruthy();

      // Phase 3: Clean the email body
      const cleanResult = cleaningPipeline.clean(parseResult.body_text || '');

      expect(cleanResult).toBeDefined();
      expect(cleanResult.cleaned_body).toContain('Acme Corporation');
      expect(cleanResult.cleaned_body).toContain('Deal Size: $50,000');
      expect(cleanResult.signature).toBeDefined();
      expect(cleanResult.had_quoted_replies).toBe(true);
      expect(cleanResult.had_signature).toBe(true);
      expect(cleanResult.has_minimum_content).toBe(true);

      // Verify whitespace normalization
      expect(cleanResult.cleaned_body).not.toContain('    ');
      expect(cleanResult.cleaned_body).not.toContain('!!!!!');

      // Verify the cleaned content is shorter than original
      expect(cleanResult.cleaned_length).toBeLessThan(cleanResult.original_length);
    });

    it('should extract structured data and clean business email', async () => {
      const dealEmail = `From: sales@partner.com
To: deals@company.com
Subject: New Deal - TechStart Inc
Date: Tue, 16 Jan 2024 14:30:00 -0800
Message-ID: <deal-message@partner.com>

Hello,

I would like to register a new opportunity:

Company: TechStart Inc
Contact: Sarah Johnson
Email: sarah@techstart.com
Deal Value: $75,000
Product: Enterprise License

Best regards,
Mike

--
Mike Wilson
Partner Manager
mike@partner.com`;

      const parsedMail = await simpleParser(dealEmail);
      const parseResult = emailParser.parse(parsedMail);
      const cleanResult = cleaningPipeline.clean(parseResult.body_text || '');

      // Verify parsing
      expect(parseResult.from?.email).toBe('sales@partner.com');
      expect(parseResult.subject).toContain('TechStart Inc');

      // Verify cleaning preserved business data
      expect(cleanResult.cleaned_body).toContain('TechStart Inc');
      expect(cleanResult.cleaned_body).toContain('Sarah Johnson');
      expect(cleanResult.cleaned_body).toContain('$75,000');
      expect(cleanResult.signature?.email).toBe('mike@partner.com');
    });

    it('should process batch of emails efficiently', async () => {
      const emailBodies = [
        'Simple email 1 without quotes or signatures.',
        'Email 2 with content.\n\n--\nSig Here\ntest@example.com',
        'Email 3.\n\n> Quoted content here',
      ];

      const cleanResults = cleaningPipeline.cleanBatch(emailBodies);

      expect(cleanResults).toHaveLength(3);
      expect(cleanResults[0].has_minimum_content).toBe(true);
      expect(cleanResults[1].had_signature).toBe(true);
      expect(cleanResults[2].had_quoted_replies).toBe(true);

      const stats = cleaningPipeline.getBatchStatistics(cleanResults);
      expect(stats.total_messages).toBe(3);
      expect(stats.messages_with_signatures).toBe(1);
      expect(stats.messages_with_quotes).toBe(1);
    });

    it('should preserve important business data through pipeline', async () => {
      const businessEmail = `From: partner@reseller.com
To: channel@vendor.com
Subject: Q1 Deal Registration
Date: Thu, 18 Jan 2024 11:00:00 -0800
Message-ID: <business@reseller.com>

Please register:

Account: Global Tech Solutions
Opportunity ID: OPP-2024-001
ARR: $125,000
Products:
- Enterprise Platform (50 licenses)
- Premium Support
- Training Services

Timeline: Close by March 31, 2024

Thanks,
Alex

--
Alex Chen
Channel Sales
alex.chen@reseller.com
Phone: +1 (555) 987-6543`;

      const parsedMail = await simpleParser(businessEmail);
      const parseResult = emailParser.parse(parsedMail);
      const cleanResult = cleaningPipeline.clean(parseResult.body_text || '');

      // Verify all key business data is preserved
      expect(cleanResult.cleaned_body).toContain('Global Tech Solutions');
      expect(cleanResult.cleaned_body).toContain('OPP-2024-001');
      expect(cleanResult.cleaned_body).toContain('$125,000');
      expect(cleanResult.cleaned_body).toContain('Enterprise Platform');
      expect(cleanResult.cleaned_body).toContain('50 licenses');
      expect(cleanResult.cleaned_body).toContain('March 31, 2024');

      // Verify signature extracted
      expect(cleanResult.signature?.email).toBe('alex.chen@reseller.com');
      expect(cleanResult.signature?.phone).toBeTruthy();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle emails with only whitespace', async () => {
      const whitespaceEmail = `From: test@example.com
Message-ID: <whitespace@test.com>



\t\t
`;

      const parsedMail = await simpleParser(whitespaceEmail);
      const parseResult = emailParser.parse(parsedMail);
      const cleanResult = cleaningPipeline.clean(parseResult.body_text || '');

      expect(cleanResult.cleaned_body.trim()).toBe('');
      expect(cleanResult.has_minimum_content).toBe(false);
    });

    it('should handle very long email content efficiently', async () => {
      const longBody = 'This is important content. '.repeat(1000);
      const longQuotes = '> Quoted line\n'.repeat(500);
      const longEmail = `From: test@example.com
Message-ID: <long@test.com>

${longBody}

${longQuotes}

--
Signature`;

      const parsedMail = await simpleParser(longEmail);
      const parseResult = emailParser.parse(parsedMail);
      const startTime = Date.now();
      const cleanResult = cleaningPipeline.clean(parseResult.body_text || '');
      const endTime = Date.now();

      expect(cleanResult).toBeDefined();
      expect(endTime - startTime).toBeLessThan(2000); // Should process in under 2 seconds
      expect(cleanResult.had_quoted_replies).toBe(true);
      expect(cleanResult.had_signature).toBe(true);
    });

    it('should handle Unicode and special characters', async () => {
      const unicodeEmail = `From: test@example.com
Subject: Unicode Test
Message-ID: <unicode@test.com>

Hello 世界! Testing special chars: €£¥

café, naïve, résumé

--
Sender`;

      const parsedMail = await simpleParser(unicodeEmail);
      const parseResult = emailParser.parse(parsedMail);
      const cleanResult = cleaningPipeline.clean(parseResult.body_text || '');

      expect(cleanResult.cleaned_body).toContain('世界');
      expect(cleanResult.cleaned_body).toContain('café');
      expect(cleanResult.has_minimum_content).toBe(true);
    });
  });

  describe('Phase 1: Ingestion - Mbox Splitting', () => {
    it.skip('should handle mbox message splitting', async () => {
      const mboxSplitter = new MboxSplitter();

      // Simple mbox with 2 messages
      const mboxContent = `From sender@example.com Mon Jan 15 10:00:00 2024
From: sender@example.com
To: recipient@example.com
Subject: First Message

Body of first message

From sender2@example.com Mon Jan 15 11:00:00 2024
From: sender2@example.com
To: recipient@example.com
Subject: Second Message

Body of second message
`;

      const result = await mboxSplitter.split_mbox(mboxContent);

      expect(result).toBeDefined();
      expect(result.chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Configuration and Options', () => {
    it('should respect cleaning pipeline configuration options', () => {
      const testBody = `Content here

> Quoted text

--
Signature
email@example.com`;

      // Test with quote removal disabled
      const pipelineNoQuotes = new CleaningPipeline({ remove_quoted_replies: false });
      const resultNoQuotes = pipelineNoQuotes.clean(testBody);

      expect(resultNoQuotes.cleaned_body).toContain('> Quoted text');

      // Test with signature extraction disabled
      const pipelineNoSig = new CleaningPipeline({ extract_signatures: false });
      const resultNoSig = pipelineNoSig.clean(testBody);

      expect(resultNoSig.signature).toBeUndefined();
      expect(resultNoSig.had_signature).toBe(false);
    });

    it('should allow runtime option updates', () => {
      const pipeline = new CleaningPipeline({ min_content_length: 10 });

      expect(pipeline.getOptions().min_content_length).toBe(10);

      pipeline.updateOptions({ min_content_length: 50 });

      expect(pipeline.getOptions().min_content_length).toBe(50);

      const shortText = 'Short content';
      const result = pipeline.clean(shortText);

      expect(result.has_minimum_content).toBe(false);
    });
  });
});
