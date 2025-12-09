/**
 * Commission Display Component
 * Displays commission structure in a readable format.
 */

import { Percent } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { CommissionStructure } from '@/types/agreement';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface CommissionDisplayProps {
  structure: CommissionStructure | null;
  compact?: boolean;
}

export function CommissionDisplay({ structure, compact = false }: CommissionDisplayProps) {
  if (!structure || !structure.rates || structure.rates.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No commission structure specified
      </div>
    );
  }

  const { type, rates } = structure;

  // Compact view for cards/lists
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Percent className="h-4 w-4 text-muted-foreground" />
        {type === 'flat' && rates[0] && (
          <span className="font-medium">{rates[0].percentage}% flat rate</span>
        )}
        {type === 'tiered' && (
          <span className="font-medium">
            {Math.min(...rates.map((r) => r.percentage))}% -{' '}
            {Math.max(...rates.map((r) => r.percentage))}% ({rates.length} tiers)
          </span>
        )}
        {type === 'product' && (
          <span className="font-medium">{rates.length} product rates</span>
        )}
      </div>
    );
  }

  // Full view
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Percent className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Commission Structure</h3>
        </div>
        <Badge variant="outline">
          {type === 'flat' && 'Flat Rate'}
          {type === 'tiered' && 'Tiered'}
          {type === 'product' && 'Product-specific'}
        </Badge>
      </div>

      {type === 'flat' && rates[0] && (
        <div className="text-center py-4">
          <div className="text-4xl font-bold text-primary">{rates[0].percentage}%</div>
          {rates[0].description && (
            <p className="text-sm text-muted-foreground mt-1">{rates[0].description}</p>
          )}
        </div>
      )}

      {type === 'tiered' && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Volume Range</TableHead>
              <TableHead className="text-right">Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate, index) => (
              <TableRow key={index}>
                <TableCell>
                  {formatCurrency(rate.min || 0)} -{' '}
                  {rate.max !== null && rate.max !== undefined
                    ? formatCurrency(rate.max)
                    : 'Unlimited'}
                </TableCell>
                <TableCell className="text-right font-medium">{rate.percentage}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {type === 'product' && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate, index) => (
              <TableRow key={index}>
                <TableCell>{rate.product || 'Unknown'}</TableCell>
                <TableCell className="text-right font-medium">{rate.percentage}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export default CommissionDisplay;
