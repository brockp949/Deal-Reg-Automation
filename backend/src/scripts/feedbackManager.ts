import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import AnnotationService from '../feedback/AnnotationService';
import { promises as fs } from 'fs';

interface FeedbackOptions {
  importFile?: string;
  reviewer?: string;
  list?: boolean;
}

function parseArgs(): FeedbackOptions {
  const args = process.argv.slice(2);
  const options: FeedbackOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--import' && args[i + 1]) {
      options.importFile = args[++i];
    } else if (args[i] === '--reviewer' && args[i + 1]) {
      options.reviewer = args[++i];
    } else if (args[i] === '--list') {
      options.list = true;
    }
  }
  return options;
}

async function printSummary(baseDir: string) {
  try {
    const resolvedSummary = path.resolve(baseDir, 'opportunities', 'feedback-summary.json');
    const raw = await fs.readFile(resolvedSummary, 'utf-8');
    logger.info('Feedback summary', JSON.parse(raw));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.warn('No feedback summary available yet. Run `npm run source:ci` after importing annotations.');
      return;
    }
    throw error;
  }
}

export async function main(optionsOverride?: FeedbackOptions) {
  const options = optionsOverride ?? parseArgs();
  const annotationService = new AnnotationService({ baseDir: config.upload.directory });

  if (!options.importFile && !options.list) {
    throw new Error('Specify --import <file> to ingest annotations or --list to view summary.');
  }

  if (options.importFile) {
    const { added, updated } = await annotationService.importAnnotations(
      path.resolve(options.importFile),
      options.reviewer
    );
    logger.info('Feedback import complete', { added, updated, reviewer: options.reviewer });
  }

  if (options.list) {
    await printSummary(config.upload.directory);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Feedback manager failed', { error: error.message });
    process.exit(1);
  });
}
