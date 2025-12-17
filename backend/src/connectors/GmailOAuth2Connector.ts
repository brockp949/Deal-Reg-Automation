/**
 * GmailOAuth2Connector - Gmail API connector using OAuth2 user tokens
 *
 * Unlike GmailConnector (service account), this uses OAuth2 tokens
 * from user authorization for accessing personal Gmail accounts.
 */

import { gmail_v1, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../db';
import logger from '../utils/logger';
import { RateLimiter, withRetry } from '../utils/apiRetry';
import { getOAuth2AuthManager } from './OAuth2AuthManager';
import { encryptToken, decryptToken } from '../services/tokenEncryption';
import {
  GmailMessagePayload,
  GmailMessageSummary,
  GmailSearchOptions,
} from './types';

// Gmail API quota: 250 quota units/user/second
// Most operations cost 5 units, so limit to ~40 requests/second with burst capacity
const GMAIL_RATE_LIMITER = new RateLimiter({
  requestsPerSecond: 40,
  burstSize: 50,
});

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: string;
  labelListVisibility?: string;
}

export interface GmailOAuth2ConnectorConfig {
  tokenId: string;  // UUID of the google_oauth_tokens record
  rateLimiter?: RateLimiter;
}

/**
 * GmailOAuth2Connector provides Gmail API access using OAuth2 user tokens.
 */
export class GmailOAuth2Connector {
  private tokenId: string;
  private rateLimiter: RateLimiter;
  private gmail?: gmail_v1.Gmail;
  private oauth2Client?: OAuth2Client;
  private tokenExpiry?: Date;

  constructor(config: GmailOAuth2ConnectorConfig) {
    this.tokenId = config.tokenId;
    this.rateLimiter = config.rateLimiter ?? GMAIL_RATE_LIMITER;
  }

  /**
   * Get an authenticated Gmail client
   */
  private async getClient(): Promise<gmail_v1.Gmail> {
    // Check if we need to refresh the client
    if (this.gmail && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.gmail;
    }

    // Fetch token from database
    const result = await query(
      `SELECT access_token, refresh_token, token_expiry, account_email
       FROM google_oauth_tokens
       WHERE id = $1 AND revoked_at IS NULL`,
      [this.tokenId]
    );

    if (result.rows.length === 0) {
      throw new Error('Token not found or has been revoked');
    }

    const { access_token, refresh_token, token_expiry, account_email } = result.rows[0];

    // Decrypt tokens
    const accessToken = decryptToken(access_token);
    const refreshToken = decryptToken(refresh_token);

    // Check if token needs refresh
    const expiryDate = new Date(token_expiry);
    const needsRefresh = expiryDate < new Date(Date.now() + 5 * 60 * 1000); // 5 min buffer

    const authManager = getOAuth2AuthManager();

    if (needsRefresh) {
      logger.info('Refreshing Gmail access token', { tokenId: this.tokenId, email: account_email });

      try {
        const { accessToken: newAccessToken, expiryDate: newExpiry } =
          await authManager.refreshAccessToken('gmail', refreshToken);

        // Update database with new token
        const encryptedNewToken = encryptToken(newAccessToken);
        await query(
          `UPDATE google_oauth_tokens
           SET access_token = $1, token_expiry = $2, updated_at = NOW()
           WHERE id = $3`,
          [encryptedNewToken, new Date(newExpiry), this.tokenId]
        );

        // Create client with new token
        this.oauth2Client = authManager.createAuthenticatedClient(
          'gmail',
          newAccessToken,
          refreshToken,
          newExpiry
        );
        this.tokenExpiry = new Date(newExpiry);
      } catch (error) {
        logger.error('Failed to refresh Gmail token', {
          tokenId: this.tokenId,
          error: (error as Error).message,
        });
        throw new Error('Failed to refresh access token. User may need to re-authorize.');
      }
    } else {
      // Use existing token
      this.oauth2Client = authManager.createAuthenticatedClient(
        'gmail',
        accessToken,
        refreshToken,
        expiryDate.getTime()
      );
      this.tokenExpiry = expiryDate;
    }

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    return this.gmail;
  }

