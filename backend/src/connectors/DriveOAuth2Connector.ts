/**
 * DriveOAuth2Connector - Google Drive API connector using OAuth2 user tokens
 *
 * Unlike DriveConnector (service account), this uses OAuth2 tokens
 * from user authorization for accessing personal Drive accounts.
 */

import { drive_v3, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../db';
import logger from '../utils/logger';
import { RateLimiter, withRetry } from '../utils/apiRetry';
import { getOAuth2AuthManager } from './OAuth2AuthManager';
import { encryptToken, decryptToken } from '../services/tokenEncryption';
import { DriveFileContent, DriveFileSummary } from './types';

// Drive API quota: 12,000 queries/minute per user (~200/second)
// Conservative limit to avoid bursting issues
const DRIVE_RATE_LIMITER = new RateLimiter({
  requestsPerSecond: 30,
  burstSize: 40,
});

export interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  createdTime?: string;
}

export interface DriveOAuth2ConnectorConfig {
  tokenId: string;  // UUID of the google_oauth_tokens record
  rateLimiter?: RateLimiter;
}

/**
 * DriveOAuth2Connector provides Drive API access using OAuth2 user tokens.
 */
export class DriveOAuth2Connector {
  private tokenId: string;
  private rateLimiter: RateLimiter;
  private drive?: drive_v3.Drive;
  private oauth2Client?: OAuth2Client;
  private tokenExpiry?: Date;

  constructor(config: DriveOAuth2ConnectorConfig) {
    this.tokenId = config.tokenId;
    this.rateLimiter = config.rateLimiter ?? DRIVE_RATE_LIMITER;
  }

