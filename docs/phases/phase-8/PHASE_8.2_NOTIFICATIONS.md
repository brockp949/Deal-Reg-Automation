# Phase 8.2 - Workflow Automations & Notifications

**Status**: ✅ Complete
**Completion Date**: 2025-11-18

## Overview

Phase 8.2 delivers a complete notification delivery infrastructure that converts opportunity insights into actionable alerts across multiple channels (Slack, Email, Tasks). The system includes robust error handling, retry logic, throttling, and comprehensive self-tests.

## Features Delivered

### 1. Notification Delivery Service

**Location**: `backend/src/insights/NotificationDeliveryService.ts`

A production-ready delivery service that handles:
- **Multi-channel delivery**: Slack, Email, and Task systems
- **Retry logic**: Configurable retry attempts with exponential backoff
- **Throttling**: Per-opportunity rate limiting to prevent spam
- **Error handling**: Graceful failure handling with detailed logging
- **Dry-run mode**: Test without actual delivery

**Key Methods**:
- `deliver(notification)`: Delivers notification to all configured channels
- `deliverToSlack(notification)`: Slack webhook integration
- `deliverToEmail(notification)`: SMTP/SendGrid email delivery
- `checkThrottle(opportunityId)`: Rate limiting enforcement
- `getThrottleStats()`: Monitor throttling state

### 2. Slack Integration

**Features**:
- Webhook-based delivery (no bot tokens required)
- Rich message formatting with attachments
- Color-coded severity indicators
- Automatic retries on failure
- Detailed structured payloads

**Configuration**:
```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
NOTIFICATION_RETRY_ATTEMPTS=3
NOTIFICATION_RETRY_DELAY_MS=2000
```

**Example Payload**:
```json
{
  "text": "Opportunity opp-123: winProbability=0.15, momentum=0.3, risks=stalled",
  "attachments": [{
    "title": "Opportunity opp-123",
    "color": "#ff4d4f",
    "fields": [
      { "title": "Win Probability", "value": "0.15", "short": true },
      { "title": "Momentum", "value": "0.3", "short": true },
      { "title": "Risks", "value": "stalled, low_engagement", "short": false }
    ]
  }]
}
```

### 3. Email Delivery

**Features**:
- SMTP/SendGrid support via nodemailer
- HTML-formatted emails with severity colors
- Multi-recipient support
- Automatic retries on failure
- Plain-text fallback

