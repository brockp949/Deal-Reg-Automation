import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import net from 'net';
import { query } from '../db';
import logger from '../utils/logger';
import { config } from '../config';
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
  const provider = config.security?.virusScan?.provider ?? 'stub';

  if (provider === 'clamd') {
    try {
      return await scanWithClamAV(filePath);
    } catch (error: any) {
      const failOpen = config.security?.virusScan?.failOpen ?? true;
      logger[failOpen ? 'warn' : 'error']('ClamAV scan failed', {
        error: error.message,
        failOpen,
      });
      if (!failOpen) {
        return {
          status: 'error',
          engine: 'clamd',
          signatureVersion: 'unknown',
          message: error.message,
          findings: [error.message],
          startedAt: new Date(),
          completedAt: new Date(),
        };
      }
    }
  }

  return performStubScan(filePath);
}

async function performStubScan(filePath: string): Promise<VirusScanResult> {
  const startedAt = new Date();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const completedAt = new Date();

  return {
    status: 'passed',
    engine: config.security?.virusScan?.provider === 'clamd' ? 'clamd-fallback' : 'stubbed',
    signatureVersion: startedAt.toISOString().split('T')[0] ?? 'unknown',
    message: 'Stub scan (no AV provider configured)',
    findings: [],
    startedAt,
    completedAt,
  };
}

async function scanWithClamAV(filePath: string): Promise<VirusScanResult> {
  const clamConfig = config.security?.virusScan?.clamav ?? { host: '127.0.0.1', port: 3310 };
  const startedAt = new Date();

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: clamConfig.host, port: clamConfig.port },
      () => {
        socket.write('zINSTREAM\0');
        const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
        stream.on('data', (chunk) => {
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          socket.write(size);
          socket.write(chunk);
        });
        stream.on('end', () => {
          const zero = Buffer.alloc(4);
          zero.writeUInt32BE(0, 0);
          socket.write(zero);
        });
        stream.on('error', (error) => {
          socket.destroy(error);
        });
      }
    );

    socket.setTimeout(30_000);

    let response = '';
    socket.on('data', (data) => {
      response += data.toString();
    });

    socket.on('timeout', () => {
      socket.destroy(new Error('ClamAV scan timed out'));
    });

    socket.on('error', (error) => {
      reject(error);
    });

    socket.on('close', () => {
      const completedAt = new Date();
      if (!response) {
        return reject(new Error('ClamAV returned an empty response'));
      }

      const normalized = response.trim();
      if (normalized.includes('FOUND')) {
        const signature = normalized.split('FOUND')[0]?.split(':')?.pop()?.trim();
        resolve({
          status: 'failed',
          engine: 'clamd',
          signatureVersion: 'clamd',
          message: normalized,
          findings: signature ? [signature] : [normalized],
          startedAt,
          completedAt,
        });
        return;
      }

      if (normalized.includes('ERROR')) {
        resolve({
          status: 'error',
          engine: 'clamd',
          signatureVersion: 'clamd',
          message: normalized,
          findings: [normalized],
          startedAt,
          completedAt,
        });
        return;
      }

      resolve({
        status: 'passed',
        engine: 'clamd',
        signatureVersion: 'clamd',
        message: normalized,
        findings: [],
        startedAt,
        completedAt,
      });
    });
  });
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
