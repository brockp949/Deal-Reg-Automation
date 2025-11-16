import { promises as fs } from 'fs';
import path from 'path';
import { SourceSyncService, SourceSyncOptions } from '../../ingestion/SourceSyncService';
import { GmailConnector } from '../../connectors/GmailConnector';
import { DriveConnector } from '../../connectors/DriveConnector';
import { GmailMessageSummary } from '../../connectors/types';

async function createTempDir() {
  return fs.mkdtemp(path.join(process.cwd(), 'tmp-source-sync-'));
}

describe('SourceSyncService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('syncs Gmail queries and writes .eml files', async () => {
    const mockGmailConnector: Partial<GmailConnector> = {
      searchMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            id: 'msg-1',
            threadId: 'thread-1',
            headers: {},
          } as GmailMessageSummary,
        ],
      }),
      fetchMessageRaw: jest.fn().mockResolvedValue({
        raw: 'From: tester@example.com\nSubject: RFQ',
        summary: {
          id: 'msg-1',
          threadId: 'thread-1',
          headers: {},
        },
      }),
    };

    const options: SourceSyncOptions = {
      spoolDirectory: tempDir,
      gmail: {
        enabled: true,
        userId: 'user@example.com',
        daysBack: 30,
        queries: [
          {
            name: 'rfq',
            query: 'subject:RFQ',
          },
        ],
      },
    };

    const service = new SourceSyncService(options, {
      gmail: mockGmailConnector as GmailConnector,
    });

    const { results, manifestEntries } = await service.syncGmail();

    expect(results[0].messages).toHaveLength(1);
    const writtenFile = path.join(tempDir, 'gmail', 'rfq', 'msg-1.eml');
    await expect(fs.readFile(writtenFile, 'utf-8')).resolves.toContain('Subject: RFQ');

    const metadataPath = `${writtenFile}.json`;
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    expect(metadata.connector).toBe('gmail');
    expect(metadata.queryName).toBe('rfq');
    expect(metadata.message.id).toBe('msg-1');
    expect(manifestEntries).toHaveLength(1);
    expect(manifestEntries[0].parser).toBe('StandardizedMboxParser');
    expect(manifestEntries[0].metadataPath).toBe(metadataPath);
  });

  it('syncs Drive documents and writes files', async () => {
    const mockDriveConnector: Partial<DriveConnector> = {
      searchFiles: jest.fn().mockResolvedValue([
        {
          id: 'file-1',
          name: 'Meeting Notes',
          mimeType: 'application/vnd.google-apps.document',
        },
      ]),
      fetchFileContent: jest.fn().mockResolvedValue({
        summary: {
          id: 'file-1',
          name: 'Meeting Notes',
          mimeType: 'application/vnd.google-apps.document',
        },
        content: Buffer.from('notes'),
        fileExtension: '.txt',
      }),
    };

    const options: SourceSyncOptions = {
      spoolDirectory: tempDir,
      drive: {
        enabled: true,
        queries: [
          {
            name: 'project',
            query: '4IEC',
          },
        ],
      },
    };

    const service = new SourceSyncService(options, {
      drive: mockDriveConnector as DriveConnector,
    });

    const { results, manifestEntries } = await service.syncDrive();

    expect(results[0].files).toHaveLength(1);
    const writtenFile = path.join(tempDir, 'drive', 'project', 'file-1.txt');
    await expect(fs.readFile(writtenFile, 'utf-8')).resolves.toBe('notes');

    const metadataPath = `${writtenFile}.json`;
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    expect(metadata.connector).toBe('drive');
    expect(metadata.queryName).toBe('project');
    expect(metadata.file.id).toBe('file-1');
    expect(manifestEntries).toHaveLength(1);
    expect(manifestEntries[0].parser).toBe('StandardizedTranscriptParser');
    expect(manifestEntries[0].metadataPath).toBe(metadataPath);
  });
});
