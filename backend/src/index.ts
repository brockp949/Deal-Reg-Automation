import app from './app';
import { config } from './config';
import logger from './utils/logger';
import pool from './db';

// Start server
const PORT = config.port;
const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`API prefix: ${config.apiPrefix}`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(() => logger.info('HTTP server closed'));
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
