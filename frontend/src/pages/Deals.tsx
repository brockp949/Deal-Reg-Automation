import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, FileDown, Loader2, Briefcase, TrendingUp, DollarSign, AlertCircle, Sparkles, RefreshCw, BarChart3, Keyboard, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dealAPI, reprocessAPI } from '@/lib/api';
import { DealRegistration } from '@/types';
import { toast } from 'sonner';
import { DealCardSkeleton } from '@/components/skeletons/DealCardSkeleton';
import { parseApiError, shouldRetry } from '@/utils/errorHandling';
import DealFunnelChart from '@/components/charts/DealFunnelChart';
import DealValueTrendChart from '@/components/charts/DealValueTrendChart';
import DealsByVendorChart from '@/components/charts/DealsByVendorChart';
import { WinLossChart } from '@/components/charts/WinLossChart';
import { DealVelocityMetrics } from '@/components/charts/DealVelocityMetrics';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { DealEditDialog } from '@/components/DealEditDialog';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { useDeleteDeal } from '@/hooks/useDeals';
import { DealStatusBadge } from '@/components/status';

export default function Deals() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('date-desc');
  const [page, setPage] = useState(1);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealRegistration | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteDeal();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['deals', search, statusFilter, sortBy, page],
    queryFn: async () => {
      const params: any = { page, limit: 20 };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;

      // Map sortBy to API parameters
      const sortMapping: Record<string, { sort_by: string; sort_order: string }> = {
        'date-desc': { sort_by: 'created_at', sort_order: 'desc' },
        'date-asc': { sort_by: 'created_at', sort_order: 'asc' },
        'value-desc': { sort_by: 'deal_value', sort_order: 'desc' },
        'value-asc': { sort_by: 'deal_value', sort_order: 'asc' },
        'name-asc': { sort_by: 'deal_name', sort_order: 'asc' },
        'name-desc': { sort_by: 'deal_name', sort_order: 'desc' },
      };
      const sort = sortMapping[sortBy] || { sort_by: 'created_at', sort_order: 'desc' };
      params.sort_by = sort.sort_by;
      params.sort_order = sort.sort_order;

      const response = await dealAPI.getAll(params);
      return response.data;
    },
    placeholderData: (previousData) => previousData, // Keep showing old data while loading new page
    retry: (failureCount, error) => {
      if (!shouldRetry(error)) return false;
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 30000, // Data is fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  });

  const deals: DealRegistration[] = (data as any)?.data || [];
  const pagination = (data as any)?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };

  // Reset to page 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleSortChange = (value: string) => {
    setSortBy(value);
    setPage(1);
  };

  const handleEditDeal = (deal: DealRegistration) => {
    setSelectedDeal(deal);
    setShowEditDialog(true);
  };

  const handleDeleteDeal = (deal: DealRegistration) => {
    setSelectedDeal(deal);
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (selectedDeal) {
      deleteMutation.mutate(selectedDeal.id, {
        onSuccess: () => {
          setShowDeleteDialog(false);
          setSelectedDeal(null);
        },
      });
    }
  };

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: '/',
      description: 'Focus search',
      callback: () => {
        searchInputRef.current?.focus();
      },
    },
    {
      key: '?',
      shift: true,
      description: 'Show keyboard shortcuts',
      callback: () => {
        setShowShortcuts(true);
      },
    },
    {
      key: 'Escape',
      description: 'Clear search',
      callback: () => {
        if (search) {
          handleSearchChange('');
          searchInputRef.current?.blur();
        }
      },
    },
  ]);

  // Calculate summary statistics (use pagination total for accurate count)
  const totalDeals = pagination.total;
  const totalValue = deals?.reduce((sum, deal) => sum + (deal.deal_value || 0), 0) || 0;
  const avgDealSize = (deals?.length || 0) > 0 ? totalValue / deals.length : 0;
  const statusBreakdown = deals?.reduce((acc, deal) => {
    acc[deal.status] = (acc[deal.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const formatCurrency = (value: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (date: string | null | undefined) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleDetailedReprocessing = async () => {
    try {
      setIsReprocessing(true);
      toast.info('Starting detailed reprocessing...', {
        description: 'This may take a few minutes. Analyzing all uploaded files for additional deals and vendor relationships.',
      });

      await reprocessAPI.detailed();

      toast.success('Detailed reprocessing started!', {
        description: 'The system is analyzing your files. Refresh in a few minutes to see new deals.',
      });

      // Refresh deals after a delay to show new results
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['deals'] });
      }, 5000);
    } catch (error: any) {
      toast.error('Reprocessing failed', {
        description: error.response?.data?.message || 'An error occurred while starting reprocessing.',
      });
    } finally {
      setIsReprocessing(false);
    }
  };

  if (error) {
    const appError = parseApiError(error);
    return (
      <div className="container py-8">
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <CardTitle className="text-destructive">Failed to Load Deals</CardTitle>
            </div>
            <CardDescription>{appError.message}</CardDescription>
          </CardHeader>
          <CardContent>
            {appError.details && (
              <div className="mb-4 rounded-md bg-muted p-3">
                <p className="text-sm text-muted-foreground">
                  {JSON.stringify(appError.details, null, 2)}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => refetch()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
              <Button variant="outline" onClick={() => window.location.href = '/'}>
                Go to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary via-amber-500 to-primary bg-clip-text text-transparent">
            Deal Registrations
          </h1>
          <p className="text-muted-foreground mt-1">
            View and manage all deal registrations in one place
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="glass hover:bg-muted/50"
            onClick={() => setShowShortcuts(true)}
            aria-label="Show keyboard shortcuts"
            title="Show keyboard shortcuts (?)"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="gap-2 glass hover:bg-muted/50"
            onClick={handleDetailedReprocessing}
            disabled={isReprocessing}
            aria-label={isReprocessing ? 'Processing deals' : 'Start deep analysis'}
          >
            {isReprocessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isReprocessing ? 'Processing...' : 'Deep Analysis'}
          </Button>
          <Button variant="outline" className="gap-2 glass hover:bg-muted/50" aria-label="Export deals to file">
            <FileDown className="h-4 w-4" />
            Export Deals
          </Button>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Deals</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDeals}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Across all statuses
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Combined deal value
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Deal Size</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(avgDealSize)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Per deal registration
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Deals</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(statusBreakdown['registered'] || 0) + (statusBreakdown['approved'] || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Registered & Approved
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle>Search & Filter</CardTitle>
          <CardDescription>Find specific deals or filter by status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                ref={searchInputRef}
                placeholder="Search deals, customers, vendors..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9 bg-background/50 border-input/50 focus:bg-background/80 transition-colors"
                aria-label="Search deals by name, customer, or vendor"
                title="Press / to focus (Esc to clear)"
              />
            </div>

            <Select value={statusFilter} onValueChange={handleStatusChange}>
              <SelectTrigger aria-label="Filter deals by status" className="bg-background/50 border-input/50">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="registered">Registered</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="closed-won">Closed Won</SelectItem>
                <SelectItem value="closed-lost">Closed Lost</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger aria-label="Sort deals by" className="bg-background/50 border-input/50">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc">Newest First</SelectItem>
                <SelectItem value="date-asc">Oldest First</SelectItem>
                <SelectItem value="value-desc">Highest Value</SelectItem>
                <SelectItem value="value-asc">Lowest Value</SelectItem>
                <SelectItem value="name-asc">Name (A-Z)</SelectItem>
                <SelectItem value="name-desc">Name (Z-A)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Analytics & Deals */}
      <Tabs defaultValue="list" className="space-y-4">
        <TabsList className="glass p-1">
          <TabsTrigger value="list" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Deals List
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-6">
          {/* Velocity Metrics */}
          <DealVelocityMetrics deals={deals} />

          {/* Main Charts */}
          <div className="grid gap-4 md:grid-cols-2">
            <DealFunnelChart />
            <DealValueTrendChart />
          </div>

          {/* Secondary Charts */}
          <div className="grid gap-4 md:grid-cols-2">
            <DealsByVendorChart />
            <WinLossChart deals={deals} />
          </div>
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          {/* Deals List */}
          {isLoading || isRefetching ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <DealCardSkeleton count={6} />
            </div>
          ) : deals.length === 0 ? (
            <Card className="glass-panel">
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <Briefcase className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
                  <h3 className="mt-4 text-lg font-semibold">No deals found</h3>
                  <p className="text-muted-foreground mt-2">
                    {search || statusFilter !== 'all'
                      ? 'Try adjusting your search or filters'
                      : 'Upload files to start extracting deal registrations'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {deals.map((deal) => (
                <Card key={deal.id} className="glass-card hover:shadow-lg transition-all hover:border-primary/20">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg truncate">{deal.deal_name}</CardTitle>
                        <CardDescription className="mt-1">
                          {deal.customer_name || 'No customer specified'}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <DealStatusBadge status={deal.status} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted/50">
                              <MoreVertical className="h-4 w-4" />
                              <span className="sr-only">Open menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditDeal(deal)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteDeal(deal)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Vendor:</span>
                        <Link
                          to={`/vendors/${deal.vendor_id}`}
                          className="font-medium hover:underline text-primary"
                        >
                          {deal.vendor_name || 'Unknown'}
                        </Link>
                      </div>

                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Deal Value:</span>
                        <span className="font-semibold">
                          {formatCurrency(deal.deal_value, deal.currency)}
                        </span>
                      </div>

                      {deal.deal_stage && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Stage:</span>
                          <span className="font-medium">{deal.deal_stage}</span>
                        </div>
                      )}

                      {deal.probability !== null && deal.probability !== undefined && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Probability:</span>
                          <span className="font-medium">{Math.round(deal.probability)}%</span>
                        </div>
                      )}

                      {deal.metadata?.buying_signal_score && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Buying Signal:</span>
                          <span className="font-medium">
                            {(deal.metadata.buying_signal_score * 100).toFixed(0)}%
                          </span>
                        </div>
                      )}

                      {deal.metadata?.confidence_score && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Confidence:</span>
                          <span className="font-medium">
                            {(deal.metadata.confidence_score * 100).toFixed(0)}%
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Registered:</span>
                        <span>{formatDate(deal.registration_date || deal.created_at)}</span>
                      </div>

                      {deal.expected_close_date && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Expected Close:</span>
                          <span>{formatDate(deal.expected_close_date)}</span>
                        </div>
                      )}

                      {deal.metadata?.extraction_method && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Source:</span>
                          <Badge variant="outline" className="text-xs bg-muted/30 border-border">
                            {deal.metadata.extraction_method}
                          </Badge>
                        </div>
                      )}
                    </div>

                    {deal.notes && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {deal.notes}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {!isLoading && totalDeals > 0 && pagination.totalPages > 1 && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="glass hover:bg-muted/50"
                  aria-label="Previous page"
                >
                  Previous
                </Button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                    .filter((pageNum) => {
                      // Show first page, last page, current page, and pages around current
                      return (
                        pageNum === 1 ||
                        pageNum === pagination.totalPages ||
                        Math.abs(pageNum - page) <= 1
                      );
                    })
                    .map((pageNum, index, array) => (
                      <React.Fragment key={pageNum}>
                        {index > 0 && array[index - 1] !== pageNum - 1 && (
                          <span className="px-2 text-muted-foreground">...</span>
                        )}
                        <Button
                          variant={pageNum === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPage(pageNum)}
                          aria-label={`Go to page ${pageNum}`}
                          aria-current={pageNum === page ? "page" : undefined}
                          className={pageNum === page ? "bg-primary" : "glass hover:bg-muted/50"}
                        >
                          {pageNum}
                        </Button>
                      </React.Fragment>
                    ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
                  disabled={page === pagination.totalPages}
                  className="glass hover:bg-muted/50"
                  aria-label="Next page"
                >
                  Next
                </Button>
              </div>

              <div className="text-center text-sm text-muted-foreground">
                Showing {(page - 1) * pagination.limit + 1} to{' '}
                {Math.min(page * pagination.limit, totalDeals)} of {totalDeals} deal
                {totalDeals !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />

      {/* Edit Deal Dialog */}
      <DealEditDialog
        deal={selectedDeal}
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) setSelectedDeal(null);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDeleteDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) setSelectedDeal(null);
        }}
        onConfirm={confirmDelete}
        entityType="deal"
        entityName={selectedDeal?.deal_name || ''}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
