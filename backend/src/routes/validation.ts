/**
 * Validation API Routes
 *
 * Provides pre-upload validation and preview functionality:
 * - File structure validation
 * - Column mapping preview
 * - Sample data extraction
 * - Warning and error detection
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import logger from '../utils/logger';
import { getParserRegistry, type FileIntent } from '../parsers/ParserRegistry';
import { getErrorGuidanceService } from '../services/ErrorGuidanceService';

const router = Router();

// Configure multer for temporary file uploads
const upload = multer({
  dest: path.join(process.cwd(), 'uploads', 'temp'),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for validation
  },
});

export interface ValidationResult {
  isValid: boolean;
  confidence: number;  // 0-1 confidence in validation results
  detectedIntent: FileIntent;
  fileInfo: {
    name: string;
    size: number;
    type: string;
    encoding?: string;
  };
  structure: {
    columns: Array<{
      name: string;
      mappedTo?: string;  // Target field it maps to
      sampleValues: any[];
      dataType: string;  // 'string' | 'number' | 'date' | 'boolean' | 'mixed'
      nullCount: number;
      confidence: number;
    }>;
    rowCount: number;
    hasHeaders: boolean;
  };
  preview: {
    estimatedRecords: number;
    sampleRecords: any[];  // Up to 5 sample extracted records
  };
  warnings: Array<{
    severity: 'high' | 'medium' | 'low';
    message: string;
    column?: string;
    suggestedFix?: string;
  }>;
  errors: Array<{
    message: string;
    column?: string;
    row?: number;
  }>;
  suggestions: {
    autoFixes: Array<{
      type: string;
      description: string;
      affectedColumns: string[];
    }>;
    manualActions: string[];
  };
  estimatedProcessingTime: string;
}

/**
 * POST /api/validation/preview
 * Preview file contents and validate structure before full upload
 */
router.post('/preview', upload.single('file'), async (req: Request, res: Response) => {
  const uploadedFile = req.file;
  const intent = (req.body.intent || 'auto') as FileIntent;

  if (!uploadedFile) {
    return res.status(400).json({
      success: false,
      error: 'No file uploaded',
    });
  }

  try {
    logger.info('Starting file validation preview', {
      fileName: uploadedFile.originalname,
      size: uploadedFile.size,
      intent,
    });

    // Get parser registry
    const registry = getParserRegistry();

    // Read file content (only first portion for large files)
    const fileBuffer = await fs.readFile(uploadedFile.path);
    const maxPreviewSize = 5 * 1024 * 1024; // 5MB preview
    const previewBuffer = fileBuffer.slice(0, Math.min(fileBuffer.length, maxPreviewSize));

    // Create temporary file metadata
    const fileMetadata = {
      filename: uploadedFile.originalname,
      mime_type: uploadedFile.mimetype,
      file_size: uploadedFile.size,
      path: uploadedFile.path,
      uploadedAt: new Date(),
    };

    // Parse first portion of file for preview
    const parseResult = await registry.parse(fileMetadata as any, intent as any, { preview: true });

    // Analyze structure and extract insights
    const validation = await analyzeFileStructure(
      fileMetadata,
      parseResult,
      intent,
      previewBuffer
    );

    logger.info('File validation completed', {
      fileName: uploadedFile.originalname,
      isValid: validation.isValid,
      warnings: validation.warnings.length,
      errors: validation.errors.length,
    });

    res.json({
      success: true,
      data: validation,
    });
  } catch (error: any) {
    logger.error('File validation failed', {
      fileName: uploadedFile?.originalname,
      error: error.message,
    });

    // Generate error guidance
    const errorGuidanceService = getErrorGuidanceService();
    const errorGuidance = await errorGuidanceService.generateActionableError({
      message: error.message,
      context: {
        fileName: uploadedFile?.originalname,
        fileType: uploadedFile?.mimetype,
        stage: 'validation',
      },
    });

    res.status(500).json({
      success: false,
      error: 'Failed to validate file',
      message: error.message,
      guidance: errorGuidance,
    });
  } finally {
    // Clean up temporary file
    if (uploadedFile) {
      try {
        await fs.unlink(uploadedFile.path);
      } catch (unlinkError) {
        logger.warn('Failed to delete temporary validation file', {
          path: uploadedFile.path,
        });
      }
    }
  }
});

/**
 * Analyze file structure and generate validation insights
 */
