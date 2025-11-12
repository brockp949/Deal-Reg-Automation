import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { query } from '../db';
import logger from '../utils/logger';
import type { FileSecurityEventType, FileScanStatus } from '../types';

export interface ChecksumResult {
  checksum: string;
  verifiedAt: Date;
}

export interface VirusScanResult {
  status: Exclude<FileScanStatus, 'not_scanned'>;
  engine: string;
  signatureVersion: string;
  message?: string;
  findings?: string[];
  startedAt: Date;
  completedAt: Date;
}

/**
 * Calculates SHA-256 checksum for a file using a streaming approach.
 */
export async function computeFileChecksum(filePath: string): Promise<ChecksumResult> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (error) => {
      logger.error('Checksum stream failed', { filePath, error: error.message });
      reject(error);
    });
    stream.on('end', () => {
      const checksum = hash.digest('hex');
      resolve({ checksum, verifiedAt: new Date() });
    });
  });
}

/**
 * Performs a stubbed virus scan. Replaces with an actual scanner in later phases.
 */
export async function performVirusScan(filePath: string): Promise<VirusScanResult> {
  const startedAt = new Date();
  // Placeholder for future AV integration (ClamAV, VirusTotal, etc.)
  await new Promise((resolve) => setTimeout(resolve, 25));
  const completedAt = new Date();

  return {
    status: 'passed',
    engine: 'stubbed-clamav',
    signatureVersion: startedAt.toISOString().split('T')[0] ?? 'unknown',
    message: 'Stub scan - replace with AV engine',
    findings: [],
    startedAt,
    completedAt,
  };
}

/**
 * Records a file security/audit event. Failures should never block uploads.
 */
export async function recordFileSecurityEvent(params: {
  fileId: string;
  eventType: FileSecurityEventType;
  actor?: string | null;
  details?: Record<string, any>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO file_security_events (id, source_file_id, event_type, actor, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        randomUUID(),
        params.fileId,
        params.eventType,
        params.actor || null,
        JSON.stringify(params.details || {}),
      ]
    );
  } catch (error: any) {
    logger.warn('Failed to record file security event', {
      fileId: params.fileId,
      eventType: params.eventType,
      error: error.message,
    });
  }
}