**Configuration**:
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-password
EMAIL_FROM=Opportunity Tracker <noreply@dealreg.com>
NOTIFICATION_EMAIL_RECIPIENTS=ops@example.com,sales@example.com
```

**Email Template**:
- Color-coded header by severity (critical=red, warning=orange, info=blue)
- Structured field display (Opportunity ID, Win Probability, Momentum, Risks)
- Professional HTML formatting
- Mobile-responsive design

### 4. Throttling & Rate Limiting

**Purpose**: Prevent notification spam for the same opportunity

**Mechanism**:
- Per-opportunity tracking
- Sliding time window
- Configurable limits
- Automatic cleanup of old throttle records

**Configuration**:
```bash
NOTIFICATION_THROTTLE_WINDOW_MS=300000    # 5 minutes
NOTIFICATION_MAX_PER_WINDOW=10            # Max 10 notifications per opportunity per window
```

**Behavior**:
- First N notifications within window: ✓ Delivered
- Additional notifications within window: ✗ Throttled
- After window expires: ✓ Delivered again

### 5. Error Handling & Retries

**Retry Strategy**:
1. Attempt 1: Immediate delivery
2. Attempt 2: After `NOTIFICATION_RETRY_DELAY_MS` * 1
3. Attempt 3: After `NOTIFICATION_RETRY_DELAY_MS` * 2
4. ... up to `NOTIFICATION_RETRY_ATTEMPTS`

**Error Types Handled**:
- Network timeouts
- HTTP errors (4xx, 5xx)
- SMTP connection failures
- Invalid configurations
- Throttle limit exceeded

**Logging**:
- Each attempt logged with context
- Final success/failure recorded
- Delivery log saved to `uploads/opportunities/notification-delivery-log.json`

### 6. Enhanced Insights Notification Script

**Location**: `backend/src/scripts/insightsNotify.ts`

**Workflow**:
1. Load insights from `uploads/opportunities/insights.json`
2. Generate insights if missing (fallback to opportunities.json)
3. Convert insights to notifications (OpportunityNotificationService)
4. Deliver notifications to all channels (NotificationDeliveryService)
5. Save delivery log and statistics

**Command**:
```bash
npm run insights:notify
```

**Outputs**:
- `uploads/opportunities/notifications.json`: Generated notifications
- `uploads/opportunities/notification-delivery-log.json`: Delivery results
- Console logs: Per-notification delivery status

### 7. Self-Test Tool

**Location**: `backend/src/scripts/notificationSelfTest.ts`

A comprehensive validation tool that tests the entire notification pipeline without requiring production data or live services.

**Command**:
```bash
npm run insights:test
```

**Tests Performed**:
1. **Configuration Validation**
   - Notification system enabled/disabled
   - Slack webhook configured
   - Email SMTP settings
   - Email recipients
   - Throttling config
   - Retry config
   - Dry-run mode status

2. **Insight Generation**
   - Creates test opportunities
   - Generates insights
   - Validates high-risk detection

3. **Notification Generation**
   - Converts insights to notifications
   - Validates severity classification
   - Checks payload structure

4. **Throttling Mechanism**
   - Tests rate limiting
   - Validates sliding window
   - Checks per-opportunity tracking

5. **Delivery Modes**
   - Dry-run validation
   - Live Slack delivery (if enabled)
   - Live email delivery (if enabled)
   - Task system logging

**Example Output**:
```
================================================================================
NOTIFICATION SYSTEM SELF-TEST RESULTS
================================================================================

✓ PASS Notification System Enabled
      Notifications are ENABLED

✓ PASS Slack Webhook URL
      Configured: https://hooks.slack.com/se...

✓ PASS Email Configuration
      Configured: smtp.gmail.com (user@example.com)

✓ PASS Throttling Configuration
      Window: 300000ms, Max: 10 per window

...

================================================================================
SUMMARY: 15/15 tests passed
================================================================================
```

## Configuration Reference

### Environment Variables

```bash
# Enable/disable notifications
NOTIFICATION_ENABLED=false

# Slack integration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Throttling
NOTIFICATION_THROTTLE_WINDOW_MS=300000        # 5 minutes
NOTIFICATION_MAX_PER_WINDOW=10                # Max per window

# Retry logic
NOTIFICATION_RETRY_ATTEMPTS=3
NOTIFICATION_RETRY_DELAY_MS=2000              # 2 seconds

# Email recipients (comma-separated)
NOTIFICATION_EMAIL_RECIPIENTS=ops@example.com,sales@example.com

# Dry-run mode (set to false for live delivery)
NOTIFICATION_DRY_RUN=true

# Email SMTP (reuses existing config)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-password
EMAIL_FROM=Opportunity Tracker <noreply@dealreg.com>
```

## Testing

### Unit Tests

**Location**: `backend/src/__tests__/insights/NotificationDeliveryService.test.ts`

**Coverage**:
- ✓ Dry-run mode (no external calls)
- ✓ Slack delivery success
- ✓ Slack retry on failure
- ✓ Slack failure after retries
- ✓ Slack HTTP error handling
- ✓ Slack missing config
- ✓ Email delivery success
- ✓ Email missing recipients
- ✓ Throttling within limit
- ✓ Throttling exceeding limit
- ✓ Throttle window reset
- ✓ Per-opportunity throttle tracking
- ✓ Multi-channel delivery
- ✓ Partial channel failures
- ✓ Throttle statistics
- ✓ Disabled notifications

**Run Tests**:
```bash
npm test -- NotificationDeliveryService
```

### Integration Tests

**Location**: `backend/src/__tests__/insights/notificationPipeline.integration.test.ts`

**Coverage**:
- ✓ Full pipeline: opportunities → insights → notifications → delivery
- ✓ Multiple critical notifications with throttling
- ✓ Delivery failure handling
- ✓ Dry-run mode end-to-end

**Run Tests**:
```bash
npm test -- notificationPipeline.integration
```

### Self-Test

**Location**: `backend/src/scripts/notificationSelfTest.ts`

Validates configuration, insight generation, notification generation, throttling, and delivery modes.

**Run Self-Test**:
```bash
npm run insights:test
```

## Usage Examples

### Example 1: Generate and Deliver Notifications

```bash
# 1. Score opportunities (generates insights.json)
npm run insights:score

