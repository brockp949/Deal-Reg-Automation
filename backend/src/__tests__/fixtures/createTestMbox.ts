/**
 * Test Fixture Generator for MBOX files
 * Creates sample MBOX files for Phase 1 testing
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TestEmailOptions {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  date?: Date;
  labels?: string[];
  messageId?: string;
}

export function createTestEmail(options: TestEmailOptions = {}): string {
  const {
    from = 'sender@example.com',
    to = 'recipient@example.com',
    subject = 'Test Email',
    body = 'This is a test email body.',
    date = new Date('2024-01-15T10:00:00Z'),
    labels = ['INBOX'],
    messageId = `<${Date.now()}@example.com>`,
  } = options;

  const emailLines = [
    `From sender@example.com ${date.toUTCString()}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    `X-Gmail-Labels: ${labels.join(',')}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
    ``,
  ];

  return emailLines.join('\n');
}

export function createTestMbox(emails: string[]): string {
  return emails.join('\n\n');
}

export function createSampleMbox(messageCount: number = 10): string {
  const emails: string[] = [];

  for (let i = 0; i < messageCount; i++) {
    const email = createTestEmail({
      from: `sender${i}@example.com`,
      to: `recipient${i}@example.com`,
      subject: `Test Email ${i + 1}`,
      body: `This is test email number ${i + 1}.\n\nIt contains some sample content for testing purposes.`,
      date: new Date(Date.UTC(2024, 0, 1 + i, 10, 0, 0)),
      labels: i % 2 === 0 ? ['SENT', 'IMPORTANT'] : ['INBOX'],
      messageId: `<test-${i}-${Date.now()}@example.com>`,
    });

    emails.push(email);
  }

  return createTestMbox(emails);
}

export function createDealRegistrationMbox(): string {
  const emails = [
    // Deal registration confirmation
    createTestEmail({
      from: 'partner-portal@vendor.com',
      to: 'sales@company.com',
      subject: 'Deal Registration Confirmed - Acme Corp',
      body: `Dear Partner,

Your deal registration has been confirmed.

Deal Details:
- Customer: Acme Corporation
- Opportunity: Cloud Migration Project
- Estimated Value: USD 250,000
- Registration ID: DR-2024-001234
- Partner: TechSolutions Inc.

This registration is valid for 90 days.

Best regards,
Vendor Partner Team`,
      date: new Date('2024-01-15T09:00:00Z'),
      labels: ['SENT', 'IMPORTANT'],
      messageId: '<deal-reg-001@vendor.com>',
    }),

    // RFP notification
    createTestEmail({
      from: 'procurement@acmecorp.com',
      to: 'sales@company.com',
      subject: 'RFP: Cloud Infrastructure Modernization',
      body: `Hello,

We are issuing an RFP for our cloud infrastructure modernization project.

Project Details:
- Budget: $200,000 - $300,000
- Timeline: Q2 2024
- RFP Number: RFP-2024-0567

Please submit your proposal by February 15, 2024.

Contact: Jane Smith (jane.smith@acmecorp.com)

Regards,
Acme Corp Procurement`,
      date: new Date('2024-01-16T14:30:00Z'),
      labels: ['INBOX', 'IMPORTANT'],
      messageId: '<rfp-001@acmecorp.com>',
    }),

    // Spam email
    createTestEmail({
      from: 'marketing@promotions.com',
      to: 'sales@company.com',
      subject: 'Amazing Deals! Buy Now!',
      body: `Get 50% off on all products!

Limited time offer. Click here to shop now!`,
      date: new Date('2024-01-17T08:00:00Z'),
      labels: ['CATEGORY_PROMOTIONS', 'SPAM'],
      messageId: '<spam-001@promotions.com>',
    }),

    // Contract signed notification
    createTestEmail({
      from: 'legal@globaltech.com',
      to: 'sales@company.com',
      subject: 'Contract Executed - GlobalTech Partnership',
      body: `The partnership agreement has been signed.

Contract Details:
- Contract Number: CT-2024-789
- Customer: GlobalTech Solutions
- Contract Value: $500,000
- Term: 3 years
- Effective Date: January 20, 2024

All parties have signed. Countersigned copy attached.

Best regards,
GlobalTech Legal Team`,
      date: new Date('2024-01-20T16:45:00Z'),
      labels: ['SENT', 'IMPORTANT', 'STARRED'],
      messageId: '<contract-001@globaltech.com>',
    }),

    // Follow-up email
    createTestEmail({
      from: 'jane.smith@acmecorp.com',
      to: 'sales@company.com',
      subject: 'Re: RFP: Cloud Infrastructure Modernization',
      body: `Hi,

Just following up on the RFP we sent last week. Do you have any questions?

The deadline is approaching soon.

Thanks,
Jane`,
      date: new Date('2024-01-25T11:00:00Z'),
      labels: ['INBOX'],
      messageId: '<rfp-followup-001@acmecorp.com>',
    }),
  ];

  return createTestMbox(emails);
}

export function writeMboxToFile(mboxContent: string, filePath: string): void {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, mboxContent, 'utf-8');
}

// Create test fixtures if run directly
if (require.main === module) {
  const fixturesDir = path.join(__dirname, '../fixtures');

  // Small test file (10 messages)
  const small = createSampleMbox(10);
  writeMboxToFile(small, path.join(fixturesDir, 'sample_10.mbox'));
  console.log('Created sample_10.mbox');

  // Medium test file (100 messages)
  const medium = createSampleMbox(100);
  writeMboxToFile(medium, path.join(fixturesDir, 'sample_100.mbox'));
  console.log('Created sample_100.mbox');

  // Deal registration test file
  const deals = createDealRegistrationMbox();
  writeMboxToFile(deals, path.join(fixturesDir, 'deal_registration.mbox'));
  console.log('Created deal_registration.mbox');

  console.log('Test fixtures created successfully!');
}
