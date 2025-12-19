import app from './app';
import { config } from './config';
import logger from './utils/logger';
import pool from './db';
import ensureMigrations from './db/ensureMigrations';
import { startSyncScheduler, stopSyncScheduler } from './services/syncScheduler';
import { closeSyncQueue } from './queues/syncProcessingQueue';
import './queues/unifiedProcessingQueue'; // Register unified processing queue processor
import { closeUnifiedQueue } from './queues/unifiedProcessingQueue';

function registerDiagnostics() {
  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled promise rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
    });
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  });

  process.on('warning', (warning) => {
    logger.warn('Process warning', { name: warning.name, message: warning.message, stack: warning.stack });
  });
}

registerDiagnostics();

async function start() {
  await ensureMigrations();

  // Start server
  const PORT = config.port;
  const server = app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`API prefix: ${config.apiPrefix}`);

    // Start sync scheduler after server is up
    if (config.connectors.googleOAuth2?.gmailCredentialsPath || config.connectors.googleOAuth2?.driveCredentialsPath) {
      startSyncScheduler();
      logger.info('Google sync scheduler started');
    }
  });

  // Graceful shutdown
  async function shutdown(signal: string) {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(() => logger.info('HTTP server closed'));

    // Stop sync scheduler and close queues
    stopSyncScheduler();
    await closeSyncQueue();
    await closeUnifiedQueue();
    logger.info('All services stopped');

    await pool.end();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});

export default app;
