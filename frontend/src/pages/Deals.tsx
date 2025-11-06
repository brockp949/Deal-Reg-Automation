import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, FileDown, Loader2, Briefcase, TrendingUp, DollarSign, AlertCircle, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { dealAPI, reprocessAPI } from '@/lib/api';
import { DealRegistration } from '@/types';
import { toast } from 'sonner';

export default function Deals() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('date-desc');
  const [isReprocessing, setIsReprocessing] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['deals', search, statusFilter, sortBy],
    queryFn: async () => {
      const params: any = { page: 1, limit: 100 };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      const response = await dealAPI.getAll(params);
      return response.data;
    },
  });

  const deals: DealRegistration[] = data?.data || [];

  // Calculate summary statistics
  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum, deal) => sum + (deal.deal_value || 0), 0);
  const avgDealSize = totalDeals > 0 ? totalValue / totalDeals : 0;
  const statusBreakdown = deals.reduce((acc, deal) => {
    acc[deal.status] = (acc[deal.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Sort deals
  const sortedDeals = [...deals].sort((a, b) => {
    switch (sortBy) {
      case 'date-desc':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'date-asc':
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case 'value-desc':
        return (b.deal_value || 0) - (a.deal_value || 0);
      case 'value-asc':
        return (a.deal_value || 0) - (b.deal_value || 0);
      case 'name-asc':
        return a.deal_name.localeCompare(b.deal_name);
      case 'name-desc':
        return b.deal_name.localeCompare(a.deal_name);
      default:
        return 0;
    }
  });

  // Filter deals by search
  const filteredDeals = sortedDeals.filter((deal) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      deal.deal_name?.toLowerCase().includes(searchLower) ||
      deal.customer_name?.toLowerCase().includes(searchLower) ||
      deal.vendor_name?.toLowerCase().includes(searchLower) ||
      deal.notes?.toLowerCase().includes(searchLower)
    );
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'registered':
        return 'bg-blue-100 text-blue-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'closed-won':
        return 'bg-purple-100 text-purple-800';
      case 'closed-lost':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

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
    return (
      <div className="container py-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>Error loading deals. Please try again.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deal Registrations</h1>
          <p className="text-muted-foreground mt-1">
            View and manage all deal registrations in one place
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleDetailedReprocessing}
            disabled={isReprocessing}
          >
            {isReprocessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isReprocessing ? 'Processing...' : 'Deep Analysis'}
          </Button>
          <Button variant="outline" className="gap-2">
            <FileDown className="h-4 w-4" />
            Export Deals
          </Button>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Deals</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDeals}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Across all statuses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Combined deal value
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Deal Size</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(avgDealSize)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Per deal registration
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Deals</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
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
      <Card>
        <CardHeader>
          <CardTitle>Search & Filter</CardTitle>
          <CardDescription>Find specific deals or filter by status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search deals, customers, vendors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
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

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
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

      {/* Deals List */}
      {isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      ) : filteredDeals.length === 0 ? (
        <Card>
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
          {filteredDeals.map((deal) => (
            <Card key={deal.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">{deal.deal_name}</CardTitle>
                    <CardDescription className="mt-1">
                      {deal.customer_name || 'No customer specified'}
                    </CardDescription>
                  </div>
                  <Badge className={getStatusColor(deal.status)} variant="secondary">
                    {deal.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Vendor:</span>
                    <Link
                      to={`/vendors/${deal.vendor_id}`}
                      className="font-medium hover:underline"
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
                      <Badge variant="outline" className="text-xs">
                        {deal.metadata.extraction_method}
                      </Badge>
                    </div>
                  )}
                </div>

                {deal.notes && (
                  <div className="pt-2 border-t">
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

      {/* Results Summary */}
      {!isLoading && filteredDeals.length > 0 && (
        <div className="text-center text-sm text-muted-foreground">
          Showing {filteredDeals.length} of {totalDeals} deal{totalDeals !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
