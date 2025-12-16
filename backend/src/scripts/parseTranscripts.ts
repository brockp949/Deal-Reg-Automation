/**
 * Parse Transcripts Script
 *
 * This script processes all transcript files in the input_transcripts directory
 * and extracts deals from them using the DealSeparator and DealExtractor services.
 *
 * Usage:
 *   npm run transcript:process
 *   npm run transcript:process -- --files="path1 path2"
 *   npm run transcript:process -- --dry-run
 *   npm run transcript:process -- --no-archive
 *   npm run transcript:process -- --no-dedupe
 *   npm run transcript:process -- --min-confidence=0.5
 *   npm run transcript:process -- --format=xlsx
 *   npm run transcript:process -- --format=csv,xlsx,json
 *   npm run transcript:process -- --format=sheets
 *   npm run transcript:process -- --output-dir=/path/to/output
 */

import path from 'path';
import { ParserFactory } from '../parsers/ParserFactory';
import { ParsedDocument } from '../parsers/types/documentTypes';
import {
  createBatchProcessor,
  FileProcessorCallback,
  BatchProcessingResult,
} from '../services/ingestion/BatchProcessor';
import {
  ensureDirectories,
  listInputFiles,
  PATHS,
} from '../config/paths';
import { DealSeparator } from '../services/extraction/DealSeparator';
import { DealExtractor, ExtractedDeal } from '../services/extraction';
import { ExportManager, ExportFormat } from '../services/export';
import logger from '../utils/logger';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noArchive = args.includes('--no-archive');
const noDedupe = args.includes('--no-dedupe');
const filesArg = args.find(a => a.startsWith('--files='));
const minConfidenceArg = args.find(a => a.startsWith('--min-confidence='));
const formatArg = args.find(a => a.startsWith('--format='));
const outputDirArg = args.find(a => a.startsWith('--output-dir='));

const minConfidence = minConfidenceArg
  ? parseFloat(minConfidenceArg.replace('--min-confidence=', ''))
  : 0.3;

// Parse export formats
const exportFormats: ExportFormat[] = formatArg
  ? formatArg.replace('--format=', '').split(',').map(f => f.trim() as ExportFormat)
  : ['csv'];

const outputDir = outputDirArg
  ? outputDirArg.replace('--output-dir=', '')
  : undefined;

/**
 * Main processing function
 */
