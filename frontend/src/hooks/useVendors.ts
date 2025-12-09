import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorAPI } from '@/lib/api';
import type { Vendor } from '@/types';
import type { VendorsResponse, CreateVendorInput, UpdateVendorInput } from '@/types/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorHandling';

interface UpdateVendorData {
  id: string;
  data: UpdateVendorInput;
}

/** Type for query data stored in React Query cache */
interface VendorsQueryData {
  success: boolean;
  data: VendorsResponse;
}

export function useCreateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateVendorInput) => vendorAPI.create(data),

    onMutate: async (newVendor) => {
      await queryClient.cancelQueries({ queryKey: ['vendors'] });

      const previousVendors = queryClient.getQueryData<VendorsQueryData>(['vendors']);

      // Optimistically add the new vendor
      queryClient.setQueriesData<VendorsQueryData>(
        { queryKey: ['vendors'] },
        (old) => {
          if (!old?.data?.data) return old;

          const optimisticVendor: Vendor = {
            id: `temp-${Date.now()}`,
            name: newVendor.name,
            normalized_name: newVendor.name.toLowerCase().trim(),
            email_domains: newVendor.email_domains || [],
            industry: newVendor.industry,
            website: newVendor.website,
            notes: newVendor.notes,
            status: newVendor.status || 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {},
          };

          return {
            ...old,
            data: {
              ...old.data,
              data: [optimisticVendor, ...old.data.data],
              pagination: {
                ...old.data.pagination,
                total: old.data.pagination.total + 1,
              },
            },
          };
        }
      );

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

      const previousVendors = queryClient.getQueryData<VendorsQueryData>(['vendors']);

      // Optimistically update the vendor
      queryClient.setQueriesData<VendorsQueryData>(
        { queryKey: ['vendors'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: old.data.data.map((vendor) =>
                vendor.id === id
                  ? { ...vendor, ...data, updated_at: new Date().toISOString() }
                  : vendor
              ),
            },
          };
        }
      );

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

      const previousVendors = queryClient.getQueryData<VendorsQueryData>(['vendors']);

      // Optimistically remove the vendor
      queryClient.setQueriesData<VendorsQueryData>(
        { queryKey: ['vendors'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: old.data.data.filter((vendor) => vendor.id !== vendorId),
              pagination: {
                ...old.data.pagination,
                total: old.data.pagination.total - 1,
              },
            },
          };
        }
      );

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
