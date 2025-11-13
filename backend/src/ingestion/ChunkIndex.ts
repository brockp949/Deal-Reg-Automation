/**
 * Chunk Index & Metadata Tracker - Phase 1 Implementation
 * Tracks chunk processing state with SQLite for resumability and concurrency safety
 */

import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'better-sqlite3';
import logger from '../utils/logger';
import { ChunkMetadata } from './MboxSplitter';

// Use require for better-sqlite3 to avoid ESM issues
const BetterSqlite3 = require('better-sqlite3');

export interface ChunkRecord {
  chunk_id: string;
  original_file: string;
  path: string;
  size_bytes: number;
  message_count: number;
  date_start: string | null;
  date_end: string | null;
  hash: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  processed_at: string | null;
}

export interface ProcessingLogEntry {
  id?: number;
  chunk_id: string;
  message_offset: number;
  status: string;
  error: string | null;
  timestamp: string;
}

export class ChunkIndex {
  private db: Database;
  private dbPath: string;

  constructor(dbPath: string = './data/chunk_index.db') {
    this.dbPath = dbPath;

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize database
    this.db = new BetterSqlite3(dbPath);
    this.initializeSchema();

    logger.info('ChunkIndex initialized', { dbPath });
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        original_file TEXT NOT NULL,
        path TEXT NOT NULL,
        size_bytes INTEGER,
        message_count INTEGER,
        date_start TEXT,
        date_end TEXT,
        hash TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT,
        processed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS processing_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT,
        message_offset INTEGER,
        status TEXT,
        error TEXT,
        timestamp TEXT,
        FOREIGN KEY (chunk_id) REFERENCES chunks(chunk_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);
      CREATE INDEX IF NOT EXISTS idx_chunks_original_file ON chunks(original_file);
      CREATE INDEX IF NOT EXISTS idx_processing_log_chunk_id ON processing_log(chunk_id);
    `);

    logger.debug('Database schema initialized');
  }

  /**
   * Register a chunk in the index
   */
  register_chunk(metadata: ChunkMetadata, originalFile: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (
        chunk_id, original_file, path, size_bytes, message_count,
        date_start, date_end, hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    stmt.run(
      metadata.chunk_id,
      originalFile,
      metadata.path,
      metadata.size_bytes,
      metadata.message_count,
      metadata.date_range.start,
      metadata.date_range.end,
      metadata.hash,
      new Date().toISOString()
    );

    logger.debug('Chunk registered', { chunk_id: metadata.chunk_id });
  }

  /**
   * Register multiple chunks at once
   */
  register_chunks(chunks: ChunkMetadata[], originalFile: string): void {
    const transaction = this.db.transaction((chunks: ChunkMetadata[]) => {
      for (const chunk of chunks) {
        this.register_chunk(chunk, originalFile);
      }
    });

    transaction(chunks);

    logger.info('Multiple chunks registered', {
      count: chunks.length,
      originalFile,
    });
  }

  /**
   * Mark chunk as processing
   */
  mark_processing(chunkId: string, messageOffset: number = 0): void {
    const stmt = this.db.prepare(`
      UPDATE chunks
      SET status = 'processing'
      WHERE chunk_id = ?
    `);

    stmt.run(chunkId);

    // Log to processing log
    this.add_processing_log(chunkId, messageOffset, 'processing', null);

    logger.debug('Chunk marked as processing', { chunk_id: chunkId });
  }

  /**
   * Mark chunk as completed
   */
  mark_completed(chunkId: string): void {
    const stmt = this.db.prepare(`
      UPDATE chunks
      SET status = 'completed', processed_at = ?
      WHERE chunk_id = ?
    `);

    stmt.run(new Date().toISOString(), chunkId);

    // Log to processing log
    this.add_processing_log(chunkId, -1, 'completed', null);

    logger.info('Chunk marked as completed', { chunk_id: chunkId });
  }

  /**
   * Mark chunk as failed
   */
  mark_failed(chunkId: string, error: string): void {
    const stmt = this.db.prepare(`
      UPDATE chunks
      SET status = 'failed'
      WHERE chunk_id = ?
    `);

    stmt.run(chunkId);

    // Log to processing log
    this.add_processing_log(chunkId, -1, 'failed', error);

    logger.error('Chunk marked as failed', { chunk_id: chunkId, error });
  }

  /**
   * Get next chunk to process
   */
  get_next_chunk(priority: 'label_score' | 'date' | 'size' = 'date'): ChunkRecord | null {
    let orderBy = 'date_start ASC';

    if (priority === 'size') {
      orderBy = 'size_bytes ASC';
    } else if (priority === 'label_score') {
      // For now, just use date. Could be enhanced with label scoring
      orderBy = 'date_start DESC';
    }

    const stmt = this.db.prepare(`
      SELECT * FROM chunks
      WHERE status = 'pending'
      ORDER BY ${orderBy}
      LIMIT 1
    `);

    const row = stmt.get() as ChunkRecord | undefined;

    if (row) {
      logger.debug('Next chunk retrieved', { chunk_id: row.chunk_id });
    }

    return row || null;
  }

  /**
   * Get resume point for a chunk
   */
  get_resume_point(chunkId: string): number {
    const stmt = this.db.prepare(`
      SELECT message_offset
      FROM processing_log
      WHERE chunk_id = ? AND status = 'processing'
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    const row = stmt.get(chunkId) as { message_offset: number } | undefined;

    return row?.message_offset || 0;
  }

  /**
   * Get chunk by ID
   */
  get_chunk(chunkId: string): ChunkRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM chunks WHERE chunk_id = ?
    `);

    const row = stmt.get(chunkId) as ChunkRecord | undefined;

    return row || null;
  }

  /**
   * Get all chunks for an original file
   */
  get_chunks_for_file(originalFile: string): ChunkRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM chunks
      WHERE original_file = ?
      ORDER BY chunk_id ASC
    `);

    return stmt.all(originalFile) as ChunkRecord[];
  }

  /**
   * Get processing statistics
   */
  get_stats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM chunks
    `);

    const row = stmt.get() as any;

    return {
      total: row.total || 0,
      pending: row.pending || 0,
      processing: row.processing || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
    };
  }

  /**
   * Add entry to processing log
   */
  private add_processing_log(
    chunkId: string,
    messageOffset: number,
    status: string,
    error: string | null
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO processing_log (chunk_id, message_offset, status, error, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunkId,
      messageOffset,
      status,
      error,
      new Date().toISOString()
    );
  }

  /**
   * Get processing log for a chunk
   */
  get_processing_log(chunkId: string): ProcessingLogEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processing_log
      WHERE chunk_id = ?
      ORDER BY timestamp DESC
    `);

    return stmt.all(chunkId) as ProcessingLogEntry[];
  }

  /**
   * Reset chunk status to pending (for retry)
   */
  reset_chunk(chunkId: string): void {
    const stmt = this.db.prepare(`
      UPDATE chunks
      SET status = 'pending', processed_at = NULL
      WHERE chunk_id = ?
    `);

    stmt.run(chunkId);

    this.add_processing_log(chunkId, 0, 'reset', null);

    logger.info('Chunk reset to pending', { chunk_id: chunkId });
  }

  /**
   * Clear all chunks (for testing)
   */
  clear_all(): void {
    this.db.exec(`
      DELETE FROM processing_log;
      DELETE FROM chunks;
    `);

    logger.warn('All chunks cleared from index');
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    logger.info('ChunkIndex closed');
  }
}
