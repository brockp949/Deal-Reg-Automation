/**
 * Processing Status Badge
 * Displays file processing status with consistent styling.
 */

import { Badge } from '@/components/ui/badge';
import type { ProcessingStatus } from '@/types';

interface ProcessingStatusBadgeProps {
  status: ProcessingStatus;
  className?: string;
}

const statusConfig: Record<
  ProcessingStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' }
> = {
  completed: { label: 'Completed', variant: 'success' },
  processing: { label: 'Processing', variant: 'warning' },
  failed: { label: 'Failed', variant: 'destructive' },
  blocked: { label: 'Blocked', variant: 'outline' },
  pending: { label: 'Pending', variant: 'secondary' },
};

export function ProcessingStatusBadge({ status, className }: ProcessingStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

export default ProcessingStatusBadge;
