import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, FileDown, Loader2, Building2, Upload, TrendingUp } from 'lucide-react';
import { vendorAPI } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import VendorCreateDialog from '@/components/VendorCreateDialog';
import type { Vendor } from '@/types';

export default function Vendors() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['vendors', search, statusFilter],
    queryFn: async () => {
      const params: any = {
        page: 1,
        limit: 50,
      };

      if (search) {
        params.search = search;
      }

      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }

      const response = await vendorAPI.getAll(params);
      return response.data;
    },
  });

  const vendors = data?.data || [];

  // Calculate summary statistics
  const totalVendors = vendors.length;
  const activeVendors = vendors.filter((v: Vendor) => v.status === 'active').length;
  const inactiveVendors = vendors.filter((v: Vendor) => v.status === 'inactive').length;

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground mt-1">
            Manage and track all your vendor partnerships
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" asChild>
            <Link to="/upload">
              <Upload className="h-4 w-4" />
              Import CSV
            </Link>
          </Button>
          <Button variant="outline" className="gap-2">
            <FileDown className="h-4 w-4" />
            Export
          </Button>
          <VendorCreateDialog />
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Vendors</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalVendors}</div>
            <p className="text-xs text-muted-foreground mt-1">
              All vendor partnerships
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Vendors</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeVendors}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Currently active partnerships
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inactive Vendors</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inactiveVendors}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Inactive or dormant
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter */}
      <Card>
        <CardHeader>
          <CardTitle>Search & Filter</CardTitle>
          <CardDescription>Find specific vendors or filter by status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search vendors by name, industry, domain..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('all')}
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'active' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('active')}
              >
                Active
              </Button>
              <Button
                variant={statusFilter === 'inactive' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('inactive')}
              >
                Inactive
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vendors List */}
      {isLoading ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Loading vendors...</p>
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-destructive">
              Failed to load vendors. Please try again.
            </div>
          </CardContent>
        </Card>
      ) : vendors.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center max-w-md mx-auto">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No vendors found</h3>
              <p className="text-muted-foreground mb-6">
                {search || statusFilter !== 'all'
                  ? 'Try adjusting your search or filters'
                  : 'Get started by importing your vendor list or adding vendors manually'}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button asChild>
                  <Link to="/upload">
                    <Upload className="mr-2 h-4 w-4" />
                    Import CSV
                  </Link>
                </Button>
                <VendorCreateDialog />
              </div>
              <div className="mt-6 text-sm text-muted-foreground">
                <p>Tip: Export your vendors from vTiger or CRM as CSV and import them here</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((vendor: Vendor) => (
            <Card key={vendor.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{vendor.name}</CardTitle>
                  <Badge variant={vendor.status === 'active' ? 'success' : 'secondary'}>
                    {vendor.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {vendor.industry && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Industry:</span>
                      <span className="font-medium">{vendor.industry}</span>
                    </div>
                  )}
                  {vendor.website && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Website:</span>
                      <a
                        href={vendor.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate"
                      >
                        {vendor.website}
                      </a>
                    </div>
                  )}
                  {vendor.email_domains && vendor.email_domains.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Domains:</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {vendor.email_domains.join(', ')}
                      </span>
                    </div>
                  )}
                  <div className="pt-2 text-xs text-muted-foreground">
                    Added {formatDate(vendor.created_at)}
                  </div>
                </div>
                <div className="mt-4">
                  <Button asChild className="w-full" size="sm">
                    <Link to={`/vendors/${vendor.id}`}>View Details</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Results Summary */}
      {!isLoading && vendors.length > 0 && (
        <div className="text-center text-sm text-muted-foreground">
          Showing {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
          {statusFilter !== 'all' && ` (${statusFilter})`}
        </div>
      )}

      {/* Pagination */}
      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" disabled={data.pagination.page === 1}>
            Previous
          </Button>
          <div className="flex items-center px-4">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </div>
          <Button
            variant="outline"
            disabled={data.pagination.page === data.pagination.totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
