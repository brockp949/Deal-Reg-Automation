/**
 * Base Parser Class
 *
 * Abstract base class that all file parsers must extend.
 * Provides common functionality and enforces standardized output format.
 */

import logger from '../utils/logger';
import {
  IParser,
  StandardizedParserOutput,
  ValidationResult,
  ParserMetadata,
  BaseParserOptions,
  FileType,
  SourceType,
  ParsingError,
  ParsingWarning,
  ParsingErrorSeverity,
  ExtractionMethod,
  NormalizedVendor,
  NormalizedDeal,
  NormalizedContact,
} from '../types/parsing';

export abstract class BaseParser implements IParser {
  protected readonly parserName: string;
  protected readonly parserVersion: string;
  protected readonly supportedFileTypes: FileType[];

  constructor(
    name: string,
    version: string,
    supportedTypes: FileType[]
  ) {
    this.parserName = name;
    this.parserVersion = version;
    this.supportedFileTypes = supportedTypes;
  }

  /**
   * Abstract method that concrete parsers must implement
   */
  abstract parse(filePath: string, options?: BaseParserOptions): Promise<StandardizedParserOutput>;

  /**
   * Validate the standardized output
   */
  validate(output: StandardizedParserOutput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate metadata
    if (!output.metadata) {
      errors.push('Missing metadata');
    } else {
      if (!output.metadata.sourceType) errors.push('Missing metadata.sourceType');
      if (!output.metadata.fileType) errors.push('Missing metadata.fileType');
      if (!output.metadata.fileName) errors.push('Missing metadata.fileName');
      if (!output.metadata.parsingMethod) errors.push('Missing metadata.parsingMethod');
      if (!output.metadata.parsedAt) errors.push('Missing metadata.parsedAt');
    }

    // Validate entities
    if (!output.entities) {
      errors.push('Missing entities');
    } else {
      if (!Array.isArray(output.entities.vendors)) errors.push('entities.vendors must be an array');
      if (!Array.isArray(output.entities.deals)) errors.push('entities.deals must be an array');
      if (!Array.isArray(output.entities.contacts)) errors.push('entities.contacts must be an array');

      // Validate entity counts match metadata
      if (output.metadata && output.metadata.recordCount) {
        if (output.entities.vendors.length !== output.metadata.recordCount.vendors) {
          warnings.push('Vendor count mismatch between entities and metadata');
        }
        if (output.entities.deals.length !== output.metadata.recordCount.deals) {
          warnings.push('Deal count mismatch between entities and metadata');
        }
        if (output.entities.contacts.length !== output.metadata.recordCount.contacts) {
          warnings.push('Contact count mismatch between entities and metadata');
        }
      }
    }

    // Validate statistics
    if (!output.statistics) {
      errors.push('Missing statistics');
    } else {
      if (!output.statistics.confidence) {
        errors.push('Missing statistics.confidence');
      }
      if (!output.statistics.extractionMethods) {
        errors.push('Missing statistics.extractionMethods');
      }
    }

    // Validate errors and warnings arrays exist
    if (!Array.isArray(output.errors)) {
      errors.push('errors must be an array');
    }
    if (!Array.isArray(output.warnings)) {
      errors.push('warnings must be an array');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get parser metadata
   */
  getMetadata(): ParserMetadata {
    return {
      name: this.parserName,
      version: this.parserVersion,
      supportedFileTypes: this.supportedFileTypes,
      capabilities: this.getCapabilities(),
    };
  }

  /**
   * Get parser capabilities (override in subclasses)
   */
  protected getCapabilities(): string[] {
    return ['basic_parsing'];
  }

  /**
   * Create a standardized parser output skeleton
   */
  protected createOutputSkeleton(
    fileName: string,
    sourceType: SourceType,
    fileType: FileType,
    fileSize?: number
  ): StandardizedParserOutput {
    return {
      metadata: {
        sourceType,
        fileType,
        fileName,
        fileSize,
        parsingMethod: this.parserName,
        parsingVersion: this.parserVersion,
        parsedAt: new Date(),
        recordCount: {
          vendors: 0,
          deals: 0,
          contacts: 0,
          total: 0,
        },
      },
      entities: {
        vendors: [],
        deals: [],
        contacts: [],
      },
      errors: [],
      warnings: [],
      statistics: {
        confidence: {
          avgConfidence: 0,
          minConfidence: 1,
          maxConfidence: 0,
          lowConfidenceCount: 0,
        },
        extractionMethods: {} as Record<ExtractionMethod, number>,
      },
    };
  }

  /**
   * Update record counts in metadata
   */
  protected updateRecordCounts(output: StandardizedParserOutput): void {
    output.metadata.recordCount = {
      vendors: output.entities.vendors.length,
      deals: output.entities.deals.length,
      contacts: output.entities.contacts.length,
      total: output.entities.vendors.length + output.entities.deals.length + output.entities.contacts.length,
    };
  }

  /**
   * Calculate confidence statistics
   */
  protected calculateConfidenceStats(output: StandardizedParserOutput): void {
    const allConfidences: number[] = [];

    // Collect all confidence scores
    output.entities.vendors.forEach((v) => {
      if (v.confidence !== undefined) allConfidences.push(v.confidence);
    });
    output.entities.deals.forEach((d) => {
      if (d.confidence_score !== undefined) allConfidences.push(d.confidence_score);
    });

    if (allConfidences.length === 0) {
      output.statistics.confidence = {
        avgConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
        lowConfidenceCount: 0,
      };
      return;
    }

    const avg = allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length;
    const min = Math.min(...allConfidences);
    const max = Math.max(...allConfidences);
    const lowCount = allConfidences.filter((c) => c < 0.5).length;

    output.statistics.confidence = {
      avgConfidence: avg,
      minConfidence: min,
      maxConfidence: max,
      lowConfidenceCount: lowCount,
    };
  }

  /**
   * Count extraction methods used
   */
  protected countExtractionMethods(output: StandardizedParserOutput): void {
    const methods: Record<string, number> = {};

    output.entities.deals.forEach((deal) => {
      if (deal.extraction_method) {
        methods[deal.extraction_method] = (methods[deal.extraction_method] || 0) + 1;
      }
    });

    output.statistics.extractionMethods = methods as Record<ExtractionMethod, number>;
  }

  /**
   * Finalize output (call this before returning)
   */
  protected finalizeOutput(output: StandardizedParserOutput, processingStartTime: number): StandardizedParserOutput {
    // Update counts
    this.updateRecordCounts(output);

    // Calculate statistics
    this.calculateConfidenceStats(output);
    this.countExtractionMethods(output);

    // Set processing time
    output.metadata.processingTime = Date.now() - processingStartTime;

    // Validate output
    const validation = this.validate(output);
    if (!validation.isValid) {
      logger.warn('Parser output validation failed', {
        parser: this.parserName,
        errors: validation.errors,
        warnings: validation.warnings,
      });

      // Add validation errors to output
      validation.errors.forEach((error) => {
        output.errors.push({
          severity: ParsingErrorSeverity.ERROR,
          message: `Validation error: ${error}`,
          recoverable: true,
        });
      });
    }

    return output;
  }

  /**
   * Add error to output
   */
  protected addError(
    output: StandardizedParserOutput,
    message: string,
    severity: ParsingErrorSeverity = ParsingErrorSeverity.ERROR,
    location?: string,
    context?: any,
    recoverable: boolean = true
  ): void {
    output.errors.push({
      severity,
      message,
      location,
      context,
      recoverable,
    });

    logger.error(`Parser error: ${message}`, {
      parser: this.parserName,
      severity,
      location,
      context,
    });
  }

  /**
   * Add warning to output
   */
  protected addWarning(
    output: StandardizedParserOutput,
    message: string,
    location?: string,
    suggestion?: string
  ): void {
    output.warnings.push({
      message,
      location,
      suggestion,
    });

    logger.warn(`Parser warning: ${message}`, {
      parser: this.parserName,
      location,
      suggestion,
    });
  }

  /**
   * Filter entities by confidence threshold
   */
  protected filterByConfidence(
    output: StandardizedParserOutput,
    threshold: number
  ): void {
    if (threshold <= 0) return;

    const originalCounts = { ...output.metadata.recordCount };

    // Filter vendors
    output.entities.vendors = output.entities.vendors.filter((v) => {
      return !v.confidence || v.confidence >= threshold;
    });

    // Filter deals
    output.entities.deals = output.entities.deals.filter((d) => {
      return !d.confidence_score || d.confidence_score >= threshold;
    });

    // Log if any entities were filtered
    const vendorsFiltered = originalCounts.vendors - output.entities.vendors.length;
    const dealsFiltered = originalCounts.deals - output.entities.deals.length;

    if (vendorsFiltered > 0 || dealsFiltered > 0) {
      logger.info('Entities filtered by confidence threshold', {
        threshold,
        vendorsFiltered,
        dealsFiltered,
      });

      this.addWarning(
        output,
        `Filtered ${vendorsFiltered} vendors and ${dealsFiltered} deals below confidence threshold ${threshold}`,
        undefined,
        'Lower the confidence threshold to include more entities'
      );
    }
  }

  /**
   * Log parsing summary
   */
  protected logParsingSummary(output: StandardizedParserOutput): void {
    logger.info('Parsing complete', {
      parser: this.parserName,
      fileName: output.metadata.fileName,
      vendors: output.metadata.recordCount.vendors,
      deals: output.metadata.recordCount.deals,
      contacts: output.metadata.recordCount.contacts,
      processingTime: output.metadata.processingTime,
      errors: output.errors.length,
      warnings: output.warnings.length,
      avgConfidence: output.statistics.confidence.avgConfidence.toFixed(2),
    });
  }
}
