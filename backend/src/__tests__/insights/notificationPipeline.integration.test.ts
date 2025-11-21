import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../../config';
import { OpportunityInsightService } from '../../insights/OpportunityInsightService';
import { OpportunityNotificationService } from '../../insights/OpportunityNotificationService';
import { NotificationDeliveryService } from '../../insights/NotificationDeliveryService';
import { OpportunityRecord } from '../../opportunities/types';

// Mock global fetch
global.fetch = jest.fn();

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-123' }),
  })),
}));

describe('Notification Pipeline Integration', () => {
  const testDir = path.join(config.upload.directory, 'opportunities-test-notifications');

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    process.env.NOTIFICATION_DRY_RUN = 'false';
    process.env.NOTIFICATION_ENABLED = 'true';
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
  });

  it('should process full pipeline: opportunities -> insights -> notifications -> delivery', async () => {
    // Step 1: Create test opportunities
    const opportunities: OpportunityRecord[] = [
      {
        id: 'opp-high-risk',
        name: 'High Risk Deal',
        stage: 'rfq',
        priority: 'low',
        costUpsideNotes: [],
        actors: ['John Doe'],
        nextSteps: [],
        sourceTags: ['email'],
        sourceSummary: [
          {
            parser: 'test-parser',
            fileName: 'email-1',
            sourceType: 'email',
            connector: 'gmail',
            queryName: 'rfq',
            referenceIds: ['email-1'],
          },
        ],
        metadata: {
          vendor: 'VendorA',
          customer: 'CustomerA',
          parser: 'test-parser',
          lastTouched: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
        createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days old (stale)
      },
      {
        id: 'opp-healthy',
        name: 'Healthy Deal',
        stage: 'po_in_progress',
        priority: 'high',
        costUpsideNotes: [],
        actors: ['Jane Smith'],
        nextSteps: [],
        sourceTags: ['email'],
        sourceSummary: [
          {
            parser: 'test-parser',
            fileName: 'email-2',
            sourceType: 'email',
            connector: 'gmail',
            queryName: 'rfq',
            referenceIds: ['email-2'],
          },
        ],
        metadata: {
          vendor: 'VendorB',
          customer: 'CustomerB',
          parser: 'test-parser',
          lastTouched: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days old
      },
    ];

    // Step 2: Generate insights
    const insightService = new OpportunityInsightService();
    const insights = insightService.generate(opportunities);

    expect(insights.insights).toHaveLength(2);
    expect(insights.insights[0].opportunity_id).toBe('opp-high-risk');
    expect(insights.insights[0].winProbability).toBeLessThanOrEqual(0.4); // Should be low
    expect(insights.insights[0].riskFlags).toContain('missing_next_steps');

    // Step 3: Generate notifications
    const notificationService = new OpportunityNotificationService({
      highRiskThreshold: 0.4,
      channels: ['slack'],
    });
    const notifications = notificationService.generate(insights.insights);

    expect(notifications).toHaveLength(1); // Only high-risk opportunity
    expect(notifications[0].opportunity_id).toBe('opp-high-risk');
    expect(notifications[0].severity).toBe('warning');

    // Step 4: Deliver notifications
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    const deliveryService = new NotificationDeliveryService();
    const deliveryResults = await deliveryService.deliver(notifications[0]);

    expect(deliveryResults).toHaveLength(1);
    expect(deliveryResults[0].success).toBe(true);
    expect(deliveryResults[0].channel).toBe('slack');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('opp-high-risk'),
      })
    );
  });

  it('should handle multiple critical notifications with throttling', async () => {
    // Create multiple high-risk opportunities
    const opportunities: OpportunityRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `opp-critical-${i}`,
      name: `Critical Deal ${i}`,
      stage: 'rfq',
      priority: 'low',
      costUpsideNotes: [],
      actors: [],
      nextSteps: [],
      sourceTags: ['email'],
      sourceSummary: [
        {
          parser: 'test-parser',
          fileName: `email-${i}`,
          sourceType: 'email',
          connector: 'gmail',
          queryName: 'rfq',
          referenceIds: [`email-${i}`],
        },
      ],
      metadata: {
        vendor: 'Vendor',
        customer: 'Customer',
        parser: 'test-parser',
        lastTouched: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      },
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(), // Very stale
    }));

    // Generate insights (all should be low probability)
    const insightService = new OpportunityInsightService();
    const insights = insightService.generate(opportunities);

    // All should have low win probability
    expect(insights.insights.every((i) => i.winProbability <= 0.3)).toBe(true);

    // Generate notifications
    const notificationService = new OpportunityNotificationService({
      highRiskThreshold: 0.4,
      channels: ['slack'],
    });
    const notifications = notificationService.generate(insights.insights);

    expect(notifications).toHaveLength(5);

    // Configure tight throttling
    process.env.NOTIFICATION_THROTTLE_WINDOW_MS = '10000';
    process.env.NOTIFICATION_MAX_PER_WINDOW = '2';

    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    const deliveryService = new NotificationDeliveryService();

    // Deliver first 2 (should succeed)
    const result1 = await deliveryService.deliver(notifications[0]);
    const result2 = await deliveryService.deliver(notifications[1]);

    expect(result1[0].success).toBe(true);
    expect(result2[0].success).toBe(true);

    // Third delivery (same opportunity repeated) may be throttled
    const result3 = await deliveryService.deliver(notifications[0]);
    expect(result3).toHaveLength(1);

    // Different opportunity should still work
    const result4 = await deliveryService.deliver(notifications[2]);
    expect(result4[0].success).toBe(true);
  });

  it('should handle delivery failures gracefully', async () => {
    const opportunities: OpportunityRecord[] = [
      {
        id: 'opp-fail-test',
        name: 'Fail Test',
        stage: 'rfq',
        priority: 'low',
        costUpsideNotes: [],
        actors: [],
        nextSteps: [],
        sourceTags: ['email'],
        sourceSummary: [
          {
            parser: 'test-parser',
            fileName: 'email-1',
            sourceType: 'email',
            connector: 'gmail',
            queryName: 'rfq',
            referenceIds: ['email-1'],
          },
        ],
        metadata: {
          vendor: 'Vendor',
          customer: 'Customer',
          parser: 'test-parser',
          lastTouched: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
        },
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const insightService = new OpportunityInsightService();
    const insights = insightService.generate(opportunities);

    const notificationService = new OpportunityNotificationService({
      highRiskThreshold: 0.5,
      channels: ['slack'],
    });
    const notifications = notificationService.generate(insights.insights);

    // Simulate network failure
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network timeout'));

    process.env.NOTIFICATION_RETRY_ATTEMPTS = '2';
    process.env.NOTIFICATION_RETRY_DELAY_MS = '10';

    const deliveryService = new NotificationDeliveryService();
    const results = await deliveryService.deliver(notifications[0]);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Network timeout');
    expect(results[0].attemptCount).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should work in dry-run mode without making external calls', async () => {
    const opportunities: OpportunityRecord[] = [
      {
        id: 'opp-dry-run',
        name: 'Dry Run Test',
        stage: 'rfq',
        priority: 'low',
        costUpsideNotes: [],
        actors: [],
        nextSteps: [],
        sourceTags: ['email'],
        sourceSummary: [
          {
            parser: 'test-parser',
            fileName: 'email-1',
            sourceType: 'email',
            connector: 'gmail',
            queryName: 'rfq',
            referenceIds: ['email-1'],
          },
        ],
        metadata: {
          vendor: 'Vendor',
          customer: 'Customer',
          parser: 'test-parser',
          lastTouched: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString(),
        },
        createdAt: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const insightService = new OpportunityInsightService();
    const insights = insightService.generate(opportunities);

    const notificationService = new OpportunityNotificationService();
    const notifications = notificationService.generate(insights.insights);

    process.env.NOTIFICATION_DRY_RUN = 'true';

    const deliveryService = new NotificationDeliveryService();
    const results = await deliveryService.deliver(notifications[0]);

    expect(results[0].success).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
