/**
 * Google Sheets Export Service
 *
 * Provides integration with Google Sheets for exporting deals.
 * Supports:
 * - Creating new sheets
 * - Appending to existing sheets
 * - Replacing sheet data
 * - Formatting and styling
 */

import { google, sheets_v4 } from 'googleapis';
import { ExtractedDeal } from '../extraction/types';
import {
  GoogleSheetsOptions,
  ExportResult,
  ColumnMapping,
  DEFAULT_COLUMN_MAPPINGS,
} from './types';
import logger from '../../utils/logger';

/**
 * Google Sheets configuration from environment
 */
interface GoogleSheetsConfig {
  enabled: boolean;
  spreadsheetId?: string;
  sheetName: string;
  credentialsPath?: string;
  credentials?: {
    client_email: string;
    private_key: string;
  };
}

/**
 * Load Google Sheets configuration from environment
 */
function loadConfig(): GoogleSheetsConfig {
  return {
    enabled: process.env.GOOGLE_SHEETS_ENABLED === 'true',
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || 'Deals',
    credentialsPath: process.env.GOOGLE_SHEETS_CREDENTIALS_PATH,
    credentials: process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY
      ? {
          client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }
      : undefined,
  };
}

/**
 * Google Sheets Export Service class
 */
export class GoogleSheetsService {
  private config: GoogleSheetsConfig;
  private sheets: sheets_v4.Sheets | null = null;
  private columnMappings: ColumnMapping[];

  constructor(options: { columnMappings?: ColumnMapping[] } = {}) {
    this.config = loadConfig();
    this.columnMappings = options.columnMappings || DEFAULT_COLUMN_MAPPINGS;
  }

  /**
   * Check if Google Sheets integration is enabled and configured
   */
  isEnabled(): boolean {
    return this.config.enabled && !!this.config.spreadsheetId;
  }

  /**
   * Initialize the Google Sheets API client
   */
  private async initClient(): Promise<sheets_v4.Sheets> {
    if (this.sheets) {
      return this.sheets;
    }

    if (!this.config.enabled) {
      throw new Error('Google Sheets integration is not enabled');
    }

    let auth;

    // Try service account credentials from environment
    if (this.config.credentials) {
      auth = new google.auth.GoogleAuth({
        credentials: this.config.credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    // Try credentials file path
    else if (this.config.credentialsPath) {
      auth = new google.auth.GoogleAuth({
        keyFile: this.config.credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    // Try application default credentials
    else {
      auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }

    this.sheets = google.sheets({ version: 'v4', auth });
    return this.sheets;
  }

  /**
   * Export deals to Google Sheets
   */
  async exportToSheets(
    deals: ExtractedDeal[],
    options: Partial<GoogleSheetsOptions> = {}
  ): Promise<ExportResult> {
    const timestamp = new Date();
    const warnings: string[] = [];

    try {
      if (!this.isEnabled()) {
        return {
          success: false,
          format: 'sheets',
          recordCount: 0,
          warnings,
          error: 'Google Sheets integration is not enabled or configured',
          timestamp,
        };
      }

      const sheets = await this.initClient();
      const spreadsheetId = options.spreadsheetId || this.config.spreadsheetId!;
      const sheetName = options.sheetName || this.config.sheetName;

      // Prepare data for sheets
      const headers = this.columnMappings.map((col) => col.header);
      const rows = deals.map((deal) => this.dealToRow(deal));

      // Determine range and update mode
      const range = `${sheetName}!A1`;

      if (options.clearExisting) {
        // Clear existing data
        await this.clearSheet(sheets, spreadsheetId, sheetName);
      }

      if (options.appendMode) {
        // Append to existing data
        await this.appendData(sheets, spreadsheetId, sheetName, rows);
      } else {
        // Replace data (including headers)
        const values = [headers, ...rows];
        await this.updateData(sheets, spreadsheetId, range, values);
      }

      // Apply formatting
      await this.applyFormatting(sheets, spreadsheetId, sheetName, headers.length, rows.length + 1);

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`;

      logger.info(`Exported ${deals.length} deals to Google Sheets`, {
        spreadsheetId,
        sheetName,
        recordCount: deals.length,
      });

      return {
        success: true,
        format: 'sheets',
        recordCount: deals.length,
        spreadsheetUrl,
        warnings,
        timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Google Sheets export failed: ${errorMessage}`);

      return {
        success: false,
        format: 'sheets',
        recordCount: 0,
        warnings,
        error: errorMessage,
        timestamp,
      };
    }
  }

  /**
   * Convert a deal to a row of values
   */
  private dealToRow(deal: ExtractedDeal): any[] {
    return this.columnMappings.map((mapping) => {
      let value: any;

      // Handle nested field paths
      if (mapping.field.includes('.')) {
        const parts = mapping.field.split('.');
        value = parts.reduce((obj: any, key) => obj?.[key], deal);
      } else {
        value = (deal as any)[mapping.field];
      }

      // Apply formatter
      if (mapping.formatter && value !== undefined && value !== null) {
        return mapping.formatter(value);
      }

      return value ?? '';
    });
  }

  /**
   * Clear all data from a sheet
   */
  private async clearSheet(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string
  ): Promise<void> {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });
  }

  /**
   * Append data to the sheet
   */
  private async appendData(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string,
    rows: any[][]
  ): Promise<void> {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    });
  }

  /**
   * Update data in the sheet (replace)
   */
  private async updateData(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    range: string,
    values: any[][]
  ): Promise<void> {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });
  }

  /**
   * Apply formatting to the sheet
   */
  private async applyFormatting(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string,
    columnCount: number,
    rowCount: number
  ): Promise<void> {
    try {
      // Get sheet ID
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
      });

      const sheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title === sheetName
      );

      if (!sheet?.properties?.sheetId) {
        logger.warn('Could not find sheet for formatting');
        return;
      }

      const sheetId = sheet.properties.sheetId;

      // Apply batch formatting
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            // Format header row
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: columnCount,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.267, green: 0.447, blue: 0.769 },
                    textFormat: {
                      bold: true,
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                    },
                    horizontalAlignment: 'CENTER',
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
              },
            },
            // Freeze header row
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: {
                    frozenRowCount: 1,
                  },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            },
            // Auto-resize columns
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: columnCount,
                },
              },
            },
          ],
        },
      });
    } catch (error) {
      // Formatting is optional, just log the error
      logger.warn('Could not apply sheet formatting:', error);
    }
  }

  /**
   * Create a new spreadsheet
   */
  async createSpreadsheet(title: string): Promise<string> {
    const sheets = await this.initClient();

    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title,
        },
        sheets: [
          {
            properties: {
              title: this.config.sheetName,
            },
          },
        ],
      },
    });

    const spreadsheetId = response.data.spreadsheetId;

    if (!spreadsheetId) {
      throw new Error('Failed to create spreadsheet');
    }

    logger.info(`Created new spreadsheet: ${spreadsheetId}`);
    return spreadsheetId;
  }

  /**
   * Get existing data from a sheet
   */
  async getExistingData(
    spreadsheetId?: string,
    sheetName?: string
  ): Promise<any[][]> {
    const sheets = await this.initClient();
    const id = spreadsheetId || this.config.spreadsheetId;
    const name = sheetName || this.config.sheetName;

    if (!id) {
      throw new Error('No spreadsheet ID configured');
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${name}!A:Z`,
    });

    return response.data.values || [];
  }
}

export default GoogleSheetsService;
