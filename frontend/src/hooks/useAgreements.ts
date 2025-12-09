/**
 * Agreements Hook
 * Provides functionality for managing vendor agreements.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { agreementAPI } from '@/lib/api';
import type { VendorAgreement, UpdateAgreementInput } from '@/types/agreement';

interface UseAgreementsOptions {
  vendorId: string;
  enabled?: boolean;
}

interface UseAgreementsReturn {
  // Data
  agreements: VendorAgreement[];
  isLoading: boolean;
  error: Error | null;

  // Upload
  uploadAgreement: (file: File) => Promise<VendorAgreement | null>;
  isUploading: boolean;
  uploadProgress: number;
  uploadError: Error | null;

  // Update
  updateAgreement: (agreementId: string, data: UpdateAgreementInput) => Promise<void>;
  isUpdating: boolean;

  // Delete
  deleteAgreement: (agreementId: string) => Promise<void>;
  isDeleting: boolean;

  // Refetch
  refetch: () => void;
}

export function useAgreements({
  vendorId,
  enabled = true,
}: UseAgreementsOptions): UseAgreementsReturn {
  const queryClient = useQueryClient();

  // Upload progress state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<Error | null>(null);

  // Query for fetching agreements
  const {
    data: agreements = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['vendor-agreements', vendorId],
    queryFn: async () => {
      const response = await agreementAPI.getAll(vendorId);
      if (!response.data.success) {
        throw new Error('Failed to fetch agreements');
      }
      return response.data.data.data;
    },
    enabled: enabled && !!vendorId,
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploadProgress(0);
      setUploadError(null);

      const response = await agreementAPI.upload(vendorId, file, (event) => {
        if (event.total) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Upload failed');
      }

      return response.data.data.data;
    },
    onSuccess: () => {
      toast.success('Agreement uploaded and processed successfully');
      queryClient.invalidateQueries({ queryKey: ['vendor-agreements', vendorId] });
      setUploadProgress(0);
    },
    onError: (error: Error) => {
      setUploadError(error);
      setUploadProgress(0);
      toast.error(error.message || 'Failed to upload agreement');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      agreementId,
      data,
    }: {
      agreementId: string;
      data: UpdateAgreementInput;
    }) => {
      const response = await agreementAPI.update(vendorId, agreementId, data);
      if (!response.data.success) {
        throw new Error(response.data.error || 'Update failed');
      }
      return response.data.data;
    },
    onSuccess: () => {
      toast.success('Agreement updated successfully');
      queryClient.invalidateQueries({ queryKey: ['vendor-agreements', vendorId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update agreement');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (agreementId: string) => {
      const response = await agreementAPI.delete(vendorId, agreementId);
      if (!response.data.success) {
        throw new Error(response.data.error || 'Delete failed');
      }
    },
    onSuccess: () => {
      toast.success('Agreement deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['vendor-agreements', vendorId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete agreement');
    },
  });

  // Upload handler
  const uploadAgreement = useCallback(
    async (file: File): Promise<VendorAgreement | null> => {
      try {
        const result = await uploadMutation.mutateAsync(file);
        return result;
      } catch {
        return null;
      }
    },
    [uploadMutation]
  );

  // Update handler
  const updateAgreement = useCallback(
    async (agreementId: string, data: UpdateAgreementInput): Promise<void> => {
      await updateMutation.mutateAsync({ agreementId, data });
    },
    [updateMutation]
  );

  // Delete handler
  const deleteAgreement = useCallback(
    async (agreementId: string): Promise<void> => {
      await deleteMutation.mutateAsync(agreementId);
    },
    [deleteMutation]
  );

  return {
    // Data
    agreements,
    isLoading,
    error: error as Error | null,

    // Upload
    uploadAgreement,
    isUploading: uploadMutation.isPending,
    uploadProgress,
    uploadError,

    // Update
    updateAgreement,
    isUpdating: updateMutation.isPending,

    // Delete
    deleteAgreement,
    isDeleting: deleteMutation.isPending,

    // Refetch
    refetch,
  };
}

/**
 * Hook for fetching a single agreement
 */
export function useAgreement(vendorId: string, agreementId: string | null) {
  return useQuery({
    queryKey: ['vendor-agreement', vendorId, agreementId],
    queryFn: async () => {
      if (!agreementId) return null;
      const response = await agreementAPI.getById(vendorId, agreementId);
      if (!response.data.success) {
        throw new Error('Failed to fetch agreement');
      }
      return response.data.data.data;
    },
    enabled: !!vendorId && !!agreementId,
  });
}

export default useAgreements;
