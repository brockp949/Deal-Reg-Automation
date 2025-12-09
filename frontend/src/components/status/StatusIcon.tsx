/**
 * Status Icon
 * Displays status icons for file processing.
 */

import { CheckCircle, AlertCircle, Loader2, File } from 'lucide-react';
import type { ProcessingStatus } from '@/types';
import { cn } from '@/lib/utils';

interface StatusIconProps {
  status: ProcessingStatus;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

export function StatusIcon({ status, size = 'md', className }: StatusIconProps) {
  const sizeClass = sizeClasses[size];

  switch (status) {
    case 'completed':
      return (
        <CheckCircle
          className={cn(sizeClass, 'text-green-500', className)}
          aria-label="Completed"
        />
      );
    case 'processing':
      return (
        <Loader2
          className={cn(sizeClass, 'text-amber-500 animate-spin', className)}
          aria-label="Processing"
        />
      );
    case 'failed':
      return (
        <AlertCircle
          className={cn(sizeClass, 'text-red-500', className)}
          aria-label="Failed"
        />
      );
    case 'blocked':
      return (
        <AlertCircle
          className={cn(sizeClass, 'text-amber-500', className)}
          aria-label="Blocked"
        />
      );
    case 'pending':
    default:
      return (
        <File
          className={cn(sizeClass, 'text-muted-foreground', className)}
          aria-label="Pending"
        />
      );
  }
}

export default StatusIcon;
