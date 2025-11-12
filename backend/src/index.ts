import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import logger from './utils/logger';
import pool from './db';

// Import routes
import vendorRoutes from './routes/vendors';
import vendorImportRoutes from './routes/vendorImport';
import dealRoutes from './routes/deals';
import fileRoutes from './routes/files';
import contactRoutes from './routes/contacts';
import exportRoutes from './routes/export';
import queueRoutes from './routes/queue';
import reprocessRoutes from './routes/reprocess';
import vendorReviewRoutes from './routes/vendorReview';
import provenanceRoutes from './routes/provenance';
import errorTrackingRoutes from './routes/errorTracking';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim()),
  },
}));

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
    });
  }
});

// API Routes
app.use(`${config.apiPrefix}/vendors`, vendorRoutes);
app.use(`${config.apiPrefix}/vendors`, vendorImportRoutes); // Vendor import endpoints
app.use(`${config.apiPrefix}/deals`, dealRoutes);
app.use(`${config.apiPrefix}/files`, fileRoutes);
app.use(`${config.apiPrefix}/contacts`, contactRoutes);
app.use(`${config.apiPrefix}/export`, exportRoutes);
app.use(`${config.apiPrefix}/queue`, queueRoutes);
app.use(`${config.apiPrefix}/reprocess`, reprocessRoutes);
app.use(`${config.apiPrefix}/vendor-review`, vendorReviewRoutes);
app.use(`${config.apiPrefix}/provenance`, provenanceRoutes);
app.use(`${config.apiPrefix}/errors`, errorTrackingRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });

  res.status(500).json({
    success: false,
    error: config.env === 'development' ? err.message : 'Internal server error',
  });
});

// Start server
const PORT = config.port;

app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`API prefix: ${config.apiPrefix}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await pool.end();
  process.exit(0);
});

export default app;
