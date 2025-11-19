/**
 * Microsoft Teams Transcript Connector
 *
 * Fetches meeting transcripts from Microsoft Teams via Graph API.
 * Supports OAuth2 authentication, token management, and rate limiting.
 *
 * Phase 7.2 - Teams/Zoom Transcript Connector & NLP Enhancements
 */

import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';

export interface TeamsAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  scope?: string;
}

export interface TeamsAccessToken {
  accessToken: string;
  expiresAt: Date;
  tokenType: string;
}

export interface TeamsMeetingTranscript {
  id: string;
  meetingId: string;
  organizerId?: string;
  subject?: string;
  startTime?: Date;
  endTime?: Date;
  participants?: Array<{
    name?: string;
    email?: string;
    role?: string;
  }>;
  content: string;
  contentType: 'vtt' | 'text';
}

export interface TeamsTranscriptSearchOptions {
  startDate?: Date;
  endDate?: Date;
  organizerId?: string;
  keywords?: string[];
  maxResults?: number;
}

export interface TeamsTranscriptSearchResult {
  transcripts: TeamsMeetingTranscript[];
  nextPageToken?: string;
  totalCount: number;
}

interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GraphCallRecord {
  id: string;
}

interface GraphCallRecordsResponse {
  value?: GraphCallRecord[];
  '@odata.nextLink'?: string;
}

interface GraphMeetingResponse {
  subject?: string;
  organizer?: {
    emailAddress?: {
      address?: string;
    };
  };
  startDateTime?: string;
  endDateTime?: string;
  participants?: {
    attendees?: Array<{
      identity?: {
        displayName?: string;
        user?: {
          email?: string;
        };
      };
      role?: string;
    }>;
  };
}

interface GraphTranscriptResponse {
  value?: Array<{
    id: string;
  }>;
}

export class TeamsTranscriptConnector {
  private accessToken: TeamsAccessToken | null = null;
  private readonly authConfig: TeamsAuthConfig;
  private readonly rateLimiter: RateLimiter;

