import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import logger from '../utils/logger';
import {
  DriveConnector,
  GmailConnector,
} from '../connectors';
import SourceSyncService, {
  DriveSyncConfig,
  GmailSyncConfig,
  SourceSyncOptions,
} from '../ingestion/SourceSyncService';

async function main() {
  if (!config.connectors.googleServiceAccount) {
    logger.warn('Google service account credentials are not configured. Aborting source sync.');
    return;
  }

  const connectors: { gmail?: GmailConnector; drive?: DriveConnector } = {};
  const spoolDirectory = path.resolve(config.upload.directory, 'source-sync');

  const gmailQueries = config.connectors.gmailSync.queries.filter((q) => q.query.length > 0);
  if (config.connectors.gmailSync.enabled && gmailQueries.length > 0) {
    connectors.gmail = new GmailConnector({
      auth: config.connectors.googleServiceAccount,
      maxResults: config.connectors.gmailSync.maxResults,
    });
  }

  const driveQueries = config.connectors.driveSync.queries.filter((q) => q.query.length > 0);
  if (config.connectors.driveSync.enabled && driveQueries.length > 0) {
    connectors.drive = new DriveConnector({
      auth: config.connectors.googleServiceAccount,
      pageSize: config.connectors.driveSync.pageSize,
    });
  }

  if (!connectors.gmail && !connectors.drive) {
    logger.warn('Neither Gmail nor Drive sync is enabled. Nothing to do.');
    return;
  }

  const options: SourceSyncOptions = {
    spoolDirectory,
    gmail: connectors.gmail
      ? ({
          enabled: true,
          userId: config.connectors.googleServiceAccount.impersonatedUser || 'me',
          daysBack: config.connectors.gmailSync.windowDays,
          maxResults: config.connectors.gmailSync.maxResults,
          queries: gmailQueries,
        } satisfies GmailSyncConfig)
      : undefined,
    drive: connectors.drive
      ? ({
          enabled: true,
          pageSize: config.connectors.driveSync.pageSize,
          queries: driveQueries.map((query) => ({
            ...query,
            mimeTypes: config.connectors.driveSync.mimeTypes,
          })),
        } satisfies DriveSyncConfig)
      : undefined,
  };

  const service = new SourceSyncService(options, connectors);
  const report = await service.syncAll();
  await fs.mkdir(spoolDirectory, { recursive: true });
  const manifestPath = path.join(spoolDirectory, 'source-sync-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(report.manifest, null, 2), 'utf-8');

  logger.info('Source sync completed', {
    gmailQueries: report.gmail.map((entry) => ({
      query: entry.query.name,
      messages: entry.messages.length,
    })),
    driveQueries: report.drive.map((entry) => ({
      query: entry.query.name,
      files: entry.files.length,
    })),
    spoolDirectory,
    manifestPath,
    manifestEntries: report.manifest.length,
  });
}

main().catch((error) => {
  logger.error('Source sync failed', { error: error.message });
  process.exit(1);
});
