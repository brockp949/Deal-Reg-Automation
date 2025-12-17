/**
 * SyncOverviewPanel Component
 *
 * Displays Google Sync configurations overview for the Import Data page.
 * Shows both Gmail and Drive sync configurations with status and quick actions.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Mail, HardDrive, Plus, Play, Clock, CheckCircle, AlertCircle, Loader2, Cloud, ArrowRight } from 'lucide-react';
import { gmailSyncAPI, driveSyncAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SyncConfig {
  id: string;
  name: string;
  service_type: 'gmail' | 'drive';
  enabled: boolean;
  sync_frequency: string;
  last_sync_at: string | null;
  next_sync_at: string | null;
}

interface SyncOverviewPanelProps {
  onTriggerSync?: (configId: string, serviceType: 'gmail' | 'drive') => void;
}

export function SyncOverviewPanel({ onTriggerSync }: SyncOverviewPanelProps) {
  const { data: gmailConfigsData, isLoading: gmailLoading } = useQuery({
    queryKey: ['gmail-sync-configs'],
    queryFn: async () => {
      const response = await gmailSyncAPI.getConfigs();
      return response.data;
    },
  });

  const { data: driveConfigsData, isLoading: driveLoading } = useQuery({
    queryKey: ['drive-sync-configs'],
    queryFn: async () => {
      const response = await driveSyncAPI.getConfigs();
      return response.data;
    },
  });

  const gmailConfigs: SyncConfig[] = gmailConfigsData?.success ? gmailConfigsData.data || [] : [];
  const driveConfigs: SyncConfig[] = driveConfigsData?.success ? driveConfigsData.data || [] : [];

  const isLoading = gmailLoading || driveLoading;
  const hasNoConfigs = gmailConfigs.length === 0 && driveConfigs.length === 0;

  const getRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
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

  const getFrequencyLabel = (freq: string) => {
    switch (freq) {
      case 'manual': return 'Manual';
      case 'hourly': return 'Hourly';
      case 'daily': return 'Daily';
      case 'weekly': return 'Weekly';
      default: return freq;
    }
  };

  const renderConfigCard = (config: SyncConfig) => {
    const isGmail = config.service_type === 'gmail';
    const Icon = isGmail ? Mail : HardDrive;
    const iconColor = isGmail ? 'text-red-500' : 'text-blue-500';

    return (
      <div
        key={config.id}
        className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon className={`h-5 w-5 ${iconColor}`} />
          <div>
            <p className="font-medium">{config.name}</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <Clock className="h-3 w-3" />
              <span>{getFrequencyLabel(config.sync_frequency)}</span>
              <span>•</span>
              <span>Last: {getRelativeTime(config.last_sync_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={config.enabled ? 'success' : 'secondary'}>
            {config.enabled ? 'Active' : 'Paused'}
          </Badge>
          {onTriggerSync && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onTriggerSync(config.id, config.service_type)}
            >
              <Play className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading sync configurations...</span>
      </div>
    );
  }

  if (hasNoConfigs) {
    return (
      <div className="text-center py-12">
        <Cloud className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No syncs configured</h3>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          Connect your Gmail or Google Drive to automatically import deals from emails and documents.
        </p>
        <Button asChild>
          <Link to="/settings/sync">
            <Plus className="mr-2 h-4 w-4" />
            Set Up Google Sync
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Active Sync Configurations</h3>
          <p className="text-sm text-muted-foreground">
            Your Gmail and Drive imports are configured below
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/sync">
            Manage Syncs
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gmail Syncs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-5 w-5 text-red-500" />
              Gmail Syncs ({gmailConfigs.length})
            </CardTitle>
            <CardDescription>
              Import deals from your email conversations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {gmailConfigs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No Gmail syncs configured</p>
                <Button asChild size="sm" variant="link" className="mt-2">
                  <Link to="/settings/sync">
                    <Plus className="mr-1 h-3 w-3" />
                    Add Gmail Sync
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {gmailConfigs.map(renderConfigCard)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Drive Syncs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-5 w-5 text-blue-500" />
              Drive Syncs ({driveConfigs.length})
            </CardTitle>
            <CardDescription>
              Import deals from Google Docs and files
            </CardDescription>
          </CardHeader>
          <CardContent>
            {driveConfigs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <HardDrive className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No Drive syncs configured</p>
                <Button asChild size="sm" variant="link" className="mt-2">
                  <Link to="/settings/sync">
                    <Plus className="mr-1 h-3 w-3" />
                    Add Drive Sync
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {driveConfigs.map(renderConfigCard)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Stats */}
      <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm">
              {gmailConfigs.filter(c => c.enabled).length + driveConfigs.filter(c => c.enabled).length} active
            </span>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm">
              {gmailConfigs.filter(c => !c.enabled).length + driveConfigs.filter(c => !c.enabled).length} paused
            </span>
          </div>
        </div>
        <Button asChild size="sm">
          <Link to="/settings/sync">
            <Plus className="mr-2 h-4 w-4" />
            New Sync
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default SyncOverviewPanel;
