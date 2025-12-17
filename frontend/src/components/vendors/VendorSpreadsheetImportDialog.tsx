/**
 * @deprecated This component is deprecated and will be removed in a future version.
 * Use the UnifiedImportWizard component at /upload instead, which provides
 * a unified file import experience with intent-based routing for all file types
 * including vendor spreadsheets.
 *
 * Vendor Spreadsheet Import Dialog
 * 4-step dialog for importing vendor deal spreadsheets.
 * 1. Upload - Drag-and-drop Excel file
 * 2. Select Vendor - Confirm auto-detected vendor or create new
 * 3. Preview - Review parsed deals before import
 * 4. Complete - Show import summary
 */

import { useState, useCallback } from 'react';
import {
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  AlertCircle,
  Building2,
  Plus,
  ChevronRight,
  ChevronLeft,
  Circle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useVendorSpreadsheetImport,
  VendorSpreadsheetDeal,
} from '@/hooks/useVendorSpreadsheet';
import { formatCurrency } from '@/lib/utils';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface VendorSpreadsheetImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Step = 'upload' | 'select-vendor' | 'preview' | 'importing' | 'complete';

export function VendorSpreadsheetImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: VendorSpreadsheetImportDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [vendorSelection, setVendorSelection] = useState<'existing' | 'new'>('existing');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [newVendorName, setNewVendorName] = useState('');

  const {
    selectedFile,
    setSelectedFile,
    extractedVendorName,
    matchingVendors,
    previewData,
    isPreviewLoading,
    previewError,
    preview,
    importSpreadsheet,
    importResult,
    importError,
    uploadProgress,
    reset,
  } = useVendorSpreadsheetImport({
    onSuccess: (result) => {
      setStep('complete');
      toast.success(`Import complete: ${result.imported} deals imported`);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(error.message || 'Import failed');
    },
  });

  const resetDialog = useCallback(() => {
    setStep('upload');
    setVendorSelection('existing');
    setSelectedVendorId(null);
    setNewVendorName('');
    reset();
  }, [reset]);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        resetDialog();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, resetDialog]
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      const allowedTypes = ['.xlsx', '.xls', '.csv'];
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

      if (!allowedTypes.includes(ext)) {
        toast.error('Please upload an Excel (.xlsx, .xls) or CSV file');
        return;
      }

      setSelectedFile(file);
      const result = await preview(file);
      if (result) {
        // Pre-select matching vendor if found
        if (result.matchingVendors.length > 0) {
          setSelectedVendorId(result.matchingVendors[0].id);
          setVendorSelection('existing');
        } else if (result.extractedVendorName) {
          setNewVendorName(result.extractedVendorName);
          setVendorSelection('new');
        }
        setStep('select-vendor');
      }
    },
    [preview, setSelectedFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleProceedToPreview = useCallback(() => {
    setStep('preview');
  }, []);

  const handleBackToVendorSelect = useCallback(() => {
    setStep('select-vendor');
  }, []);

  const handleStartImport = useCallback(async () => {
    setStep('importing');

    const options = {
      vendorId: vendorSelection === 'existing' ? selectedVendorId || undefined : undefined,
      vendorName: vendorSelection === 'new' ? newVendorName : undefined,
      createNewVendor: vendorSelection === 'new',
    };

    await importSpreadsheet(options);
  }, [vendorSelection, selectedVendorId, newVendorName, importSpreadsheet]);

  const canProceedToPreview =
    (vendorSelection === 'existing' && selectedVendorId) ||
    (vendorSelection === 'new' && newVendorName.trim());

  const renderUploadStep = () => (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <div className="mb-2">
          <span className="font-medium">Drop your vendor spreadsheet here, or </span>
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
        <AlertTitle>Expected format</AlertTitle>
        <AlertDescription className="text-sm">
          File should be named like "VendorName - Deals.xlsx" with columns:
          Opportunity, Stage, Next steps, Last update, Yearly unit opportunity, Cost upside
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

  const renderVendorSelectStep = () => (
    <div className="space-y-4">
      <div className="p-4 bg-muted rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">{selectedFile?.name}</span>
        </div>
        {extractedVendorName && (
          <p className="text-sm text-muted-foreground">
            Detected vendor name: <span className="font-medium">{extractedVendorName}</span>
          </p>
        )}
      </div>

      <div className="space-y-4">
        <Label>Select or create the vendor for these deals:</Label>

        <div className="space-y-4">
          {matchingVendors.length > 0 && (
            <div className="space-y-2">
              <div
                className={`flex items-center space-x-2 cursor-pointer p-2 rounded-lg ${
                  vendorSelection === 'existing' ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
                onClick={() => setVendorSelection('existing')}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  vendorSelection === 'existing' ? 'border-primary' : 'border-muted-foreground'
                }`}>
                  {vendorSelection === 'existing' && (
                    <Circle className="w-2 h-2 fill-primary text-primary" />
                  )}
                </div>
                <Label className="cursor-pointer">Use existing vendor</Label>
              </div>

              {vendorSelection === 'existing' && (
                <div className="ml-6 space-y-2">
                  {matchingVendors.map((vendor) => (
                    <div
                      key={vendor.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedVendorId === vendor.id
                          ? 'border-primary bg-primary/5'
                          : 'border-muted hover:border-primary/50'
                      }`}
                      onClick={() => setSelectedVendorId(vendor.id)}
                    >
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="font-medium">{vendor.name}</p>
                        <Badge variant="outline" className="mt-1">
                          {vendor.matchType === 'exact' ? 'Exact match' : 'Similar match'}
                        </Badge>
                      </div>
                      {selectedVendorId === vendor.id && (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div
              className={`flex items-center space-x-2 cursor-pointer p-2 rounded-lg ${
                vendorSelection === 'new' ? 'bg-accent' : 'hover:bg-accent/50'
              }`}
              onClick={() => setVendorSelection('new')}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                vendorSelection === 'new' ? 'border-primary' : 'border-muted-foreground'
              }`}>
                {vendorSelection === 'new' && (
                  <Circle className="w-2 h-2 fill-primary text-primary" />
                )}
              </div>
              <Label className="cursor-pointer">Create new vendor</Label>
            </div>

            {vendorSelection === 'new' && (
              <div className="ml-6">
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-muted-foreground" />
                  <Input
                    value={newVendorName}
                    onChange={(e) => setNewVendorName(e.target.value)}
                    placeholder="Enter vendor name"
                    className="flex-1"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderPreviewStep = () => {
    if (!previewData) return null;

    const { preview: previewInfo } = previewData;

    return (
      <div className="space-y-4">
        <div className="p-3 bg-muted rounded-lg flex items-center justify-between">
          <div>
            <span className="font-medium">
              {vendorSelection === 'new' ? newVendorName : matchingVendors.find(v => v.id === selectedVendorId)?.name}
            </span>
            {vendorSelection === 'new' && (
              <Badge variant="secondary" className="ml-2">New vendor</Badge>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            {previewInfo.successCount} deals to import
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4">
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
        </div>

        {previewInfo.deals.length > 0 && (
          <div className="border rounded-lg max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Cost Upside</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewInfo.deals.slice(0, 10).map((deal: VendorSpreadsheetDeal, index: number) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{deal.opportunity}</TableCell>
                    <TableCell>
                      {deal.stage && <Badge variant="outline">{deal.stage}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {deal.parsedDealValue
                        ? formatCurrency(deal.parsedDealValue, deal.parsedCurrency)
                        : deal.costUpside || 'N/A'}
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

        {previewInfo.warnings && previewInfo.warnings.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Warnings</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm mt-2">
                {previewInfo.warnings.slice(0, 3).map((warning: string, index: number) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {previewInfo.errors.length > 0 && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Parsing Errors</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm mt-2">
                {previewInfo.errors.slice(0, 5).map((error: string, index: number) => (
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
          {uploadProgress > 0 ? 'Uploading file...' : 'Processing...'}
        </p>
      </div>

      <Progress value={uploadProgress > 0 ? uploadProgress : 50} />

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
    if (!importResult) return null;

    return (
      <div className="space-y-4 py-8">
        <div className="text-center mb-4">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-semibold">Import Complete!</h3>
          <p className="text-sm text-muted-foreground">
            Deals imported to <span className="font-medium">{importResult.vendorName}</span>
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{importResult.totalDeals}</div>
            <div className="text-sm text-muted-foreground">Total Rows</div>
          </div>
          <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{importResult.imported}</div>
            <div className="text-sm text-muted-foreground">Imported</div>
          </div>
          <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">{importResult.skipped}</div>
            <div className="text-sm text-muted-foreground">Skipped</div>
          </div>
        </div>

        {importResult.errors.length > 0 && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Import Errors ({importResult.errors.length})</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm mt-2">
                {importResult.errors.slice(0, 5).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
                {importResult.errors.length > 5 && (
                  <li>...and {importResult.errors.length - 5} more</li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  const getStepNumber = () => {
    switch (step) {
      case 'upload':
        return 1;
      case 'select-vendor':
        return 2;
      case 'preview':
        return 3;
      case 'importing':
      case 'complete':
        return 4;
      default:
        return 1;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Vendor Spreadsheet</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a vendor deals spreadsheet (e.g., "VendorName - Deals.xlsx")'}
            {step === 'select-vendor' && 'Confirm or select the vendor for these deals'}
            {step === 'preview' && 'Review the deals before importing'}
            {step === 'importing' && 'Please wait while your deals are imported'}
            {step === 'complete' && 'Your deals have been imported'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        {step !== 'importing' && step !== 'complete' && (
          <div className="flex items-center justify-between mb-4">
            {['Upload', 'Select Vendor', 'Preview'].map((label, index) => (
              <div key={label} className="flex items-center">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                    getStepNumber() > index + 1
                      ? 'bg-primary text-primary-foreground'
                      : getStepNumber() === index + 1
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {getStepNumber() > index + 1 ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className={`ml-2 text-sm ${getStepNumber() >= index + 1 ? '' : 'text-muted-foreground'}`}>
                  {label}
                </span>
                {index < 2 && <ChevronRight className="h-4 w-4 mx-2 text-muted-foreground" />}
              </div>
            ))}
          </div>
        )}

        {step === 'upload' && renderUploadStep()}
        {step === 'select-vendor' && renderVendorSelectStep()}
        {step === 'preview' && renderPreviewStep()}
        {step === 'importing' && renderImportingStep()}
        {step === 'complete' && renderCompleteStep()}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}

          {step === 'select-vendor' && (
            <>
              <Button variant="outline" onClick={resetDialog}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Choose Different File
              </Button>
              <Button onClick={handleProceedToPreview} disabled={!canProceedToPreview}>
                Continue
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}

          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={handleBackToVendorSelect}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
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
            <Button onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default VendorSpreadsheetImportDialog;
