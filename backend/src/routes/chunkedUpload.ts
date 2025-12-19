/**
 * Chunked Upload Routes
 *
 * Handles resumable chunked file uploads for large files (>50MB).
 * Uses Redis for upload metadata storage to support multi-instance deployments.
 *
 * Flow:
 * 1. POST /init - Initialize upload, get upload ID
 * 2. POST /chunk - Upload chunks (5MB each), can retry
 * 3. POST /complete - Assemble chunks, queue for processing
 * 4. GET /status/:uploadId - Check upload status
 * 5. DELETE /abort/:uploadId - Abort upload, cleanup chunks
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import Redis from 'ioredis';
import logger from '../utils/logger';
import { config } from '../config';
import { query } from '../db';
import { getFileType, generateUniqueFilename } from '../utils/fileHelpers';
import { computeFileChecksum, performVirusScan, recordFileSecurityEvent } from '../services/fileSecurity';
import { addUnifiedJob } from '../queues/unifiedProcessingQueue';
import type { FileIntent } from '../parsers/ParserRegistry';

const router = Router();

function resolveOperatorId(req: Request): string {
  return (
    (req.header('x-operator-id') as string) ||
    (req.header('x-user-id') as string) ||
    (req.header('x-requested-by') as string) ||
    'anonymous'
  );
}

async function findDuplicateByChecksum(checksum: string) {
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

// Configure multer for chunk uploads (in-memory, then saved)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per chunk (safety margin over 5MB)
  },
});

// Temporary directory for chunked uploads
const CHUNKS_DIR = path.join(config.uploadPath || './uploads', 'chunks');

// Upload metadata storage (Redis for multi-instance support)
interface UploadMetadata {
  uploadId: string;
  fileName: string;
  storageFileName?: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  fileType: string;
  intent?: string;
  userId?: string;
  createdAt: string;
  lastActivity: string;
}

// TTL for uploads (24 hours)
const UPLOAD_TTL = 24 * 60 * 60; // seconds

// Redis client for upload metadata
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Chunked upload service connected to Redis');
});

redis.on('error', (error) => {
  logger.error('Redis connection error in chunked upload service', { error: error.message });
});

/**
 * Get upload metadata from Redis
 */
async function getUploadMetadata(uploadId: string): Promise<UploadMetadata | null> {
  try {
    const data = await redis.get(`upload:${uploadId}`);
    if (!data) return null;
    return JSON.parse(data);
  } catch (error: any) {
    logger.error('Failed to get upload metadata from Redis', { uploadId, error: error.message });
    return null;
  }
}

/**
 * Set upload metadata in Redis with TTL
 */
async function setUploadMetadata(metadata: UploadMetadata): Promise<void> {
  try {
    await redis.setex(`upload:${metadata.uploadId}`, UPLOAD_TTL, JSON.stringify(metadata));
  } catch (error: any) {
    logger.error('Failed to set upload metadata in Redis', {
      uploadId: metadata.uploadId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get uploaded chunks for an upload
 */
async function getUploadedChunks(uploadId: string): Promise<number[]> {
  try {
    const chunks = await redis.smembers(`upload:${uploadId}:chunks`);
    return chunks.map(c => parseInt(c, 10));
  } catch (error: any) {
    logger.error('Failed to get uploaded chunks from Redis', { uploadId, error: error.message });
    return [];
  }
}

/**
 * Add a chunk to the uploaded chunks set
 */
async function addUploadedChunk(uploadId: string, chunkIndex: number): Promise<void> {
  try {
    await redis.sadd(`upload:${uploadId}:chunks`, chunkIndex.toString());
    await redis.expire(`upload:${uploadId}:chunks`, UPLOAD_TTL);
  } catch (error: any) {
    logger.error('Failed to add uploaded chunk to Redis', {
      uploadId,
      chunkIndex,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Check if a chunk has been uploaded
 */
async function hasUploadedChunk(uploadId: string, chunkIndex: number): Promise<boolean> {
  try {
    const result = await redis.sismember(`upload:${uploadId}:chunks`, chunkIndex.toString());
    return result === 1;
  } catch (error: any) {
    logger.error('Failed to check uploaded chunk in Redis', {
      uploadId,
      chunkIndex,
      error: error.message,
    });
    return false;
  }
}

/**
 * Delete upload metadata and chunks from Redis
 */
async function deleteUploadMetadata(uploadId: string): Promise<void> {
  try {
    await redis.del(`upload:${uploadId}`, `upload:${uploadId}:chunks`);
  } catch (error: any) {
    logger.error('Failed to delete upload metadata from Redis', {
      uploadId,
      error: error.message,
    });
  }
}

/**
 * Ensure chunks directory exists
 */
async function ensureChunksDir(): Promise<void> {
  try {
    await fs.mkdir(CHUNKS_DIR, { recursive: true });
  } catch (error: any) {
    logger.error('Failed to create chunks directory', { error: error.message });
  }
}

ensureChunksDir();

/**
 * POST /api/files/upload/chunked/init
 * Initialize a chunked upload
 */
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { fileName, fileSize, fileType, totalChunks, chunkSize, intent } = req.body;

    // Validate request
    if (!fileName || !fileSize || !totalChunks || !chunkSize) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: fileName, fileSize, totalChunks, chunkSize',
      });
    }

    if (fileSize <= 0 || totalChunks <= 0 || chunkSize <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file size, total chunks, or chunk size',
      });
    }

    // Generate upload ID
    const uploadId = crypto.randomBytes(16).toString('hex');

    // Create upload metadata
    const metadata: UploadMetadata = {
      uploadId,
      fileName,
      storageFileName: generateUniqueFilename(fileName),
      fileSize,
      totalChunks,
      chunkSize,
      fileType: fileType || 'application/octet-stream',
      intent,
      userId: req.header('x-user-id') || req.header('x-operator-id'),
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };

    // Store in Redis
    await setUploadMetadata(metadata);

    // Create directory for this upload's chunks
    const uploadChunksDir = path.join(CHUNKS_DIR, uploadId);
    await fs.mkdir(uploadChunksDir, { recursive: true });

    logger.info('Chunked upload initialized', {
      uploadId,
      fileName,
      fileSize,
      totalChunks,
      chunkSize,
    });

    return res.status(200).json({
      success: true,
      data: {
        uploadId,
        message: 'Upload initialized successfully',
      },
    });
  } catch (error: any) {
    logger.error('Failed to initialize chunked upload', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to initialize upload',
      message: error.message,
    });
  }
});

