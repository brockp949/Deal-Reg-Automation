/**
 * Contact Mutation Hooks
 * React Query mutations for contact CRUD operations with optimistic updates.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { contactAPI } from '@/lib/api';
import type { Contact } from '@/types';
import type { ContactsResponse, CreateContactInput, UpdateContactInput } from '@/types/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorHandling';

interface UpdateContactData {
  id: string;
  data: UpdateContactInput;
}

/** Type for query data stored in React Query cache */
interface ContactsQueryData {
  success: boolean;
  data: ContactsResponse;
}

export function useCreateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateContactInput) => contactAPI.create(data),

    onMutate: async (newContact) => {
      // Cancel any outgoing refetches for contacts
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      await queryClient.cancelQueries({ queryKey: ['vendor-contacts', newContact.vendor_id] });

      const previousContacts = queryClient.getQueryData<ContactsQueryData>(['contacts']);
      const previousVendorContacts = queryClient.getQueryData<ContactsQueryData>([
        'vendor-contacts',
        newContact.vendor_id,
      ]);

      // Optimistically add the new contact
      const optimisticContact: Contact = {
        id: `temp-${Date.now()}`,
        vendor_id: newContact.vendor_id,
        name: newContact.name,
        email: newContact.email,
        phone: newContact.phone,
        role: newContact.role,
        is_primary: newContact.is_primary || false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueriesData<ContactsQueryData>(
        { queryKey: ['contacts'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: [optimisticContact, ...old.data.data],
              pagination: {
                ...old.data.pagination,
                total: old.data.pagination.total + 1,
              },
            },
          };
        }
      );

      queryClient.setQueriesData<ContactsQueryData>(
        { queryKey: ['vendor-contacts', newContact.vendor_id] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: [optimisticContact, ...old.data.data],
              pagination: {
                ...old.data.pagination,
                total: old.data.pagination.total + 1,
              },
            },
          };
        }
      );

      return { previousContacts, previousVendorContacts, vendorId: newContact.vendor_id };
    },

    onError: (error, _variables, context) => {
      if (context?.previousContacts) {
        queryClient.setQueryData(['contacts'], context.previousContacts);
      }
      if (context?.previousVendorContacts && context?.vendorId) {
        queryClient.setQueryData(
          ['vendor-contacts', context.vendorId],
          context.previousVendorContacts
        );
      }
      toast.error('Failed to create contact', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Contact created successfully');
    },

    onSettled: (_data, _error, newContact) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-contacts', newContact.vendor_id] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: UpdateContactData) => contactAPI.update(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });

      const previousContacts = queryClient.getQueryData<ContactsQueryData>(['contacts']);

      // Optimistically update the contact
      queryClient.setQueriesData<ContactsQueryData>(
        { queryKey: ['contacts'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: old.data.data.map((contact) =>
                contact.id === id
                  ? { ...contact, ...data, updated_at: new Date().toISOString() }
                  : contact
              ),
            },
          };
        }
      );

      return { previousContacts };
    },

    onError: (error, _variables, context) => {
      if (context?.previousContacts) {
        queryClient.setQueryData(['contacts'], context.previousContacts);
      }
      toast.error('Failed to update contact', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Contact updated successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      // Also invalidate all vendor-contacts queries
      queryClient.invalidateQueries({ queryKey: ['vendor-contacts'] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => contactAPI.delete(id),

    onMutate: async (contactId) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });

      const previousContacts = queryClient.getQueryData<ContactsQueryData>(['contacts']);

      // Optimistically remove the contact
      queryClient.setQueriesData<ContactsQueryData>(
        { queryKey: ['contacts'] },
        (old) => {
          if (!old?.data?.data) return old;

          return {
            ...old,
            data: {
              ...old.data,
              data: old.data.data.filter((contact) => contact.id !== contactId),
              pagination: {
                ...old.data.pagination,
                total: old.data.pagination.total - 1,
              },
            },
          };
        }
      );

      return { previousContacts };
    },

    onError: (error, _variables, context) => {
      if (context?.previousContacts) {
        queryClient.setQueryData(['contacts'], context.previousContacts);
      }
      toast.error('Failed to delete contact', {
        description: getErrorMessage(error),
      });
    },

    onSuccess: () => {
      toast.success('Contact deleted successfully');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-contacts'] });
    },
  });
}
