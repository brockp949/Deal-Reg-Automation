import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { fileAPI } from '@/lib/api';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function ClearDataDialog() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const queryClient = useQueryClient();

  const clearMutation = useMutation({
    mutationFn: async () => {
      return await fileAPI.clearAll();
    },
    onSuccess: (response) => {
      const stats = response.data?.success ? (response.data as any).data : undefined;
      toast.success('All data cleared successfully', {
        description: stats
          ? `Deleted: ${stats.vendors} vendors, ${stats.deals} deals, ${stats.contacts} contacts, ${stats.sourceFiles} files`
          : 'All data has been removed from the system',
      });
      setOpen(false);
      setConfirmText('');

      // Invalidate all queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to clear data');
    },
  });

  const handleClear = () => {
    if (confirmText.toLowerCase() !== 'delete all') {
      toast.error('Please type "DELETE ALL" to confirm');
      return;
    }
    clearMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="gap-2">
          <Trash2 className="h-4 w-4" />
          Clear All Data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <DialogTitle>Clear All Data</DialogTitle>
          </div>
          <DialogDescription className="space-y-3 pt-4">
            <p className="font-semibold text-destructive">
              Warning: This action cannot be undone!
            </p>
            <p>
              This will permanently delete:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>All vendors</li>
              <li>All deals</li>
              <li>All contacts</li>
              <li>All uploaded files and their data</li>
            </ul>
            <p className="text-sm">
              Type <span className="font-mono font-bold">DELETE ALL</span> to confirm:
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE ALL to confirm"
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-destructive"
            disabled={clearMutation.isPending}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              setConfirmText('');
            }}
            disabled={clearMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleClear}
            disabled={clearMutation.isPending || confirmText.toLowerCase() !== 'delete all'}
          >
            {clearMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Clearing...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear All Data
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
