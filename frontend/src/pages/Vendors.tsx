import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, Building2, DollarSign, TrendingUp, Upload, FileDown } from 'lucide-react';
import { vendorAPI } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import VendorCreateDialog from '@/components/VendorCreateDialog';
import type { Vendor, DealRegistration } from '@/types';

export default function Vendors() {
  const [search, setSearch] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);

  // Fetch all vendors
  const { data: vendorsData, isLoading: vendorsLoading } = useQuery({
    queryKey: ['vendors', search],
    queryFn: async () => {
      const params: any = { page: 1, limit: 100 };
      if (search) params.search = search;
      const response = await vendorAPI.getAll(params);
      return response.data;
    },
  });

  const vendors: Vendor[] = vendorsData?.data || [];

  // Auto-select first vendor if none selected
  const selectedVendor = selectedVendorId
    ? vendors.find((v) => v.id === selectedVendorId)
    : vendors[0];

  // Update selectedVendorId when vendors load for the first time
  if (!selectedVendorId && vendors.length > 0 && vendors[0]) {
    setSelectedVendorId(vendors[0].id);
  }

  // Fetch deals for selected vendor
  const { data: dealsData, isLoading: dealsLoading } = useQuery({
    queryKey: ['vendor-deals', selectedVendor?.id],
    queryFn: async () => {
      if (!selectedVendor?.id) return [];
      const response = await vendorAPI.getDeals(selectedVendor.id);
      return response.data.data as DealRegistration[];
    },
    enabled: !!selectedVendor?.id,
  });

  const deals: DealRegistration[] = dealsData || [];

  // Calculate statistics for selected vendor
  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum, deal) => sum + (deal.deal_value || 0), 0);
  const avgDealSize = totalDeals > 0 ? totalValue / totalDeals : 0;

  const getStatusVariant = (status: string): 'default' | 'secondary' | 'success' | 'destructive' => {
    switch (status) {
      case 'approved':
      case 'closed-won':
        return 'success';
      case 'rejected':
      case 'closed-lost':
        return 'destructive';
      case 'registered':
        return 'default';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left Sidebar - Vendor List */}
      <div className="w-80 border-r bg-muted/30 flex flex-col">
        {/* Sidebar Header */}
        <div className="p-4 border-b bg-background">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Vendors</h2>
            <VendorCreateDialog />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Vendor List */}
        <div className="flex-1 overflow-y-auto">
          {vendorsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : vendors.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {search ? 'No vendors found' : 'No vendors yet'}
            </div>
          ) : (
            <div className="p-2">
              {vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  onClick={() => setSelectedVendorId(vendor.id)}
                  className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                    selectedVendor?.id === vendor.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{vendor.name}</div>
                      {vendor.industry && (
                        <div className="text-xs opacity-80 truncate mt-0.5">
                          {vendor.industry}
                        </div>
                      )}
                    </div>
                    {vendor.status && (
                      <Badge
                        variant={vendor.status === 'active' ? 'success' : 'secondary'}
                        className={`text-xs flex-shrink-0 ${
                          selectedVendor?.id === vendor.id
                            ? 'bg-primary-foreground/20 text-primary-foreground'
                            : ''
                        }`}
                      >
                        {vendor.status}
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t bg-background text-xs text-muted-foreground">
          {vendors.length} vendor{vendors.length !== 1 ? 's' : ''} total
        </div>
      </div>

      {/* Main Content - Deals Table */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedVendor ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a vendor to view their deals</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-6 border-b bg-background">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h1 className="text-2xl font-bold">{selectedVendor.name}</h1>
                  {selectedVendor.industry && (
                    <p className="text-muted-foreground">{selectedVendor.industry}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">
                    <Upload className="h-4 w-4 mr-2" />
                    Import
                  </Button>
                  <Button variant="outline" size="sm">
                    <FileDown className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-950 rounded-lg">
                      <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{totalDeals}</div>
                      <div className="text-xs text-muted-foreground">Total Deals</div>
                    </div>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 dark:bg-green-950 rounded-lg">
                      <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
                      <div className="text-xs text-muted-foreground">Total Value</div>
                    </div>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-950 rounded-lg">
                      <DollarSign className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{formatCurrency(avgDealSize)}</div>
                      <div className="text-xs text-muted-foreground">Avg Deal Size</div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            {/* Deals Table */}
            <div className="flex-1 overflow-y-auto p-6">
              {dealsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : deals.length === 0 ? (
                <Card className="p-12">
                  <div className="text-center text-muted-foreground">
                    <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No deals found</h3>
                    <p>This vendor doesn't have any deal registrations yet</p>
                  </div>
                </Card>
              ) : (
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
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
                        <TableRow key={deal.id}>
                          <TableCell className="font-medium">
                            {deal.deal_name}
                          </TableCell>
                          <TableCell>{deal.customer_name || 'N/A'}</TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(deal.status)}>
                              {deal.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{deal.deal_stage || 'N/A'}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(deal.deal_value, deal.currency)}
                          </TableCell>
                          <TableCell>
                            {deal.probability !== null && deal.probability !== undefined
                              ? `${deal.probability}%`
                              : 'N/A'}
                          </TableCell>
                          <TableCell>
                            {formatDate(deal.registration_date || deal.created_at)}
                          </TableCell>
                          <TableCell>
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
    </div>
  );
}
