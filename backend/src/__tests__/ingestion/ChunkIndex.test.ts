/**
 * Unit Tests for ChunkIndex - Phase 1
 */

import { ChunkIndex } from '../../ingestion/ChunkIndex';
import { ChunkMetadata } from '../../ingestion/MboxSplitter';
import * as fs from 'fs';
import * as path from 'path';

describe('ChunkIndex', () => {
  let chunkIndex: ChunkIndex;
  let testDbPath: string;

  beforeEach(() => {
    // Use unique database for each test
    testDbPath = path.join(__dirname, `test_chunk_index_${Date.now()}.db`);
    chunkIndex = new ChunkIndex(testDbPath);
  });

  afterEach(() => {
    // Clean up
    chunkIndex.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('register_chunk', () => {
    it('should register a chunk successfully', () => {
      const metadata: ChunkMetadata = {
        chunk_id: 'test_chunk_001',
        path: '/path/to/chunk.mbox',
        size_bytes: 1024000,
        message_count: 100,
        date_range: {
          start: '2024-01-01T00:00:00Z',
          end: '2024-01-31T23:59:59Z',
        },
        hash: 'abc123',
        labels: ['SENT', 'INBOX'],
      };

      chunkIndex.register_chunk(metadata, '/original/file.mbox');

      const chunk = chunkIndex.get_chunk('test_chunk_001');

      expect(chunk).not.toBeNull();
      expect(chunk?.chunk_id).toBe('test_chunk_001');
      expect(chunk?.path).toBe('/path/to/chunk.mbox');
      expect(chunk?.message_count).toBe(100);
      expect(chunk?.status).toBe('pending');
    });

    it('should allow re-registering the same chunk (upsert)', () => {
      const metadata: ChunkMetadata = {
        chunk_id: 'test_chunk_001',
        path: '/path/to/chunk.mbox',
        size_bytes: 1024000,
        message_count: 100,
        date_range: { start: null, end: null },
        hash: 'abc123',
        labels: [],
      };

      chunkIndex.register_chunk(metadata, '/original/file.mbox');
      chunkIndex.register_chunk(metadata, '/original/file.mbox');

      const chunks = chunkIndex.get_chunks_for_file('/original/file.mbox');

      expect(chunks).toHaveLength(1);
    });
  });

  describe('register_chunks', () => {
    it('should register multiple chunks in a transaction', () => {
      const chunks: ChunkMetadata[] = [
        {
          chunk_id: 'chunk_001',
          path: '/path/to/chunk_001.mbox',
          size_bytes: 1024000,
          message_count: 100,
          date_range: { start: null, end: null },
          hash: 'hash1',
          labels: [],
        },
        {
          chunk_id: 'chunk_002',
          path: '/path/to/chunk_002.mbox',
          size_bytes: 2048000,
          message_count: 200,
          date_range: { start: null, end: null },
          hash: 'hash2',
          labels: [],
        },
      ];

      chunkIndex.register_chunks(chunks, '/original/file.mbox');

      const registered = chunkIndex.get_chunks_for_file('/original/file.mbox');

      expect(registered).toHaveLength(2);
      expect(registered[0].chunk_id).toBe('chunk_001');
      expect(registered[1].chunk_id).toBe('chunk_002');
    });
  });

  describe('status transitions', () => {
    beforeEach(() => {
      const metadata: ChunkMetadata = {
        chunk_id: 'test_chunk',
        path: '/path/to/chunk.mbox',
        size_bytes: 1024000,
        message_count: 100,
        date_range: { start: null, end: null },
        hash: 'abc123',
        labels: [],
      };

      chunkIndex.register_chunk(metadata, '/original/file.mbox');
    });

    it('should transition chunk to processing status', () => {
      chunkIndex.mark_processing('test_chunk', 0);

      const chunk = chunkIndex.get_chunk('test_chunk');

      expect(chunk?.status).toBe('processing');
    });

    it('should transition chunk to completed status', () => {
      chunkIndex.mark_processing('test_chunk', 0);
      chunkIndex.mark_completed('test_chunk');

      const chunk = chunkIndex.get_chunk('test_chunk');

      expect(chunk?.status).toBe('completed');
      expect(chunk?.processed_at).not.toBeNull();
    });

    it('should transition chunk to failed status', () => {
      chunkIndex.mark_processing('test_chunk', 0);
      chunkIndex.mark_failed('test_chunk', 'Test error');

      const chunk = chunkIndex.get_chunk('test_chunk');

      expect(chunk?.status).toBe('failed');

      // Check processing log
      const logs = chunkIndex.get_processing_log('test_chunk');
      const failedLog = logs.find((log) => log.status === 'failed');

      expect(failedLog).toBeDefined();
      expect(failedLog?.error).toBe('Test error');
    });

    it('should reset chunk to pending', () => {
      chunkIndex.mark_processing('test_chunk', 0);
      chunkIndex.mark_failed('test_chunk', 'Error');
      chunkIndex.reset_chunk('test_chunk');

      const chunk = chunkIndex.get_chunk('test_chunk');

      expect(chunk?.status).toBe('pending');
      expect(chunk?.processed_at).toBeNull();
    });
  });

  describe('get_next_chunk', () => {
    beforeEach(() => {
      const chunks: ChunkMetadata[] = [
        {
          chunk_id: 'chunk_001',
          path: '/path/to/chunk_001.mbox',
          size_bytes: 1024000,
          message_count: 100,
          date_range: {
            start: '2024-01-01T00:00:00Z',
            end: '2024-01-15T00:00:00Z',
          },
          hash: 'hash1',
          labels: [],
        },
        {
          chunk_id: 'chunk_002',
          path: '/path/to/chunk_002.mbox',
          size_bytes: 2048000,
          message_count: 200,
          date_range: {
            start: '2024-01-16T00:00:00Z',
            end: '2024-01-31T00:00:00Z',
          },
          hash: 'hash2',
          labels: [],
        },
        {
          chunk_id: 'chunk_003',
          path: '/path/to/chunk_003.mbox',
          size_bytes: 512000,
          message_count: 50,
          date_range: {
            start: '2024-02-01T00:00:00Z',
            end: '2024-02-15T00:00:00Z',
          },
          hash: 'hash3',
          labels: [],
        },
      ];

      chunkIndex.register_chunks(chunks, '/original/file.mbox');
    });

    it('should get next pending chunk by date (default)', () => {
      const next = chunkIndex.get_next_chunk();

      expect(next).not.toBeNull();
      expect(next?.chunk_id).toBe('chunk_001'); // Earliest date
    });

    it('should get next pending chunk by size', () => {
      const next = chunkIndex.get_next_chunk('size');

      expect(next).not.toBeNull();
      expect(next?.chunk_id).toBe('chunk_003'); // Smallest size
    });

    it('should skip chunks that are not pending', () => {
      chunkIndex.mark_completed('chunk_001');

      const next = chunkIndex.get_next_chunk();

      expect(next?.chunk_id).toBe('chunk_002');
    });

    it('should return null when no pending chunks', () => {
      chunkIndex.mark_completed('chunk_001');
      chunkIndex.mark_completed('chunk_002');
      chunkIndex.mark_completed('chunk_003');

      const next = chunkIndex.get_next_chunk();

      expect(next).toBeNull();
    });
  });

  describe('get_stats', () => {
    it('should return correct statistics', () => {
      const chunks: ChunkMetadata[] = [
        {
          chunk_id: 'chunk_001',
          path: '/path/chunk_001.mbox',
          size_bytes: 1024,
          message_count: 10,
          date_range: { start: null, end: null },
          hash: 'hash1',
          labels: [],
        },
        {
          chunk_id: 'chunk_002',
          path: '/path/chunk_002.mbox',
          size_bytes: 2048,
          message_count: 20,
          date_range: { start: null, end: null },
          hash: 'hash2',
          labels: [],
        },
        {
          chunk_id: 'chunk_003',
          path: '/path/chunk_003.mbox',
          size_bytes: 512,
          message_count: 5,
          date_range: { start: null, end: null },
          hash: 'hash3',
          labels: [],
        },
      ];

      chunkIndex.register_chunks(chunks, '/original/file.mbox');

      chunkIndex.mark_processing('chunk_001');
      chunkIndex.mark_completed('chunk_002');
      chunkIndex.mark_failed('chunk_003', 'Error');

      const stats = chunkIndex.get_stats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
    });
  });

  describe('processing_log', () => {
    it('should track processing log entries', () => {
      const metadata: ChunkMetadata = {
        chunk_id: 'test_chunk',
        path: '/path/to/chunk.mbox',
        size_bytes: 1024000,
        message_count: 100,
        date_range: { start: null, end: null },
        hash: 'abc123',
        labels: [],
      };

      chunkIndex.register_chunk(metadata, '/original/file.mbox');

      chunkIndex.mark_processing('test_chunk', 0);
      chunkIndex.mark_processing('test_chunk', 50);
      chunkIndex.mark_completed('test_chunk');

      const logs = chunkIndex.get_processing_log('test_chunk');

      expect(logs.length).toBeGreaterThanOrEqual(3);

      const statuses = logs.map((log) => log.status);
      expect(statuses).toContain('processing');
      expect(statuses).toContain('completed');
    });
  });

  describe('get_resume_point', () => {
    it('should return last processing offset', () => {
      const metadata: ChunkMetadata = {
        chunk_id: 'test_chunk',
        path: '/path/to/chunk.mbox',
        size_bytes: 1024000,
        message_count: 100,
        date_range: { start: null, end: null },
        hash: 'abc123',
        labels: [],
      };

      chunkIndex.register_chunk(metadata, '/original/file.mbox');

      chunkIndex.mark_processing('test_chunk', 100);

      const resumePoint = chunkIndex.get_resume_point('test_chunk');

      expect(resumePoint).toBe(100);
    });

    it('should return 0 if no processing log exists', () => {
      const metadata: ChunkMetadata = {
        chunk_id: 'test_chunk',
        path: '/path/to/chunk.mbox',
        size_bytes: 1024000,
        message_count: 100,
        date_range: { start: null, end: null },
        hash: 'abc123',
        labels: [],
      };

      chunkIndex.register_chunk(metadata, '/original/file.mbox');

      const resumePoint = chunkIndex.get_resume_point('test_chunk');

      expect(resumePoint).toBe(0);
    });
  });

  describe('clear_all', () => {
    it('should clear all chunks and logs', () => {
      const chunks: ChunkMetadata[] = [
        {
          chunk_id: 'chunk_001',
          path: '/path/chunk_001.mbox',
          size_bytes: 1024,
          message_count: 10,
          date_range: { start: null, end: null },
          hash: 'hash1',
          labels: [],
        },
      ];

      chunkIndex.register_chunks(chunks, '/original/file.mbox');

      chunkIndex.clear_all();

      const stats = chunkIndex.get_stats();

      expect(stats.total).toBe(0);
    });
  });
});