/**
 * POST /api/files/upload/chunked/chunk
 * Upload a chunk
 */
router.post('/chunk', upload.single('chunk'), async (req: Request, res: Response) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    const chunkFile = req.file;

    // Validate request
    if (!uploadId || chunkIndex === undefined || !chunkFile) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: uploadId, chunkIndex, chunk file',
      });
    }

    const chunkIdx = parseInt(chunkIndex, 10);
    if (isNaN(chunkIdx) || chunkIdx < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid chunk index',
      });
    }

    // Get upload metadata from Redis
    const metadata = await getUploadMetadata(uploadId);
    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found. Please initialize upload first.',
      });
    }

    // Validate chunk index
    if (chunkIdx >= metadata.totalChunks) {
      return res.status(400).json({
        success: false,
        error: `Invalid chunk index. Expected 0-${metadata.totalChunks - 1}, got ${chunkIdx}`,
      });
    }

    // Check if chunk already uploaded
    const alreadyUploaded = await hasUploadedChunk(uploadId, chunkIdx);
    if (alreadyUploaded) {
      const uploadedChunks = await getUploadedChunks(uploadId);
      logger.warn('Chunk already uploaded', { uploadId, chunkIndex: chunkIdx });
      return res.status(200).json({
        success: true,
        message: 'Chunk already uploaded',
        data: {
          uploadedChunks: uploadedChunks.length,
          totalChunks: metadata.totalChunks,
          progress: Math.round((uploadedChunks.length / metadata.totalChunks) * 100),
        },
      });
    }

    // Save chunk to disk
    const uploadChunksDir = path.join(CHUNKS_DIR, uploadId);
    const chunkPath = path.join(uploadChunksDir, `chunk_${chunkIdx}`);

    await fs.writeFile(chunkPath, chunkFile.buffer);

    // Mark chunk as uploaded in Redis
    await addUploadedChunk(uploadId, chunkIdx);

    // Update last activity
    metadata.lastActivity = new Date().toISOString();
    await setUploadMetadata(metadata);

    const uploadedChunks = await getUploadedChunks(uploadId);

    logger.info('Chunk uploaded', {
      uploadId,
      chunkIndex: chunkIdx,
      chunkSize: chunkFile.size,
      uploadedChunks: uploadedChunks.length,
      totalChunks: metadata.totalChunks,
      progress: Math.round((uploadedChunks.length / metadata.totalChunks) * 100),
    });

    return res.status(200).json({
      success: true,
      message: 'Chunk uploaded successfully',
      data: {
        uploadedChunks: uploadedChunks.length,
        totalChunks: metadata.totalChunks,
        progress: Math.round((uploadedChunks.length / metadata.totalChunks) * 100),
      },
    });
  } catch (error: any) {
    logger.error('Failed to upload chunk', {
      error: error.message,
      stack: error.stack,
      uploadId: req.body.uploadId,
      chunkIndex: req.body.chunkIndex,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to upload chunk',
      message: error.message,
    });
  }
});