  constructor(config: TeamsAuthConfig) {
    this.authConfig = {
      ...config,
      scope: config.scope || 'https://graph.microsoft.com/.default',
    };
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 60,
      requestsPerHour: 2000,
    });
  }

  /**
   * Authenticate and get access token
   */
  async authenticate(): Promise<void> {
    logger.info('Authenticating with Microsoft Graph API');

    const tokenUrl = `https://login.microsoftonline.com/${this.authConfig.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: this.authConfig.clientId,
      client_secret: this.authConfig.clientSecret,
      scope: this.authConfig.scope!,
      grant_type: 'client_credentials',
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as GraphTokenResponse;

      this.accessToken = {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000 - 60000), // 1 min buffer
        tokenType: data.token_type,
      };

      logger.info('Successfully authenticated with Microsoft Graph API', {
        expiresAt: this.accessToken.expiresAt.toISOString(),
      });
    } catch (error: any) {
      logger.error('Failed to authenticate with Microsoft Graph API', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureValidToken(): Promise<string> {
    if (!this.accessToken || new Date() >= this.accessToken.expiresAt) {
      await this.authenticate();
    }
    return this.accessToken!.accessToken;
  }

  /**
   * Search for meeting transcripts
   */
  async searchTranscripts(
    options: TeamsTranscriptSearchOptions = {}
  ): Promise<TeamsTranscriptSearchResult> {
    await this.rateLimiter.waitForSlot();

    const token = await this.ensureValidToken();
    const maxResults = options.maxResults || 50;

    logger.info('Searching for Teams meeting transcripts', {
      startDate: options.startDate?.toISOString(),
      endDate: options.endDate?.toISOString(),
      maxResults,
    });

    try {
      // Build filter query
      const filters: string[] = [];

      if (options.startDate) {
        filters.push(`start/dateTime ge '${options.startDate.toISOString()}'`);
      }
      if (options.endDate) {
        filters.push(`start/dateTime le '${options.endDate.toISOString()}'`);
      }
      if (options.organizerId) {
        filters.push(`organizer/emailAddress/address eq '${options.organizerId}'`);
      }

      const filterParam = filters.length > 0 ? `&$filter=${filters.join(' and ')}` : '';

      // First, get meetings (callRecords)
      const url = `https://graph.microsoft.com/v1.0/communications/callRecords?$top=${maxResults}${filterParam}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to search transcripts: ${response.status}`);
      }

      const data = (await response.json()) as GraphCallRecordsResponse;
      const transcripts: TeamsMeetingTranscript[] = [];

      // For each meeting, fetch its transcript if available
      for (const meeting of data.value || []) {
        try {
          const transcript = await this.fetchMeetingTranscript(meeting.id);
          if (transcript) {
            transcripts.push(transcript);
          }
        } catch (error: any) {
          logger.warn('Failed to fetch transcript for meeting', {
            meetingId: meeting.id,
            error: error.message,
          });
        }
      }

      return {
        transcripts,
        nextPageToken: data['@odata.nextLink'] ? 'next' : undefined,
        totalCount: transcripts.length,
      };
    } catch (error: any) {
      logger.error('Failed to search Teams transcripts', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch transcript for a specific meeting
   */
  async fetchMeetingTranscript(meetingId: string): Promise<TeamsMeetingTranscript | null> {
    await this.rateLimiter.waitForSlot();

    const token = await this.ensureValidToken();

    try {
      // Get meeting details
      const meetingUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}`;
      const meetingResponse = await fetch(meetingUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!meetingResponse.ok) {
        logger.debug('Meeting not found or not accessible', { meetingId });
        return null;
      }

      const meetingData = (await meetingResponse.json()) as GraphMeetingResponse;

      // Get meeting transcript
      const transcriptUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}/transcripts`;
      const transcriptResponse = await fetch(transcriptUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!transcriptResponse.ok) {
        logger.debug('Transcript not available for meeting', { meetingId });
        return null;
      }

      const transcriptData = (await transcriptResponse.json()) as GraphTranscriptResponse;

      if (!transcriptData.value || transcriptData.value.length === 0) {
        return null;
      }

      // Get the first transcript (typically there's only one)
      const transcriptId = transcriptData.value[0].id;

      // Download transcript content
      const contentUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`;
      const contentResponse = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!contentResponse.ok) {
        throw new Error(`Failed to download transcript content: ${contentResponse.status}`);
      }

      const content = await contentResponse.text();

      return {
        id: transcriptId,
        meetingId,
        organizerId: meetingData.organizer?.emailAddress?.address,
        subject: meetingData.subject,
        startTime: meetingData.startDateTime ? new Date(meetingData.startDateTime) : undefined,
        endTime: meetingData.endDateTime ? new Date(meetingData.endDateTime) : undefined,
        participants: meetingData.participants?.attendees?.map((attendee: any) => ({
          name: attendee.identity?.displayName,
          email: attendee.identity?.user?.email,
          role: attendee.role,
        })),
        content,
        contentType: content.includes('WEBVTT') ? 'vtt' : 'text',
      };
    } catch (error: any) {
      logger.error('Failed to fetch meeting transcript', {
        meetingId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Download transcript content to file
   */
  async downloadTranscript(
    transcript: TeamsMeetingTranscript,
    outputPath: string
  ): Promise<string> {
    const fileName = `teams-${transcript.meetingId}-${transcript.id}.${transcript.contentType === 'vtt' ? 'vtt' : 'txt'}`;
    const filePath = path.join(outputPath, fileName);

    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(filePath, transcript.content, 'utf-8');

    logger.info('Downloaded Teams transcript', {
      meetingId: transcript.meetingId,
      filePath,
      size: transcript.content.length,
    });

    return filePath;
  }

  /**
   * Validate credentials
   */
  async validateCredentials(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Simple rate limiter
 */
class RateLimiter {
  private requestTimestamps: number[] = [];
  private readonly requestsPerMinute: number;
  private readonly requestsPerHour: number;

  constructor(config: { requestsPerMinute: number; requestsPerHour: number }) {
    this.requestsPerMinute = config.requestsPerMinute;
    this.requestsPerHour = config.requestsPerHour;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    // Clean up old timestamps
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > oneHourAgo);

    const recentMinute = this.requestTimestamps.filter((ts) => ts > oneMinuteAgo).length;
    const recentHour = this.requestTimestamps.length;

    // Wait if we've hit rate limits
    if (recentMinute >= this.requestsPerMinute) {
      const oldestInMinute = Math.min(...this.requestTimestamps.filter((ts) => ts > oneMinuteAgo));
      const waitTime = oldestInMinute + 60000 - now + 100; // Add 100ms buffer
      if (waitTime > 0) {
        logger.debug('Rate limit: waiting for minute slot', { waitMs: waitTime });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    if (recentHour >= this.requestsPerHour) {
      const oldestInHour = Math.min(...this.requestTimestamps);
      const waitTime = oldestInHour + 3600000 - now + 100;
      if (waitTime > 0) {
        logger.debug('Rate limit: waiting for hour slot', { waitMs: waitTime });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    this.requestTimestamps.push(Date.now());
  }
}

export default TeamsTranscriptConnector;
