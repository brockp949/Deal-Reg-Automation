/**
 * Agreement Upload Dialog
 * Dialog for uploading and processing vendor agreements.
 */

import { useState, useCallback } from 'react';
import {
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  AlertCircle,
  Calendar,
  Percent,
  FileCheck,
} from 'lucide-react';
import { useAgreements } from '@/hooks/useAgreements';
import { formatDate } from '@/lib/utils';
import {
  formatCommissionSummary,
  getAgreementTypeLabel,
  isAgreementExpiringSoon,
} from '@/types/agreement';
import type { Vendor } from '@/types';
import type { VendorAgreement } from '@/types/agreement';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

interface AgreementUploadDialogProps {
  vendor: Vendor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'upload' | 'processing' | 'complete';

export function AgreementUploadDialog({
  vendor,
  open,
  onOpenChange,
}: AgreementUploadDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<VendorAgreement | null>(null);

  const { uploadAgreement, isUploading, uploadProgress, uploadError } = useAgreements({
    vendorId: vendor.id,
  });

  const resetDialog = useCallback(() => {
    setStep('upload');
    setSelectedFile(null);
    setResult(null);
  }, []);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        resetDialog();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, resetDialog]
  );

  const handleFileSelect = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (ext !== '.pdf') {
      return;
    }

    setSelectedFile(file);
  }, []);

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

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setStep('processing');
    const uploaded = await uploadAgreement(selectedFile);

    if (uploaded) {
      setResult(uploaded);
      setStep('complete');
    } else {
      setStep('upload');
    }
  }, [selectedFile, uploadAgreement]);

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
        <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <div className="mb-2">
          <span className="font-medium">Drop your agreement PDF here, or </span>
          <label className="text-primary cursor-pointer hover:underline">
            browse
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileInputChange}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">Only PDF files are supported</p>
      </div>

      {selectedFile && (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <FileCheck className="h-8 w-8 text-green-500" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button onClick={handleUpload} disabled={isUploading}>
              <Upload className="mr-2 h-4 w-4" />
              Process Agreement
            </Button>
          </div>
        </Card>
      )}

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>What will be extracted</AlertTitle>
        <AlertDescription className="text-sm">
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Agreement type (manufacturing, distribution, etc.)</li>
            <li>Effective and expiration dates</li>
            <li>Commission rates (flat, tiered, or product-specific)</li>
            <li>Key terms (exclusivity, territory, payment terms, etc.)</li>
          </ul>
        </AlertDescription>
      </Alert>

      {uploadError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{uploadError.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );

  const renderProcessingStep = () => (
    <div className="space-y-4 py-8">
      <div className="text-center mb-4">
        <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
        <h3 className="text-lg font-semibold">Processing Agreement...</h3>
        <p className="text-sm text-muted-foreground">
          {uploadProgress < 100 ? 'Uploading...' : 'Extracting data with AI...'}
        </p>
      </div>

      <Progress value={uploadProgress} />

      <p className="text-center text-sm text-muted-foreground">
        This may take a minute for large documents
      </p>

      {uploadError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Processing Error</AlertTitle>
          <AlertDescription>{uploadError.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );

  const renderCompleteStep = () => {
    if (!result) return null;

    const confidencePercent = Math.round((result.extraction_confidence || 0) * 100);

    return (
      <div className="space-y-4 py-4">
        <div className="text-center mb-4">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-semibold">Agreement Processed!</h3>
          <p className="text-sm text-muted-foreground">
            Extraction confidence: {confidencePercent}%
          </p>
        </div>

        <Card className="p-4 space-y-4">
          {/* Agreement Type */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Agreement Type</span>
            <Badge variant="outline">
              {getAgreementTypeLabel(result.agreement_type)}
            </Badge>
          </div>

          {/* Dates */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Effective Date
            </span>
            <span>{result.effective_date ? formatDate(result.effective_date) : 'Not specified'}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Expiration Date
            </span>
            <div className="flex items-center gap-2">
              <span>
                {result.expiration_date ? formatDate(result.expiration_date) : 'Not specified'}
              </span>
              {result.expiration_date && isAgreementExpiringSoon(result) && (
                <Badge variant="warning">Expiring Soon</Badge>
              )}
            </div>
          </div>

          {/* Auto Renewal */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Auto Renewal</span>
            <Badge variant={result.auto_renewal ? 'success' : 'secondary'}>
              {result.auto_renewal ? 'Yes' : 'No'}
            </Badge>
          </div>

          {/* Commission */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Commission
            </span>
            <span className="font-medium">
              {formatCommissionSummary(result.commission_structure)}
            </span>
          </div>

          {/* Key Terms Summary */}
          {result.key_terms && Object.keys(result.key_terms).length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground mb-2">Key Terms Extracted</p>
              <div className="flex flex-wrap gap-1">
                {result.key_terms.exclusivity && (
                  <Badge variant="outline" className="text-xs">
                    {result.key_terms.exclusivity}
                  </Badge>
                )}
                {result.key_terms.territory && (
                  <Badge variant="outline" className="text-xs">
                    {result.key_terms.territory}
                  </Badge>
                )}
                {result.key_terms.payment_terms && (
                  <Badge variant="outline" className="text-xs">
                    {result.key_terms.payment_terms}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </Card>

        {confidencePercent < 70 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Low Confidence Extraction</AlertTitle>
            <AlertDescription>
              The AI extraction had low confidence. Please review and edit the extracted
              data as needed.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Agreement for {vendor.name}</DialogTitle>
          <DialogDescription>
            Upload a PDF agreement to extract commission rates and key terms.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && renderUploadStep()}
        {step === 'processing' && renderProcessingStep()}
        {step === 'complete' && renderCompleteStep()}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}

          {step === 'processing' && (
            <Button variant="outline" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </Button>
          )}

          {step === 'complete' && (
            <>
              <Button variant="outline" onClick={resetDialog}>
                Upload Another
              </Button>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AgreementUploadDialog;