/**
 * POST /api/files/upload/chunked/complete
 * Complete upload and assemble chunks
 */
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const { uploadId } = req.body;

    if (!uploadId) {
      return res.status(400).json({
        success: false,
        error: 'Missing uploadId',
      });
    }

    // Get upload metadata from Redis
    const metadata = await getUploadMetadata(uploadId);
    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found',
      });
    }

    // Get uploaded chunks from Redis
    const uploadedChunks = await getUploadedChunks(uploadId);

    // Verify all chunks uploaded
    if (uploadedChunks.length !== metadata.totalChunks) {
      const missingChunks = Array.from({ length: metadata.totalChunks }, (_, i) => i).filter(
        i => !uploadedChunks.includes(i)
      );

      return res.status(400).json({
        success: false,
        error: `Upload incomplete. Expected ${metadata.totalChunks} chunks, got ${uploadedChunks.length}`,
        data: {
          uploadedChunks: uploadedChunks.length,
          totalChunks: metadata.totalChunks,
          missingChunks,
        },
      });
    }

    logger.info('Assembling chunks', { uploadId, totalChunks: metadata.totalChunks });

    // Assemble chunks into final file
    const uploadChunksDir = path.join(CHUNKS_DIR, uploadId);
    const storageFileName = metadata.storageFileName || metadata.fileName;
    const finalFilePath = path.join(config.upload.directory, storageFileName);

    const writeStream = require('fs').createWriteStream(finalFilePath);

    for (let i = 0; i < metadata.totalChunks; i++) {
      const chunkPath = path.join(uploadChunksDir, `chunk_${i}`);
      const chunkData = await fs.readFile(chunkPath);
      writeStream.write(chunkData);
    }

    writeStream.end();

    // Wait for write to complete
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    logger.info('Chunks assembled successfully', {
      uploadId,
      fileName: metadata.fileName,
      filePath: finalFilePath,
    });

    // Cleanup chunks
    try {
      await fs.rm(uploadChunksDir, { recursive: true, force: true });
      logger.info('Chunks cleaned up', { uploadId });
    } catch (cleanupError: any) {
      logger.warn('Failed to cleanup chunks', {
        uploadId,
        error: cleanupError.message,
      });
    }

    const operatorId = resolveOperatorId(req);
    const fileType = getFileType(metadata.fileName);
    const uploadIntent = (metadata.intent || 'auto') as FileIntent;
    const uploadMetadata = {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      source: 'chunked_upload',
      uploadIntent,
      requestId: req.get('x-request-id'),
      originalFilename: metadata.fileName,
      uploadId,
      isChunkedUpload: true,
      totalChunks: metadata.totalChunks,
      chunkSize: metadata.chunkSize,
      fileType: metadata.fileType,
      storageFileName,
    };

    const { checksum, verifiedAt } = await computeFileChecksum(finalFilePath);
    const duplicateFile = await findDuplicateByChecksum(checksum);
    if (duplicateFile) {
      await fs.unlink(finalFilePath).catch((err) =>
        logger.warn('Failed to delete duplicate chunked upload file', {
          filename: storageFileName,
          error: err.message,
        })
      );

      await recordFileSecurityEvent({
        fileId: duplicateFile.id,
        eventType: 'duplicate_detected',
        actor: operatorId,
        details: {
          attemptedFilename: metadata.fileName,
          duplicateOf: duplicateFile.id,
          checksum,
          uploadMetadata,
        },
      });

      const needsReprocessing = ['pending', 'failed'].includes(duplicateFile.processing_status);
      let jobId: string | undefined;
      if (needsReprocessing) {
        const job = await addUnifiedJob({
          fileId: duplicateFile.id,
          intent: uploadIntent,
        });
        jobId = job.id?.toString();
      }

      await deleteUploadMetadata(uploadId);

      return res.status(200).json({
        success: true,
        duplicate: true,
        duplicateOf: duplicateFile.id,
        message: needsReprocessing
          ? `Duplicate detected. Re-queuing ${duplicateFile.filename} for processing.`
          : `Duplicate upload detected. Reusing ${duplicateFile.filename}`,
        data: {
          uploadId,
          fileName: metadata.fileName,
          fileId: duplicateFile.id,
          jobId,
        },
      });
    }

    const scanResult = await performVirusScan(finalFilePath);
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
        metadata.fileName,
        fileType,
        metadata.fileSize,
        finalFilePath,
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

    const sourceFile = result.rows[0];

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

    let jobId: string | undefined;
    if (scanResult.status === 'passed') {
      const job = await addUnifiedJob({
        fileId: sourceFile.id,
        intent: uploadIntent,
      });
      jobId = job.id?.toString();
    }

    // Cleanup metadata from Redis
    await deleteUploadMetadata(uploadId);

    logger.info('Chunked upload completed and queued', {
      uploadId,
      fileId: sourceFile.id,
      jobId,
    });

    return res.status(200).json({
      success: true,
      message:
        scanResult.status === 'passed'
          ? 'Upload completed and queued for processing'
          : 'Upload completed but quarantined pending review',
      data: {
        uploadId,
        fileName: metadata.fileName,
        fileId: sourceFile.id,
        jobId,
      },
    });
  } catch (error: any) {
    logger.error('Failed to complete chunked upload', {
      error: error.message,
      stack: error.stack,
      uploadId: req.body.uploadId,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to complete upload',
      message: error.message,
    });
  }
});

