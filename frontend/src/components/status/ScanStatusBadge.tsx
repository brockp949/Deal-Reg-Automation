/**
 * Scan Status Badge
 * Displays security scan status with consistent styling.
 */

import { Badge } from '@/components/ui/badge';
import type { FileScanStatus } from '@/types';

interface ScanStatusBadgeProps {
  status: FileScanStatus | undefined;
  className?: string;
}

const statusConfig: Record<
  FileScanStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' }
> = {
  passed: { label: 'Scan Passed', variant: 'success' },
  failed: { label: 'Scan Failed', variant: 'destructive' },
  error: { label: 'Scan Error', variant: 'destructive' },
  pending: { label: 'Scan Pending', variant: 'warning' },
  not_scanned: { label: 'Not Scanned', variant: 'secondary' },
};

export function ScanStatusBadge({ status, className }: ScanStatusBadgeProps) {
  // Don't render if not scanned or undefined
  if (!status || status === 'not_scanned') {
    return null;
  }

  const config = statusConfig[status] || { label: 'Unknown', variant: 'secondary' as const };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

export default ScanStatusBadge;
