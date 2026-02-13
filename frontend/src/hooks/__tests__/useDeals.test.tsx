/**
 * useDeals Hook Tests
 * Comprehensive tests for deal-related React Query hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useDealsQuery } from '@/hooks/queries/useDealsQuery';
import {
  useCreateDeal,
  useUpdateDeal,
  useDeleteDeal,
  useUpdateDealStatus,
} from '@/hooks/useDeals';
import type { DealRegistration, DealStatus } from '@/types';
import type { CreateDealInput, UpdateDealInput } from '@/types/api';
import React from 'react';

const API_URL = 'http://localhost:4000/api';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock deal data
const mockDeals: DealRegistration[] = [
  {
    id: '1',
    vendor_id: 'v1',
    vendor_name: 'Acme Corp',
    deal_name: 'Enterprise Deal',
    deal_value: 50000,
    currency: 'USD',
    customer_name: 'Customer A',
    customer_industry: 'Technology',
    registration_date: '2024-01-01',
    expected_close_date: '2024-06-01',
    status: 'registered',
    deal_stage: 'Qualification',
    probability: 50,
    notes: 'Initial deal',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
    metadata: {},
  },
  {
    id: '2',
    vendor_id: 'v1',
    vendor_name: 'Acme Corp',
    deal_name: 'SMB Deal',
    deal_value: 15000,
    currency: 'USD',
    customer_name: 'Customer B',
    customer_industry: 'Healthcare',
    registration_date: '2024-01-05',
    expected_close_date: '2024-03-01',
    status: 'approved',
    deal_stage: 'Proposal',
    probability: 75,
    notes: 'Approved deal',
    created_at: '2024-01-05T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
    metadata: {},
  },
];

// Helper to create API response
const createApiResponse = <T,>(data: T) => ({
  success: true,
  data,
  message: 'Success',
});

// Create a fresh QueryClient for each test
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

// Wrapper component for testing hooks
const createWrapper = (queryClient: QueryClient) => {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
};

describe('useDealsQuery', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('fetches deals successfully', () => {
    it('should return deals data when API call succeeds', async () => {
      server.use(
        http.get(`${API_URL}/deals`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: mockDeals,
              pagination: {
                page: 1,
                limit: 20,
                total: 2,
                totalPages: 1,
              },
            })
          );
        })
      );

      const { result } = renderHook(() => useDealsQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.deals).toHaveLength(2);
      expect(result.current.deals[0].deal_name).toBe('Enterprise Deal');
      expect(result.current.deals[1].deal_name).toBe('SMB Deal');
      expect(result.current.pagination.total).toBe(2);
      expect(result.current.isError).toBe(false);
    });

    it('should pass query params to the API', async () => {
      let receivedParams: URLSearchParams | null = null;

      server.use(
        http.get(`${API_URL}/deals`, ({ request }) => {
          const url = new URL(request.url);
          receivedParams = url.searchParams;
          return HttpResponse.json(
            createApiResponse({
              data: [mockDeals[0]],
              pagination: {
                page: 1,
                limit: 10,
                total: 1,
                totalPages: 1,
              },
            })
          );
        })
      );

      const { result } = renderHook(
        () =>
          useDealsQuery({
            params: {
              page: 1,
              limit: 10,
              vendor_id: 'v1',
              status: 'registered',
              search: 'Enterprise',
            },
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(receivedParams?.get('vendor_id')).toBe('v1');
      expect(receivedParams?.get('status')).toBe('registered');
      expect(receivedParams?.get('search')).toBe('Enterprise');
    });
  });

  describe('handles loading state', () => {
    it('should show loading state initially', async () => {
      server.use(
        http.get(`${API_URL}/deals`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json(
            createApiResponse({
              data: mockDeals,
              pagination: {
                page: 1,
                limit: 20,
                total: 2,
                totalPages: 1,
              },
            })
          );
        })
      );

      const { result } = renderHook(() => useDealsQuery(), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.deals).toEqual([]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should show refetching state when refetching', async () => {
      server.use(
        http.get(`${API_URL}/deals`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: mockDeals,
              pagination: {
                page: 1,
                limit: 20,
                total: 2,
                totalPages: 1,
              },
            })
          );
        })
      );

      const { result } = renderHook(() => useDealsQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isRefetching).toBe(false);

      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.isRefetching).toBe(false);
      });
    });
  });

  describe('handles error state', () => {
    it('should set error state when API call fails', async () => {
      server.use(
        http.get(`${API_URL}/deals`, () => {
          return HttpResponse.json(
            { success: false, error: 'Server error' },
            { status: 500 }
          );
        })
      );

      const { result } = renderHook(() => useDealsQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBeTruthy();
    });

    it('should return empty array when response is not successful', async () => {
      server.use(
        http.get(`${API_URL}/deals`, () => {
          return HttpResponse.json({
            success: false,
            error: 'Not found',
          });
        })
      );

      const { result } = renderHook(() => useDealsQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.deals).toEqual([]);
    });

    it('should handle network errors', async () => {
      server.use(
        http.get(`${API_URL}/deals`, () => {
          return HttpResponse.error();
        })
      );

      const { result } = renderHook(() => useDealsQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isError).toBe(true);
    });
  });

  describe('useDealQuery - fetches single deal', () => {
    it('should fetch deals and filter to find a specific deal', async () => {
      server.use(
        http.get(`${API_URL}/deals`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: mockDeals,
              pagination: {
                page: 1,
                limit: 20,
                total: 2,
                totalPages: 1,
              },
            })
          );
        })
      );

      const { result } = renderHook(() => useDealsQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Find specific deal from the results
      const deal = result.current.deals.find((d) => d.id === '1');
      expect(deal).toBeDefined();
      expect(deal?.deal_name).toBe('Enterprise Deal');
    });
  });
});

describe('useCreateDeal', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('should create a new deal successfully', async () => {
    const newDealInput: CreateDealInput = {
      vendor_id: 'v2',
      deal_name: 'New Deal',
      deal_value: 25000,
      currency: 'USD',
      customer_name: 'New Customer',
      customer_industry: 'Finance',
      registration_date: '2024-02-01',
      expected_close_date: '2024-08-01',
      status: 'registered',
      deal_stage: 'Discovery',
      probability: 30,
      notes: 'New deal notes',
    };

    const createdDeal: DealRegistration = {
      id: '3',
      ...newDealInput,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    };

    server.use(
      http.post(`${API_URL}/deals`, async () => {
        return HttpResponse.json(createApiResponse({ deal: createdDeal }), {
          status: 201,
        });
      })
    );

    const { result } = renderHook(() => useCreateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(newDealInput);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.data).toBeDefined();
  });

  it('should call toast.success on successful creation', async () => {
    const { toast } = await import('sonner');

    const newDealInput: CreateDealInput = {
      vendor_id: 'v2',
      deal_name: 'Toast Deal',
      deal_value: 5000,
    };

    server.use(
      http.post(`${API_URL}/deals`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              id: '5',
              ...newDealInput,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              metadata: {},
            },
          }),
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useCreateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(newDealInput);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(toast.success).toHaveBeenCalledWith('Deal created successfully');
  });

  it('should call toast.error on failed creation', async () => {
    const { toast } = await import('sonner');

    const newDealInput: CreateDealInput = {
      vendor_id: 'v2',
      deal_name: 'Failed Deal',
      deal_value: 10000,
    };

    server.use(
      http.post(`${API_URL}/deals`, () => {
        return HttpResponse.json(
          { success: false, error: 'Creation failed' },
          { status: 400 }
        );
      })
    );

    const { result } = renderHook(() => useCreateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(newDealInput);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Failed to create deal',
      expect.any(Object)
    );
  });

  it('should invalidate deals query after successful creation', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const newDealInput: CreateDealInput = {
      vendor_id: 'v1',
      deal_name: 'New Deal',
    };

    server.use(
      http.post(`${API_URL}/deals`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              id: '3',
              ...newDealInput,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              metadata: {},
            },
          }),
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useCreateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(newDealInput);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });
});

describe('useUpdateDeal', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('should update an existing deal successfully', async () => {
    const updateData: UpdateDealInput = {
      deal_name: 'Updated Enterprise Deal',
      deal_value: 75000,
      notes: 'Updated notes',
    };

    const updatedDeal: DealRegistration = {
      ...mockDeals[0],
      ...updateData,
      updated_at: new Date().toISOString(),
    };

    server.use(
      http.put(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(createApiResponse({ deal: updatedDeal }));
      })
    );

    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', data: updateData });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should call toast.success on successful update', async () => {
    const { toast } = await import('sonner');

    const updateData: UpdateDealInput = {
      deal_name: 'Toast Update',
    };

    server.use(
      http.put(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              ...updateData,
              updated_at: new Date().toISOString(),
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', data: updateData });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(toast.success).toHaveBeenCalledWith('Deal updated successfully');
  });

  it('should call toast.error on failed update', async () => {
    const { toast } = await import('sonner');

    server.use(
      http.put(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(
          { success: false, error: 'Update failed' },
          { status: 400 }
        );
      })
    );

    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', data: { deal_name: 'Failed' } });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Failed to update deal',
      expect.any(Object)
    );
  });

  it('should invalidate deals query after successful update', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.put(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              deal_name: 'Updated',
              updated_at: new Date().toISOString(),
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', data: { deal_name: 'Updated' } });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('should still invalidate deals query after failed update', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.put(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(
          { success: false, error: 'Server error' },
          { status: 500 }
        );
      })
    );

    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', data: { deal_name: 'Failed' } });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // onSettled should still invalidate regardless of success/error
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });
});

describe('useDeleteDeal', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('should delete a deal successfully', async () => {
    server.use(
      http.delete(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(createApiResponse(null));
      })
    );

    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate('1');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should call toast.success on successful deletion', async () => {
    const { toast } = await import('sonner');

    server.use(
      http.delete(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(createApiResponse(null));
      })
    );

    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate('1');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(toast.success).toHaveBeenCalledWith('Deal deleted successfully');
  });

  it('should call toast.error on failed deletion', async () => {
    const { toast } = await import('sonner');

    server.use(
      http.delete(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(
          { success: false, error: 'Delete failed' },
          { status: 400 }
        );
      })
    );

    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate('1');
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Failed to delete deal',
      expect.any(Object)
    );
  });

  it('should invalidate deals query after successful deletion', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.delete(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(createApiResponse(null));
      })
    );

    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate('1');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });
});

describe('useUpdateDealStatus', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('should update deal status successfully', async () => {
    const newStatus: DealStatus = 'approved';

    server.use(
      http.patch(`${API_URL}/deals/:id/status`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              status: newStatus,
              updated_at: new Date().toISOString(),
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', status: newStatus });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should call toast.success on successful status update', async () => {
    const { toast } = await import('sonner');

    server.use(
      http.patch(`${API_URL}/deals/:id/status`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              status: 'approved',
              updated_at: new Date().toISOString(),
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', status: 'approved' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(toast.success).toHaveBeenCalledWith(
      'Deal status updated successfully'
    );
  });

  it('should call toast.error on failed status update', async () => {
    const { toast } = await import('sonner');

    server.use(
      http.patch(`${API_URL}/deals/:id/status`, () => {
        return HttpResponse.json(
          { success: false, error: 'Status update failed' },
          { status: 400 }
        );
      })
    );

    const { result } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', status: 'rejected' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Failed to update deal status',
      expect.any(Object)
    );
  });

  it('should handle all valid status values', async () => {
    const statuses: DealStatus[] = [
      'registered',
      'approved',
      'rejected',
      'closed-won',
      'closed-lost',
    ];

    for (const status of statuses) {
      server.use(
        http.patch(`${API_URL}/deals/:id/status`, () => {
          return HttpResponse.json(
            createApiResponse({
              deal: {
                ...mockDeals[0],
                status,
                updated_at: new Date().toISOString(),
              },
            })
          );
        })
      );

      const { result } = renderHook(() => useUpdateDealStatus(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ id: '1', status });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    }
  });

  it('should invalidate deals query after successful status update', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.patch(`${API_URL}/deals/:id/status`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              status: 'approved',
              updated_at: new Date().toISOString(),
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', status: 'approved' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });
});

describe('Optimistic updates work correctly', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('should cancel outgoing queries before optimistic update', async () => {
    const cancelQueriesSpy = vi.spyOn(queryClient, 'cancelQueries');

    server.use(
      http.patch(`${API_URL}/deals/:id/status`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              status: 'approved',
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ id: '1', status: 'approved' });
    });

    await waitFor(() => {
      expect(cancelQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should handle concurrent mutations', async () => {
    let requestCount = 0;

    server.use(
      http.patch(`${API_URL}/deals/:id/status`, async () => {
        requestCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              status: 'approved',
            },
          })
        );
      })
    );

    const { result: result1 } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    const { result: result2 } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    // Fire both mutations
    act(() => {
      result1.current.mutate({ id: '1', status: 'approved' });
      result2.current.mutate({ id: '2', status: 'rejected' });
    });

    await waitFor(() => {
      expect(result1.current.isSuccess || result1.current.isError).toBe(true);
      expect(result2.current.isSuccess || result2.current.isError).toBe(true);
    });

    expect(requestCount).toBe(2);
  });
});

describe('Cache invalidation after mutations', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('should invalidate deals query after create mutation', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.post(`${API_URL}/deals`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              id: '3',
              vendor_id: 'v1',
              deal_name: 'New Deal',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              metadata: {},
            },
          }),
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useCreateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({
        vendor_id: 'v1',
        deal_name: 'New Deal',
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('should invalidate deals query after update mutation', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.put(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              deal_name: 'Updated',
              updated_at: new Date().toISOString(),
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', data: { deal_name: 'Updated' } });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('should invalidate deals query after delete mutation', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.delete(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(createApiResponse(null));
      })
    );

    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate('1');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('should invalidate deals query after status update mutation', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.patch(`${API_URL}/deals/:id/status`, () => {
        return HttpResponse.json(
          createApiResponse({
            deal: {
              ...mockDeals[0],
              status: 'approved',
              updated_at: new Date().toISOString(),
            },
          })
        );
      })
    );

    const { result } = renderHook(() => useUpdateDealStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', status: 'approved' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('should still invalidate cache after mutation error', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.put(`${API_URL}/deals/:id`, () => {
        return HttpResponse.json(
          { success: false, error: 'Server error' },
          { status: 500 }
        );
      })
    );

    const { result } = renderHook(() => useUpdateDeal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ id: '1', data: { deal_name: 'Failed' } });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // onSettled should still invalidate regardless of success/error
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });
});
