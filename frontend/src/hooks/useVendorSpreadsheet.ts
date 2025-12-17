/**
 * Vendor Spreadsheet Hook
 * Provides functionality for importing and exporting vendor deal spreadsheets.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  vendorSpreadsheetAPI,
  dealAPI,
  VendorSpreadsheetDeal,
  VendorMatch,
  SpreadsheetPreviewResponse,
  SpreadsheetImportResponse,
} from '@/lib/api';

// Re-export types
export type { VendorSpreadsheetDeal, VendorMatch, SpreadsheetPreviewResponse, SpreadsheetImportResponse };

interface UseVendorSpreadsheetImportOptions {
  onSuccess?: (result: SpreadsheetImportResponse) => void;
  onError?: (error: Error) => void;
}

interface UseVendorSpreadsheetImportReturn {
  // File selection
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;

  // Extract vendor from filename
  extractedVendorName: string | null;
  matchingVendors: VendorMatch[];
  canCreateNew: boolean;
  isExtracting: boolean;
  extractVendor: (filename: string) => Promise<void>;

  // Preview
  previewData: SpreadsheetPreviewResponse | null;
  isPreviewLoading: boolean;
  previewError: Error | null;
  preview: (file: File) => Promise<SpreadsheetPreviewResponse | null>;
  clearPreview: () => void;

  // Import
  importSpreadsheet: (options: {
    vendorId?: string;
    vendorName?: string;
    createNewVendor?: boolean;
  }) => Promise<SpreadsheetImportResponse | null>;
  isImporting: boolean;
  importResult: SpreadsheetImportResponse | null;
  importError: Error | null;

  // Upload progress
  uploadProgress: number;

  // Reset all state
  reset: () => void;
}

export function useVendorSpreadsheetImport({
  onSuccess,
  onError,
}: UseVendorSpreadsheetImportOptions = {}): UseVendorSpreadsheetImportReturn {
  const queryClient = useQueryClient();

  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Extract vendor state
  const [extractedVendorName, setExtractedVendorName] = useState<string | null>(null);
  const [matchingVendors, setMatchingVendors] = useState<VendorMatch[]>([]);
  const [canCreateNew, setCanCreateNew] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  // Preview state
  const [previewData, setPreviewData] = useState<SpreadsheetPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<Error | null>(null);

  // Import state
  const [importResult, setImportResult] = useState<SpreadsheetImportResponse | null>(null);
  const [importError, setImportError] = useState<Error | null>(null);

  // Upload progress
  const [uploadProgress, setUploadProgress] = useState(0);

  // Extract vendor from filename
  const extractVendor = useCallback(async (filename: string) => {
    setIsExtracting(true);
    try {
      const response = await vendorSpreadsheetAPI.extractVendor(filename);
      if (response.data.success) {
        const data = response.data.data;
        setExtractedVendorName(data.extractedVendorName);
        setMatchingVendors(data.matchingVendors);
        setCanCreateNew(data.canCreateNew);
      }
    } catch (error) {
      console.error('Failed to extract vendor from filename:', error);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  // Preview spreadsheet
  const preview = useCallback(async (file: File): Promise<SpreadsheetPreviewResponse | null> => {
    setIsPreviewLoading(true);
    setPreviewError(null);
    setUploadProgress(0);

    try {
      const response = await vendorSpreadsheetAPI.preview(file, (event) => {
        if (event.total) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      if (response.data.success) {
        const data = response.data.data;
        setPreviewData(data);
        setExtractedVendorName(data.extractedVendorName);
        setMatchingVendors(data.matchingVendors);
        setCanCreateNew(!!data.extractedVendorName);
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
  }, [onError]);

  // Clear preview
  const clearPreview = useCallback(() => {
    setPreviewData(null);
    setPreviewError(null);
  }, []);

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (options: {
      vendorId?: string;
      vendorName?: string;
      createNewVendor?: boolean;
    }) => {
      if (!selectedFile) {
        throw new Error('No file selected');
      }

      setImportError(null);
      setUploadProgress(0);

      const response = await vendorSpreadsheetAPI.import(
        selectedFile,
        options,
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
    onSuccess: (data) => {
      setImportResult(data);
      setUploadProgress(0);

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-deals', data.vendorId] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });

      onSuccess?.(data);
    },
    onError: (error: Error) => {
      setImportError(error);
      setUploadProgress(0);
      onError?.(error);
    },
  });

  // Import spreadsheet
  const importSpreadsheet = useCallback(
    async (options: {
      vendorId?: string;
      vendorName?: string;
      createNewVendor?: boolean;
    }): Promise<SpreadsheetImportResponse | null> => {
      try {
        return await importMutation.mutateAsync(options);
      } catch {
        return null;
      }
    },
    [importMutation]
  );

  // Reset all state
  const reset = useCallback(() => {
    setSelectedFile(null);
    setExtractedVendorName(null);
    setMatchingVendors([]);
    setCanCreateNew(false);
    setPreviewData(null);
    setPreviewError(null);
    setImportResult(null);
    setImportError(null);
    setUploadProgress(0);
  }, []);

  return {
    // File selection
    selectedFile,
    setSelectedFile,

    // Extract vendor
    extractedVendorName,
    matchingVendors,
    canCreateNew,
    isExtracting,
    extractVendor,

    // Preview
    previewData,
    isPreviewLoading,
    previewError,
    preview,
    clearPreview,

    // Import
    importSpreadsheet,
    isImporting: importMutation.isPending,
    importResult,
    importError,

    // Upload progress
    uploadProgress,

    // Reset
    reset,
  };
}

// Hook for inline deal editing
interface UseInlineDealEditOptions {
  vendorId: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface UseInlineDealEditReturn {
  updateDeal: (dealId: string, field: string, value: unknown) => Promise<void>;
  isUpdating: boolean;
  updateError: Error | null;
}

export function useInlineDealEdit({
  vendorId,
  onSuccess,
  onError,
}: UseInlineDealEditOptions): UseInlineDealEditReturn {
  const queryClient = useQueryClient();
  const [updateError, setUpdateError] = useState<Error | null>(null);

  const updateMutation = useMutation({
    mutationFn: async ({ dealId, field, value }: { dealId: string; field: string; value: unknown }) => {
      const updateData: Record<string, unknown> = { [field]: value };

      const response = await dealAPI.update(dealId, updateData);

      if (!response.data.success) {
        throw new Error(response.data.error || 'Update failed');
      }

      return response.data.data;
    },
    onMutate: async ({ dealId, field, value }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['vendor-deals', vendorId] });

      // Snapshot the previous value
      const previousDeals = queryClient.getQueryData(['vendor-deals', vendorId]);

      // Optimistically update
      queryClient.setQueryData(['vendor-deals', vendorId], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((deal: any) =>
            deal.id === dealId ? { ...deal, [field]: value } : deal
          ),
        };
      });

      return { previousDeals };
    },
    onSuccess: () => {
      setUpdateError(null);
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      onSuccess?.();
    },
    onError: (error: Error, _variables, context) => {
      setUpdateError(error);
      // Rollback on error
      if (context?.previousDeals) {
        queryClient.setQueryData(['vendor-deals', vendorId], context.previousDeals);
      }
      onError?.(error);
    },
  });

  const updateDeal = useCallback(
    async (dealId: string, field: string, value: unknown) => {
      await updateMutation.mutateAsync({ dealId, field, value });
    },
    [updateMutation]
  );

  return {
    updateDeal,
    isUpdating: updateMutation.isPending,
    updateError,
  };
}

// Hook for spreadsheet export
interface UseVendorSpreadsheetExportOptions {
  vendorId: string;
  vendorName: string;
  onError?: (error: Error) => void;
}

interface UseVendorSpreadsheetExportReturn {
  exportSpreadsheet: (dealIds?: string[]) => Promise<void>;
  isExporting: boolean;
  exportError: Error | null;
}

export function useVendorSpreadsheetExport({
  vendorId,
  vendorName,
  onError,
}: UseVendorSpreadsheetExportOptions): UseVendorSpreadsheetExportReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<Error | null>(null);

  const exportSpreadsheet = useCallback(
    async (dealIds?: string[]) => {
      setIsExporting(true);
      setExportError(null);

      try {
        let response;
        if (dealIds && dealIds.length > 0) {
          response = await vendorSpreadsheetAPI.exportSelectedDeals(vendorId, dealIds);
        } else {
          response = await vendorSpreadsheetAPI.exportSpreadsheet(vendorId);
        }

        // Create download link
        const blob = new Blob([response.data], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${vendorName.replace(/[^a-zA-Z0-9]/g, '_')} - Deals.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Export failed');
        setExportError(err);
        onError?.(err);
      } finally {
        setIsExporting(false);
      }
    },
    [vendorId, vendorName, onError]
  );

  return {
    exportSpreadsheet,
    isExporting,
    exportError,
  };
}

export default useVendorSpreadsheetImport;
