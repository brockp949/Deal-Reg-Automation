/**
 * Deal Status Badge
 * Displays deal registration status with consistent styling.
 */

import { Badge } from '@/components/ui/badge';
import type { DealStatus } from '@/types';
import { cn } from '@/lib/utils';

interface DealStatusBadgeProps {
  status: DealStatus;
  className?: string;
  /** Use color classes instead of Badge variant for more customization */
  useColorClasses?: boolean;
}

const statusConfig: Record<
  DealStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
    colorClass: string;
  }
> = {
  registered: {
    label: 'Registered',
    variant: 'default',
    colorClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  approved: {
    label: 'Approved',
    variant: 'success',
    colorClass: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    colorClass: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  'closed-won': {
    label: 'Closed Won',
    variant: 'success',
    colorClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
  'closed-lost': {
    label: 'Closed Lost',
    variant: 'secondary',
    colorClass: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
};

export function DealStatusBadge({
  status,
  className,
  useColorClasses = false,
}: DealStatusBadgeProps) {
  const config = statusConfig[status] || {
    label: status,
    variant: 'secondary' as const,
    colorClass: 'bg-gray-100 text-gray-800',
  };

  if (useColorClasses) {
    return (
      <Badge variant="secondary" className={cn(config.colorClass, className)}>
        {config.label}
      </Badge>
    );
  }

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

/**
 * Get the color class for a deal status (for use in custom components)
 */
export function getDealStatusColorClass(status: DealStatus): string {
  return statusConfig[status]?.colorClass || 'bg-gray-100 text-gray-800';
}

export default DealStatusBadge;
