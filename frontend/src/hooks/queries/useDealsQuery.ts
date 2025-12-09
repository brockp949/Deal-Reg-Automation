/**
 * Deals Query Hook
 * Type-safe hook for fetching deals data.
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { dealAPI } from '@/lib/api';
import type { DealQueryParams, DealsResponse, ApiResponse } from '@/types/api';
import type { DealRegistration } from '@/types';

export interface UseDealsQueryOptions
  extends Omit<
    UseQueryOptions<ApiResponse<DealsResponse>, Error, ApiResponse<DealsResponse>>,
    'queryKey' | 'queryFn'
  > {
  params?: DealQueryParams;
}

export interface UseDealsQueryResult {
  deals: DealRegistration[];
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

export function useDealsQuery(options: UseDealsQueryOptions = {}): UseDealsQueryResult {
  const { params = {}, ...queryOptions } = options;

  const query = useQuery({
    queryKey: ['deals', params],
    queryFn: async () => {
      const response = await dealAPI.getAll(params);
      return response.data;
    },
    ...queryOptions,
  });

  // Extract data with proper typing
  const responseData = query.data as ApiResponse<DealsResponse> | undefined;
  const dealsData = responseData?.success
    ? (responseData.data as DealsResponse)
    : undefined;

  return {
    deals: dealsData?.data ?? [],
    pagination: dealsData?.pagination ?? {
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

export default useDealsQuery;
