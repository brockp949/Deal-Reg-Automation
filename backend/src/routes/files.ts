import { Router, Request, Response } from 'express';
import multer from 'multer';
import { join } from 'path';
import { mkdir, readdir, unlink, stat } from 'fs/promises';
import { query } from '../db';
import { config } from '../config';
import { getFileType, isValidFileType, isValidFileSize, generateUniqueFilename } from '../utils/fileHelpers';
import { ApiResponse, SourceFile } from '../types';
import logger from '../utils/logger';
import { computeFileChecksum, performVirusScan, recordFileSecurityEvent } from '../services/fileSecurity';
import { storeConfigFile } from '../services/configStorage';
import { uploadLimiter, batchUploadLimiter } from '../middleware/rateLimiter';
import { requireRole } from '../api/middleware/apiKeyAuth';
import type { FileIntent } from '../parsers/ParserRegistry';
import { getFileValidationAgent } from '../agents/FileValidationAgent';

const router = Router();

// Ensure upload directory exists
mkdir(config.upload.directory, { recursive: true }).catch((err) =>
  logger.error('Failed to create upload directory', err)
);
mkdir(config.configStorage.directory, { recursive: true }).catch((err) =>
  logger.error('Failed to create config storage directory', err)
);

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.upload.directory);
  },
  filename: (req, file, cb) => {
    const uniqueFilename = generateUniqueFilename(file.originalname);
    cb(null, uniqueFilename);
  },
});

// Multer upload middleware
const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter: (req, file, cb) => {
    if (!isValidFileType(file.originalname)) {
      return cb(new Error(`Invalid file type. Allowed types: ${config.upload.allowedTypes.join(', ')}`));
    }
    cb(null, true);
  },
});

function resolveOperatorId(req: Request): string {
  return (
    (req.header('x-operator-id') as string) ||
    (req.header('x-user-id') as string) ||
    (req.header('x-requested-by') as string) ||
    'anonymous'
  );
}

function validateUploadRequest(req: Request): { valid: boolean; error?: string } {
  const { intent, source, configName, uploadIntent } = req.body || {};

  // Legacy intents for config management
  const configIntents = ['update-config', 'ingest', 'test', undefined, null, ''];

  // New file processing intents
  const fileIntents = ['vendor', 'deal', 'email', 'transcript', 'vendor_spreadsheet', 'auto'];

  // Accept either legacy config intents or new file intents
  if (intent && !configIntents.includes(intent) && !fileIntents.includes(intent)) {
    return { valid: false, error: 'Invalid intent. Use vendor, deal, email, transcript, auto, or update-config.' };
  }

  // Validate uploadIntent if provided
  if (uploadIntent && !fileIntents.includes(uploadIntent)) {
    return { valid: false, error: 'Invalid uploadIntent. Use vendor, deal, email, transcript, vendor_spreadsheet, or auto.' };
  }

  if (source && typeof source !== 'string') {
    return { valid: false, error: 'source must be a string if provided.' };
  }
  if (configName && typeof configName !== 'string') {
    return { valid: false, error: 'configName must be a string if provided.' };
  }
  return { valid: true };
}

function buildUploadMetadata(req: Request, originalName: string, extras?: Record<string, any>) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    source: req.body?.source || 'upload_wizard',
    intent: req.body?.intent,
    uploadIntent: req.body?.uploadIntent || 'auto',  // New file processing intent
    vendorId: req.body?.vendorId,      // For deal imports to specific vendor
    vendorName: req.body?.vendorName,  // For deal imports with vendor name
    configName: req.body?.configName,
    requestId: req.get('x-request-id'),
    originalFilename: originalName,
    ...extras,
  };
}

async function findDuplicateByChecksum(checksum: string): Promise<SourceFile | null> {
  const existing = await query(
    `SELECT * FROM source_files
     WHERE checksum_sha256 = $1
       AND scan_status = 'passed'
       AND duplicate_of_id IS NULL
     ORDER BY upload_date ASC
     LIMIT 1`,
    [checksum]
  );
  return existing.rows[0] ?? null;
}

/**
 * POST /api/files/validate
 * Validate a file before upload using AI-powered validation agent
 */
