/**
 * Files Query Hook
 * Type-safe hook for fetching files data.
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { fileAPI } from '@/lib/api';
import type { FileQueryParams, FilesResponse, ApiResponse } from '@/types/api';
import type { SourceFile } from '@/types';

export interface UseFilesQueryOptions
  extends Omit<
    UseQueryOptions<ApiResponse<FilesResponse>, Error, ApiResponse<FilesResponse>>,
    'queryKey' | 'queryFn'
  > {
  params?: FileQueryParams;
  /** Auto-refresh interval when files are processing (ms). Set to false to disable. */
  autoRefreshWhenProcessing?: number | false;
}

export interface UseFilesQueryResult {
  files: SourceFile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
  hasProcessingFiles: boolean;
}

export function useFilesQuery(options: UseFilesQueryOptions = {}): UseFilesQueryResult {
  const { params = {}, autoRefreshWhenProcessing = 2000, ...queryOptions } = options;

  const query = useQuery({
    queryKey: ['files', params],
    queryFn: async () => {
      const response = await fileAPI.getAll(params);
      return response.data;
    },
    refetchInterval: (query) => {
      if (autoRefreshWhenProcessing === false) return false;

      const responseData = query.state.data as ApiResponse<FilesResponse> | undefined;
      const filesData = responseData?.success
        ? (responseData.data as FilesResponse)
        : undefined;
      const files = filesData?.data ?? [];

      const hasProcessing = files.some(
        (file) =>
          file.processing_status === 'processing' || file.processing_status === 'pending'
      );
      return hasProcessing ? autoRefreshWhenProcessing : false;
    },
    ...queryOptions,
  });

  // Extract data with proper typing
  const responseData = query.data as ApiResponse<FilesResponse> | undefined;
  const filesData = responseData?.success
    ? (responseData.data as FilesResponse)
    : undefined;

  const files = filesData?.data ?? [];
  const hasProcessingFiles = files.some(
    (file) =>
      file.processing_status === 'processing' || file.processing_status === 'pending'
  );

  return {
    files,
    pagination: filesData?.pagination ?? {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 1,
    },
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
    hasProcessingFiles,
  };
}

export default useFilesQuery;
