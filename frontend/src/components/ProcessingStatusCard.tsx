import { CheckCircle2, XCircle, Loader2, Activity } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useProcessingStatus } from '@/hooks/useProcessingStatus';
import { toast } from 'sonner';

interface ProcessingStatusCardProps {
  fileId: string;
  fileName: string;
  onComplete?: () => void;
}

export function ProcessingStatusCard({ fileId, fileName, onComplete }: ProcessingStatusCardProps) {
  const { status, isConnected, error } = useProcessingStatus(fileId, {
    onComplete: (finalStatus) => {
      toast.success('Processing completed!', {
        description: `Found ${finalStatus.dealsFound || 0} deals, ${finalStatus.vendorsFound || 0} vendors, ${finalStatus.contactsFound || 0} contacts`,
      });
      onComplete?.();
    },
    onError: (errorMessage) => {
      toast.error('Processing failed', {
        description: errorMessage,
      });
    },
  });

  const getStatusIcon = () => {
    if (!status) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;

    switch (status.status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'processing':
      case 'started':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = () => {
    if (!status) return 'bg-gray-100 text-gray-800';

    switch (status.status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'processing':
      case 'started':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <CardTitle className="text-base">{fileName}</CardTitle>
          </div>
          <Badge className={getStatusColor()} variant="secondary">
            {status?.status || 'initializing'}
          </Badge>
        </div>
        <CardDescription>
          {status?.message || 'Connecting to processing server...'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Bar */}
        {status && status.status !== 'failed' && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {status.stage || 'Processing'}
              </span>
              <span className="font-medium">{status.progress}%</span>
            </div>
            <Progress value={status.progress} className="h-2" />
          </div>
        )}

        {/* Connection Status */}
        {!isConnected && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Connecting to server...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <XCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        )}

        {/* Results Summary (on completion) */}
        {status?.status === 'completed' && (
          <div className="grid grid-cols-3 gap-4 pt-2 border-t">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {status.dealsFound || 0}
              </div>
              <div className="text-xs text-muted-foreground">Deals</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {status.vendorsFound || 0}
              </div>
              <div className="text-xs text-muted-foreground">Vendors</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {status.contactsFound || 0}
              </div>
              <div className="text-xs text-muted-foreground">Contacts</div>
            </div>
          </div>
        )}

        {/* Error Details */}
        {status?.status === 'failed' && status.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800">{status.error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
