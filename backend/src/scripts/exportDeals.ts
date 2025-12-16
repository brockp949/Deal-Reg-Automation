/**
 * Export Deals Script
 *
 * Standalone script to export extracted deals to various formats.
 * Can be used independently of the processing pipeline.
 *
 * Usage:
 *   npm run transcript:export
 *   npm run transcript:export -- --format=xlsx
 *   npm run transcript:export -- --format=csv,xlsx,json
 *   npm run transcript:export -- --format=sheets
 *   npm run transcript:export -- --input=/path/to/deals.json
 *   npm run transcript:export -- --output-dir=/path/to/output
 */

import fs from 'fs';
import path from 'path';
import { ExportManager, ExportFormat, ExportResult } from '../services/export';
import { ExtractedDeal } from '../services/extraction/types';
import { PATHS, ensureDirectories } from '../config/paths';
import logger from '../utils/logger';

// Parse command line arguments
const args = process.argv.slice(2);
const formatArg = args.find(a => a.startsWith('--format='));
const inputArg = args.find(a => a.startsWith('--input='));
const outputDirArg = args.find(a => a.startsWith('--output-dir='));

const exportFormats: ExportFormat[] = formatArg
  ? formatArg.replace('--format=', '').split(',').map(f => f.trim() as ExportFormat)
  : ['csv'];

const inputPath = inputArg
  ? inputArg.replace('--input=', '')
  : null;

const outputDir = outputDirArg
  ? outputDirArg.replace('--output-dir=', '')
  : PATHS.OUTPUT_CSV;

/**
 * Load deals from the most recent JSON export or specified file
 */
async function loadDeals(customPath?: string | null): Promise<ExtractedDeal[]> {
  let dealsPath: string;

  if (customPath) {
    dealsPath = path.resolve(customPath);
  } else {
    // Find most recent JSON export
    const csvDir = PATHS.OUTPUT_CSV;
    if (!fs.existsSync(csvDir)) {
      throw new Error(`Output directory not found: ${csvDir}`);
    }

    const jsonFiles = fs.readdirSync(csvDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(csvDir, f),
        mtime: fs.statSync(path.join(csvDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (jsonFiles.length === 0) {
      throw new Error('No JSON exports found. Run transcript:process first.');
    }

    dealsPath = jsonFiles[0].path;
    logger.info(`Using most recent export: ${jsonFiles[0].name}`);
  }

  if (!fs.existsSync(dealsPath)) {
    throw new Error(`Input file not found: ${dealsPath}`);
  }

  const content = fs.readFileSync(dealsPath, 'utf-8');
  const data = JSON.parse(content);

  // Handle both raw array and { metadata, deals } format
  const deals = Array.isArray(data) ? data : data.deals;

  if (!Array.isArray(deals)) {
    throw new Error('Invalid input format: expected array of deals');
  }

  return deals;
}

/**
 * Main export function
 */
async function main(): Promise<void> {
  logger.info('=== Deal Export Tool ===');
  logger.info(`Formats: ${exportFormats.join(', ')}`);
  logger.info(`Output directory: ${outputDir}`);

  // Ensure directories exist
  ensureDirectories();

  // Load deals
  let deals: ExtractedDeal[];
  try {
    deals = await loadDeals(inputPath);
    logger.info(`Loaded ${deals.length} deal(s)`);
  } catch (error) {
    logger.error(`Failed to load deals: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (deals.length === 0) {
    logger.warn('No deals to export');
    return;
  }

  // Create export manager
  const exportManager = new ExportManager({
    includeExtendedColumns: true,
  });

  // Export to requested formats
  logger.info('');
  logger.info('=== Exporting ===');

  const results = await exportManager.exportMultiple(
    deals,
    exportFormats,
    {
      outputDir,
      includeMetadata: true,
    }
  );

  // Report results
  let successCount = 0;
  let failCount = 0;

  for (const [format, result] of results) {
    if (result.success) {
      successCount++;
      if (result.filePath) {
        logger.info(`  ${format.toUpperCase()}: ${result.filePath}`);
      } else if (result.spreadsheetUrl) {
        logger.info(`  ${format.toUpperCase()}: ${result.spreadsheetUrl}`);
      }
    } else {
      failCount++;
      logger.error(`  ${format.toUpperCase()}: Failed - ${result.error}`);
    }
  }

  // Summary
  logger.info('');
  logger.info('=== Export Summary ===');
  logger.info(`Deals exported: ${deals.length}`);
  logger.info(`Formats succeeded: ${successCount}/${exportFormats.length}`);

  if (failCount > 0) {
    logger.warn(`Formats failed: ${failCount}`);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
