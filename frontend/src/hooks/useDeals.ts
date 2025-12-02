import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dealAPI } from '@/lib/api';
import { DealRegistration } from '@/types';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorHandling';

interface UpdateDealStatusData {
  id: string;
  status: string;
}

interface CreateDealData {
  vendor_id: string;
  deal_name: string;
  deal_value?: number;
  currency?: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: Date;
  expected_close_date?: Date;
  status?: string;
  deal_stage?: string;
  probability?: number;
  notes?: string;
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
      const previousDeals = queryClient.getQueryData(['deals']);

      // Optimistically update to the new value
      queryClient.setQueriesData({ queryKey: ['deals'] }, (old: any) => {
        if (!old?.data) return old;

        return {
          ...old,
          data: old.data.map((deal: DealRegistration) =>
            deal.id === id ? { ...deal, status } : deal
          ),
        };
      });

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
    mutationFn: (data: CreateDealData) => dealAPI.create(data),

    onMutate: async (newDeal) => {
      await queryClient.cancelQueries({ queryKey: ['deals'] });

      const previousDeals = queryClient.getQueryData(['deals']);

      // Optimistically add the new deal with a temporary ID
      queryClient.setQueriesData({ queryKey: ['deals'] }, (old: any) => {
        if (!old?.data) return old;

        const optimisticDeal: DealRegistration = {
          id: `temp-${Date.now()}`,
          ...newDeal,
          deal_value: newDeal.deal_value || 0,
          currency: newDeal.currency || 'USD',
          status: newDeal.status || 'registered',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as DealRegistration;

        return {
          ...old,
          data: [optimisticDeal, ...old.data],
          pagination: old.pagination ? {
            ...old.pagination,
            total: old.pagination.total + 1,
          } : undefined,
        };
      });

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

export function useDeleteDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => dealAPI.delete(id),

    onMutate: async (dealId) => {
      await queryClient.cancelQueries({ queryKey: ['deals'] });

      const previousDeals = queryClient.getQueryData(['deals']);

      // Optimistically remove the deal
      queryClient.setQueriesData({ queryKey: ['deals'] }, (old: any) => {
        if (!old?.data) return old;

        return {
          ...old,
          data: old.data.filter((deal: DealRegistration) => deal.id !== dealId),
          pagination: old.pagination ? {
            ...old.pagination,
            total: old.pagination.total - 1,
          } : undefined,
        };
      });

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
