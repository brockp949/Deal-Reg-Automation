/**
 * useChunkedUpload Hook
 *
 * React hook for uploading large files in resumable chunks.
 *
 * Features:
 * - Splits files into 5MB chunks
 * - Uploads chunks in parallel (3 concurrent)
 * - Resume interrupted uploads
 * - Progress tracking
 * - Automatic retry on failure
 */

import { useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';

export interface ChunkedUploadProgress {
  uploadedChunks: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  progress: number; // 0-100
  speed: number; // bytes per second
  estimatedTimeRemaining: number; // seconds
  currentChunk: number;
}

export interface ChunkedUploadOptions {
  chunkSize?: number; // Default: 5MB
  maxConcurrent?: number; // Default: 3
  maxRetries?: number; // Default: 3
  retryDelay?: number; // Default: 1000ms
  onProgress?: (progress: ChunkedUploadProgress) => void;
  onChunkComplete?: (chunkIndex: number, totalChunks: number) => void;
  onComplete?: (uploadId: string, fileId: string, jobId?: string) => void;
  onError?: (error: Error) => void;
}

interface UseChunkedUploadReturn {
  uploadFile: (file: File, intent?: string) => Promise<{ uploadId: string; fileId: string; jobId?: string } | null>;
  progress: ChunkedUploadProgress | null;
  isUploading: boolean;
  error: string | null;
  cancelUpload: () => void;
  resumeUpload: (uploadId: string, file: File) => Promise<void>;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second

/**
 * Hook to upload files in resumable chunks
 *
 * @example
 * ```tsx
 * const { uploadFile, progress, isUploading, cancelUpload } = useChunkedUpload({
 *   onProgress: (p) => console.log(`${p.progress}% complete`),
 *   onComplete: (uploadId, fileId, jobId) => console.log('Upload complete!', fileId, jobId),
 * });
 *
 * const handleFileSelect = async (file: File) => {
 *   if (file.size > 50 * 1024 * 1024) { // > 50MB
 *     await uploadFile(file, 'vendor_spreadsheet');
 *   }
 * };
 * ```
 */
export function useChunkedUpload(options: ChunkedUploadOptions = {}): UseChunkedUploadReturn {
  const [progress, setProgress] = useState<ChunkedUploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortController = useRef<AbortController | null>(null);
  const startTime = useRef<number>(0);

  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
  } = options;

  /**
   * Split file into chunks
   */
  const createChunks = useCallback((file: File): Blob[] => {
    const chunks: Blob[] = [];
    let offset = 0;

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      chunks.push(chunk);
      offset += chunkSize;
    }

    return chunks;
  }, [chunkSize]);

  /**
   * Initialize upload
   */
  const initializeUpload = useCallback(
    async (file: File, intent?: string): Promise<string> => {
      const chunks = createChunks(file);

      const response = await api.post<any>('/files/upload/chunked/init', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        totalChunks: chunks.length,
        chunkSize,
        intent,
      });
      const payload = response.data;
      if (payload?.success === false) {
        throw new Error(payload.error || 'Failed to initialize upload');
      }

      const data = payload?.data || payload;
      const uploadId = data?.uploadId;
      if (!uploadId) {
        throw new Error('Upload initialization failed: missing uploadId');
      }

      return uploadId;
    },
    [createChunks, chunkSize]
  );

  /**
   * Upload a single chunk with retry
   */
  const uploadChunk = useCallback(
    async (
      uploadId: string,
      chunk: Blob,
      chunkIndex: number,
      retries: number = 0
    ): Promise<void> => {
      try {
        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', chunkIndex.toString());
        formData.append('chunk', chunk);

        await api.post('/files/upload/chunked/chunk', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          signal: abortController.current?.signal,
        });

        // Notify chunk complete
        if (options.onChunkComplete) {
          const totalChunks = Math.ceil(chunk.size / chunkSize);
          options.onChunkComplete(chunkIndex, totalChunks);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw err; // Don't retry if cancelled
        }

        if (retries < maxRetries) {
          console.warn(`Chunk ${chunkIndex} failed, retrying (${retries + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * (retries + 1)));
          return uploadChunk(uploadId, chunk, chunkIndex, retries + 1);
        }

        throw new Error(`Failed to upload chunk ${chunkIndex}: ${err.message}`);
      }
    },
    [chunkSize, maxRetries, retryDelay, options]
  );

  /**
   * Upload chunks in parallel with concurrency limit
   */
  const uploadChunks = useCallback(
    async (uploadId: string, chunks: Blob[]): Promise<void> => {
      let uploadedChunks = 0;
      let uploadedBytes = 0;
      const totalChunks = chunks.length;
      const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0);

      const updateProgress = () => {
        const elapsed = Date.now() - startTime.current;
        const speed = elapsed > 0 ? (uploadedBytes / elapsed) * 1000 : 0;
        const remainingBytes = totalBytes - uploadedBytes;
        const estimatedTimeRemaining = speed > 0 ? remainingBytes / speed : 0;

        const progressData: ChunkedUploadProgress = {
          uploadedChunks,
          totalChunks,
          uploadedBytes,
          totalBytes,
          progress: Math.round((uploadedBytes / totalBytes) * 100),
          speed,
          estimatedTimeRemaining,
          currentChunk: uploadedChunks,
        };

        setProgress(progressData);

        if (options.onProgress) {
          options.onProgress(progressData);
        }
      };

      // Process chunks concurrently
      const processChunk = async (chunkIndex: number): Promise<void> => {
        await uploadChunk(uploadId, chunks[chunkIndex], chunkIndex);

        uploadedChunks++;
        uploadedBytes += chunks[chunkIndex].size;
        updateProgress();
      };

      // Upload chunks with concurrency limit
      let currentIndex = 0;
      const workers: Promise<void>[] = [];

      const processNext = async (): Promise<void> => {
        while (currentIndex < totalChunks) {
          const index = currentIndex++;
          await processChunk(index);
        }
      };

      // Start workers
      for (let i = 0; i < Math.min(maxConcurrent, totalChunks); i++) {
        workers.push(processNext());
      }

      await Promise.all(workers);
    },
    [uploadChunk, maxConcurrent, options]
  );

  /**
   * Complete upload
   */
  const completeUpload = useCallback(async (uploadId: string): Promise<{ fileId: string; jobId?: string }> => {
    const response = await api.post<any>('/files/upload/chunked/complete', { uploadId });
    const payload = response.data;

    if (payload?.success === false) {
      throw new Error(payload.error || 'Failed to complete upload');
    }

    const data = payload?.data || payload;
    const fileId = data?.fileId || data?.id;
    if (!fileId) {
      throw new Error('Upload completed but file ID was missing');
    }

    return { fileId, jobId: data?.jobId };
  }, []);

  /**
   * Upload file in chunks
   */
  const uploadFile = useCallback(
    async (file: File, intent?: string): Promise<{ uploadId: string; fileId: string; jobId?: string } | null> => {
      setIsUploading(true);
      setError(null);
      setProgress(null);
      startTime.current = Date.now();
      abortController.current = new AbortController();

      try {
        // Initialize upload
        const uploadId = await initializeUpload(file, intent);

        // Create chunks
        const chunks = createChunks(file);

        // Upload chunks
        await uploadChunks(uploadId, chunks);

        // Complete upload
        const { fileId, jobId } = await completeUpload(uploadId);

        // Notify complete
        if (options.onComplete) {
          options.onComplete(uploadId, fileId, jobId);
        }

        setIsUploading(false);

        return { uploadId, fileId, jobId };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('Upload cancelled');
          setError('Upload cancelled');
        } else {
          const errorMessage = err.response?.data?.message || err.message || 'Upload failed';
          setError(errorMessage);
          console.error('Chunked upload error:', err);

          if (options.onError) {
            options.onError(err);
          }
        }

        setIsUploading(false);
        return null;
      }
    },
    [initializeUpload, createChunks, uploadChunks, completeUpload, options]
  );

  /**
   * Cancel upload
   */
  const cancelUpload = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort();
      setIsUploading(false);
      setError('Upload cancelled');
    }
  }, []);

  /**
   * Resume upload from a previous session
   */
  const resumeUpload = useCallback(
    async (uploadId: string, file: File): Promise<void> => {
      setIsUploading(true);
      setError(null);
      startTime.current = Date.now();
      abortController.current = new AbortController();

      try {
        // Get upload status
        const statusResponse = await api.get<any>(`/files/upload/chunked/status/${uploadId}`);
        const statusPayload = statusResponse.data;
        if (statusPayload?.success === false) {
          throw new Error(statusPayload.error || 'Failed to check upload status');
        }

        const statusData = statusPayload?.data || statusPayload;
        const missingChunks = Array.isArray(statusData?.missingChunks)
          ? statusData.missingChunks
          : [];

        if (missingChunks.length === 0) {
          // All chunks uploaded, complete the upload
          const { fileId, jobId } = await completeUpload(uploadId);

          if (options.onComplete) {
            options.onComplete(uploadId, fileId, jobId);
          }

          setIsUploading(false);
          return;
        }

        // Upload missing chunks
        const chunks = createChunks(file);
        const missingChunkBlobs = missingChunks.map((idx: number) => chunks[idx]);

        await uploadChunks(uploadId, missingChunkBlobs);

        // Complete upload
        const { fileId, jobId } = await completeUpload(uploadId);

        if (options.onComplete) {
          options.onComplete(uploadId, fileId, jobId);
        }

        setIsUploading(false);
      } catch (err: any) {
        const errorMessage = err.response?.data?.message || err.message || 'Resume failed';
        setError(errorMessage);
        console.error('Resume upload error:', err);

        if (options.onError) {
          options.onError(err);
        }

        setIsUploading(false);
      }
    },
    [createChunks, uploadChunks, completeUpload, options]
  );

  return {
    uploadFile,
    progress,
    isUploading,
    error,
    cancelUpload,
    resumeUpload,
  };
}

export default useChunkedUpload;
