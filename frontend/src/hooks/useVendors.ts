import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorAPI } from '@/lib/api';
import { Vendor } from '@/types';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorHandling';

interface CreateVendorData {
  name: string;
  email_domains?: string[];
  industry?: string;
  website?: string;
  notes?: string;
  status?: string;
}

interface UpdateVendorData {
  id: string;
  data: Partial<CreateVendorData>;
}

export function useCreateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateVendorData) => vendorAPI.create(data),

    onMutate: async (newVendor) => {
      await queryClient.cancelQueries({ queryKey: ['vendors'] });

      const previousVendors = queryClient.getQueryData(['vendors']);

      // Optimistically add the new vendor
      queryClient.setQueriesData({ queryKey: ['vendors'] }, (old: any) => {
        if (!old?.data) return old;

        const optimisticVendor: Vendor = {
          id: `temp-${Date.now()}`,
          ...newVendor,
          status: newVendor.status || 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Vendor;

        return {
          ...old,
          data: [optimisticVendor, ...old.data],
          pagination: old.pagination ? {
            ...old.pagination,
            total: old.pagination.total + 1,
          } : undefined,
        };
      });

      return { previousVendors };
    },

    onError: (error, _variables, context) => {
      if (context?.previousVendors) {
        queryClient.setQueryData(['vendors'], context.previousVendors);
      }
      toast.error('Failed to create vendor', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Vendor created successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: UpdateVendorData) => vendorAPI.update(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['vendors'] });

      const previousVendors = queryClient.getQueryData(['vendors']);

      // Optimistically update the vendor
      queryClient.setQueriesData({ queryKey: ['vendors'] }, (old: any) => {
        if (!old?.data) return old;

        return {
          ...old,
          data: old.data.map((vendor: Vendor) =>
            vendor.id === id ? { ...vendor, ...data } : vendor
          ),
        };
      });

      return { previousVendors };
    },

    onError: (error, _variables, context) => {
      if (context?.previousVendors) {
        queryClient.setQueryData(['vendors'], context.previousVendors);
      }
      toast.error('Failed to update vendor', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Vendor updated successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}

export function useDeleteVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vendorAPI.delete(id),

    onMutate: async (vendorId) => {
      await queryClient.cancelQueries({ queryKey: ['vendors'] });

      const previousVendors = queryClient.getQueryData(['vendors']);

      // Optimistically remove the vendor
      queryClient.setQueriesData({ queryKey: ['vendors'] }, (old: any) => {
        if (!old?.data) return old;

        return {
          ...old,
          data: old.data.filter((vendor: Vendor) => vendor.id !== vendorId),
          pagination: old.pagination ? {
            ...old.pagination,
            total: old.pagination.total - 1,
          } : undefined,
        };
      });

      return { previousVendors };
    },

    onError: (error, _variables, context) => {
      if (context?.previousVendors) {
        queryClient.setQueryData(['vendors'], context.previousVendors);
      }
      toast.error('Failed to delete vendor', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Vendor deleted successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });
}
