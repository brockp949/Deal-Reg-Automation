/**
 * SyncSettingsPage
 *
 * Page for managing Gmail and Google Drive sync configurations.
 */

import { useState, useEffect } from 'react';
import { googleAuthAPI, gmailSyncAPI, driveSyncAPI } from '@/lib/api';
import { GoogleAccountConnect } from '@/components/sync/GoogleAccountConnect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Mail, HardDrive, Plus, Play, Trash2, Clock, AlertCircle } from 'lucide-react';

interface GoogleAccount {
  id: string;
  account_email: string;
  service_type: 'gmail' | 'drive';
}

interface SyncConfig {
  id: string;
  token_id: string;
  name: string;
  service_type: 'gmail' | 'drive';
  enabled: boolean;
  account_email?: string;
  sync_frequency: string;
  last_sync_at?: string;
  next_sync_at?: string;
  gmail_label_ids?: string[];
  gmail_date_from?: string;
  gmail_date_to?: string;
  drive_folder_id?: string;
  drive_folder_url?: string;
  drive_include_subfolders?: boolean;
}

export function SyncSettingsPage() {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [gmailConfigs, setGmailConfigs] = useState<SyncConfig[]>([]);
  const [driveConfigs, setDriveConfigs] = useState<SyncConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [showNewGmailDialog, setShowNewGmailDialog] = useState(false);
  const [showNewDriveDialog, setShowNewDriveDialog] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [accountsRes, gmailRes, driveRes] = await Promise.all([
        googleAuthAPI.getAccounts(),
        gmailSyncAPI.getConfigs(),
        driveSyncAPI.getConfigs(),
      ]);

      if (accountsRes.data.success) {
        setAccounts(accountsRes.data.data.accounts || []);
      }
      if (gmailRes.data.success) {
        setGmailConfigs(gmailRes.data.data || []);
      }
      if (driveRes.data.success) {
        setDriveConfigs(driveRes.data.data || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load sync settings');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerSync = async (configId: string, type: 'gmail' | 'drive') => {
    try {
      setActionInProgress(configId);
      if (type === 'gmail') {
        await gmailSyncAPI.triggerSync(configId);
      } else {
        await driveSyncAPI.triggerSync(configId);
      }
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to trigger sync');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleToggleEnabled = async (config: SyncConfig) => {
    try {
      setActionInProgress(config.id);
      if (config.service_type === 'gmail') {
        await gmailSyncAPI.updateConfig(config.id, { enabled: !config.enabled });
      } else {
        await driveSyncAPI.updateConfig(config.id, { enabled: !config.enabled });
      }
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update sync config');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteConfig = async (configId: string, type: 'gmail' | 'drive') => {
    if (!confirm('Are you sure you want to delete this sync configuration?')) return;

    try {
      setActionInProgress(configId);
      if (type === 'gmail') {
        await gmailSyncAPI.deleteConfig(configId);
      } else {
        await driveSyncAPI.deleteConfig(configId);
      }
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete sync config');
    } finally {
      setActionInProgress(null);
    }
  };

  const gmailAccounts = accounts.filter(a => a.service_type === 'gmail');
  const driveAccounts = accounts.filter(a => a.service_type === 'drive');

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-lg text-muted-foreground">Loading sync settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Google Sync Settings</h1>
        <p className="text-muted-foreground mt-1">
          Import deals from Gmail emails and Google Drive documents.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Connected Accounts */}
      <GoogleAccountConnect
        onAccountConnected={() => loadData()}
        onAccountDisconnected={() => loadData()}
      />

      {/* Sync Configurations */}
      <Tabs defaultValue="gmail" className="space-y-4">
        <TabsList>
          <TabsTrigger value="gmail" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Gmail Syncs ({gmailConfigs.length})
          </TabsTrigger>
          <TabsTrigger value="drive" className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Drive Syncs ({driveConfigs.length})
          </TabsTrigger>
        </TabsList>

        {/* Gmail Tab */}
        <TabsContent value="gmail" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Gmail Sync Configurations</h2>
            <NewGmailConfigDialog
              open={showNewGmailDialog}
              onOpenChange={setShowNewGmailDialog}
              accounts={gmailAccounts}
              onCreated={() => {
                setShowNewGmailDialog(false);
                loadData();
              }}
            />
          </div>

          {gmailConfigs.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Gmail Syncs Configured</h3>
                <p className="text-muted-foreground mb-4">
                  Create a sync configuration to start importing deals from Gmail.
                </p>
                {gmailAccounts.length > 0 ? (
                  <Button onClick={() => setShowNewGmailDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Gmail Sync
                  </Button>
                ) : (
                  <p className="text-sm text-yellow-600">
                    Connect a Gmail account above to create sync configurations.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {gmailConfigs.map(config => (
                <SyncConfigCard
                  key={config.id}
                  config={config}
                  onTrigger={() => handleTriggerSync(config.id, 'gmail')}
                  onToggle={() => handleToggleEnabled(config)}
                  onDelete={() => handleDeleteConfig(config.id, 'gmail')}
                  isLoading={actionInProgress === config.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Drive Tab */}
        <TabsContent value="drive" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Drive Sync Configurations</h2>
            <NewDriveConfigDialog
              open={showNewDriveDialog}
              onOpenChange={setShowNewDriveDialog}
              accounts={driveAccounts}
              onCreated={() => {
                setShowNewDriveDialog(false);
                loadData();
              }}
            />
          </div>

          {driveConfigs.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <HardDrive className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Drive Syncs Configured</h3>
                <p className="text-muted-foreground mb-4">
                  Create a sync configuration to start importing deals from Google Drive.
                </p>
                {driveAccounts.length > 0 ? (
                  <Button onClick={() => setShowNewDriveDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Drive Sync
                  </Button>
                ) : (
                  <p className="text-sm text-yellow-600">
                    Connect a Google Drive account above to create sync configurations.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {driveConfigs.map(config => (
                <SyncConfigCard
                  key={config.id}
                  config={config}
                  onTrigger={() => handleTriggerSync(config.id, 'drive')}
                  onToggle={() => handleToggleEnabled(config)}
                  onDelete={() => handleDeleteConfig(config.id, 'drive')}
                  isLoading={actionInProgress === config.id}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Sync Config Card Component
function SyncConfigCard({
  config,
  onTrigger,
  onToggle,
  onDelete,
  isLoading,
}: {
  config: SyncConfig;
  onTrigger: () => void;
  onToggle: () => void;
  onDelete: () => void;
  isLoading: boolean;
}) {
  const frequencyLabels: Record<string, string> = {
    manual: 'Manual',
    hourly: 'Every hour',
    daily: 'Daily',
    weekly: 'Weekly',
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {config.service_type === 'gmail' ? (
                <Mail className="h-5 w-5 text-red-500" />
              ) : (
                <HardDrive className="h-5 w-5 text-blue-500" />
              )}
              {config.name}
            </CardTitle>
            <CardDescription className="mt-1">
              {config.account_email}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={config.enabled ? 'default' : 'secondary'}>
              {config.enabled ? 'Active' : 'Paused'}
            </Badge>
            <Badge variant="outline">
              <Clock className="h-3 w-3 mr-1" />
              {frequencyLabels[config.sync_frequency] || config.sync_frequency}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {config.last_sync_at && (
            <span>
              Last synced: {new Date(config.last_sync_at).toLocaleString()}
            </span>
          )}
          {config.next_sync_at && config.sync_frequency !== 'manual' && (
            <span>
              Next sync: {new Date(config.next_sync_at).toLocaleString()}
            </span>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <div className="flex items-center gap-2">
          <Switch
            checked={config.enabled}
            onCheckedChange={onToggle}
            disabled={isLoading}
          />
          <span className="text-sm">
            {config.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onTrigger}
            disabled={isLoading || !config.enabled}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Sync Now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isLoading}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// New Gmail Config Dialog
function NewGmailConfigDialog({
  open,
  onOpenChange,
  accounts,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: GoogleAccount[];
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [frequency, setFrequency] = useState('manual');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name || !tokenId) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setCreating(true);
      setError(null);
      await gmailSyncAPI.createConfig({
        tokenId,
        name,
        syncFrequency: frequency,
      });
      setName('');
      setTokenId('');
      setFrequency('manual');
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create sync configuration');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button disabled={accounts.length === 0}>
          <Plus className="h-4 w-4 mr-2" />
          New Gmail Sync
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Gmail Sync Configuration</DialogTitle>
          <DialogDescription>
            Set up a new sync to import deal information from Gmail.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Configuration Name</Label>
            <Input
              id="name"
              placeholder="e.g., Work Gmail - Deal Emails"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account">Gmail Account</Label>
            <Select value={tokenId} onValueChange={setTokenId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map(account => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.account_email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="frequency">Sync Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (sync on demand)</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Sync'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// New Drive Config Dialog
function NewDriveConfigDialog({
  open,
  onOpenChange,
  accounts,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: GoogleAccount[];
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [folderUrl, setFolderUrl] = useState('');
  const [frequency, setFrequency] = useState('manual');
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name || !tokenId || !folderUrl) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setCreating(true);
      setError(null);
      await driveSyncAPI.createConfig({
        tokenId,
        name,
        folderUrl,
        includeSubfolders,
        syncFrequency: frequency,
      });
      setName('');
      setTokenId('');
      setFolderUrl('');
      setFrequency('manual');
      setIncludeSubfolders(true);
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create sync configuration');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button disabled={accounts.length === 0}>
          <Plus className="h-4 w-4 mr-2" />
          New Drive Sync
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Drive Sync Configuration</DialogTitle>
          <DialogDescription>
            Set up a new sync to import deal information from Google Drive documents.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Configuration Name</Label>
            <Input
              id="name"
              placeholder="e.g., Sales Meeting Notes"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account">Google Drive Account</Label>
            <Select value={tokenId} onValueChange={setTokenId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map(account => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.account_email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="folderUrl">Folder URL</Label>
            <Input
              id="folderUrl"
              placeholder="https://drive.google.com/drive/folders/..."
              value={folderUrl}
              onChange={(e) => setFolderUrl(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Paste the URL of the Google Drive folder containing your documents.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="subfolders"
              checked={includeSubfolders}
              onCheckedChange={setIncludeSubfolders}
            />
            <Label htmlFor="subfolders">Include subfolders</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="frequency">Sync Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (sync on demand)</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Sync'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SyncSettingsPage;
