import { gmail_v1, google } from 'googleapis';
import { JWT } from 'google-auth-library';
import GoogleAuthManager from './GoogleAuthManager';
import {
  GmailMessagePayload,
  GmailMessageSummary,
  GmailSearchOptions,
} from './types';
import { RateLimiter, withRetry } from '../utils/apiRetry';

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Gmail API quota: 250 quota units/user/second
// Most operations cost 5 units, so limit to ~40 requests/second with burst capacity
const GMAIL_RATE_LIMITER = new RateLimiter({
  requestsPerSecond: 40,
  burstSize: 50,
});

export interface GmailConnectorConfig {
  auth: {
    clientEmail: string;
    privateKey: string;
    impersonatedUser?: string;
  };
  maxResults?: number;
  rateLimiter?: RateLimiter;
}

export class GmailConnector {
  private clientPromise: Promise<JWT> | null = null;
  private gmail?: gmail_v1.Gmail;
  private rateLimiter: RateLimiter;

  constructor(private readonly config: GmailConnectorConfig) {
    this.rateLimiter = config.rateLimiter ?? GMAIL_RATE_LIMITER;
  }

  private async getClient(): Promise<gmail_v1.Gmail> {
    if (!this.clientPromise) {
      const authManager = new GoogleAuthManager(
        {
          clientEmail: this.config.auth.clientEmail,
          privateKey: this.config.auth.privateKey,
          impersonatedUser: this.config.auth.impersonatedUser,
        },
        GMAIL_SCOPES
      );
      this.clientPromise = authManager.authorize();
    }

    if (!this.gmail) {
      const auth = await this.clientPromise;
      this.gmail = google.gmail({ version: 'v1', auth });
    }

    return this.gmail;
  }

  async searchMessages(options: GmailSearchOptions): Promise<{
    messages: GmailMessageSummary[];
    nextPageToken?: string;
  }> {
    const gmail = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return gmail.users.messages.list({
          userId: options.userId,
          q: options.query,
          includeSpamTrash: options.includeSpamTrash ?? false,
          labelIds: options.labelIds,
          maxResults: options.maxResults ?? this.config.maxResults ?? 50,
          pageToken: options.pageToken ?? undefined,
        });
      })
    );

    const messageSummaries: GmailMessageSummary[] = [];

    if (response.data.messages?.length) {
      for (const message of response.data.messages) {
        if (!message.id) continue;
        const detail = await this.fetchMessageSummary(options.userId, message.id);
        messageSummaries.push(detail);
      }
    }

    return {
      messages: messageSummaries,
      nextPageToken: response.data.nextPageToken ?? undefined,
    };
  }

  async fetchMessageRaw(userId: string, messageId: string): Promise<GmailMessagePayload> {
    const gmail = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return gmail.users.messages.get({
          userId,
          id: messageId,
          format: 'raw',
        });
      })
    );

    const raw = response.data.raw ? Buffer.from(response.data.raw, 'base64').toString('utf-8') : '';
    const summary = await this.fetchMessageSummary(userId, messageId);

    return {
      summary,
      raw,
    };
  }

  private async fetchMessageSummary(userId: string, messageId: string): Promise<GmailMessageSummary> {
    const gmail = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return gmail.users.messages.get({
          userId,
          id: messageId,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date', 'X-GM-THRID', 'Message-ID', 'X-Gmail-Labels'],
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
}

export default GmailConnector;
