import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, Briefcase, FileText, TrendingUp, Plus, Upload, ArrowRight, Cloud, Mail, HardDrive, Lightbulb, Sparkles } from 'lucide-react';
import { vendorAPI, dealAPI, fileAPI, syncStatsAPI } from '@/lib/api';
import { formatCurrency, formatDate, formatFileSize } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KPICardSkeleton } from '@/components/skeletons/KPICardSkeleton';
import { ActivityListSkeleton } from '@/components/skeletons/ActivityListSkeleton';
import DealFunnelChart from '@/components/charts/DealFunnelChart';
import DealsByVendorChart from '@/components/charts/DealsByVendorChart';
import DealValueTrendChart from '@/components/charts/DealValueTrendChart';

export default function Dashboard() {
  // Fetch statistics
  const { data: vendorsData, isLoading: vendorsLoading } = useQuery({
    queryKey: ['vendors-dashboard'],
    queryFn: async () => {
      const response = await vendorAPI.getAll({ page: 1, limit: 5 });
      return response.data;
    },
  });

  const { data: dealsData, isLoading: dealsLoading } = useQuery({
    queryKey: ['deals-dashboard'],
    queryFn: async () => {
      const response = await dealAPI.getAll({ page: 1, limit: 10 });
      return response.data;
    },
  });

  const { data: filesData, isLoading: filesLoading } = useQuery({
    queryKey: ['files-dashboard'],
    queryFn: async () => {
      const response = await fileAPI.getAll({ limit: 5 });
      return response.data;
    },
  });

  const { data: syncStatsData, isLoading: syncLoading } = useQuery({
    queryKey: ['sync-stats-dashboard'],
    queryFn: async () => {
      const response = await syncStatsAPI.getStats();
      return response.data;
    },
  });

  const vendors = vendorsData?.success ? (vendorsData.data.data || []) : [];
  const deals = dealsData?.success ? (dealsData.data.data || []) : [];
  const files = filesData?.success ? (filesData.data.data || []) : [];

  const totalVendors = vendorsData?.success ? vendorsData.data.pagination?.total || 0 : 0;
  const totalDeals = dealsData?.success ? dealsData.data.pagination?.total || 0 : 0;
  const totalFiles = filesData?.success ? filesData.data.data?.filter((f) => f.processing_status === 'completed').length || 0 : 0;

  // Calculate total deal value
  const totalDealValue = deals?.reduce((sum: number, deal: any) => sum + (deal.deal_value || 0), 0) || 0;

  // Sync stats
  const syncStats = syncStatsData?.success ? syncStatsData.data : null;
  const activeConfigs = syncStats?.activeConfigs || 0;
  const recentSyncs = syncStats?.recentRuns || [];

  // Helper to format relative time
  const getRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getSyncStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success">Completed</Badge>;
      case 'running':
        return <Badge variant="warning">Running</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success">Completed</Badge>;
      case 'processing':
        return <Badge variant="warning">Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const isNewUser = totalVendors === 0 && totalDeals === 0 && totalFiles === 0;

  const kpiCards = [
    {
      label: 'Total Vendors',
      value: totalVendors,
      subtext: vendors.length > 0 ? `+${vendors.length} recent` : undefined,
      subtextColor: 'text-green-500',
      icon: Building2,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10',
    },
    {
      label: 'Total Deals',
      value: totalDeals,
      subtext: deals.length > 0 ? `+${deals.length} recent` : undefined,
      subtextColor: 'text-green-500',
      icon: Briefcase,
      iconColor: 'text-green-500',
      iconBg: 'bg-green-500/10',
    },
    {
      label: 'Files Processed',
      value: totalFiles,
      subtext: 'Completed',
      subtextColor: 'text-muted-foreground',
      icon: FileText,
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-500/10',
    },
    {
      label: 'Deal Value',
      value: formatCurrency(totalDealValue),
      subtext: 'Total pipeline',
      subtextColor: 'text-muted-foreground',
      icon: TrendingUp,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-500/10',
    },
    {
      label: 'Google Sync',
      value: activeConfigs,
      subtext: syncStats?.lastSyncAt ? `Last: ${getRelativeTime(syncStats.lastSyncAt)}` : 'No syncs yet',
      subtextColor: 'text-muted-foreground',
      icon: Cloud,
      iconColor: 'text-cyan-500',
      iconBg: 'bg-cyan-500/10',
      onClick: () => window.location.href = '/settings/sync',
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome to your deal registration automation hub
        </p>
      </div>

      {/* Quick Start Hero (shown when no data) */}
      {isNewUser && (
        <div className="hero-card mb-8 p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30 shadow-lg shadow-primary/10">
              <Sparkles className="h-6 w-6 text-primary animate-float" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-1">Quick Start Guide</h2>
              <p className="text-muted-foreground">
                Get your deal registration system up and running in minutes
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {[
              { step: 1, title: 'Vendors', desc: 'Upload your vendor list CSV to populate the vendor database' },
              { step: 2, title: 'Deals', desc: 'Import deals CSV with vendor associations and customers' },
              { step: 3, title: 'MBOX', desc: 'Upload email archives for AI-powered deal extraction' },
              { step: 4, title: 'Transcripts', desc: 'Upload meeting transcripts for sales conversation analysis' },
            ].map((item, index) => (
              <div
                key={item.step}
                className={`flex flex-col items-start p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/15 transition-all duration-300 animate-fade-in-up stagger-${index + 1}`}
              >
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center mb-3 border border-primary/30">
                  <span className="text-primary font-bold">{item.step}</span>
                </div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Button asChild size="lg" className="group">
              <Link to="/upload">
                <Upload className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                Start Upload Wizard
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="group">
              <Link to="/settings/sync">
                <Cloud className="mr-2 h-5 w-5" />
                Connect Google Sync
              </Link>
            </Button>
          </div>

          {/* Google Sync Tip */}
          <div className="mt-6 p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-start gap-3">
            <Lightbulb className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-cyan-100">
                Pro tip: Connect Gmail & Google Drive
              </p>
              <p className="text-sm text-cyan-300/80 mt-1">
                Import deals automatically from your email and documents for continuous updates.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {vendorsLoading || dealsLoading || filesLoading || syncLoading ? (
          <KPICardSkeleton count={5} />
        ) : (
          kpiCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className={`kpi-card p-6 ${card.onClick ? 'cursor-pointer' : ''} animate-fade-in-up stagger-${index + 1}`}
                onClick={card.onClick}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className="text-2xl font-bold tracking-tight">{card.value}</p>
                    {card.subtext && (
                      <p className={`text-xs ${card.subtextColor}`}>{card.subtext}</p>
                    )}
                  </div>
                  <div className={`h-10 w-10 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                    <Icon className={`h-5 w-5 ${card.iconColor}`} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DealValueTrendChart />
        </div>
        <DealsByVendorChart />
        <DealFunnelChart />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Recent Activity */}
        {filesLoading ? (
          <ActivityListSkeleton items={5} />
        ) : (
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Files</CardTitle>
                <Button asChild size="sm" variant="outline">
                  <Link to="/upload">View All</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No files uploaded yet</p>
                  <Button asChild size="sm">
                    <Link to="/upload">
                      <Plus className="mr-2 h-4 w-4" />
                      Upload Files
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {files.slice(0, 5).map((file: any) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-200"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{file.filename}</p>
                        <div className="flex gap-2 text-sm text-muted-foreground mt-1">
                          <span>{formatFileSize(file.file_size)}</span>
                          <span>•</span>
                          <span>{formatDate(file.upload_date)}</span>
                        </div>
                      </div>
                      {getStatusBadge(file.processing_status)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Recent Deals */}
        {dealsLoading ? (
          <ActivityListSkeleton items={5} />
        ) : (
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Deals</CardTitle>
                <Button asChild size="sm" variant="outline">
                  <Link to="/vendors">View All</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {deals.length === 0 ? (
                <div className="text-center py-8">
                  <Briefcase className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No deals registered yet</p>
                  <Button asChild size="sm">
                    <Link to="/upload">
                      <Plus className="mr-2 h-4 w-4" />
                      Upload Files
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {deals.slice(0, 5).map((deal: any) => (
                    <div
                      key={deal.id}
                      className="flex items-start justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-200"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{deal.deal_name}</p>
                        <div className="text-sm text-muted-foreground mt-1">
                          {deal.vendor_name && <span>{deal.vendor_name}</span>}
                          {deal.customer_name && (
                            <>
                              <span className="mx-1">•</span>
                              <span>{deal.customer_name}</span>
                            </>
                          )}
                        </div>
                        <p className="text-sm font-medium mt-1">
                          {formatCurrency(deal.deal_value, deal.currency)}
                        </p>
                      </div>
                      <Badge
                        variant={
                          deal.status === 'closed-won'
                            ? 'success'
                            : deal.status === 'approved'
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {deal.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Recent Syncs */}
        {syncLoading ? (
          <ActivityListSkeleton items={5} />
        ) : (
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Syncs</CardTitle>
                <Button asChild size="sm" variant="outline">
                  <Link to="/settings/sync">View All</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recentSyncs.length === 0 ? (
                <div className="text-center py-8">
                  <Cloud className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No syncs configured yet</p>
                  <Button asChild size="sm">
                    <Link to="/settings/sync">
                      <Plus className="mr-2 h-4 w-4" />
                      Set Up Google Sync
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentSyncs.slice(0, 5).map((sync: any) => (
                    <div
                      key={sync.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-200"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {sync.service_type === 'gmail' ? (
                          <Mail className="h-4 w-4 text-red-500 flex-shrink-0" />
                        ) : (
                          <HardDrive className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{sync.config_name || 'Sync'}</p>
                          <div className="flex gap-2 text-sm text-muted-foreground mt-1">
                            <span>{sync.items_processed || 0} items</span>
                            <span>•</span>
                            <span>{getRelativeTime(sync.started_at)}</span>
                          </div>
                        </div>
                      </div>
                      {getSyncStatusBadge(sync.status)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Quick Actions */}
      <Card className="mt-6 glass-card">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button asChild className="h-auto py-6 flex-col group">
              <Link to="/upload">
                <FileText className="h-8 w-8 mb-2 group-hover:scale-110 transition-transform" />
                <span className="text-lg">Upload Files</span>
                <span className="text-xs font-normal opacity-80 mt-1">
                  Import emails, transcripts, or CSV
                </span>
              </Link>
            </Button>

            <Button asChild variant="outline" className="h-auto py-6 flex-col group">
              <Link to="/vendors">
                <Building2 className="h-8 w-8 mb-2 group-hover:scale-110 transition-transform" />
                <span className="text-lg">View Vendors</span>
                <span className="text-xs font-normal opacity-80 mt-1">
                  Manage vendor partnerships
                </span>
              </Link>
            </Button>

            <Button asChild variant="outline" className="h-auto py-6 flex-col group">
              <Link to="/settings/sync">
                <Cloud className="h-8 w-8 mb-2 group-hover:scale-110 transition-transform" />
                <span className="text-lg">Google Sync</span>
                <span className="text-xs font-normal opacity-80 mt-1">
                  Manage Gmail & Drive imports
                </span>
              </Link>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-6 flex-col group"
              onClick={async () => {
                try {
                  const response = await fetch('/api/export/csv', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'deals' }),
                  });
                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `deals-export-${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                } catch (e) {
                  console.error('Export failed', e);
                }
              }}
            >
              <TrendingUp className="h-8 w-8 mb-2 group-hover:scale-110 transition-transform" />
              <span className="text-lg">Generate Report</span>
              <span className="text-xs font-normal opacity-80 mt-1">
                Export deal registration data
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
