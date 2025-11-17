/**
 * Smoke Tests for All Connectors
 *
 * Validates basic connectivity and functionality for each connector
 * without performing full syncs.
 *
 * Phase 7.3 - Deployment Hardening & Observability
 */

import path from 'path';
import { promises as fs } from 'fs';
import { config } from '../config';
import logger from '../utils/logger';
import {
  GmailConnector,
  DriveConnector,
  CRMCSVConnector,
  TeamsTranscriptConnector,
  ZoomTranscriptConnector,
} from '../connectors';

interface SmokeTestResult {
  connector: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, any>;
}

class SmokeTestRunner {
  private results: SmokeTestResult[] = [];

  async testGmail(): Promise<SmokeTestResult> {
    const startTime = Date.now();
    const result: SmokeTestResult = {
      connector: 'gmail',
      passed: false,
      duration: 0,
    };

    try {
      if (!config.connectors.googleServiceAccount) {
        throw new Error('Google service account credentials not configured');
      }

      const connector = new GmailConnector({
        auth: config.connectors.googleServiceAccount,
        maxResults: 1,
      });

      // Test: Search for any message (limit 1)
      const userId = config.connectors.googleServiceAccount.impersonatedUser || 'me';
      const searchResult = await connector.searchMessages({
        userId,
        query: 'is:all',
        maxResults: 1,
      });

      result.passed = true;
      result.details = {
        userId,
        messagesFound: searchResult.messages.length,
        apiReachable: true,
      };
    } catch (error: any) {
      result.error = error.message;
      result.details = { stack: error.stack };
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  async testDrive(): Promise<SmokeTestResult> {
    const startTime = Date.now();
    const result: SmokeTestResult = {
      connector: 'drive',
      passed: false,
      duration: 0,
    };

    try {
      if (!config.connectors.googleServiceAccount) {
        throw new Error('Google service account credentials not configured');
      }

      const connector = new DriveConnector({
        auth: config.connectors.googleServiceAccount,
        pageSize: 1,
      });

      // Test: Search for any file (limit 1)
      const searchResult = await connector.searchFiles({
        query: 'trashed = false',
        mimeTypes: [],
        pageSize: 1,
      });

      result.passed = true;
      result.details = {
        filesFound: searchResult.files.length,
        apiReachable: true,
      };
    } catch (error: any) {
      result.error = error.message;
      result.details = { stack: error.stack };
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  async testCRMCSV(): Promise<SmokeTestResult> {
    const startTime = Date.now();
    const result: SmokeTestResult = {
      connector: 'crm-csv',
      passed: false,
      duration: 0,
    };

    try {
      const crmDirectory = process.env.CRM_CSV_DIRECTORY || path.resolve(config.upload.directory, 'crm');
      const connector = new CRMCSVConnector({ directory: crmDirectory });

      // Test: Check if directory exists and is accessible
      try {
        await fs.access(crmDirectory);
      } catch {
        // Create directory if it doesn't exist
        await fs.mkdir(crmDirectory, { recursive: true });
      }

      // Test: Scan for CSV files
      const scanResult = await connector.scanCSVFiles({
        directory: crmDirectory,
        maxFiles: 10,
      });

      result.passed = true;
      result.details = {
        directory: crmDirectory,
        filesFound: scanResult.files.length,
        directoryAccessible: true,
      };
    } catch (error: any) {
      result.error = error.message;
      result.details = { stack: error.stack };
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  async testTeams(): Promise<SmokeTestResult> {
    const startTime = Date.now();
    const result: SmokeTestResult = {
      connector: 'teams',
      passed: false,
      duration: 0,
    };

    try {
      const clientId = process.env.TEAMS_CLIENT_ID;
      const clientSecret = process.env.TEAMS_CLIENT_SECRET;
      const tenantId = process.env.TEAMS_TENANT_ID;

      if (!clientId || !clientSecret || !tenantId) {
        throw new Error('Teams credentials not configured (TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, TEAMS_TENANT_ID)');
      }

      const connector = new TeamsTranscriptConnector({
        clientId,
        clientSecret,
        tenantId,
      });

      // Test: Authenticate with Microsoft Graph API
      await connector.authenticate();

      result.passed = true;
      result.details = {
        authenticated: true,
        apiReachable: true,
      };
    } catch (error: any) {
      result.error = error.message;
      result.details = { stack: error.stack };
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  async testZoom(): Promise<SmokeTestResult> {
    const startTime = Date.now();
    const result: SmokeTestResult = {
      connector: 'zoom',
      passed: false,
      duration: 0,
    };

    try {
      const accountId = process.env.ZOOM_ACCOUNT_ID;
      const clientId = process.env.ZOOM_CLIENT_ID;
      const clientSecret = process.env.ZOOM_CLIENT_SECRET;

      if (!accountId || !clientId || !clientSecret) {
        throw new Error('Zoom credentials not configured (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)');
      }

      const connector = new ZoomTranscriptConnector({
        accountId,
        clientId,
        clientSecret,
      });

      // Test: Authenticate with Zoom API
      await connector.authenticateServerToServer();

      result.passed = true;
      result.details = {
        authenticated: true,
        apiReachable: true,
      };
    } catch (error: any) {
      result.error = error.message;
      result.details = { stack: error.stack };
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  async runAll(): Promise<void> {
    logger.info('Starting smoke tests for all connectors...');

    this.results = [];
    this.results.push(await this.testGmail());
    this.results.push(await this.testDrive());
    this.results.push(await this.testCRMCSV());
    this.results.push(await this.testTeams());
    this.results.push(await this.testZoom());

    this.printResults();
  }

  async runConnector(connectorName: string): Promise<void> {
    logger.info(`Starting smoke test for ${connectorName} connector...`);

    this.results = [];

    switch (connectorName) {
      case 'gmail':
        this.results.push(await this.testGmail());
        break;
      case 'drive':
        this.results.push(await this.testDrive());
        break;
      case 'crm-csv':
        this.results.push(await this.testCRMCSV());
        break;
      case 'teams':
        this.results.push(await this.testTeams());
        break;
      case 'zoom':
        this.results.push(await this.testZoom());
        break;
      default:
        logger.error(`Unknown connector: ${connectorName}`);
        process.exit(1);
    }

    this.printResults();
  }

  private printResults(): void {
    const passedCount = this.results.filter((r) => r.passed).length;
    const totalCount = this.results.length;

    logger.info('\n========== SMOKE TEST RESULTS ==========');
    for (const result of this.results) {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      const duration = `${result.duration}ms`;

      logger.info(`${status} - ${result.connector.padEnd(12)} (${duration})`);

      if (result.details) {
        logger.info(`       Details: ${JSON.stringify(result.details, null, 2)}`);
      }

      if (result.error) {
        logger.error(`       Error: ${result.error}`);
      }
    }

    logger.info('========================================');
    logger.info(`Summary: ${passedCount}/${totalCount} tests passed`);

    if (passedCount < totalCount) {
      process.exit(1);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runner = new SmokeTestRunner();

  if (args.includes('--all')) {
    await runner.runAll();
  } else {
    const connectorIndex = args.indexOf('--connector');
    if (connectorIndex === -1 || !args[connectorIndex + 1]) {
      logger.error('Usage: npm run smoke:all OR npm run smoke:<connector>');
      logger.error('Available connectors: gmail, drive, crm-csv, teams, zoom');
      process.exit(1);
    }

    const connectorName = args[connectorIndex + 1];
    await runner.runConnector(connectorName);
  }
}

main().catch((error) => {
  logger.error('Smoke tests failed', { error: error.message });
  process.exit(1);
});
