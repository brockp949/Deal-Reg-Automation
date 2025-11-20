
import { parseEnhancedMboxFile } from '../../parsers/enhancedMboxMain';
import { parseEnhancedTranscript } from '../../parsers/enhancedTranscriptParser';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

describe('Improved Extraction Logic', () => {
    const tempMboxPath = join(__dirname, 'temp_improved.mbox');
    const tempTranscriptPath = join(__dirname, 'temp_improved.txt');

    afterAll(() => {
        try {
            unlinkSync(tempMboxPath);
            unlinkSync(tempTranscriptPath);
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    describe('MBOX Extraction', () => {
        it('should extract next steps and new currencies', async () => {
            const mboxContent = `From sender@example.com Mon, 15 Jan 2024 09:00:00 GMT
From: partner@vendor.com
To: sales@company.com
Subject: Deal Registration - Project Alpha
Date: Mon, 15 Jan 2024 09:00:00 GMT
Message-ID: <deal-001@vendor.com>
Content-Type: text/plain; charset=UTF-8

Hi Team,

This is a new deal registration.
Great progress on the Project Alpha deal.

Deal Value: ¥ 1,500,000
Also seeing interest in INR 50,000 services.

Next Steps:
- Schedule a demo with the CTO
- Send updated pricing proposal
- Review contract terms

Best,
Partner
`;
            writeFileSync(tempMboxPath, mboxContent);

            const result = await parseEnhancedMboxFile(tempMboxPath, { confidenceThreshold: 0.01 });
            const deal = result.extractedDeals[0];

            expect(deal).toBeDefined();
            expect(deal.deal_value).toBeDefined();

            expect(deal.next_steps).toBeDefined();
            expect(deal.next_steps?.length).toBeGreaterThan(0);
            expect(deal.next_steps).toContain('- Schedule a demo with the CTO');
            expect(deal.next_steps).toContain('- Send updated pricing proposal');
        });

        it('should extract deal type and pricing model', async () => {
            const emailContent = `From sender@example.com Mon, 15 Jan 2024 09:00:00 GMT
From: partner@example.com
To: deals@vendor.com
Subject: Deal Registration - Renewal Opportunity
Date: Mon, 15 Jan 2024 09:00:00 GMT
Message-ID: <deal-002@vendor.com>
Content-Type: text/plain; charset=UTF-8

Hi Team,

We have a renewal opportunity for Client Corp.
This is a subscription based deal.
They are looking to renew their existing licenses.

Thanks,
Partner
`;
            writeFileSync(tempMboxPath, emailContent);

            const result = await parseEnhancedMboxFile(tempMboxPath, { confidenceThreshold: 0.01 });
            const deal = result.extractedDeals[0];

            expect(deal).toBeDefined();
            expect(deal?.deal_type).toBe('renewal');
            expect(deal?.pricing_model).toBe('subscription');
        });
    });

    describe('Transcript Extraction', () => {
        it('should extract objections and competitor insights', async () => {
            const transcriptContent = `
[00:01:00] Sales Rep: Hi, thanks for meeting with us.
[00:01:30] Prospect: Thanks. We are looking for a new CRM.
[00:02:00] Sales Rep: Great. What are your requirements?
[00:02:30] Prospect: We need something easy to use.
[00:03:00] Sales Rep: Our solution is very intuitive.
[00:03:30] Prospect: However, price is a concern. It seems very expensive compared to Salesforce Inc.
[00:04:00] Sales Rep: We offer better value.
[00:04:30] Prospect: Salesforce Inc. is cheaper for our team size.
[00:05:00] Sales Rep: But we include more features.
[00:05:30] Prospect: I also need approval from my boss before we can proceed.
[00:06:00] Prospect: What is the price for 100 users?
`;
            writeFileSync(tempTranscriptPath, transcriptContent);

            const result = await parseEnhancedTranscript(tempTranscriptPath, { buyingSignalThreshold: 0.1 });
            const deal = result.deal;

            expect(deal).toBeDefined();

            // Check Objections
            expect(deal?.objections).toBeDefined();
            expect(deal?.objections?.length).toBeGreaterThan(0);
            expect(deal?.objections?.some(o => o.includes('price is a concern'))).toBe(true);
            expect(deal?.objections?.some(o => o.includes('need approval'))).toBe(true);

            // Check Competitor Insights
            expect(deal?.identified_competitors).toContain('Salesforce Inc');
            expect(deal?.competitor_insights).toBeDefined();
            expect(deal?.competitor_insights?.length).toBeGreaterThan(0);
            expect(deal?.competitor_insights?.some(i => i.includes('Salesforce') && i.includes('cheaper'))).toBe(true);
        });
    });
});
