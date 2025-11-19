/**
 * Zoom Transcript Connector
 *
 * Fetches meeting transcripts from Zoom via Zoom API.
 * Supports OAuth2/JWT authentication, token management, and rate limiting.
 *
 * Phase 7.2 - Teams/Zoom Transcript Connector & NLP Enhancements
 */

import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';

export interface ZoomAuthConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
  authType?: 'oauth' | 'server-to-server';
}

export interface ZoomAccessToken {
  accessToken: string;
  expiresAt: Date;
  tokenType: string;
}

export interface ZoomMeetingTranscript {
  id: string;
  meetingId: string;
  meetingUuid: string;
  topic: string;
  startTime: Date;
  duration: number;
  hostId: string;
  hostEmail?: string;
  participantCount?: number;
  content: string;
  vttContent?: string;
}

export interface ZoomTranscriptSearchOptions {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  type?: 'past' | 'upcoming' | 'live';
  pageSize?: number;
  nextPageToken?: string;
}

export interface ZoomTranscriptSearchResult {
  transcripts: ZoomMeetingTranscript[];
  nextPageToken?: string;
  totalRecords: number;
}

interface ZoomTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface ZoomMeetingsResponse {
  meetings?: Array<{ id: number; uuid: string }>;
  next_page_token?: string;
  total_records?: number;
}

interface ZoomRecordingFile {
  id?: string;
  file_type?: string;
  recording_type?: string;
  file_extension?: string;
  download_url: string;
}

interface ZoomMeetingRecordingResponse {
  id: number | string;
  topic: string;
  start_time: string;
  duration: number;
  host_id: string;
  host_email?: string;
  participant_count?: number;
  recording_files?: ZoomRecordingFile[];
}

export class ZoomTranscriptConnector {
  private accessToken: ZoomAccessToken | null = null;
  private readonly authConfig: ZoomAuthConfig;
  private readonly rateLimiter: RateLimiter;
  private readonly apiBaseUrl = 'https://api.zoom.us/v2';

  constructor(config: ZoomAuthConfig) {
    this.authConfig = {
      ...config,
      authType: config.authType || 'server-to-server',
    };
    this.rateLimiter = new RateLimiter({
      requestsPerSecond: 10,
      requestsPerDay: 10000,
    });
  }

  /**
   * Authenticate and get access token
   */
  async authenticate(): Promise<void> {
    logger.info('Authenticating with Zoom API', { authType: this.authConfig.authType });

    if (this.authConfig.authType === 'server-to-server') {
      await this.authenticateServerToServer();
    } else {
      await this.authenticateOAuth();
    }
  }