router.post('/validate', requireRole(['write', 'admin']), async (req: Request, res: Response) => {
  try {
    const { file, intent } = req.body;

    // Validate request body
    if (!file || !file.name || !file.type || !file.size || !file.sampleContent) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: file.name, file.type, file.size, file.sampleContent',
      });
    }

    // Quick validation first (file size, type)
    const validationAgent = getFileValidationAgent();
    const quickCheck = await validationAgent.quickValidate({
      name: file.name,
      type: file.type,
      size: file.size,
    });

    if (!quickCheck.isValid) {
      return res.status(400).json({
        success: false,
        error: quickCheck.errors.join('; '),
        errors: quickCheck.errors,
      });
    }

    // AI-powered validation
    logger.info('Validating file with AI agent', {
      fileName: file.name,
      fileSize: file.size,
      intent,
    });

    const validationResult = await validationAgent.validate({
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
        sampleContent: file.sampleContent,
      },
      userIntent: intent,
    });

    return res.status(200).json({
      success: true,
      data: validationResult,
    });

  } catch (error: any) {
    logger.error('File validation error', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'File validation failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/files/upload
 * Upload a single file
 */
router.post('/upload', requireRole(['write', 'admin']), uploadLimiter, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const validation = validateUploadRequest(req);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const operatorId = resolveOperatorId(req);
    const fileType = getFileType(req.file.originalname);
    const storagePath = join(config.upload.directory, req.file.filename);
    const uploadMetadata = buildUploadMetadata(req, req.file.originalname);

    const { checksum, verifiedAt } = await computeFileChecksum(storagePath);

    const duplicateFile = await findDuplicateByChecksum(checksum);
    if (duplicateFile) {
      await unlink(storagePath).catch((err) =>
        logger.warn('Failed to delete duplicate upload temp file', {
          filename: req.file?.filename,
          error: err.message,
        })
      );

      await recordFileSecurityEvent({
        fileId: duplicateFile.id,
        eventType: 'duplicate_detected',
        actor: operatorId,
        details: {
          attemptedFilename: req.file.originalname,
          duplicateOf: duplicateFile.id,
          checksum,
          uploadMetadata,
        },
      });

      logger.info('Duplicate upload detected; reusing existing file', {
        duplicateOf: duplicateFile.id,
        attemptedFilename: req.file.originalname,
        processingStatus: duplicateFile.processing_status,
      });

      // Re-queue for processing if the file hasn't been processed yet
      const needsReprocessing = ['pending', 'failed'].includes(duplicateFile.processing_status);
      if (needsReprocessing) {
        logger.info('Duplicate file needs processing, re-queueing', {
          fileId: duplicateFile.id,
          processingStatus: duplicateFile.processing_status,
        });

        const { addUnifiedJob } = await import('../queues/unifiedProcessingQueue');
        const job = await addUnifiedJob({
          fileId: duplicateFile.id,
          intent: uploadMetadata.uploadIntent || 'auto',
          vendorId: uploadMetadata.vendorId,
          vendorName: uploadMetadata.vendorName,
        });
        logger.info('Duplicate file queued for unified processing', {
          fileId: duplicateFile.id,
          jobId: job.id,
          intent: uploadMetadata.uploadIntent,
        });
      }

      return res.status(200).json({
        success: true,
        data: duplicateFile,
        duplicate: true,
        duplicateOf: duplicateFile.id,
        message: needsReprocessing
          ? `Duplicate detected. Re-queuing ${duplicateFile.filename} for processing.`
          : `Duplicate upload detected. Reusing ${duplicateFile.filename}`,
      });
    }

    const scanResult = await performVirusScan(storagePath);

    const processingStatus = scanResult.status === 'passed' ? 'pending' : 'blocked';
    const quarantineInfo =
      scanResult.status === 'passed'
        ? { at: null, reason: null }
        : { at: new Date(), reason: scanResult.message || 'File failed automated scan' };

    const result = await query(
      `INSERT INTO source_files (
        filename,
        file_type,
        file_size,
        storage_path,
        processing_status,
        checksum_sha256,
        checksum_verified_at,
        scan_status,
        scan_engine,
        scan_details,
        scan_completed_at,
        quarantined_at,
        quarantine_reason,
        uploaded_by,
        upload_metadata,
        upload_intent
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16)
       RETURNING *`,
      [
        req.file.originalname,
        fileType,
        req.file.size,
        storagePath,
        processingStatus,
        checksum,
        verifiedAt,
        scanResult.status,
        scanResult.engine,
        JSON.stringify({
          signatureVersion: scanResult.signatureVersion,
          message: scanResult.message,
          findings: scanResult.findings,
        }),
        scanResult.completedAt,
        quarantineInfo.at,
        quarantineInfo.reason,
        operatorId,
        JSON.stringify(uploadMetadata),
        uploadMetadata.uploadIntent || 'auto',
      ]
    );

    let sourceFile: SourceFile = result.rows[0];
    const shouldStoreConfig = (fileType === 'json' || uploadMetadata.intent === 'update-config') && scanResult.status === 'passed';

    await recordFileSecurityEvent({
      fileId: sourceFile.id,
      eventType: 'upload_received',
      actor: operatorId,
      details: uploadMetadata,
    });
    await recordFileSecurityEvent({
      fileId: sourceFile.id,
      eventType: 'checksum_recorded',
      actor: operatorId,
      details: { checksum },
    });
    await recordFileSecurityEvent({
      fileId: sourceFile.id,
      eventType:
        scanResult.status === 'passed'
          ? 'scan_passed'
          : scanResult.status === 'failed'
            ? 'scan_failed'
            : 'scan_error',
      actor: operatorId,
      details: {
        engine: scanResult.engine,
        signatureVersion: scanResult.signatureVersion,
        findings: scanResult.findings,
        message: scanResult.message,
      },
    });

    if (quarantineInfo.at) {
      await recordFileSecurityEvent({
        fileId: sourceFile.id,
        eventType: 'quarantined',
        actor: operatorId,
        details: { reason: quarantineInfo.reason },
      });
    }

    if (shouldStoreConfig) {
      const configDetails = await storeConfigFile({
        sourceFileId: sourceFile.id,
        tempPath: storagePath,
        originalFilename: req.file.originalname,
        checksum,
        operatorId,
        intent: uploadMetadata.intent,
        configName: uploadMetadata.configName,
      });

      await recordFileSecurityEvent({
        fileId: sourceFile.id,
        eventType: 'config_stored',
        actor: operatorId,
        details: configDetails,
      });

      const updated = await query(
        `UPDATE source_files
         SET storage_path = $1,
             metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{config}', $2::jsonb),
             processing_status = 'completed',
             processing_completed_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [configDetails.storedPath, JSON.stringify(configDetails), sourceFile.id]
      );

      sourceFile = updated.rows[0];

      logger.info('Configuration file stored', {
        fileId: sourceFile.id,
        snapshotId: configDetails.snapshotId,
        configName: configDetails.configName,
      });

      return res.status(201).json({
        success: true,
        data: sourceFile,
        message: `Configuration ${configDetails.configName} stored`,
      });
    }

    logger.info('File uploaded successfully', {
      fileId: sourceFile.id,
      filename: sourceFile.filename,
      size: sourceFile.file_size,
      checksum,
      scanStatus: scanResult.status,
    });

    if (scanResult.status === 'passed') {
      const { addUnifiedJob } = await import('../queues/unifiedProcessingQueue');
      const job = await addUnifiedJob({
        fileId: sourceFile.id,
        intent: uploadMetadata.uploadIntent || 'auto',
        vendorId: uploadMetadata.vendorId,
        vendorName: uploadMetadata.vendorName,
      });
      logger.info('File queued for unified processing', {
        fileId: sourceFile.id,
        jobId: job.id,
        intent: uploadMetadata.uploadIntent,
      });
    } else {
      logger.warn('File not queued due to scan status', {
        fileId: sourceFile.id,
        scanStatus: scanResult.status,
      });
    }

    const response: ApiResponse<SourceFile> = {
      success: true,
      data: sourceFile,
      message:
        scanResult.status === 'passed'
          ? 'File uploaded and queued for processing'
          : 'File uploaded but quarantined pending review',
    };

    res.status(201).json(response);
  } catch (error: any) {
    logger.error('Error uploading file', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload file',
    });
  }
});

/**
 * POST /api/files/batch-upload
 * Upload multiple files
 */
router.post('/batch-upload', requireRole(['write', 'admin']), batchUploadLimiter, upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const validation = validateUploadRequest(req);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
      });
    }

    const uploadedFiles: SourceFile[] = [];
    const { addUnifiedJob } = await import('../queues/unifiedProcessingQueue');
    const operatorId = resolveOperatorId(req);
    let queuedCount = 0;
    let quarantinedCount = 0;
    let duplicateCount = 0;
    let configsStored = 0;

    for (const [index, file] of files.entries()) {
      const fileType = getFileType(file.originalname);
      const storagePath = join(config.upload.directory, file.filename);
      const uploadMetadata = buildUploadMetadata(req, file.originalname, {
        batchSize: files.length,
        batchIndex: index,
      });

      const { checksum, verifiedAt } = await computeFileChecksum(storagePath);
      const duplicateFile = await findDuplicateByChecksum(checksum);

      if (duplicateFile) {
        duplicateCount++;
        await unlink(storagePath).catch((err) =>
          logger.warn('Failed to delete duplicate upload temp file (batch)', {
            filename: file.filename,
            error: err.message,
          })
        );
        await recordFileSecurityEvent({
          fileId: duplicateFile.id,
          eventType: 'duplicate_detected',
          actor: operatorId,
          details: {
            attemptedFilename: file.originalname,
            duplicateOf: duplicateFile.id,
            checksum,
            uploadMetadata,
          },
        });
        logger.info('Duplicate upload skipped in batch', {
          duplicateOf: duplicateFile.id,
          attemptedFilename: file.originalname,
        });
        continue;
      }

      const scanResult = await performVirusScan(storagePath);
      const processingStatus = scanResult.status === 'passed' ? 'pending' : 'blocked';
      const quarantineInfo =
        scanResult.status === 'passed'
          ? { at: null, reason: null }
          : { at: new Date(), reason: scanResult.message || 'File failed automated scan' };

      const result = await query(
        `INSERT INTO source_files (
          filename,
          file_type,
          file_size,
          storage_path,
          processing_status,
          checksum_sha256,
          checksum_verified_at,
          scan_status,
          scan_engine,
          scan_details,
          scan_completed_at,
          quarantined_at,
          quarantine_reason,
          uploaded_by,
          upload_metadata,
          upload_intent
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16)
         RETURNING *`,
        [
          file.originalname,
          fileType,
          file.size,
          storagePath,
          processingStatus,
          checksum,
          verifiedAt,
          scanResult.status,
          scanResult.engine,
          JSON.stringify({
            signatureVersion: scanResult.signatureVersion,
            message: scanResult.message,
            findings: scanResult.findings,
          }),
          scanResult.completedAt,
          quarantineInfo.at,
          quarantineInfo.reason,
          operatorId,
          JSON.stringify(uploadMetadata),
          uploadMetadata.uploadIntent || 'auto',
        ]
      );

      let sourceFile: SourceFile = result.rows[0];
      const shouldStoreConfig = (fileType === 'json' || uploadMetadata.intent === 'update-config') && scanResult.status === 'passed';

      await recordFileSecurityEvent({
        fileId: sourceFile.id,
        eventType: 'upload_received',
        actor: operatorId,
        details: uploadMetadata,
      });
      await recordFileSecurityEvent({
        fileId: sourceFile.id,
        eventType: 'checksum_recorded',
        actor: operatorId,
        details: { checksum },
      });
      await recordFileSecurityEvent({
        fileId: sourceFile.id,
        eventType:
          scanResult.status === 'passed'
            ? 'scan_passed'
            : scanResult.status === 'failed'
              ? 'scan_failed'
              : 'scan_error',
        actor: operatorId,
        details: {
          engine: scanResult.engine,
          signatureVersion: scanResult.signatureVersion,
          findings: scanResult.findings,
          message: scanResult.message,
        },
      });
      if (quarantineInfo.at) {
        await recordFileSecurityEvent({
          fileId: sourceFile.id,
          eventType: 'quarantined',
          actor: operatorId,
          details: { reason: quarantineInfo.reason },
        });
      }

      if (shouldStoreConfig) {
        const configDetails = await storeConfigFile({
          sourceFileId: sourceFile.id,
          tempPath: storagePath,
          originalFilename: file.originalname,
          checksum,
          operatorId,
          intent: uploadMetadata.intent,
          configName: uploadMetadata.configName,
        });

        await recordFileSecurityEvent({
          fileId: sourceFile.id,
          eventType: 'config_stored',
          actor: operatorId,
          details: configDetails,
        });

        const updated = await query(
          `UPDATE source_files
           SET storage_path = $1,
               metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{config}', $2::jsonb),
               processing_status = 'completed',
               processing_completed_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING *`,
          [configDetails.storedPath, JSON.stringify(configDetails), sourceFile.id]
        );

        sourceFile = updated.rows[0];
        configsStored++;
        uploadedFiles.push(sourceFile);
        continue;
      }

      uploadedFiles.push(sourceFile);

      if (scanResult.status === 'passed') {
        const job = await addUnifiedJob({
          fileId: sourceFile.id,
          intent: uploadMetadata.uploadIntent || 'auto',
          vendorId: uploadMetadata.vendorId,
          vendorName: uploadMetadata.vendorName,
        });
        queuedCount++;
        logger.info('File queued for unified processing (batch)', {
          fileId: sourceFile.id,
          jobId: job.id,
          intent: uploadMetadata.uploadIntent,
        });
      } else {
        quarantinedCount++;
        logger.warn('File quarantined from batch upload', {
          fileId: sourceFile.id,
          scanStatus: scanResult.status,
        });
      }
    }

    logger.info('Batch upload completed', {
      total: uploadedFiles.length,
      queued: queuedCount,
      quarantined: quarantinedCount,
      duplicates: duplicateCount,
      configsStored,
    });

    res.status(201).json({
      success: true,
      data: uploadedFiles,
      message: `${uploadedFiles.length} files uploaded (${queuedCount} queued, ${quarantinedCount} quarantined, ${duplicateCount} duplicates reused, ${configsStored} configs stored)`,
      duplicate: duplicateCount > 0,
    });
  } catch (error: any) {
    logger.error('Error in batch upload', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to upload files',
    });
  }
});

/**
 * GET /api/files
 * Get all uploaded files
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, file_type, limit = '50', scan_status, uploaded_by } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`processing_status = $${paramCount++}`);
      params.push(status);
    }

    if (scan_status) {
      conditions.push(`scan_status = $${paramCount++}`);
      params.push(scan_status);
    }

    if (uploaded_by) {
      conditions.push(`uploaded_by = $${paramCount++}`);
      params.push(uploaded_by);
    }

    if (file_type) {
      conditions.push(`file_type = $${paramCount++}`);
      params.push(file_type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const result = await query(
      `SELECT * FROM source_files ${whereClause}
       ORDER BY upload_date DESC
       LIMIT $${paramCount}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Error fetching files', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch files',
    });
  }
});

