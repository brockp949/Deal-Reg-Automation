/**
 * Vendor Edit Dialog
 * Dialog for editing existing vendor information.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { useUpdateVendor } from '@/hooks/useVendors';
import type { Vendor } from '@/types';
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

// Validation schema
const vendorSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  industry: z.string().optional(),
  website: z.string().url('Invalid URL').or(z.literal('')).optional(),
  email_domains: z.string().optional(),
  notes: z.string().optional(),
});

type VendorFormData = z.infer<typeof vendorSchema>;

interface VendorEditDialogProps {
  vendor: Vendor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VendorEditDialog({ vendor, open, onOpenChange }: VendorEditDialogProps) {
  const updateMutation = useUpdateVendor();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
  });

  // Reset form when vendor changes
  useEffect(() => {
    if (vendor) {
      reset({
        name: vendor.name,
        industry: vendor.industry || '',
        website: vendor.website || '',
        email_domains: vendor.email_domains?.join(', ') || '',
        notes: vendor.notes || '',
      });
    }
  }, [vendor, reset]);

  const onSubmit = (data: VendorFormData) => {
    if (!vendor) return;

    const processedData = {
      name: data.name,
      email_domains: data.email_domains
        ? data.email_domains.split(',').map((d) => d.trim()).filter(Boolean)
        : [],
      website: data.website || undefined,
      industry: data.industry || undefined,
      notes: data.notes || undefined,
    };

    updateMutation.mutate(
      { id: vendor.id, data: processedData },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  const industry = watch('industry');

  if (!vendor) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Vendor</DialogTitle>
          <DialogDescription>
            Update the vendor information below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Vendor Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-name">
              Vendor Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-name"
              placeholder="Acme Corporation"
              {...register('name')}
              className={errors.name ? 'border-destructive' : ''}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* Industry */}
          <div className="space-y-2">
            <Label htmlFor="edit-industry">Industry</Label>
            <Select
              value={industry || ''}
              onValueChange={(value) => setValue('industry', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Technology">Technology</SelectItem>
                <SelectItem value="Healthcare">Healthcare</SelectItem>
                <SelectItem value="Finance">Finance</SelectItem>
                <SelectItem value="Manufacturing">Manufacturing</SelectItem>
                <SelectItem value="Retail">Retail</SelectItem>
                <SelectItem value="Education">Education</SelectItem>
                <SelectItem value="Telecommunications">Telecommunications</SelectItem>
                <SelectItem value="Energy">Energy</SelectItem>
                <SelectItem value="Professional Services">Professional Services</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Website */}
          <div className="space-y-2">
            <Label htmlFor="edit-website">Website</Label>
            <Input
              id="edit-website"
              type="url"
              placeholder="https://example.com"
              {...register('website')}
              className={errors.website ? 'border-destructive' : ''}
            />
            {errors.website && (
              <p className="text-sm text-destructive">{errors.website.message}</p>
            )}
          </div>

          {/* Email Domains */}
          <div className="space-y-2">
            <Label htmlFor="edit-email_domains">Email Domains</Label>
            <Input
              id="edit-email_domains"
              placeholder="example.com, example.io (comma separated)"
              {...register('email_domains')}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of email domains associated with this vendor
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <textarea
              id="edit-notes"
              rows={3}
              placeholder="Additional information about this vendor..."
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

export default VendorEditDialog;
