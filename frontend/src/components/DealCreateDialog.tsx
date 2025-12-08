import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Loader2 } from 'lucide-react';
import { vendorAPI } from '@/lib/api';
import { dealSchema, type DealFormData } from '@/schemas/dealSchema';
import { useCreateDeal } from '@/hooks/useDeals';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

interface DealCreateDialogProps {
  preselectedVendorId?: string;
  trigger?: React.ReactNode;
}

export default function DealCreateDialog({ preselectedVendorId, trigger }: DealCreateDialogProps) {
  const [open, setOpen] = useState(false);

  // Fetch vendors for selection
  const { data: vendorsData } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const response = await vendorAPI.getAll({ page: 1, limit: 100 });
      return response.data;
    },
  });

  const vendors = vendorsData?.data || [];

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<DealFormData>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      vendor_id: preselectedVendorId || '',
      currency: 'USD',
      status: 'registered',
    },
  });

  const createMutation = useCreateDeal();

  const onSubmit = (data: DealFormData) => {
    const processedData = {
      ...data,
      deal_value: Number(data.deal_value),
      probability: data.probability ? Number(data.probability) : undefined,
      customer_name: data.customer_name || undefined,
      customer_industry: data.customer_industry || undefined,
      deal_stage: data.deal_stage || undefined,
      expected_close_date: data.expected_close_date || undefined,
      notes: data.notes || undefined,
    };

    createMutation.mutate(processedData as any, {
      onSuccess: () => {
        reset();
        setOpen(false);
      },
    });
  };

  const vendorId = watch('vendor_id');
  const status = watch('status');
  const currency = watch('currency');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Deal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Deal Registration</DialogTitle>
          <DialogDescription>
            Register a new deal opportunity. Fill in the details below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Vendor Selection */}
          <div className="space-y-2">
            <Label htmlFor="vendor_id">
              Vendor <span className="text-destructive">*</span>
            </Label>
            <Select
              value={vendorId}
              onValueChange={(value) => setValue('vendor_id', value)}
              disabled={!!preselectedVendorId}
            >
              <SelectTrigger className={errors.vendor_id ? 'border-destructive' : ''}>
                <SelectValue placeholder="Select a vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((vendor: any) => (
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
            <Label htmlFor="deal_name">
              Deal Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="deal_name"
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
              <Label htmlFor="deal_value">
                Deal Value <span className="text-destructive">*</span>
              </Label>
              <Input
                id="deal_value"
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
              <Label htmlFor="currency">Currency</Label>
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
            <Label htmlFor="customer_name">Customer Name</Label>
            <Input
              id="customer_name"
              placeholder="Global Manufacturing Inc"
              {...register('customer_name')}
            />
          </div>

          {/* Customer Industry */}
          <div className="space-y-2">
            <Label htmlFor="customer_industry">Customer Industry</Label>
            <Input
              id="customer_industry"
              placeholder="Manufacturing"
              {...register('customer_industry')}
            />
          </div>

          {/* Status & Deal Stage */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={status}
                onValueChange={(value: any) => setValue('status', value)}
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
              <Label htmlFor="deal_stage">Deal Stage</Label>
              <Input
                id="deal_stage"
                placeholder="Negotiation"
                {...register('deal_stage')}
              />
            </div>
          </div>

          {/* Probability & Expected Close Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="probability">Probability (%)</Label>
              <Input
                id="probability"
                type="number"
                min="0"
                max="100"
                placeholder="75"
                {...register('probability')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expected_close_date">Expected Close Date</Label>
              <Input
                id="expected_close_date"
                type="date"
                {...register('expected_close_date')}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
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
              onClick={() => {
                reset();
                setOpen(false);
              }}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Deal'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
