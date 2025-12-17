/**
 * UnifiedImportWizard
 *
 * A simplified, unified file import wizard that handles all file types
 * (vendors, deals, emails, transcripts) with intent-based routing
 * and real-time progress tracking via SSE.
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  File,
  Loader2,
  X,
  CheckCircle,
  AlertCircle,
  Building2,
  Briefcase,
  Mail,
  FileText,
  FileSpreadsheet,
  Sparkles,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { formatFileSize } from '@/lib/utils';
import {
  useUnifiedImport,
  getIntentDisplayName,
  type ImportFile,
} from '@/hooks/useUnifiedImport';
import type { FileIntent } from '@/lib/api';

// Icon mapping for intents
const intentIcons: Record<FileIntent, React.ReactNode> = {
  vendor: <Building2 className="w-4 h-4" />,
  deal: <Briefcase className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
  transcript: <FileText className="w-4 h-4" />,
  vendor_spreadsheet: <FileSpreadsheet className="w-4 h-4" />,
  auto: <Sparkles className="w-4 h-4" />,
};

// Status colors and icons
const statusConfig: Record<
  ImportFile['status'],
  { color: string; bgColor: string; icon: React.ReactNode }
> = {
  pending: {
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    icon: <File className="w-4 h-4" />,
  },
  uploading: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
  },
  processing: {
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 dark:bg-amber-950',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
  },
  completed: {
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950',
    icon: <CheckCircle className="w-4 h-4" />,
  },
  failed: {
    color: 'text-red-600',
    bgColor: 'bg-red-50 dark:bg-red-950',
    icon: <AlertCircle className="w-4 h-4" />,
  },
};

// All accepted file types
const ACCEPTED_FILE_TYPES = {
  'text/csv': ['.csv'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/mbox': ['.mbox'],
  'text/plain': ['.txt'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

export default function UnifiedImportWizard() {
  const navigate = useNavigate();
  const {
    files,
    isUploading,
    summary,
    addFiles,
    removeFile,
    updateIntent,
    uploadAll,
    clearAll,
    retryFile,
  } = useUnifiedImport();

  const [showCompleted, setShowCompleted] = useState(true);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      // Handle rejected files
      rejectedFiles.forEach((rejection) => {
        const fileName = rejection.file.name;
        const error = rejection.errors[0];
        if (error.code === 'file-too-large') {
          toast.error(`${fileName} is too large. Maximum file size is 5GB.`);
        } else {
          toast.error(`${fileName}: ${error.message}`);
        }
      });

      if (acceptedFiles.length > 0) {
        addFiles(acceptedFiles);
      }
    },
    [addFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: 5 * 1024 * 1024 * 1024, // 5GB
  });

  // Filter files by completion status if needed
  const visibleFiles = showCompleted
    ? files
    : files.filter((f) => f.status !== 'completed');

  const hasAnyFiles = files.length > 0;
  const hasPendingFiles = summary.pending > 0;
  const hasActiveProcessing = summary.uploading > 0 || summary.processing > 0;
  const allCompleted =
    files.length > 0 && summary.completed === files.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Import Files</h1>
        <p className="text-muted-foreground mt-2">
          Upload vendor lists, deal spreadsheets, email archives, or meeting transcripts.
          Files are automatically categorized for processing.
        </p>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Area & File List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dropzone */}
          <Card className="p-6">
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
              `}
            >
              <input {...getInputProps()} />
              <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
              {isDragActive ? (
                <p className="text-lg font-medium">Drop files here...</p>
              ) : (
                <>
                  <p className="text-lg font-medium mb-1">
                    Drag & drop files here, or click to select
                  </p>
                  <p className="text-sm text-muted-foreground">
                    CSV, Excel, MBOX, PDF, TXT, DOCX (max 5GB)
                  </p>
                </>
              )}
            </div>
          </Card>

          {/* File List */}
          {hasAnyFiles && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">
                  Files ({files.length})
                  {summary.completed > 0 && (
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      {summary.completed} completed
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {summary.completed > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCompleted(!showCompleted)}
                    >
                      {showCompleted ? 'Hide' : 'Show'} Completed
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    disabled={hasActiveProcessing}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Clear All
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {visibleFiles.map((importFile) => (
                  <FileRow
                    key={importFile.id}
                    importFile={importFile}
                    onRemove={() => removeFile(importFile.id)}
                    onIntentChange={(intent) => updateIntent(importFile.id, intent)}
                    onRetry={() => retryFile(importFile.id)}
                    disabled={isUploading}
                  />
                ))}
              </div>

              {/* Upload Button */}
              {hasPendingFiles && (
                <Button
                  onClick={uploadAll}
                  disabled={isUploading}
                  className="w-full mt-4"
                  size="lg"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-5 w-5" />
                      Import {summary.pending} File{summary.pending > 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              )}
            </Card>
          )}

          {/* Completion Summary */}
          {allCompleted && (
            <Card className="p-6 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
              <div className="flex items-start gap-4">
                <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-green-900 dark:text-green-100">
                    Import Complete!
                  </h3>
                  <div className="mt-2 text-sm text-green-800 dark:text-green-200 space-y-1">
                    {summary.totalVendors > 0 && (
                      <p>{summary.totalVendors} vendors created</p>
                    )}
                    {summary.totalDeals > 0 && (
                      <p>{summary.totalDeals} deals imported</p>
                    )}
                    {summary.totalContacts > 0 && (
                      <p>{summary.totalContacts} contacts added</p>
                    )}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/deals')}
                    >
                      View Deals
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/vendors')}
                    >
                      View Vendors
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearAll}>
                      Import More
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Sidebar - Processing Summary */}
        <div className="lg:col-span-1">
          <Card className="p-6 sticky top-6">
            <h3 className="font-semibold mb-4">Processing Summary</h3>

            {!hasAnyFiles ? (
              <p className="text-sm text-muted-foreground">
                No files added yet. Drag and drop files or click to select.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Status Counts */}
                <div className="grid grid-cols-2 gap-2">
                  <StatusBadge
                    label="Pending"
                    count={summary.pending}
                    variant="secondary"
                  />
                  <StatusBadge
                    label="Uploading"
                    count={summary.uploading}
                    variant="blue"
                  />
                  <StatusBadge
                    label="Processing"
                    count={summary.processing}
                    variant="amber"
                  />
                  <StatusBadge
                    label="Completed"
                    count={summary.completed}
                    variant="green"
                  />
                  {summary.failed > 0 && (
                    <StatusBadge
                      label="Failed"
                      count={summary.failed}
                      variant="red"
                    />
                  )}
                </div>

                {/* Results Summary */}
                {(summary.totalVendors > 0 ||
                  summary.totalDeals > 0 ||
                  summary.totalContacts > 0) && (
                  <div className="pt-4 border-t space-y-2">
                    <h4 className="text-sm font-medium">Created</h4>
                    {summary.totalVendors > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Vendors</span>
                        <span className="font-medium">{summary.totalVendors}</span>
                      </div>
                    )}
                    {summary.totalDeals > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Deals</span>
                        <span className="font-medium">{summary.totalDeals}</span>
                      </div>
                    )}
                    {summary.totalContacts > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Contacts</span>
                        <span className="font-medium">{summary.totalContacts}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Help Section */}
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-sm font-medium mb-2">Supported File Types</h4>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Building2 className="w-3 h-3" />
                  <span>CSV/Excel: Vendor lists</span>
                </div>
                <div className="flex items-center gap-2">
                  <Briefcase className="w-3 h-3" />
                  <span>CSV/Excel: Deal registrations</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-3 h-3" />
                  <span>"Vendor - Deals.xlsx": Combined format</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-3 h-3" />
                  <span>MBOX: Email archives</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3" />
                  <span>TXT/PDF/DOCX: Transcripts</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// File row component
interface FileRowProps {
  importFile: ImportFile;
  onRemove: () => void;
  onIntentChange: (intent: FileIntent) => void;
  onRetry: () => void;
  disabled: boolean;
}

function FileRow({
  importFile,
  onRemove,
  onIntentChange,
  onRetry,
  disabled,
}: FileRowProps) {
  const { status, uploadProgress, processingProgress, error, result, intent } =
    importFile;
  const config = statusConfig[status];

  // Calculate overall progress
  const overallProgress =
    status === 'uploading'
      ? uploadProgress * 0.3
      : status === 'processing'
        ? 30 + processingProgress * 0.7
        : status === 'completed'
          ? 100
          : 0;

  return (
    <div className={`rounded-lg p-3 ${config.bgColor}`}>
      <div className="flex items-start gap-3">
        {/* Status Icon */}
        <div className={`flex-shrink-0 mt-1 ${config.color}`}>{config.icon}</div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate text-sm">{importFile.file.name}</p>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatFileSize(importFile.file.size)}
            </span>
          </div>

          {/* Intent Selector (only for pending files) */}
          {status === 'pending' && (
            <div className="mt-2">
              <Select
                value={intent}
                onValueChange={(value) => onIntentChange(value as FileIntent)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-48 text-xs">
                  <div className="flex items-center gap-2">
                    {intentIcons[intent]}
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    <div className="flex items-center gap-2">
                      {intentIcons.auto}
                      Auto-detect
                    </div>
                  </SelectItem>
                  <SelectItem value="vendor">
                    <div className="flex items-center gap-2">
                      {intentIcons.vendor}
                      Vendor List
                    </div>
                  </SelectItem>
                  <SelectItem value="deal">
                    <div className="flex items-center gap-2">
                      {intentIcons.deal}
                      Deal List
                    </div>
                  </SelectItem>
                  <SelectItem value="vendor_spreadsheet">
                    <div className="flex items-center gap-2">
                      {intentIcons.vendor_spreadsheet}
                      Vendor Deals Spreadsheet
                    </div>
                  </SelectItem>
                  <SelectItem value="email">
                    <div className="flex items-center gap-2">
                      {intentIcons.email}
                      Email Archive
                    </div>
                  </SelectItem>
                  <SelectItem value="transcript">
                    <div className="flex items-center gap-2">
                      {intentIcons.transcript}
                      Transcript
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Progress Bar */}
          {(status === 'uploading' || status === 'processing') && (
            <div className="mt-2">
              <Progress value={overallProgress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {status === 'uploading'
                  ? `Uploading... ${uploadProgress}%`
                  : `Processing... ${processingProgress}%`}
              </p>
            </div>
          )}

          {/* Error Message */}
          {status === 'failed' && error && (
            <p className="text-xs text-red-600 mt-1">{error}</p>
          )}

          {/* Success Results */}
          {status === 'completed' && result && (
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {result.vendorsCreated > 0 && (
                <span>{result.vendorsCreated} vendors</span>
              )}
              {result.dealsCreated > 0 && (
                <span>{result.dealsCreated} deals</span>
              )}
              {result.contactsCreated > 0 && (
                <span>{result.contactsCreated} contacts</span>
              )}
              {result.warnings.length > 0 && (
                <Badge variant="outline" className="text-amber-600">
                  {result.warnings.length} warnings
                </Badge>
              )}
            </div>
          )}

          {/* Non-pending intent display */}
          {status !== 'pending' && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
              {intentIcons[intent]}
              <span>{getIntentDisplayName(intent)}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0">
          {status === 'pending' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRemove}
              disabled={disabled}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {status === 'failed' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRetry}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          {status === 'completed' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Status badge component
interface StatusBadgeProps {
  label: string;
  count: number;
  variant: 'secondary' | 'blue' | 'amber' | 'green' | 'red';
}

function StatusBadge({ label, count, variant }: StatusBadgeProps) {
  if (count === 0) return null;

  const colors = {
    secondary: 'bg-muted text-muted-foreground',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  return (
    <div
      className={`px-2 py-1 rounded text-xs font-medium text-center ${colors[variant]}`}
    >
      {count} {label}
    </div>
  );
}
