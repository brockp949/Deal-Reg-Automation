/**
 * GoogleAccountConnect Component
 *
 * Allows users to connect and manage their Google accounts
 * for Gmail and Drive sync.
 */

import { useState, useEffect } from 'react';
import { googleAuthAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail, HardDrive, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';

interface GoogleAccount {
  id: string;
  account_email: string;
  service_type: 'gmail' | 'drive';
  scopes: string[];
  created_at: string;
  updated_at: string;
}

interface GoogleAuthStatus {
  gmailConfigured: boolean;
  driveConfigured: boolean;
}

interface GoogleAccountConnectProps {
  onAccountConnected?: (account: GoogleAccount) => void;
  onAccountDisconnected?: (accountId: string) => void;
}

export function GoogleAccountConnect({
  onAccountConnected: _onAccountConnected,
  onAccountDisconnected,
}: GoogleAccountConnectProps) {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<'gmail' | 'drive' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  // Load accounts and auth status
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statusRes, accountsRes] = await Promise.all([
        googleAuthAPI.getStatus(),
        googleAuthAPI.getAccounts(),
      ]);

      if (statusRes.data.success && accountsRes.data.success) {
        setAuthStatus(statusRes.data.data);
        setAccounts(accountsRes.data.data.accounts || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load Google account status');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (service: 'gmail' | 'drive') => {
    try {
      setConnecting(service);
      setError(null);

      const res = await googleAuthAPI.startAuthorization(service);
      if (!res.data.success) {
        throw new Error('Failed to start authorization');
      }
      const { authUrl } = res.data.data;

      // Open authorization URL in new window
      const authWindow = window.open(
        authUrl,
        'google-auth',
        'width=600,height=700,left=200,top=100'
      );

      // Poll for window close and reload accounts
      const checkWindow = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkWindow);
          setConnecting(null);
          loadData(); // Reload accounts after auth window closes
        }
      }, 500);

      // Set a timeout to stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(checkWindow);
        if (connecting === service) {
          setConnecting(null);
        }
      }, 5 * 60 * 1000);

    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to start ${service} authorization`);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    if (!confirm('Are you sure you want to disconnect this account? All sync configurations will be deleted.')) {
      return;
    }

    try {
      setError(null);
      await googleAuthAPI.disconnectAccount(accountId);
      setAccounts(accounts.filter(a => a.id !== accountId));
      onAccountDisconnected?.(accountId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to disconnect account');
    }
  };

  const handleRefresh = async (accountId: string) => {
    try {
      setRefreshing(accountId);
      setError(null);
      await googleAuthAPI.refreshToken(accountId);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to refresh token');
    } finally {
      setRefreshing(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading Google accounts...</span>
        </CardContent>
      </Card>
    );
  }

  const gmailAccounts = accounts.filter(a => a.service_type === 'gmail');
  const driveAccounts = accounts.filter(a => a.service_type === 'drive');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <img src="https://www.gstatic.com/images/branding/product/1x/googleg_16dp.png" alt="" className="h-5 w-5" />
          Google Account Connections
        </CardTitle>
        <CardDescription>
          Connect your Gmail and Google Drive accounts to import deals from emails and documents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Gmail Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-red-500" />
              <h3 className="font-medium">Gmail</h3>
              {authStatus?.gmailConfigured ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  Not configured
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => handleConnect('gmail')}
              disabled={connecting === 'gmail' || !authStatus?.gmailConfigured}
            >
              {connecting === 'gmail' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Connect Gmail
                </>
              )}
            </Button>
          </div>

          {gmailAccounts.length > 0 ? (
            <div className="space-y-2 pl-7">
              {gmailAccounts.map(account => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div>
                    <p className="font-medium">{account.account_email}</p>
                    <p className="text-sm text-muted-foreground">
                      Connected {new Date(account.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRefresh(account.id)}
                      disabled={refreshing === account.id}
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing === account.id ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDisconnect(account.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : authStatus?.gmailConfigured && (
            <p className="text-sm text-muted-foreground pl-7">
              No Gmail accounts connected. Click "Connect Gmail" to get started.
            </p>
          )}
        </div>

        {/* Drive Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-blue-500" />
              <h3 className="font-medium">Google Drive</h3>
              {authStatus?.driveConfigured ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  Not configured
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => handleConnect('drive')}
              disabled={connecting === 'drive' || !authStatus?.driveConfigured}
            >
              {connecting === 'drive' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Connect Drive
                </>
              )}
            </Button>
          </div>

          {driveAccounts.length > 0 ? (
            <div className="space-y-2 pl-7">
              {driveAccounts.map(account => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div>
                    <p className="font-medium">{account.account_email}</p>
                    <p className="text-sm text-muted-foreground">
                      Connected {new Date(account.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRefresh(account.id)}
                      disabled={refreshing === account.id}
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing === account.id ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDisconnect(account.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : authStatus?.driveConfigured && (
            <p className="text-sm text-muted-foreground pl-7">
              No Google Drive accounts connected. Click "Connect Drive" to get started.
            </p>
          )}
        </div>

        {/* Info about credentials */}
        {(!authStatus?.gmailConfigured || !authStatus?.driveConfigured) && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {!authStatus?.gmailConfigured && !authStatus?.driveConfigured ? (
                'Google API credentials are not configured. Contact your administrator to set up Gmail and Drive API credentials.'
              ) : !authStatus?.gmailConfigured ? (
                'Gmail API credentials are not configured. Contact your administrator to set up Gmail API credentials.'
              ) : (
                'Drive API credentials are not configured. Contact your administrator to set up Drive API credentials.'
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export default GoogleAccountConnect;