async function analyzeFileStructure(
  fileMetadata: any,
  parseResult: any,
  intent: FileIntent,
  previewBuffer: Buffer
): Promise<ValidationResult> {
  const warnings: ValidationResult['warnings'] = [];
  const errors: ValidationResult['errors'] = [];
  const autoFixes: ValidationResult['suggestions']['autoFixes'] = [];
  const manualActions: string[] = [];

  // Analyze columns (for spreadsheet-based files)
  const columns: ValidationResult['structure']['columns'] = [];
  let hasHeaders = true;
  let rowCount = 0;

  if (parseResult.vendors && parseResult.vendors.length > 0) {
    rowCount = parseResult.vendors.length;
    const sampleVendor = parseResult.vendors[0];

    Object.keys(sampleVendor).forEach((key) => {
      const sampleValues = parseResult.vendors
        .slice(0, 5)
        .map((v: any) => v[key])
        .filter((val: any) => val !== null && val !== undefined);

      const dataType = detectDataType(sampleValues);
      const nullCount = parseResult.vendors.filter((v: any) => !v[key]).length;

      columns.push({
        name: key,
        mappedTo: key, // TODO: Implement intelligent column mapping
        sampleValues: sampleValues.slice(0, 3),
        dataType,
        nullCount,
        confidence: 0.9, // TODO: Calculate actual confidence
      });

      // Check for issues
      if (nullCount > parseResult.vendors.length * 0.5) {
        warnings.push({
          severity: 'medium',
          message: `Column "${key}" has ${nullCount} null values (${Math.round((nullCount / parseResult.vendors.length) * 100)}%)`,
          column: key,
          suggestedFix: 'Consider removing this column or providing default values',
        });
      }
    });
  }

  if (parseResult.deals && parseResult.deals.length > 0) {
    rowCount = Math.max(rowCount, parseResult.deals.length);

    // Similar analysis for deals
    const sampleDeal = parseResult.deals[0];
    Object.keys(sampleDeal).forEach((key) => {
      if (!columns.find((c) => c.name === key)) {
        const sampleValues = parseResult.deals
          .slice(0, 5)
          .map((d: any) => d[key])
          .filter((val: any) => val !== null && val !== undefined);

        const dataType = detectDataType(sampleValues);
        const nullCount = parseResult.deals.filter((d: any) => !d[key]).length;

        columns.push({
          name: key,
          mappedTo: key,
          sampleValues: sampleValues.slice(0, 3),
          dataType,
          nullCount,
          confidence: 0.9,
        });
      }
    });
  }

  // Check for common issues
  if (columns.length === 0) {
    errors.push({
      message: 'No columns detected. File may be empty or in an unsupported format.',
    });
  }

  if (rowCount === 0) {
    errors.push({
      message: 'No data rows detected. File appears to be empty.',
    });
  }

  // Check for date format issues
  const dateColumns = columns.filter((c) => c.dataType === 'date' || c.name.toLowerCase().includes('date'));
  dateColumns.forEach((col) => {
    if (col.dataType !== 'date') {
      warnings.push({
        severity: 'high',
        message: `Column "${col.name}" appears to be a date but couldn't be parsed`,
        column: col.name,
        suggestedFix: 'Use ISO format (YYYY-MM-DD) or MM/DD/YYYY',
      });

      autoFixes.push({
        type: 'FIX_DATE_FORMAT',
        description: `Auto-convert "${col.name}" to standard date format`,
        affectedColumns: [col.name],
      });
    }
  });

  // Check for currency format issues
  const valueColumns = columns.filter((c) =>
    c.name.toLowerCase().includes('value') ||
    c.name.toLowerCase().includes('price') ||
    c.name.toLowerCase().includes('amount')
  );
  valueColumns.forEach((col) => {
    if (col.dataType !== 'number') {
      warnings.push({
        severity: 'medium',
        message: `Column "${col.name}" should contain numeric values`,
        column: col.name,
        suggestedFix: 'Remove currency symbols and use plain numbers',
      });

      autoFixes.push({
        type: 'FIX_CURRENCY_FORMAT',
        description: `Remove currency symbols from "${col.name}"`,
        affectedColumns: [col.name],
      });
    }
  });

  // Estimate processing time (rough estimate)
  const estimatedTimeSeconds = Math.max(5, Math.ceil(rowCount / 1000) * 2);
  const estimatedTimeString = formatDuration(estimatedTimeSeconds * 1000);

  // Generate sample extracted records
  const sampleRecords = [];
  if (parseResult.vendors) {
    sampleRecords.push(...parseResult.vendors.slice(0, 3).map((v: any) => ({
      type: 'vendor',
      data: v,
    })));
  }
  if (parseResult.deals) {
    sampleRecords.push(...parseResult.deals.slice(0, 2).map((d: any) => ({
      type: 'deal',
      data: d,
    })));
  }

  const isValid = errors.length === 0;
  const confidence = isValid ? (warnings.length === 0 ? 1.0 : 0.8) : 0.3;

  return {
    isValid,
    confidence,
    detectedIntent: intent,
    fileInfo: {
      name: fileMetadata.filename,
      size: fileMetadata.file_size,
      type: fileMetadata.mime_type,
    },
    structure: {
      columns,
      rowCount,
      hasHeaders,
    },
    preview: {
      estimatedRecords: rowCount,
      sampleRecords,
    },
    warnings,
    errors,
    suggestions: {
      autoFixes,
      manualActions,
    },
    estimatedProcessingTime: estimatedTimeString,
  };
}

/**
 * Detect data type from sample values
 */
function detectDataType(values: any[]): string {
  if (values.length === 0) return 'unknown';

  const types = values.map((val) => {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'number') return 'number';
    if (typeof val === 'boolean') return 'boolean';
    if (val instanceof Date || !isNaN(Date.parse(val))) return 'date';
    return 'string';
  });

  const uniqueTypes = [...new Set(types.filter((t) => t !== 'null'))];

  if (uniqueTypes.length === 0) return 'null';
  if (uniqueTypes.length === 1) return uniqueTypes[0];
  return 'mixed';
}

/**
 * Format duration (milliseconds) to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return 'less than a second';
  if (ms < 60000) return `${Math.round(ms / 1000)} seconds`;

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);

  if (seconds > 0) {
    return `${minutes} min ${seconds} sec`;
  }
  return `${minutes} min`;
}

export default router;
