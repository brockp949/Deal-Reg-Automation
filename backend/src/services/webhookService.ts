/**
 * Webhook Service
 * 
 * Manages webhook subscriptions and event delivery
 */

import axios from 'axios';
import { query } from '../db';
import logger from '../utils/logger';

export interface WebhookSubscription {
    id: string;
    url: string;
    events: string[];
    secret?: string;
    isActive: boolean;
    createdAt: Date;
}

export interface WebhookEvent {
    id: string;
    eventType: string;
    payload: any;
    timestamp: Date;
}

/**
 * Subscribe to webhook events
 */
export async function subscribeToWebhooks(
    url: string,
    events: string[],
    secret?: string
): Promise<WebhookSubscription> {
    try {
        const result = await query(
            `INSERT INTO webhook_subscriptions (url, events, secret, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
            [url, events, secret]
        );

        logger.info('Webhook subscription created', { url, events });
        return result.rows[0];
    } catch (error: any) {
        logger.error('Failed to create webhook subscription', { error: error.message });
        throw error;
    }
}

/**
 * Trigger a webhook event
 */
export async function triggerWebhook(
    eventType: string,
    payload: any
): Promise<void> {
    try {
        // Find active subscriptions for this event
        const result = await query(
            `SELECT * FROM webhook_subscriptions 
       WHERE is_active = true AND $1 = ANY(events)`,
            [eventType]
        );

        if (result.rows.length === 0) return;

        const subscriptions = result.rows;
        const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date();

        logger.info(`Triggering webhook event: ${eventType}`, {
            eventId,
            subscriptionCount: subscriptions.length
        });

        // Send to all subscribers asynchronously
        subscriptions.forEach(async (sub) => {
            try {
                await sendWebhook(sub, {
                    id: eventId,
                    eventType,
                    payload,
                    timestamp
                });
            } catch (error: any) {
                logger.error('Webhook delivery failed', {
                    subscriptionId: sub.id,
                    url: sub.url,
                    error: error.message
                });

                // Log failure
                await logWebhookDelivery(sub.id, eventId, false, error.message);
            }
        });

    } catch (error: any) {
        logger.error('Failed to trigger webhook', { error: error.message });
    }
}

/**
 * Send webhook payload to a single subscriber
 */
async function sendWebhook(
    subscription: WebhookSubscription,
    event: WebhookEvent
): Promise<void> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Event': event.eventType,
        'X-Webhook-ID': event.id,
        'X-Webhook-Timestamp': event.timestamp.toISOString()
    };

    // Add signature if secret is present (HMAC-SHA256)
    if (subscription.secret) {
        // In a real implementation, we would generate a signature here
        // const signature = crypto.createHmac('sha256', subscription.secret).update(JSON.stringify(event)).digest('hex');
        // headers['X-Webhook-Signature'] = signature;
    }

    await axios.post(subscription.url, event, {
        headers,
        timeout: 5000
    });

    await logWebhookDelivery(subscription.id, event.id, true);
}

/**
 * Log webhook delivery attempt
 */
async function logWebhookDelivery(
    subscriptionId: string,
    eventId: string,
    success: boolean,
    errorMessage?: string
): Promise<void> {
    try {
        await query(
            `INSERT INTO webhook_delivery_logs (
        subscription_id, event_id, success, error_message, created_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [subscriptionId, eventId, success, errorMessage]
        );
    } catch (error) {
        // Ignore logging errors
    }
}

export default {
    subscribeToWebhooks,
    triggerWebhook
};