  /**
   * Get an authenticated Drive client
   */
  private async getClient(): Promise<drive_v3.Drive> {
    // Check if we need to refresh the client
    if (this.drive && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.drive;
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
      logger.info('Refreshing Drive access token', { tokenId: this.tokenId, email: account_email });

      try {
        const { accessToken: newAccessToken, expiryDate: newExpiry } =
          await authManager.refreshAccessToken('drive', refreshToken);

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
          'drive',
          newAccessToken,
          refreshToken,
          newExpiry
        );
        this.tokenExpiry = new Date(newExpiry);
      } catch (error) {
        logger.error('Failed to refresh Drive token', {
          tokenId: this.tokenId,
          error: (error as Error).message,
        });
        throw new Error('Failed to refresh access token. User may need to re-authorize.');
      }
    } else {
      // Use existing token
      this.oauth2Client = authManager.createAuthenticatedClient(
        'drive',
        accessToken,
        refreshToken,
        expiryDate.getTime()
      );
      this.tokenExpiry = expiryDate;
    }

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    return this.drive;
  }

  /**
   * List root folders in Drive
   */
  async listRootFolders(): Promise<DriveFolder[]> {
    const drive = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return drive.files.list({
          q: "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
          fields: 'files(id, name, mimeType, parents, modifiedTime, createdTime)',
          orderBy: 'name',
          pageSize: 100,
        });
      })
    );

    return (response.data.files || []).map((file) => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      parents: file.parents || undefined,
      modifiedTime: file.modifiedTime || undefined,
      createdTime: file.createdTime || undefined,
    }));
  }

  /**
   * List children of a folder (both files and subfolders)
   */
  async listFolderContents(
    folderId: string,
    options: {
      mimeTypes?: string[];
      includeSubfolders?: boolean;
      pageToken?: string;
      pageSize?: number;
    } = {}
  ): Promise<{
    items: (DriveFolder | DriveFileSummary)[];
    nextPageToken?: string;
  }> {
    const drive = await this.getClient();

    // Build query
    let query = `'${folderId}' in parents and trashed = false`;

    // Filter by mime types if specified
    if (options.mimeTypes && options.mimeTypes.length > 0) {
      const mimeTypeFilters = options.mimeTypes
        .map((mt) => `mimeType = '${mt}'`)
        .join(' or ');
      // Always include folders if we want to navigate
      query += ` and (mimeType = 'application/vnd.google-apps.folder' or ${mimeTypeFilters})`;
    }

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return drive.files.list({
          q: query,
          fields:
            'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, owners(displayName, emailAddress), lastModifyingUser(displayName, emailAddress))',
          orderBy: 'folder,name',
          pageSize: options.pageSize ?? 50,
          pageToken: options.pageToken,
        });
      })
    );

    const items = (response.data.files || []).map((file) => {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        return {
          id: file.id || '',
          name: file.name || '',
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime || undefined,
          createdTime: file.createdTime || undefined,
        } as DriveFolder;
      } else {
        return {
          id: file.id || '',
          name: file.name || '',
          mimeType: file.mimeType || '',
          modifiedTime: file.modifiedTime || undefined,
          createdTime: file.createdTime || undefined,
          owners: file.owners?.map((o) => ({
            displayName: o.displayName || undefined,
            emailAddress: o.emailAddress || undefined,
          })),
          lastModifyingUser: file.lastModifyingUser
            ? {
                displayName: file.lastModifyingUser.displayName || undefined,
                emailAddress: file.lastModifyingUser.emailAddress || undefined,
              }
            : undefined,
        } as DriveFileSummary;
      }
    });

    return {
      items,
      nextPageToken: response.data.nextPageToken ?? undefined,
    };
  }

  /**
   * Search for files in a folder (recursively if needed)
   */
  async searchFiles(
    folderId: string,
    options: {
      mimeTypes?: string[];
      includeSubfolders?: boolean;
      maxResults?: number;
    } = {}
  ): Promise<DriveFileSummary[]> {
    const drive = await this.getClient();
    const results: DriveFileSummary[] = [];
    const processedFolders = new Set<string>();
    const folderQueue = [folderId];

    const mimeTypes = options.mimeTypes ?? ['application/vnd.google-apps.document'];
    const maxResults = options.maxResults ?? 100;

    while (folderQueue.length > 0 && results.length < maxResults) {
      const currentFolderId = folderQueue.shift()!;
      if (processedFolders.has(currentFolderId)) continue;
      processedFolders.add(currentFolderId);

      // Build query for files
      const mimeTypeFilter = mimeTypes.map((mt) => `mimeType = '${mt}'`).join(' or ');
      const fileQuery = `'${currentFolderId}' in parents and (${mimeTypeFilter}) and trashed = false`;

      // Fetch files
      let pageToken: string | undefined;
      do {
        const response = await this.rateLimiter.execute(() =>
          withRetry(async () => {
            return drive.files.list({
              q: fileQuery,
              fields:
                'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, owners(displayName, emailAddress), lastModifyingUser(displayName, emailAddress))',
              orderBy: 'modifiedTime desc',
              pageSize: Math.min(50, maxResults - results.length),
              pageToken,
            });
          })
        );

        for (const file of response.data.files || []) {
          if (results.length >= maxResults) break;
          results.push({
            id: file.id || '',
            name: file.name || '',
            mimeType: file.mimeType || '',
            modifiedTime: file.modifiedTime || undefined,
            createdTime: file.createdTime || undefined,
            owners: file.owners?.map((o) => ({
              displayName: o.displayName || undefined,
              emailAddress: o.emailAddress || undefined,
            })),
            lastModifyingUser: file.lastModifyingUser
              ? {
                  displayName: file.lastModifyingUser.displayName || undefined,
                  emailAddress: file.lastModifyingUser.emailAddress || undefined,
                }
              : undefined,
          });
        }

        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken && results.length < maxResults);

      // If including subfolders, queue them
      if (options.includeSubfolders !== false) {
        const folderResponse = await this.rateLimiter.execute(() =>
          withRetry(async () => {
            return drive.files.list({
              q: `'${currentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
              fields: 'files(id)',
              pageSize: 100,
            });
          })
        );

        for (const folder of folderResponse.data.files || []) {
          if (folder.id && !processedFolders.has(folder.id)) {
            folderQueue.push(folder.id);
          }
        }
      }
    }

    return results;
  }

  /**
   * Get file count in a folder
   */
  async getFileCount(
    folderId: string,
    options: {
      mimeTypes?: string[];
      includeSubfolders?: boolean;
    } = {}
  ): Promise<number> {
    // Use search with high limit just for counting
    const files = await this.searchFiles(folderId, {
      ...options,
      maxResults: 10000, // Safety limit
    });
    return files.length;
  }

  /**
   * Fetch file content (export Google Docs as text)
   */
  async fetchFileContent(file: DriveFileSummary): Promise<DriveFileContent> {
    const drive = await this.getClient();
    let contentBuffer: Buffer;
    let extension = '.txt';

    // Google Docs need to be exported
    if (file.mimeType.includes('google-apps.document')) {
      const res = await this.rateLimiter.execute(() =>
        withRetry(async () => {
          return drive.files.export(
            {
              fileId: file.id,
              mimeType: 'text/plain',
            },
            { responseType: 'arraybuffer' }
          );
        })
      );
      contentBuffer = Buffer.from(res.data as ArrayBuffer);
      extension = '.txt';
    } else if (file.mimeType.includes('google-apps.spreadsheet')) {
      const res = await this.rateLimiter.execute(() =>
        withRetry(async () => {
          return drive.files.export(
            {
              fileId: file.id,
              mimeType: 'text/csv',
            },
            { responseType: 'arraybuffer' }
          );
        })
      );
      contentBuffer = Buffer.from(res.data as ArrayBuffer);
      extension = '.csv';
    } else {
      // Binary file - download directly
      const res = await this.rateLimiter.execute(() =>
        withRetry(async () => {
          return drive.files.get(
            {
              fileId: file.id,
              alt: 'media',
            },
            { responseType: 'arraybuffer' }
          );
        })
      );
      contentBuffer = Buffer.from(res.data as ArrayBuffer);

      // Determine extension from mime type
      if (file.mimeType === 'application/pdf') {
        extension = '.pdf';
      } else if (
        file.mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        extension = '.docx';
      } else if (file.mimeType === 'text/plain') {
        extension = '.txt';
      }
    }

    return {
      summary: file,
      content: contentBuffer,
      fileExtension: extension,
    };
  }

  /**
   * Get folder info by ID
   */
  async getFolderInfo(folderId: string): Promise<DriveFolder | null> {
    const drive = await this.getClient();

    try {
      const response = await this.rateLimiter.execute(() =>
        withRetry(async () => {
          return drive.files.get({
            fileId: folderId,
            fields: 'id, name, mimeType, parents, modifiedTime, createdTime',
          });
        })
      );

      if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
        return null; // Not a folder
      }

      return {
        id: response.data.id || '',
        name: response.data.name || '',
        mimeType: response.data.mimeType,
        parents: response.data.parents || undefined,
        modifiedTime: response.data.modifiedTime || undefined,
        createdTime: response.data.createdTime || undefined,
      };
    } catch (error: any) {
      if (error.code === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Parse a Google Drive URL to extract the folder ID
   */
  static parseDriveFolderUrl(url: string): string | null {
    // Patterns:
    // https://drive.google.com/drive/folders/FOLDER_ID
    // https://drive.google.com/drive/u/0/folders/FOLDER_ID
    // https://drive.google.com/open?id=FOLDER_ID

    try {
      const urlObj = new URL(url);

      if (urlObj.hostname !== 'drive.google.com') {
        return null;
      }

      // Check for /folders/ pattern
      const foldersMatch = urlObj.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
      if (foldersMatch) {
        return foldersMatch[1];
      }

      // Check for ?id= pattern
      const idParam = urlObj.searchParams.get('id');
      if (idParam) {
        return idParam;
      }

      return null;
    } catch {
      return null;
    }
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

export default DriveOAuth2Connector;
