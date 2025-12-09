/**
 * Severity Indicator
 * Displays error severity with icon and badge.
 */

import { XCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

interface SeverityIndicatorProps {
  severity: ErrorSeverity;
  showBadge?: boolean;
  showIcon?: boolean;
  iconSize?: 'sm' | 'md' | 'lg';
  className?: string;
}

const severityConfig: Record<
  ErrorSeverity,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    iconClass: string;
    Icon: typeof XCircle;
  }
> = {
  critical: {
    label: 'Critical',
    variant: 'destructive',
    iconClass: 'text-red-600',
    Icon: XCircle,
  },
  error: {
    label: 'Error',
    variant: 'destructive',
    iconClass: 'text-red-500',
    Icon: AlertCircle,
  },
  warning: {
    label: 'Warning',
    variant: 'outline',
    iconClass: 'text-amber-500',
    Icon: AlertTriangle,
  },
  info: {
    label: 'Info',
    variant: 'secondary',
    iconClass: 'text-blue-500',
    Icon: Info,
  },
};

const iconSizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

export function SeverityIndicator({
  severity,
  showBadge = true,
  showIcon = true,
  iconSize = 'md',
  className,
}: SeverityIndicatorProps) {
  const config = severityConfig[severity] || severityConfig.info;
  const { Icon, iconClass, label, variant } = config;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showIcon && (
        <Icon
          className={cn(iconSizeClasses[iconSize], iconClass)}
          aria-label={label}
        />
      )}
      {showBadge && <Badge variant={variant}>{label}</Badge>}
    </div>
  );
}

/**
 * Severity Icon only (for use in lists)
 */
export function SeverityIcon({
  severity,
  size = 'md',
  className,
}: {
  severity: ErrorSeverity;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const config = severityConfig[severity] || severityConfig.info;
  const { Icon, iconClass, label } = config;

  return (
    <Icon
      className={cn(iconSizeClasses[size], iconClass, className)}
      aria-label={label}
    />
  );
}

/**
 * Severity Badge only
 */
export function SeverityBadge({
  severity,
  className,
}: {
  severity: ErrorSeverity;
  className?: string;
}) {
  const config = severityConfig[severity] || severityConfig.info;

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

export default SeverityIndicator;
