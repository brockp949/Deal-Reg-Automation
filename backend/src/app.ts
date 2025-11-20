import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import logger from './utils/logger';
import pool from './db';
import { apiKeyAuth } from './api/middleware/apiKeyAuth';

// Import routes
import vendorRoutes from './routes/vendors';
import vendorImportRoutes from './routes/vendorImport';
import dealRoutes from './routes/deals';
import fileRoutes from './routes/files';
import configRoutes from './routes/configs';
import contactRoutes from './routes/contacts';
import exportRoutes from './routes/export';
import queueRoutes from './routes/queue';
import reprocessRoutes from './routes/reprocess';
import vendorReviewRoutes from './routes/vendorReview';
import provenanceRoutes from './routes/provenance';
import errorTrackingRoutes from './routes/errorTracking';
import aiExtractionRoutes from './routes/aiExtraction';
import vendorMatchingRoutes from './routes/vendorMatching';
import duplicateDetectionRoutes from './routes/duplicateDetection';
import mergeManagementRoutes from './routes/mergeManagement';
import correlationAndQualityRoutes from './routes/correlationAndQuality';

const app = express();

// Security and parsing middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(apiKeyAuth);
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim()),
  },
}));

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
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
app.use(`${config.apiPrefix}/configs`, configRoutes);
app.use(`${config.apiPrefix}/contacts`, contactRoutes);
app.use(`${config.apiPrefix}/export`, exportRoutes);
app.use(`${config.apiPrefix}/queue`, queueRoutes);
app.use(`${config.apiPrefix}/reprocess`, reprocessRoutes);
app.use(`${config.apiPrefix}/vendor-review`, vendorReviewRoutes);
app.use(`${config.apiPrefix}/provenance`, provenanceRoutes);
app.use(`${config.apiPrefix}/errors`, errorTrackingRoutes);
app.use(`${config.apiPrefix}/ai`, aiExtractionRoutes);
app.use(`${config.apiPrefix}/vendor-matching`, vendorMatchingRoutes);
app.use(`${config.apiPrefix}/duplicates`, duplicateDetectionRoutes);
app.use(`${config.apiPrefix}/merge`, mergeManagementRoutes);
app.use(`${config.apiPrefix}/correlation`, correlationAndQualityRoutes);
app.use(`${config.apiPrefix}/quality`, correlationAndQualityRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });

  res.status(500).json({
    success: false,
    error: config.env === 'development' ? err.message : 'Internal server error',
  });
});

export default app;
