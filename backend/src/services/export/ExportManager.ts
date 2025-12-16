/**
 * Export Manager
 *
 * Unified interface for exporting deals to multiple formats.
 * Combines EnhancedExportService and GoogleSheetsService.
 */

import { ExtractedDeal } from '../extraction/types';
import { EnhancedExportService } from './EnhancedExportService';
import { GoogleSheetsService } from './GoogleSheetsService';
import {
  ExportOptions,
  ExportResult,
  GoogleSheetsOptions,
  ExportFormat,
} from './types';
import logger from '../../utils/logger';

/**
 * Combined export options
 */
export interface ExportManagerOptions {
  /** Enable extended columns (source info) */
  includeExtendedColumns?: boolean;
}

/**
 * Export Manager class
 */
export class ExportManager {
  private fileExportService: EnhancedExportService;
  private sheetsService: GoogleSheetsService;

  constructor(options: ExportManagerOptions = {}) {
    this.fileExportService = new EnhancedExportService({
      includeExtendedColumns: options.includeExtendedColumns,
    });
    this.sheetsService = new GoogleSheetsService();
  }

  /**
   * Export deals to specified format(s)
   */
  async export(
    deals: ExtractedDeal[],
    options: ExportOptions,
    sheetsOptions?: Partial<GoogleSheetsOptions>
  ): Promise<ExportResult> {
    if (options.format === 'sheets') {
      return this.exportToSheets(deals, sheetsOptions);
    }

    return this.fileExportService.exportDeals(deals, options);
  }

  /**
   * Export to multiple formats at once
   */
  async exportMultiple(
    deals: ExtractedDeal[],
    formats: ExportFormat[],
    baseOptions: Omit<ExportOptions, 'format'> = {},
    sheetsOptions?: Partial<GoogleSheetsOptions>
  ): Promise<Map<ExportFormat, ExportResult>> {
    const results = new Map<ExportFormat, ExportResult>();

    for (const format of formats) {
      try {
        const result = await this.export(
          deals,
          { ...baseOptions, format },
          sheetsOptions
        );
        results.set(format, result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.set(format, {
          success: false,
          format,
          recordCount: 0,
          warnings: [],
          error: errorMessage,
          timestamp: new Date(),
        });
      }
    }

    // Log summary
    const successful = Array.from(results.values()).filter((r) => r.success).length;
    logger.info(`Export complete: ${successful}/${formats.length} formats succeeded`);

    return results;
  }

  /**
   * Export to Google Sheets
   */
  async exportToSheets(
    deals: ExtractedDeal[],
    options?: Partial<GoogleSheetsOptions>
  ): Promise<ExportResult> {
    if (!this.sheetsService.isEnabled()) {
      return {
        success: false,
        format: 'sheets',
        recordCount: 0,
        warnings: [],
        error: 'Google Sheets integration is not enabled. Set GOOGLE_SHEETS_ENABLED=true and configure credentials.',
        timestamp: new Date(),
      };
    }

    return this.sheetsService.exportToSheets(deals, options);
  }

  /**
   * Export to CSV file
   */
  async exportToCsv(
    deals: ExtractedDeal[],
    options: Omit<ExportOptions, 'format'> = {}
  ): Promise<ExportResult> {
    return this.fileExportService.exportDeals(deals, { ...options, format: 'csv' });
  }

  /**
   * Export to Excel file
   */
  async exportToExcel(
    deals: ExtractedDeal[],
    options: Omit<ExportOptions, 'format'> = {}
  ): Promise<ExportResult> {
    return this.fileExportService.exportDeals(deals, { ...options, format: 'xlsx' });
  }

  /**
   * Export to JSON file
   */
  async exportToJson(
    deals: ExtractedDeal[],
    options: Omit<ExportOptions, 'format'> = {}
  ): Promise<ExportResult> {
    return this.fileExportService.exportDeals(deals, { ...options, format: 'json' });
  }

  /**
   * Get export buffer without writing to file
   */
  async getBuffer(
    deals: ExtractedDeal[],
    format: 'csv' | 'xlsx' | 'json'
  ): Promise<Buffer> {
    return this.fileExportService.getBuffer(deals, format);
  }

  /**
   * Check if Google Sheets is available
   */
  isSheetsEnabled(): boolean {
    return this.sheetsService.isEnabled();
  }

  /**
   * Get supported formats
   */
  getSupportedFormats(): ExportFormat[] {
    const formats: ExportFormat[] = ['csv', 'xlsx', 'json'];
    if (this.isSheetsEnabled()) {
      formats.push('sheets');
    }
    return formats;
  }
}

export default ExportManager;