/**
 * GET /api/files/upload/chunked/status/:uploadId
 * Get upload status
 */
router.get('/status/:uploadId', async (req: Request, res: Response) => {
  try {
    const { uploadId } = req.params;

    const metadata = await getUploadMetadata(uploadId);
    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found',
      });
    }

    const uploadedChunks = await getUploadedChunks(uploadId);
    const missingChunks = Array.from({ length: metadata.totalChunks }, (_, i) => i).filter(
      i => !uploadedChunks.includes(i)
    );

    return res.status(200).json({
      success: true,
      data: {
        uploadId: metadata.uploadId,
        fileName: metadata.fileName,
        fileSize: metadata.fileSize,
        totalChunks: metadata.totalChunks,
        uploadedChunks: uploadedChunks.length,
        progress: Math.round((uploadedChunks.length / metadata.totalChunks) * 100),
        missingChunks,
        createdAt: metadata.createdAt,
        lastActivity: metadata.lastActivity,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get upload status', {
      error: error.message,
      uploadId: req.params.uploadId,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to get upload status',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/files/upload/chunked/abort/:uploadId
 * Abort upload and cleanup
 */
router.delete('/abort/:uploadId', async (req: Request, res: Response) => {
  try {
    const { uploadId } = req.params;

    const metadata = await getUploadMetadata(uploadId);
    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found',
      });
    }

    // Cleanup chunks
    const uploadChunksDir = path.join(CHUNKS_DIR, uploadId);
    try {
      await fs.rm(uploadChunksDir, { recursive: true, force: true });
      logger.info('Upload aborted, chunks cleaned up', { uploadId });
    } catch (cleanupError: any) {
      logger.warn('Failed to cleanup chunks during abort', {
        uploadId,
        error: cleanupError.message,
      });
    }

    // Remove metadata from Redis
    await deleteUploadMetadata(uploadId);

    return res.status(200).json({
      success: true,
      message: 'Upload aborted successfully',
    });
  } catch (error: any) {
    logger.error('Failed to abort upload', {
      error: error.message,
      uploadId: req.params.uploadId,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to abort upload',
      message: error.message,
    });
  }
});

/**
 * Cleanup stale uploads (older than 24 hours)
 * Redis TTL handles most cleanup, but this catches orphaned chunk directories
 */
async function cleanupStaleUploads(): Promise<void> {
  try {
    // Scan for all upload keys in Redis
    const keys = await redis.keys('upload:*');
    const uploadKeys = keys.filter(k => !k.includes(':chunks'));

    logger.debug('Checking for stale uploads', { totalUploads: uploadKeys.length });

    for (const key of uploadKeys) {
      const uploadId = key.replace('upload:', '');
      const metadata = await getUploadMetadata(uploadId);

      // If metadata exists, Redis TTL will handle it
      // This cleanup is mainly for orphaned chunk directories
      if (!metadata) {
        const uploadChunksDir = path.join(CHUNKS_DIR, uploadId);
        try {
          await fs.rm(uploadChunksDir, { recursive: true, force: true });
          logger.info('Cleaned up orphaned chunk directory', { uploadId });
        } catch (error: any) {
          // Ignore - directory may not exist
        }
      }
    }

    // Also check for chunk directories without metadata
    try {
      const chunkDirs = await fs.readdir(CHUNKS_DIR);
      for (const dir of chunkDirs) {
        const metadata = await getUploadMetadata(dir);
        if (!metadata) {
          const uploadChunksDir = path.join(CHUNKS_DIR, dir);
          await fs.rm(uploadChunksDir, { recursive: true, force: true });
          logger.info('Cleaned up orphaned chunk directory', { uploadId: dir });
        }
      }
    } catch (error: any) {
      // Ignore - chunks dir may not exist
    }
  } catch (error: any) {
    logger.error('Error during stale upload cleanup', { error: error.message });
  }
}

// Run cleanup every hour
setInterval(cleanupStaleUploads, 60 * 60 * 1000);

export default router;
