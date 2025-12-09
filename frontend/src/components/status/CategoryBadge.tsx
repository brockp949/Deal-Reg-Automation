/**
 * Category Badge
 * Displays error category with consistent styling.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type ErrorCategory = 'parsing' | 'extraction' | 'validation' | 'processing' | 'integration' | string;

interface CategoryBadgeProps {
  category: ErrorCategory;
  className?: string;
}

const categoryConfig: Record<string, string> = {
  parsing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  extraction: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  validation: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  processing: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  integration: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
};

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const colorClass = categoryConfig[category.toLowerCase()] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';

  return (
    <Badge className={cn(colorClass, className)}>
      {category}
    </Badge>
  );
}

export default CategoryBadge;
