import { NotificationDeliveryService } from '../../insights/NotificationDeliveryService';
import { OpportunityNotification } from '../../insights/OpportunityNotificationService';
import { config } from '../../config';

// Mock global fetch
global.fetch = jest.fn();

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-123' }),
  })),
}));

describe('NotificationDeliveryService', () => {
  let service: NotificationDeliveryService;
  let mockNotification: OpportunityNotification;

  beforeEach(() => {
    service = new NotificationDeliveryService();
    mockNotification = {
      opportunity_id: 'opp-test-001',
      severity: 'critical',
      message: 'Test notification',
      channels: ['slack'],
      payload: {
        text: 'Test notification',
        attachments: [
          {
            title: 'Opportunity opp-test-001',
            color: '#ff4d4f',
            fields: [
              { title: 'Win Probability', value: '0.15', short: true },
              { title: 'Momentum', value: '0.3', short: true },
            ],
          },
        ],
      },
    };

    // Reset fetch mock
    (global.fetch as jest.Mock).mockReset();

    // Reset config for tests
    process.env.NOTIFICATION_DRY_RUN = 'false';
    process.env.NOTIFICATION_ENABLED = 'true';
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    process.env.NOTIFICATION_RETRY_ATTEMPTS = '3';
    process.env.NOTIFICATION_RETRY_DELAY_MS = '100';
    process.env.NOTIFICATION_THROTTLE_WINDOW_MS = '5000';
    process.env.NOTIFICATION_MAX_PER_WINDOW = '5';
  });

  describe('Dry Run Mode', () => {
    it('should log notifications without delivering in dry-run mode', async () => {
      process.env.NOTIFICATION_DRY_RUN = 'true';
      service = new NotificationDeliveryService();

      const results = await service.deliver(mockNotification);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].channel).toBe('slack');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Slack Delivery', () => {
    beforeEach(() => {
      process.env.NOTIFICATION_DRY_RUN = 'false';
    });

    it('should deliver to Slack successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const results = await service.deliver(mockNotification);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].channel).toBe('slack');
      expect(results[0].attemptCount).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mockNotification.payload),
        })
      );
    });

    it('should retry on failure and succeed', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

      const results = await service.deliver(mockNotification);

      expect(results[0].success).toBe(true);
      expect(results[0].attemptCount).toBe(3);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should fail after all retries exhausted', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const results = await service.deliver(mockNotification);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Network error');
      expect(results[0].attemptCount).toBe(3);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle non-ok HTTP responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const results = await service.deliver(mockNotification);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Slack API error: 500');
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should return error if webhook URL not configured', async () => {
      process.env.SLACK_WEBHOOK_URL = '';
      service = new NotificationDeliveryService();

      const results = await service.deliver(mockNotification);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Slack webhook URL not configured');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Email Delivery', () => {
    beforeEach(() => {
      process.env.NOTIFICATION_DRY_RUN = 'false';
      process.env.NOTIFICATION_EMAIL_RECIPIENTS = 'test@example.com,ops@example.com';
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASSWORD = 'password';
      mockNotification.channels = ['email'];
    });

    it('should deliver email successfully', async () => {
      service = new NotificationDeliveryService();
      const results = await service.deliver(mockNotification);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].channel).toBe('email');
      expect(results[0].attemptCount).toBe(1);
    });

    it('should fail if no recipients configured', async () => {
      process.env.NOTIFICATION_EMAIL_RECIPIENTS = '';
      service = new NotificationDeliveryService();

      const results = await service.deliver(mockNotification);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('No email recipients configured');
    });
  });

  describe('Throttling', () => {
    beforeEach(() => {
      process.env.NOTIFICATION_DRY_RUN = 'false';
      process.env.NOTIFICATION_THROTTLE_WINDOW_MS = '1000';
      process.env.NOTIFICATION_MAX_PER_WINDOW = '2';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });
    });

    it('should allow notifications within throttle limit', async () => {
      service = new NotificationDeliveryService();

      const result1 = await service.deliver(mockNotification);
      const result2 = await service.deliver(mockNotification);

      expect(result1[0].success).toBe(true);
      expect(result2[0].success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throttle notifications exceeding limit', async () => {
      service = new NotificationDeliveryService();

      await service.deliver(mockNotification);
      await service.deliver(mockNotification);
      const result3 = await service.deliver(mockNotification);

      expect(result3[0].success).toBe(false);
      expect(result3[0].error).toContain('Throttled');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should reset throttle after time window', async () => {
      service = new NotificationDeliveryService();

      await service.deliver(mockNotification);
      await service.deliver(mockNotification);

      // Wait for throttle window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result3 = await service.deliver(mockNotification);

      expect(result3[0].success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should track throttle separately per opportunity', async () => {
      service = new NotificationDeliveryService();

      const notification2 = { ...mockNotification, opportunity_id: 'opp-test-002' };

      await service.deliver(mockNotification);
      await service.deliver(mockNotification);

      // Different opportunity should not be throttled
      const result = await service.deliver(notification2);

      expect(result[0].success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Multi-Channel Delivery', () => {
    beforeEach(() => {
      process.env.NOTIFICATION_DRY_RUN = 'false';
      process.env.NOTIFICATION_EMAIL_RECIPIENTS = 'test@example.com';
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASSWORD = 'password';
      mockNotification.channels = ['slack', 'email', 'tasks'];
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });
    });

    it('should deliver to multiple channels', async () => {
      service = new NotificationDeliveryService();
      const results = await service.deliver(mockNotification);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.channel)).toEqual(['slack', 'email', 'tasks']);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should continue delivery if one channel fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Slack error'));
      service = new NotificationDeliveryService();

      const results = await service.deliver(mockNotification);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(false); // Slack failed
      expect(results[1].success).toBe(true); // Email succeeded
      expect(results[2].success).toBe(true); // Tasks succeeded
    });
  });

  describe('Throttle Stats', () => {
    it('should return throttle statistics', async () => {
      process.env.NOTIFICATION_DRY_RUN = 'false';
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
      service = new NotificationDeliveryService();

      await service.deliver(mockNotification);
      await service.deliver({ ...mockNotification, opportunity_id: 'opp-002' });

      const stats = service.getThrottleStats();

      expect(stats).toHaveLength(2);
      expect(stats[0].opportunityId).toBe('opp-test-001');
      expect(stats[0].count).toBe(1);
      expect(stats[1].opportunityId).toBe('opp-002');
      expect(stats[1].count).toBe(1);
    });
  });

  describe('Disabled Notifications', () => {
    it('should skip delivery when notifications disabled', async () => {
      process.env.NOTIFICATION_ENABLED = 'false';
      service = new NotificationDeliveryService();

      const results = await service.deliver(mockNotification);

      expect(results).toHaveLength(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
