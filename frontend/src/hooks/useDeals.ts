import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dealAPI } from '@/lib/api';
import type { DealRegistration, DealStatus } from '@/types';
import type { DealsResponse, CreateDealInput, UpdateDealInput } from '@/types/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorHandling';

interface UpdateDealStatusData {
  id: string;
  status: DealStatus;
}

/** Type for query data stored in React Query cache */
interface DealsQueryData {
  success: boolean;
  data: DealsResponse;
}

export function useUpdateDealStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: UpdateDealStatusData) =>
      dealAPI.updateStatus(id, status),

    onMutate: async ({ id, status }) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['deals'] });

      // Snapshot the previous value
      const previousDeals = queryClient.getQueryData<DealsQueryData>(['deals']);

      // Optimistically update to the new value
      queryClient.setQueriesData<DealsQueryData>(
        { queryKey: ['deals'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: old.data.data.map((deal) =>
                deal.id === id ? { ...deal, status } : deal
              ),
            },
          };
        }
      );

      return { previousDeals };
    },

    onError: (error, _variables, context) => {
      // Rollback to previous value on error
      if (context?.previousDeals) {
        queryClient.setQueryData(['deals'], context.previousDeals);
      }
      toast.error('Failed to update deal status', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Deal status updated successfully');
    },

    onSettled: () => {
      // Always refetch after error or success to ensure we're in sync
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDealInput) => dealAPI.create(data),

    onMutate: async (newDeal) => {
      await queryClient.cancelQueries({ queryKey: ['deals'] });

      const previousDeals = queryClient.getQueryData<DealsQueryData>(['deals']);

      // Optimistically add the new deal with a temporary ID
      queryClient.setQueriesData<DealsQueryData>(
        { queryKey: ['deals'] },
        (old) => {
          if (!old?.data?.data) return old;

          const optimisticDeal: DealRegistration = {
            id: `temp-${Date.now()}`,
            vendor_id: newDeal.vendor_id,
            deal_name: newDeal.deal_name,
            deal_value: newDeal.deal_value || 0,
            currency: newDeal.currency || 'USD',
            customer_name: newDeal.customer_name,
            customer_industry: newDeal.customer_industry,
            registration_date: newDeal.registration_date,
            expected_close_date: newDeal.expected_close_date,
            status: newDeal.status || 'registered',
            deal_stage: newDeal.deal_stage,
            probability: newDeal.probability,
            notes: newDeal.notes,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {},
          };

          return {
            ...old,
            data: {
              ...old.data,
              data: [optimisticDeal, ...old.data.data],
              pagination: {
                ...old.data.pagination,
                total: old.data.pagination.total + 1,
              },
            },
          };
        }
      );

      return { previousDeals };
    },

    onError: (error, _variables, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(['deals'], context.previousDeals);
      }
      toast.error('Failed to create deal', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Deal created successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDealInput }) =>
      dealAPI.update(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['deals'] });

      const previousDeals = queryClient.getQueryData<DealsQueryData>(['deals']);

      // Optimistically update the deal
      queryClient.setQueriesData<DealsQueryData>(
        { queryKey: ['deals'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: old.data.data.map((deal) =>
                deal.id === id
                  ? { ...deal, ...data, updated_at: new Date().toISOString() }
                  : deal
              ),
            },
          };
        }
      );

      return { previousDeals };
    },

    onError: (error, _variables, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(['deals'], context.previousDeals);
      }
      toast.error('Failed to update deal', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Deal updated successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => dealAPI.delete(id),

    onMutate: async (dealId) => {
      await queryClient.cancelQueries({ queryKey: ['deals'] });

      const previousDeals = queryClient.getQueryData<DealsQueryData>(['deals']);

      // Optimistically remove the deal
      queryClient.setQueriesData<DealsQueryData>(
        { queryKey: ['deals'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: old.data.data.filter((deal) => deal.id !== dealId),
              pagination: {
                ...old.data.pagination,
                total: old.data.pagination.total - 1,
              },
            },
          };
        }
      );

      return { previousDeals };
    },

    onError: (error, _variables, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(['deals'], context.previousDeals);
      }
      toast.error('Failed to delete deal', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Deal deleted successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}
