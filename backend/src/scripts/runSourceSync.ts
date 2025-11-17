import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import logger from '../utils/logger';
import {
  DriveConnector,
  GmailConnector,
  CRMCSVConnector,
} from '../connectors';
import SourceSyncService, {
  DriveSyncConfig,
  GmailSyncConfig,
  CRMCSVSyncConfig,
  SourceSyncOptions,
} from '../ingestion/SourceSyncService';

async function main() {
  // Parse command line arguments for connector filtering
  const args = process.argv.slice(2);
  const connectorFlagIndex = args.indexOf('--connector');
  const selectedConnector = connectorFlagIndex !== -1 ? args[connectorFlagIndex + 1] : null;

  if (!config.connectors.googleServiceAccount && selectedConnector !== 'crm-csv') {
    logger.warn('Google service account credentials are not configured. Aborting source sync.');
    return;
  }

  const connectors: { gmail?: GmailConnector; drive?: DriveConnector; crmCsv?: CRMCSVConnector } = {};
  const spoolDirectory = path.resolve(config.upload.directory, 'source-sync');

  // Gmail connector
  const gmailQueries = config.connectors.gmailSync.queries.filter((q) => q.query.length > 0);
  const enableGmail = (!selectedConnector || selectedConnector === 'gmail') && config.connectors.gmailSync.enabled && gmailQueries.length > 0;
  if (enableGmail) {
    connectors.gmail = new GmailConnector({
      auth: config.connectors.googleServiceAccount,
      maxResults: config.connectors.gmailSync.maxResults,
    });
    logger.info('Gmail connector enabled');
  }

  // Drive connector
  const driveQueries = config.connectors.driveSync.queries.filter((q) => q.query.length > 0);
  const enableDrive = (!selectedConnector || selectedConnector === 'drive') && config.connectors.driveSync.enabled && driveQueries.length > 0;
  if (enableDrive) {
    connectors.drive = new DriveConnector({
      auth: config.connectors.googleServiceAccount,
      pageSize: config.connectors.driveSync.pageSize,
    });
    logger.info('Drive connector enabled');
  }

  // CRM CSV connector
  const crmCsvEnabled = process.env.CRM_CSV_ENABLED === 'true';
  const enableCrmCsv = (!selectedConnector || selectedConnector === 'crm-csv') && crmCsvEnabled;
  if (enableCrmCsv) {
    const crmDirectory = process.env.CRM_CSV_DIRECTORY || path.resolve(config.upload.directory, 'crm');
    connectors.crmCsv = new CRMCSVConnector({ directory: crmDirectory });
    logger.info('CRM CSV connector enabled', { directory: crmDirectory });
  }

  // Teams and Zoom connectors (Phase 7.2 - not yet in main sync service, placeholder for future)
  if (selectedConnector === 'teams') {
    logger.info('Teams connector requested but not yet integrated into main sync service');
    return;
  }
  if (selectedConnector === 'zoom') {
    logger.info('Zoom connector requested but not yet integrated into main sync service');
    return;
  }

  if (!connectors.gmail && !connectors.drive && !connectors.crmCsv) {
    logger.warn('No connectors are enabled. Nothing to do.');
    return;
  }

  if (selectedConnector) {
    logger.info(`Running sync for connector: ${selectedConnector}`);
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
    crmCsv: connectors.crmCsv
      ? ({
          enabled: true,
          directory: process.env.CRM_CSV_DIRECTORY || path.resolve(config.upload.directory, 'crm'),
          maxFiles: parseInt(process.env.CRM_CSV_MAX_FILES || '100', 10),
        } satisfies CRMCSVSyncConfig)
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
    crmCsvFiles: report.crmCsv.map((entry) => ({
      files: entry.files.length,
      totalSizeMB: (entry.files.reduce((sum, f) => sum + f.fileSize, 0) / 1024 / 1024).toFixed(2),
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
