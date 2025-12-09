import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Vendor } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function VendorApproval() {
  const queryClient = useQueryClient();
  const [vendorToApprove, setVendorToApprove] = useState<Vendor | null>(null);
  const [vendorToDeny, setVendorToDeny] = useState<Vendor | null>(null);
  const [mergeIntoVendorId, setMergeIntoVendorId] = useState('');
  const [denyNotes, setDenyNotes] = useState('');

  const {
    data: vendors,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['vendors', 'review'],
    queryFn: async () => {
      const response = await vendorAPI.getReviewQueue();
      if (!response.data.success) return [];
      return response.data.data.data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, mergeId }: { id: string; mergeId?: string }) =>
      vendorAPI.approve(id, mergeId),
    onSuccess: () => {
      toast.success('Vendor approved');
      queryClient.invalidateQueries({ queryKey: ['vendors', 'review'] });
      setVendorToApprove(null);
      setMergeIntoVendorId('');
    },
    onError: () => {
      toast.error('Failed to approve vendor');
    },
  });

  const denyMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      vendorAPI.deny(id, notes),
    onSuccess: () => {
      toast.success('Vendor denied');
      queryClient.invalidateQueries({ queryKey: ['vendors', 'review'] });
      setVendorToDeny(null);
      setDenyNotes('');
    },
    onError: () => {
      toast.error('Failed to deny vendor');
    },
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isError) {
    return <div>Error loading vendors for approval</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Vendor Approval Queue</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vendors?.map((vendor: Vendor) => (
            <TableRow key={vendor.id}>
              <TableCell>{vendor.name}</TableCell>
              <TableCell>{vendor.website}</TableCell>
              <TableCell>{vendor.industry}</TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVendorToApprove(vendor)}
                  className="mr-2"
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setVendorToDeny(vendor)}
                >
                  Deny
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog
        open={!!vendorToApprove}
        onOpenChange={() => setVendorToApprove(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Vendor</DialogTitle>
          </DialogHeader>
          <div>
            <p>
              You are about to approve the vendor: <strong>{vendorToApprove?.name}</strong>
            </p>
            <div className="mt-4">
              <Label htmlFor="mergeId">Merge into existing vendor (optional)</Label>
              <Input
                id="mergeId"
                value={mergeIntoVendorId}
                onChange={(e) => setMergeIntoVendorId(e.target.value)}
                placeholder="Enter existing vendor ID"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() =>
                approveMutation.mutate({
                  id: vendorToApprove!.id,
                  mergeId: mergeIntoVendorId,
                })
              }
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!vendorToDeny} onOpenChange={() => setVendorToDeny(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Vendor</DialogTitle>
          </DialogHeader>
          <div>
            <p>
              You are about to deny the vendor: <strong>{vendorToDeny?.name}</strong>
            </p>
            <div className="mt-4">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={denyNotes}
                onChange={(e) => setDenyNotes(e.target.value)}
                placeholder="Reason for denial"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() =>
                denyMutation.mutate({
                  id: vendorToDeny!.id,
                  notes: denyNotes,
                })
              }
              variant="destructive"
            >
              Deny
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