async function main(): Promise<void> {
  logger.info('=== Transcript Processing Pipeline (v3) ===');

  // Ensure directories exist
  ensureDirectories();

  // Get files to process
  let filesToProcess: string[];

  if (filesArg) {
    filesToProcess = filesArg
      .replace('--files=', '')
      .split(' ')
      .filter(Boolean)
      .map(f => path.resolve(f));
  } else {
    filesToProcess = listInputFiles();
  }

  if (filesToProcess.length === 0) {
    logger.info('No files to process in input_transcripts directory');
    logger.info('Add files to the following directories:');
    logger.info(`  - ${PATHS.INPUT_MBOX}`);
    logger.info(`  - ${PATHS.INPUT_PDF}`);
    logger.info(`  - ${PATHS.INPUT_DOCX}`);
    logger.info(`  - ${PATHS.INPUT_TXT}`);
    return;
  }

  logger.info(`Found ${filesToProcess.length} file(s) to process`);
  logger.info(`Options: dedupe=${!noDedupe}, minConfidence=${minConfidence}, formats=${exportFormats.join(',')}`);

  // Create batch processor
  const batchProcessor = createBatchProcessor({
    archiveAfterProcessing: !noArchive && !dryRun,
    continueOnError: true,
    skipDuplicates: true,
    dryRun,
  });

  // Load previously processed checksums
  await batchProcessor.loadProcessedChecksums();

  // Create extraction services
  const separator = new DealSeparator({
    minConfidence: 0.2,
    mergeOverlapping: true,
  });

  const extractor = new DealExtractor({
    deduplicate: !noDedupe,
    deduplicationThreshold: 0.85,
    minConfidence,
  });

  // Create export manager
  const exportManager = new ExportManager({
    includeExtendedColumns: true,
  });

  // Track all extracted deals
  const allDeals: ExtractedDeal[] = [];
  let totalDuplicatesRemoved = 0;

  // Create file processor callback
  const processFile: FileProcessorCallback = async (filePath, metadata) => {
    const fileName = path.basename(filePath);
    logger.info(`Processing: ${fileName}`);

    // Check if parser can handle this file
    if (!ParserFactory.canParse(filePath)) {
      logger.warn(`Unsupported file type: ${path.extname(filePath)}`);
      return { dealsExtracted: 0 };
    }

    // Parse the document
    const parsed: ParsedDocument = await ParserFactory.parse(filePath, {
      enableOCR: true,
      normalizeWhitespace: true,
      sortTextByPosition: true,
    });

    if (!parsed.success) {
      logger.error(`Failed to parse: ${filePath}`);
      for (const error of parsed.errors) {
        logger.error(`  - ${error.message}`);
      }
      return { dealsExtracted: 0 };
    }

    logger.info(`  Extracted ${parsed.rawText.length} characters`);

    // Step 1: Separate deals (find boundaries)
    const separationResult = await separator.separateDeals(parsed.rawText);
    logger.info(`  Found ${separationResult.boundaries.length} deal boundaries`);

    if (separationResult.warnings.length > 0) {
      for (const warning of separationResult.warnings) {
        logger.warn(`  Warning: ${warning}`);
      }
    }

    // Step 2: Extract deals from boundaries
    const extractionResult = await extractor.extractDeals(
      parsed.rawText,
      separationResult.boundaries
    );

    // Add source file to each deal
    for (const deal of extractionResult.deals) {
      deal.sourceLocation.sourceFile = fileName;
    }

    allDeals.push(...extractionResult.deals);
    totalDuplicatesRemoved += extractionResult.duplicates.length;

    logger.info(`  Extracted ${extractionResult.deals.length} deal(s)`);
    if (extractionResult.duplicates.length > 0) {
      logger.info(`  Removed ${extractionResult.duplicates.length} duplicate(s)`);
    }

    // Log extraction statistics
    const stats = extractionResult.statistics;
    logger.debug(`  Fields extracted:`, stats.fieldsExtracted);

    return {
      dealsExtracted: extractionResult.deals.length,
      data: extractionResult.deals,
    };
  };

  // Process all files
  const result: BatchProcessingResult = await batchProcessor.processFiles(
    filesToProcess,
    processFile
  );

  // Print summary
  console.log('');
  logger.info('=== Processing Summary ===');
  logger.info(`Total files: ${result.totalFiles}`);
  logger.info(`Processed: ${result.processed}`);
  logger.info(`Failed: ${result.failed}`);
  logger.info(`Skipped: ${result.skipped}`);
  logger.info(`Total deals extracted: ${allDeals.length}`);
  logger.info(`Duplicates removed: ${totalDuplicatesRemoved}`);
  logger.info(`Duration: ${result.durationMs}ms`);

  // Print deal summary
  if (allDeals.length > 0) {
    console.log('');
    logger.info('=== Deals Found ===');
    for (const deal of allDeals) {
      const value = deal.dealValue ? `$${deal.dealValue.toLocaleString()}` : 'N/A';
      const status = deal.status || 'Unknown';
      const confidence = `${(deal.confidence * 100).toFixed(0)}%`;
      logger.info(`  - ${deal.dealName} | ${deal.customerName || 'N/A'} | ${value} | ${status} | ${confidence}`);
    }
  }

  // Export to requested formats
  if (allDeals.length > 0 && !dryRun) {
    console.log('');
    logger.info('=== Exporting Results ===');

    const exportResults = await exportManager.exportMultiple(
      allDeals,
      exportFormats,
      {
        outputDir: outputDir || PATHS.OUTPUT_CSV,
        includeMetadata: true,
      }
    );

    // Report export results
    for (const [format, exportResult] of exportResults) {
      if (exportResult.success) {
        if (exportResult.filePath) {
          logger.info(`  ${format.toUpperCase()}: ${exportResult.filePath}`);
        } else if (exportResult.spreadsheetUrl) {
          logger.info(`  ${format.toUpperCase()}: ${exportResult.spreadsheetUrl}`);
        }
      } else {
        logger.error(`  ${format.toUpperCase()}: Failed - ${exportResult.error}`);
      }
    }
  }

  // Log any failures
  if (result.failed > 0) {
    console.log('');
    logger.warn('Failed files:');
    for (const file of result.files) {
      if (file.status === 'failed') {
        logger.warn(`  - ${file.fileName}: ${file.error}`);
      }
    }
  }
}

// Run the script
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
