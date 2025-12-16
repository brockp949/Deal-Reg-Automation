/**
 * Export Service Types
 *
 * Type definitions for export functionality.
 */

import { ExtractedDeal } from '../extraction/types';

/**
 * Supported export formats
 */
export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'sheets';

/**
 * Export options configuration
 */
export interface ExportOptions {
  /** Export format */
  format: ExportFormat;
  /** Custom columns to include (default: all) */
  columns?: string[];
  /** Include metadata fields */
  includeMetadata?: boolean;
  /** Custom output file name */
  fileName?: string;
  /** Output directory path */
  outputDir?: string;
}

/**
 * Google Sheets specific options
 */
export interface GoogleSheetsOptions {
  /** Spreadsheet ID */
  spreadsheetId: string;
  /** Sheet name within the spreadsheet */
  sheetName?: string;
  /** Whether to append or replace data */
  appendMode?: boolean;
  /** Start row for data (1-indexed) */
  startRow?: number;
  /** Clear existing data before writing */
  clearExisting?: boolean;
}

/**
 * Export result metadata
 */
export interface ExportResult {
  /** Whether export was successful */
  success: boolean;
  /** Export format used */
  format: ExportFormat;
  /** Number of deals exported */
  recordCount: number;
  /** Output file path (for file exports) */
  filePath?: string;
  /** File size in bytes (for file exports) */
  fileSize?: number;
  /** Spreadsheet URL (for Google Sheets) */
  spreadsheetUrl?: string;
  /** Any warnings during export */
  warnings: string[];
  /** Error message if failed */
  error?: string;
  /** Export timestamp */
  timestamp: Date;
}

/**
 * Column mapping for export
 */
export interface ColumnMapping {
  /** Internal field name */
  field: keyof ExtractedDeal | string;
  /** Display header name */
  header: string;
  /** Column width (for Excel) */
  width?: number;
  /** Data formatter function */
  formatter?: (value: any) => string;
}

/**
 * Default column mappings for deal export
 */
export const DEFAULT_COLUMN_MAPPINGS: ColumnMapping[] = [
  { field: 'dealName', header: 'Deal Name', width: 30 },
  { field: 'customerName', header: 'Customer Name', width: 25 },
  { field: 'dealValue', header: 'Deal Value', width: 15, formatter: (v) => v ? `$${v.toLocaleString()}` : '' },
  { field: 'currency', header: 'Currency', width: 10 },
  { field: 'status', header: 'Status', width: 15 },
  { field: 'owner', header: 'Owner', width: 20 },
  { field: 'expectedCloseDate', header: 'Expected Close', width: 15, formatter: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
  { field: 'probability', header: 'Probability', width: 12, formatter: (v) => v ? `${v}%` : '' },
  { field: 'decisionMaker', header: 'Decision Maker', width: 20 },
  { field: 'confidence', header: 'Confidence', width: 12, formatter: (v) => v ? `${(v * 100).toFixed(0)}%` : '' },
];

/**
 * Extended column mappings including source info
 */
export const EXTENDED_COLUMN_MAPPINGS: ColumnMapping[] = [
  ...DEFAULT_COLUMN_MAPPINGS,
  { field: 'sourceLocation.sourceFile', header: 'Source File', width: 30 },
  { field: 'sourceLocation.startLine', header: 'Start Line', width: 12 },
  { field: 'sourceLocation.endLine', header: 'End Line', width: 12 },
];
