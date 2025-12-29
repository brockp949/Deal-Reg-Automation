import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Building2, DollarSign, TrendingUp, Upload, FileDown, FileText, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { vendorAPI } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import VendorCreateDialog from '@/components/VendorCreateDialog';
import { VendorEditDialog } from '@/components/VendorEditDialog';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { DealImportDialog } from '@/components/DealImportDialog';
import { AgreementUploadDialog } from '@/components/AgreementUploadDialog';
import { useDeleteVendor } from '@/hooks/useVendors';
import { useVendorSpreadsheetExport } from '@/hooks/useVendorSpreadsheet';
import { DealStatusBadge } from '@/components/status';
import type { Vendor } from '@/types';
import type { VendorQueryParams } from '@/types/api';

export default function Vendors() {
  const [search, setSearch] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [vendorToEdit, setVendorToEdit] = useState<Vendor | null>(null);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showAgreementDialog, setShowAgreementDialog] = useState(false);
  const deleteMutation = useDeleteVendor();

  // Fetch all vendors
  const { data: vendors = [], isLoading: vendorsLoading } = useQuery({
    queryKey: ['vendors', search],
    queryFn: async () => {
      const params: VendorQueryParams = { page: 1, limit: 100 };
      if (search) params.search = search;
      const response = await vendorAPI.getAll(params);
      if (!response.data.success) return [];
      return response.data.data.data || [];
    },
  });

  // Auto-select first vendor if none selected
  const selectedVendor = selectedVendorId
    ? vendors.find((v) => v.id === selectedVendorId)
    : vendors[0];

  // Update selectedVendorId when vendors load for the first time
  if (!selectedVendorId && vendors.length > 0 && vendors[0]) {
    setSelectedVendorId(vendors[0].id);
  }

  // Fetch deals for selected vendor
  const { data: deals = [], isLoading: dealsLoading } = useQuery({
    queryKey: ['vendor-deals', selectedVendor?.id],
    queryFn: async () => {
      if (!selectedVendor?.id) return [];
      const response = await vendorAPI.getDeals(selectedVendor.id);
      if (!response.data.success) return [];
      return response.data.data.data || [];
    },
    enabled: !!selectedVendor?.id,
  });

  // Calculate statistics for selected vendor
  const totalDeals = deals?.length || 0;
  const totalValue = deals?.reduce((sum, deal) => sum + (deal.deal_value || 0), 0) || 0;
  const avgDealSize = totalDeals > 0 ? totalValue / totalDeals : 0;

  // Export hook
  const { exportSpreadsheet, isExporting } = useVendorSpreadsheetExport({
    vendorId: selectedVendor?.id || '',
    vendorName: selectedVendor?.name || '',
  });

  const handleEditVendor = (vendor: Vendor, e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setVendorToEdit(vendor);
    setShowEditDialog(true);
  };

  const handleDeleteVendor = (vendor: Vendor, e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setVendorToDelete(vendor);
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (vendorToDelete) {
      deleteMutation.mutate(vendorToDelete.id, {
        onSuccess: () => {
          setShowDeleteDialog(false);
          setVendorToDelete(null);
          // If we deleted the selected vendor, select the first remaining vendor
          if (selectedVendorId === vendorToDelete.id) {
            setSelectedVendorId(null);
          }
        },
      });
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] animate-fade-in">
      {/* Left Sidebar - Vendor List */}
      <div className="w-80 border-r border-white/5 bg-black/20 flex flex-col backdrop-blur-sm">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-white/5 bg-background/50 backdrop-blur-md">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">Vendors</h2>
            <VendorCreateDialog />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background/50 border-input/50 focus:bg-background/80 transition-colors"
            />
          </div>
        </div>

        {/* Vendor List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {vendorsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : vendors.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {search ? 'No vendors found' : 'No vendors yet'}
            </div>
          ) : (
            <>
              {vendors.map((vendor) => (
                <div
                  key={vendor.id}
                  onClick={() => setSelectedVendorId(vendor.id)}
                  className={`w-full text-left p-3 rounded-lg transition-all cursor-pointer border border-transparent ${selectedVendor?.id === vendor.id
                      ? 'bg-primary/20 text-primary border-primary/20 shadow-sm'
                      : 'hover:bg-white/5 text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{vendor.name}</div>
                      {vendor.industry && (
                        <div className="text-xs opacity-70 truncate mt-0.5">
                          {vendor.industry}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {vendor.status && (
                        <Badge
                          variant={vendor.status === 'active' ? 'outline' : 'secondary'}
                          className={`text-[10px] h-5 px-1.5 flex-shrink-0 ${selectedVendor?.id === vendor.id
                              ? 'border-primary/30 text-primary'
                              : 'border-white/10'
                            }`}
                        >
                          {vendor.status}
                        </Badge>
                      )}
                      {selectedVendor?.id === vendor.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 flex-shrink-0 hover:bg-primary/20"
                            >
                              <MoreVertical className="h-3 w-3" />
                              <span className="sr-only">Open menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="glass">
                            <DropdownMenuItem onClick={(e) => handleEditVendor(vendor, e)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => handleDeleteVendor(vendor, e)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-white/5 bg-black/20 text-xs text-muted-foreground backdrop-blur-md">
          {vendors.length} vendor{vendors.length !== 1 ? 's' : ''} total
        </div>
      </div>

      {/* Main Content - Deals Table */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background/30">
        {!selectedVendor ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center animate-fade-in">
              <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                <Building2 className="h-8 w-8 opacity-50" />
              </div>
              <p className="text-lg font-medium">Select a vendor</p>
              <p className="text-sm opacity-60">View details and associated deals</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-6 border-b border-white/5 bg-background/50 backdrop-blur-md animate-slide-in-right">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">{selectedVendor.name}</h1>
                  {selectedVendor.industry && (
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="glass border-white/10">
                        {selectedVendor.industry}
                      </Badge>
                      {selectedVendor.website && (
                        <a href={selectedVendor.website} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                          Visit Website
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)} className="glass hover:bg-white/10">
                    <Upload className="h-4 w-4 mr-2" />
                    Import Deals
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowAgreementDialog(true)} className="glass hover:bg-white/10">
                    <FileText className="h-4 w-4 mr-2" />
                    Upload Agreement
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportSpreadsheet()}
                    disabled={isExporting || deals.length === 0}
                    className="glass hover:bg-white/10"
                  >
                    {isExporting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileDown className="h-4 w-4 mr-2" />
                    )}
                    Export
                  </Button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card className="glass-card p-4 flex flex-row items-center gap-4">
                  <div className="p-3 bg-blue-500/10 rounded-xl">
                    <TrendingUp className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{totalDeals}</div>
                    <div className="text-xs text-muted-foreground">Total Deals</div>
                  </div>
                </Card>
                <Card className="glass-card p-4 flex flex-row items-center gap-4">
                  <div className="p-3 bg-green-500/10 rounded-xl">
                    <DollarSign className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
                    <div className="text-xs text-muted-foreground">Total Value</div>
                  </div>
                </Card>
                <Card className="glass-card p-4 flex flex-row items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-xl">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{formatCurrency(avgDealSize)}</div>
                    <div className="text-xs text-muted-foreground">Avg Deal Size</div>
                  </div>
                </Card>
              </div>
            </div>

            {/* Deals Table */}
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
              {dealsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : deals.length === 0 ? (
                <Card className="glass-panel p-12 border-dashed">
                  <div className="text-center text-muted-foreground">
                    <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No deals found</h3>
                    <p>This vendor doesn't have any deal registrations yet</p>
                  </div>
                </Card>
              ) : (
                <Card className="glass-panel overflow-hidden border-white/5">
                  <Table>
                    <TableHeader className="bg-black/20">
                      <TableRow className="hover:bg-transparent border-white/5">
                        <TableHead>Deal Name</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead className="text-right">Deal Value</TableHead>
                        <TableHead>Probability</TableHead>
                        <TableHead>Registration Date</TableHead>
                        <TableHead>Expected Close</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deals.map((deal) => (
                        <TableRow key={deal.id} className="hover:bg-white/5 border-white/5 transition-colors">
                          <TableCell className="font-medium">
                            {deal.deal_name}
                          </TableCell>
                          <TableCell>{deal.customer_name || 'N/A'}</TableCell>
                          <TableCell>
                            <DealStatusBadge status={deal.status} />
                          </TableCell>
                          <TableCell>{deal.deal_stage || 'N/A'}</TableCell>
                          <TableCell className="text-right font-medium text-green-500">
                            {formatCurrency(deal.deal_value, deal.currency)}
                          </TableCell>
                          <TableCell>
                            {deal.probability !== null && deal.probability !== undefined
                              ? <Badge variant={deal.probability > 50 ? "success" : "secondary"} className="text-xs">{deal.probability}%</Badge>
                              : 'N/A'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(deal.registration_date || deal.created_at)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {deal.expected_close_date
                              ? formatDate(deal.expected_close_date)
                              : 'N/A'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </div>
          </>
        )}
      </div>

      {/* Edit Vendor Dialog */}
      <VendorEditDialog
        vendor={vendorToEdit}
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) setVendorToEdit(null);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDeleteDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) setVendorToDelete(null);
        }}
        onConfirm={confirmDelete}
        entityType="vendor"
        entityName={vendorToDelete?.name || ''}
        isDeleting={deleteMutation.isPending}
      />

      {/* Deal Import Dialog */}
      {selectedVendor && (
        <DealImportDialog
          vendor={selectedVendor}
          open={showImportDialog}
          onOpenChange={setShowImportDialog}
        />
      )}

      {/* Agreement Upload Dialog */}
      {selectedVendor && (
        <AgreementUploadDialog
          vendor={selectedVendor}
          open={showAgreementDialog}
          onOpenChange={setShowAgreementDialog}
        />
      )}
    </div>
  );
}
