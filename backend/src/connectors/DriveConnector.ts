import { drive_v3, google } from 'googleapis';
import { JWT } from 'google-auth-library';
import GoogleAuthManager from './GoogleAuthManager';
import {
  DriveFileContent,
  DriveFileSummary,
  DriveSearchOptions,
} from './types';
import { RateLimiter, withRetry } from '../utils/apiRetry';

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Drive API quota: 12,000 queries/minute per user (~200/second)
// Conservative limit to avoid bursting issues
const DRIVE_RATE_LIMITER = new RateLimiter({
  requestsPerSecond: 30,
  burstSize: 40,
});

export interface DriveConnectorConfig {
  auth: {
    clientEmail: string;
    privateKey: string;
    impersonatedUser?: string;
  };
  pageSize?: number;
  rateLimiter?: RateLimiter;
}

export class DriveConnector {
  private clientPromise: Promise<JWT> | null = null;
  private drive?: drive_v3.Drive;
  private rateLimiter: RateLimiter;

  constructor(private readonly config: DriveConnectorConfig) {
    this.rateLimiter = config.rateLimiter ?? DRIVE_RATE_LIMITER;
  }

  private async getClient(): Promise<drive_v3.Drive> {
    if (!this.clientPromise) {
      const authManager = new GoogleAuthManager(
        {
          clientEmail: this.config.auth.clientEmail,
          privateKey: this.config.auth.privateKey,
          impersonatedUser: this.config.auth.impersonatedUser,
        },
        DRIVE_SCOPES
      );
      this.clientPromise = authManager.authorize();
    }

    if (!this.drive) {
      const auth = await this.clientPromise;
      this.drive = google.drive({ version: 'v3', auth });
    }

    return this.drive;
  }

  async searchFiles(options: DriveSearchOptions): Promise<DriveFileSummary[]> {
    const drive = await this.getClient();

    const response = await this.rateLimiter.execute(() =>
      withRetry(async () => {
        return drive.files.list({
          q: options.q,
          fields:
            options.fields ??
            'files(id, name, mimeType, modifiedTime, createdTime, owners(displayName,emailAddress), lastModifyingUser(displayName,emailAddress))',
          orderBy: options.orderBy ?? 'modifiedTime desc',
          pageSize: options.pageSize ?? this.config.pageSize ?? 50,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
      })
    );

    if (!response.data.files) {
      return [];
    }

    return response.data.files
      .filter((file): file is drive_v3.Schema$File & { id: string } => Boolean(file.id))
      .map((file) => ({
        id: file.id,
        name: file.name || 'untitled',
        mimeType: file.mimeType || 'application/octet-stream',
        modifiedTime: file.modifiedTime || undefined,
        createdTime: file.createdTime || undefined,
        owners: file.owners?.map((owner) => ({
          displayName: owner.displayName || undefined,
          emailAddress: owner.emailAddress || undefined,
        })),
        lastModifyingUser: file.lastModifyingUser
          ? {
              displayName: file.lastModifyingUser.displayName || undefined,
              emailAddress: file.lastModifyingUser.emailAddress || undefined,
            }
          : undefined,
      }));
  }

  async fetchFileContent(file: DriveFileSummary): Promise<DriveFileContent> {
    const drive = await this.getClient();
    let contentBuffer: Buffer;
    let extension = '.txt';

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
    } else {
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

      if (file.mimeType === 'application/pdf') {
        extension = '.pdf';
      } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        extension = '.docx';
      } else {
        extension = '.txt';
      }
    }

    return {
      summary: file,
      content: contentBuffer,
      fileExtension: extension,
    };
  }
}

export default DriveConnector;
