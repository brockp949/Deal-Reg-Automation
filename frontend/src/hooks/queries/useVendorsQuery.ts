/**
 * Vendors Query Hook
 * Type-safe hook for fetching vendors data.
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { vendorAPI } from '@/lib/api';
import type { VendorQueryParams, VendorsResponse, ApiResponse } from '@/types/api';
import type { Vendor } from '@/types';

export interface UseVendorsQueryOptions
  extends Omit<
    UseQueryOptions<ApiResponse<VendorsResponse>, Error, ApiResponse<VendorsResponse>>,
    'queryKey' | 'queryFn'
  > {
  params?: VendorQueryParams;
}

export interface UseVendorsQueryResult {
  vendors: Vendor[];
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
}

export function useVendorsQuery(options: UseVendorsQueryOptions = {}): UseVendorsQueryResult {
  const { params = {}, ...queryOptions } = options;

  const query = useQuery({
    queryKey: ['vendors', params],
    queryFn: async () => {
      const response = await vendorAPI.getAll(params);
      return response.data;
    },
    ...queryOptions,
  });

  // Extract data with proper typing
  const responseData = query.data as ApiResponse<VendorsResponse> | undefined;
  const vendorsData = responseData?.success
    ? (responseData.data as VendorsResponse)
    : undefined;

  return {
    vendors: vendorsData?.data ?? [],
    pagination: vendorsData?.pagination ?? {
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
  };
}

export default useVendorsQuery;
