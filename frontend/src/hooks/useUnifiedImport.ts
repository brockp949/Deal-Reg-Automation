/**
 * useUnifiedImport Hook
 *
 * Manages the unified file import process with intent-based routing
 * and real-time progress tracking via SSE.
 * Supports chunked uploads for large files (>50MB).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fileAPI, progressAPI, type FileIntent, type UnifiedUploadOptions } from '@/lib/api';
import { toast } from 'sonner';
import { useChunkedUpload } from './useChunkedUpload';

const CHUNKED_UPLOAD_THRESHOLD = 50 * 1024 * 1024; // 50MB

// File with intent and progress tracking
export interface ImportFile {
  id: string;
  file: File;
  intent: FileIntent;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  uploadProgress: number;
  processingProgress: number;
  result?: {
    vendorsCreated: number;
    dealsCreated: number;
    contactsCreated: number;
    errors: string[];
    warnings: string[];
  };
  error?: string;
  fileId?: string;  // Backend file ID after upload
  isChunkedUpload?: boolean; // True if using chunked upload for large files
}

// Auto-detect intent from file
function detectIntent(file: File): FileIntent {
  const filename = file.name.toLowerCase();
  const ext = filename.substring(filename.lastIndexOf('.'));

  // Check extension first
  if (ext === '.mbox') return 'email';
  if (ext === '.txt' || ext === '.pdf' || ext === '.docx') return 'transcript';

  // Check filename patterns for spreadsheets
  const vendorSpreadsheetPattern = /^(.+?)\s*[-_]\s*deals?\.(xlsx?|csv)$/i;
  if (vendorSpreadsheetPattern.test(file.name)) {
    return 'vendor_spreadsheet';
  }

  // Check for keywords
  if (filename.includes('vendor') || filename.includes('supplier') || filename.includes('manufacturer')) {
    return 'vendor';
  }
  if (filename.includes('deal') || filename.includes('opportunity') || filename.includes('registration')) {
    return 'deal';
  }

  return 'auto';
}

// Get display name for intent
export function getIntentDisplayName(intent: FileIntent): string {
  const names: Record<FileIntent, string> = {
    vendor: 'Vendor List',
    deal: 'Deal List',
    email: 'Email Archive',
    transcript: 'Transcript',
    vendor_spreadsheet: 'Vendor Deals Spreadsheet',
    auto: 'Auto-detect',
  };
  return names[intent];
}

// Get icon for intent
export function getIntentIcon(intent: FileIntent): string {
  const icons: Record<FileIntent, string> = {
    vendor: '🏢',
    deal: '💼',
    email: '📧',
    transcript: '📝',
    vendor_spreadsheet: '📊',
    auto: '🔍',
  };
  return icons[intent];
}

export function useUnifiedImport() {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const currentChunkedFileIdRef = useRef<string | null>(null);

  // Initialize chunked upload hook for large files (>50MB)
  const chunkedUpload = useChunkedUpload({
    onProgress: (progress) => {
      const fileId = currentChunkedFileIdRef.current;
      if (fileId) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId ? { ...f, uploadProgress: progress.progress } : f
          )
        );
      }
    },
    onComplete: (uploadId, jobId) => {
      const fileId = currentChunkedFileIdRef.current;
      if (fileId) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, status: 'processing', uploadProgress: 100, fileId: jobId }
              : f
          )
        );

        // Subscribe to processing progress
        const file = files.find((f) => f.id === fileId);
        if (file) {
          subscribeToProgress({ ...file, fileId: jobId });
        }
      }
      currentChunkedFileIdRef.current = null;
    },
    onError: (error) => {
      const fileId = currentChunkedFileIdRef.current;
      if (fileId) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId ? { ...f, status: 'failed', error: error.message } : f
          )
        );
        const file = files.find((f) => f.id === fileId);
        if (file) {
          toast.error(`Failed to upload ${file.file.name}: ${error.message}`);
        }
      }
      currentChunkedFileIdRef.current = null;
    },
  });

  // Cleanup event sources on unmount
  useEffect(() => {
    return () => {
      eventSourcesRef.current.forEach((es) => es.close());
      eventSourcesRef.current.clear();
    };
  }, []);

  // Add files to the queue
  const addFiles = useCallback((newFiles: File[]) => {
    const importFiles: ImportFile[] = newFiles.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      intent: detectIntent(file),
      status: 'pending',
      uploadProgress: 0,
      processingProgress: 0,
    }));
    setFiles((prev) => [...prev, ...importFiles]);
  }, []);

  // Remove a file from the queue
  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    // Close any associated event source
    const es = eventSourcesRef.current.get(id);
    if (es) {
      es.close();
      eventSourcesRef.current.delete(id);
    }
  }, []);

  // Update file intent
  const updateIntent = useCallback((id: string, intent: FileIntent) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, intent } : f))
    );
  }, []);

  // Subscribe to progress updates for a file
  const subscribeToProgress = useCallback((importFile: ImportFile) => {
    if (!importFile.fileId) return;

    // Close existing connection if any
    const existing = eventSourcesRef.current.get(importFile.id);
    if (existing) {
      existing.close();
    }

    const es = progressAPI.subscribe(importFile.fileId);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setFiles((prev) =>
          prev.map((f) => {
            if (f.id === importFile.id) {
              return {
                ...f,
                processingProgress: data.progress || f.processingProgress,
                status: data.stage === 'completed' ? 'completed' :
                        data.stage === 'failed' ? 'failed' :
                        'processing',
                result: data.result,
                error: data.stage === 'failed' ? data.message : undefined,
              };
            }
            return f;
          })
        );

        // Close connection when done
        if (data.stage === 'completed' || data.stage === 'failed') {
          es.close();
          eventSourcesRef.current.delete(importFile.id);

          if (data.stage === 'completed') {
            toast.success(`Processed ${importFile.file.name}`);
          } else {
            toast.error(`Failed to process ${importFile.file.name}`);
          }

          // Invalidate queries
          queryClient.invalidateQueries({ queryKey: ['files'] });
          queryClient.invalidateQueries({ queryKey: ['vendors'] });
          queryClient.invalidateQueries({ queryKey: ['deals'] });
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e);
      }
    };

    es.onerror = () => {
      es.close();
      eventSourcesRef.current.delete(importFile.id);
    };

    eventSourcesRef.current.set(importFile.id, es);
  }, [queryClient]);

  // Upload a single file
  const uploadFile = useCallback(async (importFile: ImportFile) => {
    const isLargeFile = importFile.file.size > CHUNKED_UPLOAD_THRESHOLD;

    setFiles((prev) =>
      prev.map((f) =>
        f.id === importFile.id
          ? { ...f, status: 'uploading', isChunkedUpload: isLargeFile }
          : f
      )
    );

    try {
      if (isLargeFile) {
        // Use chunked upload for large files (>50MB)
        currentChunkedFileIdRef.current = importFile.id;

        const result = await chunkedUpload.uploadFile(
          importFile.file,
          importFile.intent
        );

        if (result) {
          // Success - callbacks will handle state updates
          return true;
        } else {
          throw new Error('Chunked upload failed');
        }
      } else {
        // Use regular upload for small files
        const options: UnifiedUploadOptions = {
          uploadIntent: importFile.intent,
        };

        const response = await fileAPI.uploadWithIntent(
          importFile.file,
          options,
          (progressEvent) => {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setFiles((prev) =>
              prev.map((f) => (f.id === importFile.id ? { ...f, uploadProgress: progress } : f))
            );
          }
        );

        if (response.data.success) {
          const fileId = response.data.data?.id;
          setFiles((prev) =>
            prev.map((f) =>
              f.id === importFile.id
                ? { ...f, status: 'processing', uploadProgress: 100, fileId }
                : f
            )
          );

          // Subscribe to progress updates
          if (fileId) {
            subscribeToProgress({ ...importFile, fileId });
          }

          return true;
        } else {
          throw new Error(response.data.error || 'Upload failed');
        }
      }
    } catch (error: any) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === importFile.id
            ? { ...f, status: 'failed', error: error.message }
            : f
        )
      );
      toast.error(`Failed to upload ${importFile.file.name}: ${error.message}`);
      currentChunkedFileIdRef.current = null;
      return false;
    }
  }, [subscribeToProgress, chunkedUpload]);

  // Upload all pending files
  const uploadAll = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) {
      toast.error('No files to upload');
      return;
    }

    setIsUploading(true);

    for (const file of pendingFiles) {
      await uploadFile(file);
    }

    setIsUploading(false);
    toast.success(`Started processing ${pendingFiles.length} files`);
  }, [files, uploadFile]);

  // Clear all files
  const clearAll = useCallback(() => {
    eventSourcesRef.current.forEach((es) => es.close());
    eventSourcesRef.current.clear();
    setFiles([]);
  }, []);

  // Retry a failed file
  const retryFile = useCallback((id: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, status: 'pending', uploadProgress: 0, processingProgress: 0, error: undefined }
          : f
      )
    );
  }, []);

  // Get summary statistics
  const summary = {
    total: files.length,
    pending: files.filter((f) => f.status === 'pending').length,
    uploading: files.filter((f) => f.status === 'uploading').length,
    processing: files.filter((f) => f.status === 'processing').length,
    completed: files.filter((f) => f.status === 'completed').length,
    failed: files.filter((f) => f.status === 'failed').length,
    totalVendors: files.reduce((sum, f) => sum + (f.result?.vendorsCreated || 0), 0),
    totalDeals: files.reduce((sum, f) => sum + (f.result?.dealsCreated || 0), 0),
    totalContacts: files.reduce((sum, f) => sum + (f.result?.contactsCreated || 0), 0),
  };

  return {
    files,
    isUploading,
    summary,
    addFiles,
    removeFile,
    updateIntent,
    uploadFile,
    uploadAll,
    clearAll,
    retryFile,
    // Chunked upload controls (for large files >50MB)
    chunkedUploadProgress: chunkedUpload.progress,
    isChunkedUploading: chunkedUpload.isUploading,
    cancelChunkedUpload: chunkedUpload.cancelUpload,
  };
}

export default useUnifiedImport;