/**
 * GET /api/files/metrics/security
 * Aggregate security metrics for telemetry dashboards
 */
router.get('/metrics/security', async (_req: Request, res: Response) => {
  try {
    const scanStatsResult = await query(
      `SELECT scan_status, COUNT(*)::int AS count
       FROM source_files
       GROUP BY scan_status`
    );
    const blockedCountResult = await query(
      `SELECT COUNT(*)::int AS count
       FROM source_files
       WHERE processing_status = 'blocked'`
    );
    const quarantineCountResult = await query(
      `SELECT COUNT(*)::int AS count
       FROM source_files
       WHERE quarantined_at IS NOT NULL`
    );
    const duplicate30dResult = await query(
      `SELECT COUNT(*)::int AS count
       FROM file_security_events
       WHERE event_type = 'duplicate_detected'
         AND created_at >= NOW() - INTERVAL '30 days'`
    );

    const scanStats = scanStatsResult.rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.scan_status || 'unknown'] = row.count;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        scanStatus: scanStats,
        blockedCount: blockedCountResult.rows[0]?.count ?? 0,
        quarantinedCount: quarantineCountResult.rows[0]?.count ?? 0,
        duplicateEventsLast30Days: duplicate30dResult.rows[0]?.count ?? 0,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching security metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to load security metrics',
    });
  }
});

