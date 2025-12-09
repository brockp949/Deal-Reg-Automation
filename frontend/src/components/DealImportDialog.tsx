/**
 * Deal Import Dialog
 * Dialog for uploading and importing deals for a specific vendor.
 */

import { useState, useCallback } from 'react';
import { Upload, Loader2, CheckCircle2, XCircle, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useDealImport } from '@/hooks/useDealImport';
import { formatCurrency } from '@/lib/utils';
import type { Vendor } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface DealImportDialogProps {
  vendor: Vendor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'upload' | 'preview' | 'importing' | 'complete';

export function DealImportDialog({ vendor, open, onOpenChange }: DealImportDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const {
    previewData,
    isPreviewLoading,
    previewError,
    preview,
    clearPreview,
    startImport,
    importProgress,
    importStatus,
    importError,
    uploadProgress,
  } = useDealImport({
    vendorId: vendor.id,
    onSuccess: (result) => {
      setStep('complete');
      toast.success(
        `Import complete: ${result.result?.imported.created} deals created, ${result.result?.imported.updated} updated`
      );
    },
    onError: (error) => {
      toast.error(error.message || 'Import failed');
    },
  });

  const resetDialog = useCallback(() => {
    setStep('upload');
    setSelectedFile(null);
    clearPreview();
  }, [clearPreview]);

  const handleClose = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      resetDialog();
    }
    onOpenChange(isOpen);
  }, [onOpenChange, resetDialog]);

  const handleFileSelect = useCallback(async (file: File) => {
    const allowedTypes = ['.xlsx', '.xls', '.csv'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!allowedTypes.includes(ext)) {
      toast.error('Please upload an Excel (.xlsx, .xls) or CSV file');
      return;
    }

    setSelectedFile(file);
    const result = await preview(file);
    if (result) {
      setStep('preview');
    }
  }, [preview]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleStartImport = useCallback(async () => {
    if (!selectedFile) return;
    setStep('importing');
    await startImport(selectedFile);
  }, [selectedFile, startImport]);

  const renderUploadStep = () => (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <div className="mb-2">
          <span className="font-medium">Drop your file here, or </span>
          <label className="text-primary cursor-pointer hover:underline">
            browse
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileInputChange}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          Supports Excel (.xlsx, .xls) and CSV files
        </p>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Expected columns</AlertTitle>
        <AlertDescription className="text-sm">
          Deal Name (required), Deal Value, Currency, Customer Name, Status, Registration Date, Expected Close Date, Probability, Deal Stage, Notes
        </AlertDescription>
      </Alert>

      {isPreviewLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span>Parsing file... {uploadProgress > 0 && `${uploadProgress}%`}</span>
        </div>
      )}

      {previewError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{previewError.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );

  const renderPreviewStep = () => {
    if (!previewData) return null;

    const { preview: previewInfo } = previewData;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{previewInfo.totalRows}</div>
            <div className="text-xs text-muted-foreground">Total Rows</div>
          </div>
          <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{previewInfo.successCount}</div>
            <div className="text-xs text-muted-foreground">Valid</div>
          </div>
          <div className="text-center p-3 bg-red-50 dark:bg-red-950 rounded-lg">
            <div className="text-2xl font-bold text-red-600">{previewInfo.errorCount}</div>
            <div className="text-xs text-muted-foreground">Errors</div>
          </div>
          <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">{previewInfo.duplicates}</div>
            <div className="text-xs text-muted-foreground">Duplicates</div>
          </div>
        </div>

        {previewInfo.deals.length > 0 && (
          <div className="border rounded-lg max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal Name</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewInfo.deals.map((deal, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{deal.deal_name}</TableCell>
                    <TableCell>{deal.customer_name || 'N/A'}</TableCell>
                    <TableCell className="text-right">
                      {deal.deal_value
                        ? formatCurrency(deal.deal_value, deal.currency)
                        : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{deal.status || 'registered'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {previewInfo.successCount > 10 && (
              <div className="p-2 text-center text-sm text-muted-foreground border-t">
                Showing first 10 of {previewInfo.successCount} deals
              </div>
            )}
          </div>
        )}

        {previewInfo.errors.length > 0 && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Parsing Errors</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm mt-2">
                {previewInfo.errors.slice(0, 5).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
                {previewInfo.errors.length > 5 && (
                  <li>...and {previewInfo.errors.length - 5} more</li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  const renderImportingStep = () => (
    <div className="space-y-4 py-8">
      <div className="text-center mb-4">
        <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
        <h3 className="text-lg font-semibold">Importing Deals...</h3>
        <p className="text-sm text-muted-foreground">
          {importStatus?.state === 'active' ? 'Processing...' : 'Uploading...'}
        </p>
      </div>

      <Progress value={uploadProgress > 0 && importProgress === 0 ? uploadProgress : importProgress} />

      <p className="text-center text-sm text-muted-foreground">
        {uploadProgress > 0 && importProgress === 0
          ? `Uploading: ${uploadProgress}%`
          : `Progress: ${importProgress}%`}
      </p>

      {importError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Import Error</AlertTitle>
          <AlertDescription>{importError.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );

  const renderCompleteStep = () => {
    if (!importStatus?.result) return null;

    const { imported } = importStatus.result;

    return (
      <div className="space-y-4 py-8">
        <div className="text-center mb-4">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-semibold">Import Complete!</h3>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{imported.created}</div>
            <div className="text-sm text-muted-foreground">Deals Created</div>
          </div>
          <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{imported.updated}</div>
            <div className="text-sm text-muted-foreground">Deals Updated</div>
          </div>
          <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">{imported.skipped}</div>
            <div className="text-sm text-muted-foreground">Skipped</div>
          </div>
        </div>

        {imported.errors.length > 0 && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Import Errors ({imported.errors.length})</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm mt-2">
                {imported.errors.slice(0, 5).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
                {imported.errors.length > 5 && (
                  <li>...and {imported.errors.length - 5} more</li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Deals for {vendor.name}</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file to bulk import deals for this vendor.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && renderUploadStep()}
        {step === 'preview' && renderPreviewStep()}
        {step === 'importing' && renderImportingStep()}
        {step === 'complete' && renderCompleteStep()}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}

          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={resetDialog}>
                Choose Different File
              </Button>
              <Button
                onClick={handleStartImport}
                disabled={!previewData || previewData.preview.successCount === 0}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import {previewData?.preview.successCount || 0} Deals
              </Button>
            </>
          )}

          {step === 'importing' && (
            <Button variant="outline" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Importing...
            </Button>
          )}

          {step === 'complete' && (
            <Button onClick={() => handleClose(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DealImportDialog;
