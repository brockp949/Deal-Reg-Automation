import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Building2, RefreshCw, AlertCircle, Users } from 'lucide-react';

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
    refetch,
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
      toast.success('Vendor approved successfully');
      queryClient.invalidateQueries({ queryKey: ['vendors', 'review'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
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

  const pendingCount = vendors?.length || 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendor Approvals</h1>
          <p className="text-muted-foreground mt-1">
            Review and approve newly discovered vendors
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} className="glass hover:bg-white/10 gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <Users className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Vendors awaiting approval
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle>Approval Queue</CardTitle>
          <CardDescription>
            Review each vendor and approve or deny their registration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <h3 className="text-lg font-semibold">Error Loading Queue</h3>
              <p className="text-muted-foreground mt-2">Failed to load vendors for approval</p>
              <Button variant="outline" onClick={() => refetch()} className="mt-4">
                Try Again
              </Button>
            </div>
          ) : vendors?.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
              <h3 className="text-lg font-semibold">All Caught Up!</h3>
              <p className="text-muted-foreground mt-2">No vendors pending approval</p>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 overflow-hidden">
              <Table>
                <TableHeader className="bg-black/20">
                  <TableRow className="hover:bg-transparent border-white/5">
                    <TableHead>Name</TableHead>
                    <TableHead>Website</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendors?.map((vendor: Vendor) => (
                    <TableRow key={vendor.id} className="hover:bg-white/5 border-white/5">
                      <TableCell className="font-medium">{vendor.name}</TableCell>
                      <TableCell>
                        {vendor.website ? (
                          <a
                            href={vendor.website}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {vendor.website}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {vendor.industry ? (
                          <Badge variant="outline" className="bg-white/5 border-white/10">
                            {vendor.industry}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                          Pending
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVendorToApprove(vendor)}
                            className="gap-1 hover:bg-green-500/10 hover:text-green-500 hover:border-green-500/20"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVendorToDeny(vendor)}
                            className="gap-1 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20"
                          >
                            <XCircle className="h-4 w-4" />
                            Deny
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={!!vendorToApprove} onOpenChange={() => setVendorToApprove(null)}>
        <DialogContent className="glass">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Approve Vendor
            </DialogTitle>
            <DialogDescription>
              Approve <strong>{vendorToApprove?.name}</strong> as a new vendor
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{vendorToApprove?.name}</p>
                  <p className="text-sm text-muted-foreground">{vendorToApprove?.industry || 'No industry specified'}</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mergeId">Merge into existing vendor (optional)</Label>
              <Input
                id="mergeId"
                value={mergeIntoVendorId}
                onChange={(e) => setMergeIntoVendorId(e.target.value)}
                placeholder="Enter existing vendor ID to merge"
                className="bg-background/50"
              />
              <p className="text-xs text-muted-foreground">
                If this vendor is a duplicate, enter the ID of the existing vendor to merge records
              </p>
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
                  mergeId: mergeIntoVendorId || undefined,
                })
              }
              disabled={approveMutation.isPending}
              className="gap-2"
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Approve Vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deny Dialog */}
      <Dialog open={!!vendorToDeny} onOpenChange={() => setVendorToDeny(null)}>
        <DialogContent className="glass">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Deny Vendor
            </DialogTitle>
            <DialogDescription>
              Deny <strong>{vendorToDeny?.name}</strong> from being added as a vendor
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-destructive/20 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="font-medium">{vendorToDeny?.name}</p>
                  <p className="text-sm text-muted-foreground">{vendorToDeny?.industry || 'No industry specified'}</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Reason for denial (optional)</Label>
              <Input
                id="notes"
                value={denyNotes}
                onChange={(e) => setDenyNotes(e.target.value)}
                placeholder="e.g., Duplicate, Invalid, Not a vendor..."
                className="bg-background/50"
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
              disabled={denyMutation.isPending}
              variant="destructive"
              className="gap-2"
            >
              {denyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Deny Vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