# 2. Generate and deliver notifications
npm run insights:notify
```

**Result**:
- Notifications generated in `uploads/opportunities/notifications.json`
- Delivery log in `uploads/opportunities/notification-delivery-log.json`
- Slack/Email delivered to configured channels

### Example 2: Dry-Run Testing

```bash
# Set dry-run mode
export NOTIFICATION_DRY_RUN=true

# Run notification delivery
npm run insights:notify
```

**Result**:
- Notifications generated
- Delivery simulated (no external calls)
- Logs show what would have been delivered

### Example 3: Configuration Validation

```bash
# Run self-test
npm run insights:test
```

**Result**:
- Validates all configuration
- Tests notification generation
- Tests throttling
- Optionally tests live delivery

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Opportunity Insights Notifications
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci
        working-directory: backend

      - name: Score opportunities
        run: npm run insights:score
        working-directory: backend
        env:
          UPLOAD_DIR: ./uploads

      - name: Deliver notifications
        run: npm run insights:notify
        working-directory: backend
        env:
          NOTIFICATION_ENABLED: true
          NOTIFICATION_DRY_RUN: false
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          NOTIFICATION_EMAIL_RECIPIENTS: ${{ secrets.NOTIFICATION_EMAIL_RECIPIENTS }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
```

## Security Considerations

1. **Webhook URLs**: Store `SLACK_WEBHOOK_URL` in secrets/environment variables
2. **SMTP Credentials**: Never commit `SMTP_USER` or `SMTP_PASSWORD` to git
3. **Throttling**: Prevents accidental spam/DoS
4. **Dry-run Default**: Notifications disabled by default, prevents accidental live delivery
5. **TLS**: Email delivery uses TLS/SSL when SMTP_PORT=465

## Troubleshooting

### Notifications Not Delivering

1. Check `NOTIFICATION_ENABLED=true`
2. Check `NOTIFICATION_DRY_RUN=false`
3. Verify Slack webhook URL is valid
4. Check email SMTP credentials
5. Run self-test: `npm run insights:test`

### Throttling Issues

1. Check `NOTIFICATION_THROTTLE_WINDOW_MS` and `NOTIFICATION_MAX_PER_WINDOW`
2. Review throttle stats with delivery service
3. Increase `MAX_PER_WINDOW` if needed
4. Review `notification-delivery-log.json` for throttle errors

### Delivery Failures

1. Check retry attempts: `NOTIFICATION_RETRY_ATTEMPTS`
2. Review logs for specific error messages
3. Test Slack webhook manually: `curl -X POST -H 'Content-Type: application/json' -d '{"text":"Test"}' <webhook-url>`
4. Test email SMTP: Use a mail testing tool like `swaks`

## Future Enhancements

- Microsoft Teams integration
- SMS notifications (Twilio)
- Jira/Asana task creation
- Notification templates customization
- User preference management (per-user channels)
- Notification history dashboard

## Completion Summary

✅ **All Phase 8.2 Requirements Met**:
1. ✅ Slack webhook integration with retries
2. ✅ Email delivery via nodemailer
3. ✅ Throttling and rate limiting
4. ✅ Error handling and retry logic
5. ✅ Comprehensive tests (unit + integration)
6. ✅ Self-test validation tool
7. ✅ Documentation and examples

**Lines of Code**: ~1,200
**Test Coverage**: 16 unit tests, 4 integration tests, 15 self-test validations
**Configuration Options**: 8 environment variables