  /**
   * Server-to-Server OAuth (recommended for integrations)
   */
  private async authenticateServerToServer(): Promise<void> {
    const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${this.authConfig.accountId}`;

    const credentials = Buffer.from(
      `${this.authConfig.clientId}:${this.authConfig.clientSecret}`
    ).toString('base64');

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as ZoomTokenResponse;

      this.accessToken = {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000 - 60000), // 1 min buffer
        tokenType: data.token_type,
      };

      logger.info('Successfully authenticated with Zoom API (Server-to-Server)', {
        expiresAt: this.accessToken.expiresAt.toISOString(),
      });
    } catch (error: any) {
      logger.error('Failed to authenticate with Zoom API', { error: error.message });
      throw error;
    }
  }

  /**
   * OAuth authentication (for user-level access)
   */
  private async authenticateOAuth(): Promise<void> {
    // For OAuth, you would typically need a refresh token from the OAuth flow
    // This is a simplified version - production would require full OAuth implementation
    throw new Error('OAuth authentication not fully implemented. Use server-to-server auth.');
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
    options: ZoomTranscriptSearchOptions = {}
  ): Promise<ZoomTranscriptSearchResult> {
    await this.rateLimiter.waitForSlot();

    const token = await this.ensureValidToken();
    const pageSize = options.pageSize || 30;
    const meetingType = options.type || 'past';

    logger.info('Searching for Zoom meeting transcripts', {
      startDate: options.startDate?.toISOString(),
      endDate: options.endDate?.toISOString(),
      type: meetingType,
      pageSize,
    });

    try {
      // Build query parameters
      const params = new URLSearchParams({
        type: meetingType,
        page_size: pageSize.toString(),
      });

      if (options.startDate) {
        params.append('from', options.startDate.toISOString().split('T')[0]);
      }
      if (options.endDate) {
        params.append('to', options.endDate.toISOString().split('T')[0]);
      }
      if (options.nextPageToken) {
        params.append('next_page_token', options.nextPageToken);
      }

      // Get list of meetings
      const userId = options.userId || 'me';
      const meetingsUrl = `${this.apiBaseUrl}/users/${userId}/recordings?${params.toString()}`;

      const response = await fetch(meetingsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to search meetings: ${response.status}`);
      }

      const data = (await response.json()) as ZoomMeetingsResponse;
      const transcripts: ZoomMeetingTranscript[] = [];

      // For each meeting with recordings, check for transcripts
      for (const meeting of data.meetings || []) {
        try {
          const transcript = await this.fetchMeetingTranscript(meeting.uuid);
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
        nextPageToken: data.next_page_token,
        totalRecords: data.total_records || transcripts.length,
      };
    } catch (error: any) {
      logger.error('Failed to search Zoom transcripts', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch transcript for a specific meeting
   */
  async fetchMeetingTranscript(meetingUuid: string): Promise<ZoomMeetingTranscript | null> {
    await this.rateLimiter.waitForSlot();

    const token = await this.ensureValidToken();

    try {
      // Double-encode the meeting UUID (Zoom API requirement)
      const encodedUuid = encodeURIComponent(encodeURIComponent(meetingUuid));

      // Get recording files for the meeting
      const recordingsUrl = `${this.apiBaseUrl}/meetings/${encodedUuid}/recordings`;
      const response = await fetch(recordingsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug('No recordings found for meeting', { meetingUuid });
          return null;
        }
        throw new Error(`Failed to get recordings: ${response.status}`);
      }

      const recordingData = (await response.json()) as ZoomMeetingRecordingResponse;

      // Find transcript file in recording files
      const transcriptFile = recordingData.recording_files?.find(
        (file: any) => file.file_type === 'TRANSCRIPT' || file.recording_type === 'audio_transcript'
      );

      const vttFile = recordingData.recording_files?.find(
        (file: any) => file.file_extension === 'VTT'
      );

      if (!transcriptFile && !vttFile) {
        logger.debug('No transcript files found for meeting', { meetingUuid });
        return null;
      }

      // Download transcript content
      let content = '';
      let vttContent: string | undefined;

      if (transcriptFile) {
        content = await this.downloadFile(transcriptFile.download_url, token);
      }

      if (vttFile) {
        vttContent = await this.downloadFile(vttFile.download_url, token);
        if (!content) {
          content = vttContent; // Use VTT as primary content if no text transcript
        }
      }

      return {
        id: transcriptFile?.id || vttFile?.id || `transcript-${meetingUuid}`,
        meetingId: recordingData.id.toString(),
        meetingUuid,
        topic: recordingData.topic,
        startTime: new Date(recordingData.start_time),
        duration: recordingData.duration,
        hostId: recordingData.host_id,
        hostEmail: recordingData.host_email,
        participantCount: recordingData.participant_count,
        content,
        vttContent,
      };
    } catch (error: any) {
      logger.error('Failed to fetch meeting transcript', {
        meetingUuid,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Download file content from Zoom
   */
  private async downloadFile(downloadUrl: string, token: string): Promise<string> {
    await this.rateLimiter.waitForSlot();

    const response = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }

    return await response.text();
  }

  /**
   * Download transcript content to file
   */
  async downloadTranscript(
    transcript: ZoomMeetingTranscript,
    outputPath: string
  ): Promise<string> {
    const sanitizedTopic = transcript.topic.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const fileName = `zoom-${transcript.meetingId}-${sanitizedTopic}.txt`;
    const filePath = path.join(outputPath, fileName);

    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(filePath, transcript.content, 'utf-8');

    // Also save VTT file if available
    if (transcript.vttContent) {
      const vttFileName = `zoom-${transcript.meetingId}-${sanitizedTopic}.vtt`;
      const vttFilePath = path.join(outputPath, vttFileName);
      await fs.writeFile(vttFilePath, transcript.vttContent, 'utf-8');
    }

    logger.info('Downloaded Zoom transcript', {
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
 * Simple rate limiter for API calls
 */
class RateLimiter {
  private requestTimestamps: number[] = [];
  private readonly requestsPerSecond: number;
  private readonly requestsPerDay: number;

  constructor(config: { requestsPerSecond: number; requestsPerDay: number }) {
    this.requestsPerSecond = config.requestsPerSecond;
    this.requestsPerDay = config.requestsPerDay;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    const oneDayAgo = now - 86400000;

    // Clean up old timestamps
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > oneDayAgo);

    const recentSecond = this.requestTimestamps.filter((ts) => ts > oneSecondAgo).length;
    const recentDay = this.requestTimestamps.length;

    // Wait if we've hit rate limits
    if (recentSecond >= this.requestsPerSecond) {
      const oldestInSecond = Math.min(...this.requestTimestamps.filter((ts) => ts > oneSecondAgo));
      const waitTime = oldestInSecond + 1000 - now + 50; // Add 50ms buffer
      if (waitTime > 0) {
        logger.debug('Rate limit: waiting for second slot', { waitMs: waitTime });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    if (recentDay >= this.requestsPerDay) {
      const oldestInDay = Math.min(...this.requestTimestamps);
      const waitTime = oldestInDay + 86400000 - now + 1000;
      if (waitTime > 0) {
        logger.debug('Rate limit: waiting for day slot', { waitMs: waitTime });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    this.requestTimestamps.push(Date.now());
  }
}

export default ZoomTranscriptConnector;
