import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import logger from './utils/logger';
import pool from './db';
import { apiKeyAuth, requireRole } from './api/middleware/apiKeyAuth';
import { apiKeyUsageLogger } from './api/middleware/apiKeyUsageLogger';
import { methodRoleGuard } from './api/middleware/methodRoleGuard';
import { apiLimiter, mutationLimiter, uploadLimiter } from './middleware/rateLimiter';
import { requestId } from './middleware/requestId';
import { runWithContext } from './utils/requestContext';
import { requestMetrics } from './utils/requestMetrics';

// Import routes
import vendorRoutes from './routes/vendors';
import vendorImportRoutes from './routes/vendorImport';
import dealImportRoutes from './routes/dealImport';
import agreementRoutes from './routes/agreements';
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
import jobsRoutes from './routes/jobs';
import qualityAlertsRoutes from './routes/qualityAlerts';
import qualityDashboardRoutes from './routes/qualityDashboard';
import fileProgressRoutes from './routes/fileProgress';
import batchDuplicatesRoutes from './routes/batchDuplicates';
import webhookRoutes from './routes/webhooks';
import reportRoutes from './routes/reports';
import mergeAuditRoutes from './routes/mergeAudit';
import opsRoutes from './routes/ops';
import metricsRoutes from './routes/metrics';
import healthRoutes from './routes/health';
import dashboardRoutes from './routes/dashboard';
import googleAuthRoutes from './routes/googleAuth';
import gmailSyncRoutes from './routes/gmailSync';
import driveSyncRoutes from './routes/driveSync';
import syncStatsRoutes from './routes/syncStats';
import vendorSpreadsheetExportRoutes from './routes/vendorSpreadsheetExport';
import progressRoutes from './routes/progress';
import feedbackRoutes from './routes/feedback';
import chunkedUploadRoutes from './routes/chunkedUpload';
import monitoringRoutes from './routes/monitoring';
import validationRoutes from './routes/validation';
import emailThreadsRoutes from './routes/emailThreads';

const app = express();

const isChunkedUploadRequest = (req: Request): boolean => {
  const path = req.originalUrl || req.url || '';
  return path.includes(`${config.apiPrefix}/files/upload/chunked`) || path.includes('/files/upload/chunked');
};

// Security and parsing middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use((req, _res, next) => runWithContext({ requestId: (req as any).requestId }, next));
app.use(requestId);
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(apiKeyAuth);
app.use(apiKeyUsageLogger);
app.use((req, res, next) => {
  if (isChunkedUploadRequest(req)) return next();
  return apiLimiter(req, res, next);
});
app.use((req, res, next) => {
  if (isChunkedUploadRequest(req)) return next();
  return mutationLimiter(req, res, next);
});
app.use(methodRoleGuard);
app.use(requestMetrics);
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim()),
  },
}));

// Health check endpoint with optional detailed metrics
app.get('/health', async (req: Request, res: Response) => {
  try {
    const detailed = req.query.detailed === 'true';
    await pool.query('SELECT 1');

    const health: any = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.env,
    };

    if (detailed) {
      // Memory usage
      const memUsage = process.memoryUsage();
      health.memory = {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
        external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
      };

      // Database connection pool stats
      health.database = {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingClients: pool.waitingCount,
      };

      // CPU usage
      const cpuUsage = process.cpuUsage();
      health.cpu = {
        user: Math.round(cpuUsage.user / 1000) + 'ms',
        system: Math.round(cpuUsage.system / 1000) + 'ms',
      };
    }

    res.json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// API Routes
app.use(`${config.apiPrefix}/vendors`, vendorRoutes);
app.use(`${config.apiPrefix}/vendors`, vendorImportRoutes); // Vendor import endpoints
app.use(`${config.apiPrefix}/vendors/:vendorId/deals`, uploadLimiter, dealImportRoutes); // Deal import per vendor
app.use(`${config.apiPrefix}/vendors/:vendorId/deals`, vendorSpreadsheetExportRoutes); // Vendor spreadsheet export
app.use(`${config.apiPrefix}/vendors/:vendorId/agreements`, uploadLimiter, agreementRoutes); // Vendor agreements
app.use(`${config.apiPrefix}/deals`, dealRoutes);
app.use(`${config.apiPrefix}/files`, (req, res, next) => {
  if (isChunkedUploadRequest(req)) return next();
  return uploadLimiter(req, res, next);
}, fileRoutes);
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
app.use(`${config.apiPrefix}/jobs`, jobsRoutes);
app.use(`${config.apiPrefix}/quality/alerts`, qualityAlertsRoutes);
app.use(`${config.apiPrefix}/quality/dashboard`, qualityDashboardRoutes);
app.use(`${config.apiPrefix}/files`, fileProgressRoutes);
app.use(`${config.apiPrefix}/duplicates`, batchDuplicatesRoutes);
app.use(`${config.apiPrefix}/webhooks`, webhookRoutes);
app.use(`${config.apiPrefix}/reports`, reportRoutes);
app.use(`${config.apiPrefix}/merge`, requireRole(['admin']), mergeAuditRoutes);
app.use(`${config.apiPrefix}/ops`, opsRoutes);
app.use('/', healthRoutes);
app.use(`${config.apiPrefix}/metrics`, metricsRoutes);
app.use(`${config.apiPrefix}/monitoring`, monitoringRoutes);
app.use(`${config.apiPrefix}/dashboard`, dashboardRoutes);
app.use(`${config.apiPrefix}/google-auth`, googleAuthRoutes);
app.use(`${config.apiPrefix}/sync/gmail`, gmailSyncRoutes);
app.use(`${config.apiPrefix}/sync/drive`, driveSyncRoutes);
app.use(`${config.apiPrefix}/sync/stats`, syncStatsRoutes);
app.use(`${config.apiPrefix}/progress`, progressRoutes);
app.use(`${config.apiPrefix}/feedback`, feedbackRoutes);
app.use(`${config.apiPrefix}/files/upload/chunked`, chunkedUploadRoutes);
app.use(`${config.apiPrefix}/validation`, uploadLimiter, validationRoutes);
app.use(`${config.apiPrefix}/email-threads`, emailThreadsRoutes);

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
