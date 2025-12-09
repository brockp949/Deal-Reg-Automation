/**
 * Deal Edit Dialog
 * Dialog for editing existing deal information.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { vendorAPI } from '@/lib/api';
import { dealSchema, type DealFormInput } from '@/schemas/dealSchema';
import { useUpdateDeal } from '@/hooks/useDeals';
import type { DealRegistration, DealStatus, Vendor } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DealEditDialogProps {
  deal: DealRegistration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DealEditDialog({ deal, open, onOpenChange }: DealEditDialogProps) {
  const updateMutation = useUpdateDeal();

  // Fetch vendors for selection
  const { data: vendorsData } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const response = await vendorAPI.getAll({ page: 1, limit: 100 });
      // Return empty array if error, otherwise return the vendors data
      if (!response.data.success) return [];
      return response.data.data.data;
    },
    enabled: open,
  });

  const vendors: Vendor[] = vendorsData || [];

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<DealFormInput>({
    resolver: zodResolver(dealSchema),
  });

  // Reset form when deal changes
  useEffect(() => {
    if (deal) {
      reset({
        vendor_id: deal.vendor_id,
        deal_name: deal.deal_name,
        deal_value: deal.deal_value?.toString() || '',
        currency: deal.currency || 'USD',
        customer_name: deal.customer_name || '',
        customer_industry: deal.customer_industry || '',
        status: deal.status,
        deal_stage: deal.deal_stage || '',
        probability: deal.probability?.toString() || '',
        expected_close_date: deal.expected_close_date
          ? new Date(deal.expected_close_date).toISOString().split('T')[0]
          : '',
        notes: deal.notes || '',
      });
    }
  }, [deal, reset]);

  const onSubmit = (data: DealFormInput) => {
    if (!deal) return;

    // Process data for the API
    const processedData = {
      vendor_id: data.vendor_id,
      deal_name: data.deal_name,
      deal_value: data.deal_value ? Number(data.deal_value) : undefined,
      currency: data.currency,
      customer_name: data.customer_name || undefined,
      customer_industry: data.customer_industry || undefined,
      status: data.status as DealStatus,
      deal_stage: data.deal_stage || undefined,
      probability: data.probability ? Number(data.probability) : undefined,
      expected_close_date: data.expected_close_date || undefined,
      notes: data.notes || undefined,
    };

    updateMutation.mutate(
      { id: deal.id, data: processedData },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  const vendorId = watch('vendor_id');
  const status = watch('status');
  const currency = watch('currency');

  if (!deal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Deal Registration</DialogTitle>
          <DialogDescription>
            Update the deal information below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Vendor Selection */}
          <div className="space-y-2">
            <Label htmlFor="edit-vendor_id">
              Vendor <span className="text-destructive">*</span>
            </Label>
            <Select
              value={vendorId}
              onValueChange={(value) => setValue('vendor_id', value)}
            >
              <SelectTrigger className={errors.vendor_id ? 'border-destructive' : ''}>
                <SelectValue placeholder="Select a vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.vendor_id && (
              <p className="text-sm text-destructive">{errors.vendor_id.message}</p>
            )}
          </div>

          {/* Deal Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-deal_name">
              Deal Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-deal_name"
              placeholder="Enterprise Cloud Migration"
              {...register('deal_name')}
              className={errors.deal_name ? 'border-destructive' : ''}
            />
            {errors.deal_name && (
              <p className="text-sm text-destructive">{errors.deal_name.message}</p>
            )}
          </div>

          {/* Deal Value & Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-deal_value">
                Deal Value <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-deal_value"
                type="number"
                step="0.01"
                placeholder="250000"
                {...register('deal_value')}
                className={errors.deal_value ? 'border-destructive' : ''}
              />
              {errors.deal_value && (
                <p className="text-sm text-destructive">{errors.deal_value.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-currency">Currency</Label>
              <Select
                value={currency}
                onValueChange={(value) => setValue('currency', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Customer Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-customer_name">Customer Name</Label>
            <Input
              id="edit-customer_name"
              placeholder="Global Manufacturing Inc"
              {...register('customer_name')}
            />
          </div>

          {/* Customer Industry */}
          <div className="space-y-2">
            <Label htmlFor="edit-customer_industry">Customer Industry</Label>
            <Input
              id="edit-customer_industry"
              placeholder="Manufacturing"
              {...register('customer_industry')}
            />
          </div>

          {/* Status & Deal Stage */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={status}
                onValueChange={(value: DealStatus) => setValue('status', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="registered">Registered</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="closed-won">Closed Won</SelectItem>
                  <SelectItem value="closed-lost">Closed Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-deal_stage">Deal Stage</Label>
              <Input
                id="edit-deal_stage"
                placeholder="Negotiation"
                {...register('deal_stage')}
              />
            </div>
          </div>

          {/* Probability & Expected Close Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-probability">Probability (%)</Label>
              <Input
                id="edit-probability"
                type="number"
                min="0"
                max="100"
                placeholder="75"
                {...register('probability')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-expected_close_date">Expected Close Date</Label>
              <Input
                id="edit-expected_close_date"
                type="date"
                {...register('expected_close_date')}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <textarea
              id="edit-notes"
              rows={3}
              placeholder="Additional deal information..."
              {...register('notes')}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default DealEditDialog;
