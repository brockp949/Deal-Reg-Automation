import dotenv from 'dotenv';
import { fileProcessingQueue, getQueueStats, cleanOldJobs, closeQueue } from '../queues/fileProcessingQueue';
import { vendorImportQueue, getVendorImportQueueStats } from '../queues/vendorImportQueue';
import '../queues/unifiedProcessingQueue'; // Import to register the processor
import logger from '../utils/logger';

// Load environment variables
dotenv.config();

logger.info('Starting worker for file processing and vendor imports...');

// Log queue stats periodically
setInterval(async () => {
  try {
    const fileStats = await getQueueStats();
    const vendorStats = await getVendorImportQueueStats();
    logger.info('Queue statistics', {
      fileProcessing: fileStats,
      vendorImport: vendorStats,
    });
  } catch (error: any) {
    logger.error('Error getting queue stats', { error: error.message });
  }
}, 60000); // Every minute

// Clean old jobs daily
setInterval(async () => {
  try {
    await cleanOldJobs();
  } catch (error: any) {
    logger.error('Error cleaning old jobs', { error: error.message });
  }
}, 24 * 60 * 60 * 1000); // Every 24 hours

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down worker...');
  await closeQueue(); // File processing queue
  await vendorImportQueue.close(); // Vendor import queue
  logger.info('All queues closed');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Worker started successfully - processing file uploads and vendor imports');
logger.info('Waiting for jobs...');