/**
 * GET /api/files/:id
 * Get file details by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT * FROM source_files WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Error fetching file', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch file',
    });
  }
});

/**
 * DELETE /api/files/clear-all
 * Clear all data and files from the system (use with caution!)
 */
router.delete('/clear-all', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    if (!config.adminOps.clearAllEnabled) {
      return res.status(403).json({
        success: false,
        error: 'Clear-all operation is disabled. Set CLEAR_ALL_ENDPOINT_ENABLED=true to allow.',
      });
    }

    const token = (req.header('x-admin-token') || req.header('x-api-key')) ?? '';
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Missing admin token (X-Admin-Token).',
      });
    }

    if (!config.adminOps.clearAllToken || token !== config.adminOps.clearAllToken) {
      logger.warn('Unauthorized clear-all attempt', { actor: resolveOperatorId(req) });
      return res.status(403).json({
        success: false,
        error: 'Invalid admin token.',
      });
    }

    logger.warn('Clear all data operation initiated', { actor: resolveOperatorId(req) });

    // Step 1: Delete all records from tables (in reverse order of dependencies)
    const deleteStats = {
      contacts: 0,
      deals: 0,
      vendors: 0,
      sourceFiles: 0,
      filesDeleted: 0,
      errors: [] as string[],
    };

    // Delete contacts (depends on vendors)
    const contactsResult = await query('DELETE FROM contacts RETURNING id');
    deleteStats.contacts = contactsResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.contacts} contacts`);

    // Delete deals (depends on vendors and source_files)
    const dealsResult = await query('DELETE FROM deal_registrations RETURNING id');
    deleteStats.deals = dealsResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.deals} deals`);

    // Delete vendors
    const vendorsResult = await query('DELETE FROM vendors RETURNING id');
    deleteStats.vendors = vendorsResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.vendors} vendors`);

    // Get all source files before deleting
    const sourceFilesResult = await query('SELECT storage_path FROM source_files');
    const filePaths = sourceFilesResult.rows.map((row: any) => row.storage_path);

    // Delete source_files from database
    const sourceFilesDeleteResult = await query('DELETE FROM source_files RETURNING id');
    deleteStats.sourceFiles = sourceFilesDeleteResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.sourceFiles} source file records`);

    // Step 2: Delete physical files from uploads directory
    try {
      // Delete individual tracked files
      for (const filePath of filePaths) {
        try {
          await unlink(filePath);
          deleteStats.filesDeleted++;
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            // Ignore "file not found" errors
            deleteStats.errors.push(`Failed to delete ${filePath}: ${err.message}`);
          }
        }
      }

      // Also clean up any remaining files in uploads directory
      try {
        const files = await readdir(config.upload.directory);
        for (const file of files) {
          const filePath = join(config.upload.directory, file);
          try {
            const stats = await stat(filePath);
            if (stats.isFile()) {
              await unlink(filePath);
              deleteStats.filesDeleted++;
            }
          } catch (err: any) {
            deleteStats.errors.push(`Failed to delete ${file}: ${err.message}`);
          }
        }
      } catch (err: any) {
        deleteStats.errors.push(`Failed to read upload directory: ${err.message}`);
      }

      logger.info(`Deleted ${deleteStats.filesDeleted} physical files`);
    } catch (err: any) {
      logger.error('Error deleting physical files', { error: err.message });
      deleteStats.errors.push(`File deletion error: ${err.message}`);
    }

    // Step 3: Clear Redis queues (optional)
    try {
      const { fileProcessingQueue } = await import('../queues/fileProcessingQueue');
      await fileProcessingQueue.obliterate({ force: true });
      logger.info('Cleared file processing queue');
    } catch (err: any) {
      logger.warn('Failed to clear Redis queues', { error: err.message });
      // Non-critical, don't add to errors
    }

    logger.warn('Clear all data operation completed', deleteStats);

    res.json({
      success: true,
      message: 'All data and files cleared successfully',
      data: deleteStats,
    });
  } catch (error: any) {
    logger.error('Error clearing data', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to clear data',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/files/:id
 * Delete a file
 */
router.delete('/:id', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actor = resolveOperatorId(req);

    const fileResult = await query('SELECT storage_path FROM source_files WHERE id = $1', [id]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    const storagePath = fileResult.rows[0].storage_path as string | null;

    const result = await query('DELETE FROM source_files WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    if (storagePath) {
      try {
        await unlink(storagePath);
        logger.info('Deleted physical file from storage', { fileId: id, storagePath, actor });
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn('Failed to delete physical file from storage', {
            fileId: id,
            storagePath,
            error: err.message,
          });
        }
      }
    }

    logger.info('File deleted', { fileId: id, actor });

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error deleting file', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete file',
    });
  }
});

/**
 * POST /api/files/:id/process
 * Trigger file processing
 */
router.post('/:id/process', requireRole(['write', 'admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actor = resolveOperatorId(req);

    // Check if file exists
    const fileResult = await query('SELECT * FROM source_files WHERE id = $1', [id]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    const file: SourceFile = fileResult.rows[0];

    if (file.processing_status === 'processing') {
      return res.status(400).json({
        success: false,
        error: 'File is already being processed',
      });
    }

    // Add file to unified processing queue
    const { addUnifiedJob } = await import('../queues/unifiedProcessingQueue');
    const intent = (file.upload_intent || 'auto') as FileIntent;
    const job = await addUnifiedJob({
      fileId: id,
      intent,
    });

    logger.info('Manual file processing requested', { fileId: id, actor, jobId: job.id, intent });

    res.json({
      success: true,
      message: 'File processing queued',
      data: {
        jobId: job.id,
      },
    });
  } catch (error: any) {
    logger.error('Error processing file', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to start file processing',
    });
  }
});

export default router;