  /**
   * List available Gmail labels
   */
  async listLabels(): Promise<GmailLabel[]> {
    const gmail = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return gmail.users.labels.list({ userId: 'me' });
      })
    );

    if (!response.data.labels) {
      return [];
    }

    return response.data.labels.map((label) => ({
      id: label.id || '',
      name: label.name || '',
      type: label.type === 'system' ? 'system' : 'user',
      messageListVisibility: label.messageListVisibility || undefined,
      labelListVisibility: label.labelListVisibility || undefined,
    }));
  }

  /**
   * Search for messages matching criteria
   */
  async searchMessages(options: Omit<GmailSearchOptions, 'userId'>): Promise<{
    messages: GmailMessageSummary[];
    nextPageToken?: string;
  }> {
    const gmail = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return gmail.users.messages.list({
          userId: 'me',
          q: options.query,
          includeSpamTrash: options.includeSpamTrash ?? false,
          labelIds: options.labelIds,
          maxResults: options.maxResults ?? 50,
          pageToken: options.pageToken ?? undefined,
        });
      })
    );

    const messageSummaries: GmailMessageSummary[] = [];

    if (response.data.messages?.length) {
      for (const message of response.data.messages) {
        if (!message.id) continue;
        const detail = await this.fetchMessageSummary(message.id);
        messageSummaries.push(detail);
      }
    }

    return {
      messages: messageSummaries,
      nextPageToken: response.data.nextPageToken ?? undefined,
    };
  }

  /**
   * Get message count matching criteria (without fetching messages)
   */
  async getMessageCount(options: Omit<GmailSearchOptions, 'userId'>): Promise<number> {
    const gmail = await this.getClient();
    let count = 0;
    let pageToken: string | undefined;

    do {
      const response = await this.rateLimiter.execute(() =>
        withRetry(async () => {
          return gmail.users.messages.list({
            userId: 'me',
            q: options.query,
            includeSpamTrash: options.includeSpamTrash ?? false,
            labelIds: options.labelIds,
            maxResults: 500, // Max allowed
            pageToken,
          });
        })
      );

      count += response.data.messages?.length || 0;
      pageToken = response.data.nextPageToken ?? undefined;

      // Safety limit
      if (count > 10000) break;
    } while (pageToken);

    return count;
  }

  /**
   * Fetch full raw message
   */
  async fetchMessageRaw(messageId: string): Promise<GmailMessagePayload> {
    const gmail = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'raw',
        });
      })
    );

    const raw = response.data.raw
      ? Buffer.from(response.data.raw, 'base64').toString('utf-8')
      : '';
    const summary = await this.fetchMessageSummary(messageId);

    return {
      summary,
      raw,
    };
  }

  /**
   * Fetch message metadata summary
   */
  private async fetchMessageSummary(messageId: string): Promise<GmailMessageSummary> {
    const gmail = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'metadata',
          metadataHeaders: [
            'Subject',
            'From',
            'To',
            'Date',
            'X-GM-THRID',
            'Message-ID',
            'X-Gmail-Labels',
          ],
        });
      })
    );

    const headers: Record<string, string> = {};
    response.data.payload?.headers?.forEach((header) => {
      if (header.name && header.value) {
        headers[header.name.toLowerCase()] = header.value;
      }
    });

    const labelsHeader = headers['x-gmail-labels'];
    const labels = labelsHeader
      ? labelsHeader
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
      : undefined;

    return {
      id: messageId,
      threadId: response.data.threadId || '',
      historyId: response.data.historyId || undefined,
      internalDate: response.data.internalDate || undefined,
      snippet: response.data.snippet || undefined,
      headers,
      labelIds: response.data.labelIds || undefined,
      labels,
    };
  }

  /**
   * Get the account email associated with this connector
   */
  async getAccountEmail(): Promise<string> {
    const result = await query(
      `SELECT account_email FROM google_oauth_tokens WHERE id = $1`,
      [this.tokenId]
    );

    if (result.rows.length === 0) {
      throw new Error('Token not found');
    }

    return result.rows[0].account_email;
  }
}

export default GmailOAuth2Connector;
