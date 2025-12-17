/**
 * EditableDealsTable Component
 * Table with inline editing capabilities for vendor deals.
 * Click on a cell to edit, auto-saves on blur or Enter.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Pencil, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useInlineDealEdit } from '@/hooks/useVendorSpreadsheet';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DealStatusBadge } from '@/components/status';
import type { DealStatus } from '@/types';

// Define Deal interface locally
interface Deal {
  id: string;
  deal_name: string;
  deal_stage?: string;
  notes?: string;
  deal_value?: number;
  currency?: string;
  status: DealStatus;
  updated_at: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EditableDealsTableProps {
  deals: Deal[];
  vendorId: string;
  isLoading?: boolean;
}

interface EditingCell {
  dealId: string;
  field: string;
}

const DEAL_STAGES = [
  'Prospecting',
  'Qualification',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
  'unknown',
];

export function EditableDealsTable({
  deals,
  vendorId,
  isLoading = false,
}: EditableDealsTableProps) {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { updateDeal, isUpdating } = useInlineDealEdit({
    vendorId,
    onSuccess: () => {
      toast.success('Deal updated');
      setEditingCell(null);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update deal');
    },
  });

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const startEditing = useCallback((dealId: string, field: string, currentValue: string) => {
    setEditingCell({ dealId, field });
    setEditValue(currentValue || '');
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingCell) return;

    const { dealId, field } = editingCell;
    let valueToSave: unknown = editValue;

    // Handle special field types
    if (field === 'deal_value' || field === 'probability') {
      const numValue = parseFloat(editValue);
      if (isNaN(numValue)) {
        toast.error(`Invalid ${field === 'deal_value' ? 'value' : 'probability'}`);
        return;
      }
      valueToSave = numValue;
    }

    await updateDeal(dealId, field, valueToSave);
  }, [editingCell, editValue, updateDeal]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        saveEdit();
      } else if (e.key === 'Escape') {
        cancelEditing();
      }
    },
    [saveEdit, cancelEditing]
  );

  const handleBlur = useCallback(() => {
    // Small delay to allow clicks on save button
    setTimeout(() => {
      if (editingCell) {
        saveEdit();
      }
    }, 100);
  }, [editingCell, saveEdit]);

  const handleSelectChange = useCallback(
    async (dealId: string, field: string, value: string) => {
      await updateDeal(dealId, field, value);
    },
    [updateDeal]
  );

  const renderEditableCell = (
    deal: Deal,
    field: string,
    displayValue: string,
    type: 'text' | 'number' | 'select' = 'text'
  ) => {
    const isEditing = editingCell?.dealId === deal.id && editingCell?.field === field;

    if (isEditing && type === 'select') {
      return (
        <Select
          value={editValue}
          onValueChange={(value) => handleSelectChange(deal.id, field, value)}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEAL_STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {stage}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            type={type}
            className="h-8 w-full min-w-[80px]"
          />
          {isUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      );
    }

    return (
      <div
        className="flex items-center gap-1 group cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1"
        onClick={() => startEditing(deal.id, field, String(deal[field as keyof Deal] || ''))}
      >
        <span className="flex-1">{displayValue || 'N/A'}</span>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card className="p-12">
        <div className="flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  if (deals.length === 0) {
    return (
      <Card className="p-12">
        <div className="text-center text-muted-foreground">
          <p>No deals found for this vendor</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Deal Name</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right">Deal Value</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((deal) => {
            // Extract metadata fields if available
            const metadata = (deal as any).metadata || {};

            return (
              <TableRow key={deal.id}>
                <TableCell className="font-medium">
                  {renderEditableCell(deal, 'deal_name', deal.deal_name)}
                </TableCell>
                <TableCell>
                  {editingCell?.dealId === deal.id && editingCell?.field === 'deal_stage' ? (
                    <Select
                      value={editValue || deal.deal_stage || 'unknown'}
                      onValueChange={(value) => handleSelectChange(deal.id, 'deal_stage', value)}
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEAL_STAGES.map((stage) => (
                          <SelectItem key={stage} value={stage}>
                            {stage}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div
                      className="cursor-pointer hover:opacity-75 transition-opacity"
                      onClick={() => startEditing(deal.id, 'deal_stage', deal.deal_stage || '')}
                    >
                      {deal.deal_stage ? (
                        <Badge variant="outline">{deal.deal_stage}</Badge>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[200px]">
                  {renderEditableCell(
                    deal,
                    'notes',
                    deal.notes ? (deal.notes.length > 50 ? `${deal.notes.substring(0, 50)}...` : deal.notes) : ''
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {renderEditableCell(
                    deal,
                    'deal_value',
                    deal.deal_value ? formatCurrency(deal.deal_value, deal.currency) : '',
                    'number'
                  )}
                </TableCell>
                <TableCell>
                  <DealStatusBadge status={deal.status} />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {metadata.last_update || formatDate(deal.updated_at)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

export default EditableDealsTable;
