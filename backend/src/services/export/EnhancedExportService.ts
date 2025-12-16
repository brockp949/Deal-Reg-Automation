/**
 * Enhanced Export Service
 *
 * Provides multi-format export capabilities for extracted deals:
 * - CSV with proper escaping and column mapping
 * - Excel (XLSX) with formatting and styling
 * - JSON with optional pretty printing
 */

import ExcelJS from 'exceljs';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs';
import path from 'path';
import { ExtractedDeal } from '../extraction/types';
import {
  ExportOptions,
  ExportResult,
  ColumnMapping,
  DEFAULT_COLUMN_MAPPINGS,
  EXTENDED_COLUMN_MAPPINGS,
} from './types';
import { PATHS } from '../../config/paths';
import logger from '../../utils/logger';

/**
 * Enhanced Export Service class
 */
export class EnhancedExportService {
  private columnMappings: ColumnMapping[];

  constructor(options: { includeExtendedColumns?: boolean } = {}) {
    this.columnMappings = options.includeExtendedColumns
      ? EXTENDED_COLUMN_MAPPINGS
      : DEFAULT_COLUMN_MAPPINGS;
  }

  /**
   * Export deals to the specified format
   */
  async exportDeals(
    deals: ExtractedDeal[],
    options: ExportOptions
  ): Promise<ExportResult> {
    const timestamp = new Date();
    const warnings: string[] = [];

    try {
      // Clean and prepare data
      const cleanedDeals = deals.map((deal) => this.cleanForExport(deal));

      if (cleanedDeals.length === 0) {
        warnings.push('No deals to export');
      }

      let buffer: Buffer;
      let filePath: string | undefined;

      switch (options.format) {
        case 'csv':
          buffer = this.exportToCsv(cleanedDeals, options);
          break;
        case 'xlsx':
          buffer = await this.exportToExcel(cleanedDeals, options);
          break;
        case 'json':
          buffer = this.exportToJson(cleanedDeals, options);
          break;
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

      // Write to file if output directory specified
      if (options.outputDir || options.fileName) {
        filePath = await this.writeToFile(buffer, options, timestamp);
      }

      logger.info(`Export complete: ${deals.length} deals to ${options.format}`, {
        format: options.format,
        recordCount: deals.length,
        filePath,
      });

      return {
        success: true,
        format: options.format,
        recordCount: deals.length,
        filePath,
        fileSize: buffer.length,
        warnings,
        timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Export failed: ${errorMessage}`);

      return {
        success: false,
        format: options.format,
        recordCount: 0,
        warnings,
        error: errorMessage,
        timestamp,
      };
    }
  }

  /**
   * Export deals to CSV format
   */
  exportToCsv(
    deals: Record<string, any>[],
    options: ExportOptions
  ): Buffer {
    const columns = this.getColumnHeaders(options.columns);

    const csv = stringify(deals, {
      header: true,
      columns: columns.map((col) => ({
        key: col.header,
        header: col.header,
      })),
      quoted_string: true,
      escape: '"',
    });

    return Buffer.from(csv, 'utf-8');
  }

  /**
   * Export deals to Excel format
   */
  async exportToExcel(
    deals: Record<string, any>[],
    options: ExportOptions
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Deal Registration Automation';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Deals', {
      views: [{ state: 'frozen', ySplit: 1 }], // Freeze header row
    });

    const columns = this.getColumnHeaders(options.columns);

    // Set up columns with headers and widths
    sheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.header,
      width: col.width || 15,
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // Add data rows
    for (const deal of deals) {
      const rowData: Record<string, any> = {};
      for (const col of columns) {
        rowData[col.header] = deal[col.header] ?? '';
      }
      sheet.addRow(rowData);
    }

    // Add alternating row colors
    for (let i = 2; i <= sheet.rowCount; i++) {
      if (i % 2 === 0) {
        const row = sheet.getRow(i);
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
      }
    }

    // Add auto-filter
    if (deals.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: deals.length + 1, column: columns.length },
      };
    }

    // Add metadata sheet if requested
    if (options.includeMetadata) {
      const metaSheet = workbook.addWorksheet('Metadata');
      metaSheet.addRow(['Export Date', new Date().toISOString()]);
      metaSheet.addRow(['Total Records', deals.length]);
      metaSheet.addRow(['Generated By', 'Deal Registration Automation']);
    }

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Export deals to JSON format
   */
  exportToJson(
    deals: Record<string, any>[],
    options: ExportOptions
  ): Buffer {
    const output = options.includeMetadata
      ? {
          metadata: {
            exportDate: new Date().toISOString(),
            recordCount: deals.length,
            generator: 'Deal Registration Automation',
          },
          deals,
        }
      : deals;

    return Buffer.from(JSON.stringify(output, null, 2), 'utf-8');
  }

  /**
   * Clean a deal for export (apply formatters and flatten nested fields)
   */
  private cleanForExport(deal: ExtractedDeal): Record<string, any> {
    const cleaned: Record<string, any> = {};

    for (const mapping of this.columnMappings) {
      let value: any;

      // Handle nested field paths (e.g., 'sourceLocation.sourceFile')
      if (mapping.field.includes('.')) {
        const parts = mapping.field.split('.');
        value = parts.reduce((obj: any, key) => obj?.[key], deal);
      } else {
        value = (deal as any)[mapping.field];
      }

      // Apply formatter if provided
      if (mapping.formatter && value !== undefined && value !== null) {
        value = mapping.formatter(value);
      }

      cleaned[mapping.header] = value ?? '';
    }

    return cleaned;
  }

  /**
   * Get column headers based on options
   */
  private getColumnHeaders(customColumns?: string[]): ColumnMapping[] {
    if (!customColumns || customColumns.length === 0) {
      return this.columnMappings;
    }

    // Filter to only requested columns
    return this.columnMappings.filter((col) =>
      customColumns.includes(col.header) || customColumns.includes(col.field)
    );
  }

  /**
   * Write buffer to file
   */
  private async writeToFile(
    buffer: Buffer,
    options: ExportOptions,
    timestamp: Date
  ): Promise<string> {
    const outputDir = options.outputDir || PATHS.OUTPUT_CSV;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate filename
    const extension = options.format === 'xlsx' ? 'xlsx' : options.format;
    const defaultName = `deals_${timestamp.toISOString().replace(/[:.]/g, '-')}`;
    const fileName = options.fileName || defaultName;
    const fullFileName = fileName.includes('.') ? fileName : `${fileName}.${extension}`;

    const filePath = path.join(outputDir, fullFileName);

    // Write file
    fs.writeFileSync(filePath, buffer);
    logger.debug(`Exported to file: ${filePath}`);

    return filePath;
  }

  /**
   * Get a buffer without writing to file
   */
  async getBuffer(
    deals: ExtractedDeal[],
    format: 'csv' | 'xlsx' | 'json'
  ): Promise<Buffer> {
    const cleanedDeals = deals.map((deal) => this.cleanForExport(deal));

    switch (format) {
      case 'csv':
        return this.exportToCsv(cleanedDeals, { format });
      case 'xlsx':
        return this.exportToExcel(cleanedDeals, { format });
      case 'json':
        return this.exportToJson(cleanedDeals, { format });
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
}

export default EnhancedExportService;
