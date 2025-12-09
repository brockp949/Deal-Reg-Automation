/**
 * Deal Import Hook
 * Provides functionality for importing deals for a specific vendor.
 */

import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dealImportAPI } from '@/lib/api';
import type {
  DealImportPreviewResponse,
  DealImportJobResponse,
  DealImportJobStatus,
} from '@/types/api';

interface UseDealImportOptions {
  vendorId: string;
  onSuccess?: (result: DealImportJobStatus) => void;
  onError?: (error: Error) => void;
}

interface UseDealImportReturn {
  // Preview
  previewData: DealImportPreviewResponse | null;
  isPreviewLoading: boolean;
  previewError: Error | null;
  preview: (file: File) => Promise<DealImportPreviewResponse | null>;
  clearPreview: () => void;

  // Import
  startImport: (file: File) => Promise<void>;
  isImporting: boolean;
  importProgress: number;
  importStatus: DealImportJobStatus | null;
  importError: Error | null;

  // Upload progress
  uploadProgress: number;
}

export function useDealImport({
  vendorId,
  onSuccess,
  onError,
}: UseDealImportOptions): UseDealImportReturn {
  const queryClient = useQueryClient();

  // Preview state
  const [previewData, setPreviewData] = useState<DealImportPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<Error | null>(null);

  // Import state
  const [importStatus, setImportStatus] = useState<DealImportJobStatus | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importError, setImportError] = useState<Error | null>(null);

  // Upload progress
  const [uploadProgress, setUploadProgress] = useState(0);

  // Polling interval ref
  const pollingIntervalRef = useRef<number | null>(null);

  // Clear polling interval
  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Preview mutation
  const preview = useCallback(async (file: File): Promise<DealImportPreviewResponse | null> => {
    setIsPreviewLoading(true);
    setPreviewError(null);
    setUploadProgress(0);

    try {
      const response = await dealImportAPI.previewImport(
        vendorId,
        file,
        (event) => {
          if (event.total) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        }
      );

      if (response.data.success) {
        const data = response.data.data;
        setPreviewData(data);
        return data;
      } else {
        throw new Error(response.data.error || 'Preview failed');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Preview failed');
      setPreviewError(err);
      onError?.(err);
      return null;
    } finally {
      setIsPreviewLoading(false);
      setUploadProgress(0);
    }
  }, [vendorId, onError]);

  // Clear preview
  const clearPreview = useCallback(() => {
    setPreviewData(null);
    setPreviewError(null);
  }, []);

  // Poll job status
  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const response = await dealImportAPI.getJobStatus(vendorId, jobId);

      if (response.data.success) {
        const status = response.data.data;
        setImportStatus(status);
        setImportProgress(status.progress);

        // Check if job is complete
        if (status.state === 'completed') {
          clearPolling();
          setImportProgress(100);

          // Invalidate related queries
          queryClient.invalidateQueries({ queryKey: ['vendor-deals', vendorId] });
          queryClient.invalidateQueries({ queryKey: ['deals'] });

          onSuccess?.(status);
        } else if (status.state === 'failed') {
          clearPolling();
          const err = new Error(status.failedReason || 'Import failed');
          setImportError(err);
          onError?.(err);
        }
      }
    } catch (error) {
      clearPolling();
      const err = error instanceof Error ? error : new Error('Failed to check import status');
      setImportError(err);
      onError?.(err);
    }
  }, [vendorId, clearPolling, queryClient, onSuccess, onError]);

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      setImportError(null);
      setImportProgress(0);
      setImportStatus(null);
      setUploadProgress(0);

      const response = await dealImportAPI.startImport(
        vendorId,
        file,
        (event) => {
          if (event.total) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Import failed');
      }

      return response.data.data;
    },
    onSuccess: (data: DealImportJobResponse) => {
      setUploadProgress(0);

      // Start polling for job status
      pollingIntervalRef.current = window.setInterval(() => {
        pollJobStatus(data.jobId);
      }, 1000);

      // Initial poll
      pollJobStatus(data.jobId);
    },
    onError: (error: Error) => {
      setImportError(error);
      setUploadProgress(0);
      onError?.(error);
    },
  });

  // Start import
  const startImport = useCallback(async (file: File) => {
    clearPolling();
    await importMutation.mutateAsync(file);
  }, [importMutation, clearPolling]);

  return {
    // Preview
    previewData,
    isPreviewLoading,
    previewError,
    preview,
    clearPreview,

    // Import
    startImport,
    isImporting: importMutation.isPending || (importStatus?.state === 'active'),
    importProgress,
    importStatus,
    importError,

    // Upload progress
    uploadProgress,
  };
}

export default useDealImport;
