/**
 * Validation Preview Component
 *
 * Displays file validation results before full upload:
 * - File structure and column mapping
 * - Sample extracted records
 * - Warnings and errors
 * - Auto-fix suggestions
 */

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  FileText,
  Table,
  Sparkles,
  ChevronRight,
} from 'lucide-react';

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  detectedIntent: string;
  fileInfo: {
    name: string;
    size: number;
    type: string;
  };
  structure: {
    columns: Array<{
      name: string;
      mappedTo?: string;
      sampleValues: any[];
      dataType: string;
      nullCount: number;
      confidence: number;
    }>;
    rowCount: number;
    hasHeaders: boolean;
  };
  preview: {
    estimatedRecords: number;
    sampleRecords: any[];
  };
  warnings: Array<{
    severity: 'high' | 'medium' | 'low';
    message: string;
    column?: string;
    suggestedFix?: string;
  }>;
  errors: Array<{
    message: string;
    column?: string;
    row?: number;
  }>;
  suggestions: {
    autoFixes: Array<{
      type: string;
      description: string;
      affectedColumns: string[];
    }>;
    manualActions: string[];
  };
  estimatedProcessingTime: string;
}

interface ValidationPreviewProps {
  validation: ValidationResult;
  onProceed: () => void;
  onCancel: () => void;
  onApplyAutoFix?: (fixType: string) => void;
}

export function ValidationPreview({
  validation,
  onProceed,
  onCancel,
  onApplyAutoFix,
}: ValidationPreviewProps) {
  const { isValid: _isValid, confidence, structure, preview, warnings, errors, suggestions } = validation;

  // Determine overall status
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  return (
    <div className="space-y-6">
      {/* Header - Overall Status */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div
            className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
              hasErrors
                ? 'bg-red-100 dark:bg-red-900'
                : hasWarnings
                ? 'bg-amber-100 dark:bg-amber-900'
                : 'bg-green-100 dark:bg-green-900'
            }`}
          >
            {hasErrors ? (
              <XCircle className="w-6 h-6 text-red-600" />
            ) : hasWarnings ? (
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            ) : (
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            )}
          </div>

          <div className="flex-1">
            <h2 className="text-xl font-semibold">
              {hasErrors
                ? 'Validation Failed'
                : hasWarnings
                ? 'Validation Passed with Warnings'
                : 'Validation Passed'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {hasErrors
                ? `Found ${errors.length} error${errors.length > 1 ? 's' : ''} that must be fixed before upload`
                : hasWarnings
                ? `Found ${warnings.length} warning${warnings.length > 1 ? 's' : ''} - review before proceeding`
                : 'Your file looks good and is ready to upload'}
            </p>

            <div className="flex items-center gap-4 mt-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Detected Type:</span>{' '}
                <Badge variant="outline" className="ml-1">
                  {validation.detectedIntent}
                </Badge>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Confidence:</span>{' '}
                <span className="font-medium">{Math.round(confidence * 100)}%</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Est. Processing:</span>{' '}
                <span className="font-medium">{validation.estimatedProcessingTime}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Errors */}
      {errors.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="w-5 h-5 text-red-600" />
            <h3 className="text-lg font-semibold">Errors ({errors.length})</h3>
          </div>

          <div className="space-y-3">
            {errors.map((error, index) => (
              <Alert key={index} variant="destructive">
                <AlertDescription>
                  <div className="font-medium">{error.message}</div>
                  {error.column && (
                    <div className="text-sm mt-1">Column: {error.column}</div>
                  )}
                  {error.row && <div className="text-sm mt-1">Row: {error.row}</div>}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        </Card>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h3 className="text-lg font-semibold">Warnings ({warnings.length})</h3>
          </div>

          <div className="space-y-3">
            {warnings.map((warning, index) => (
              <Alert key={index}>
                <AlertDescription>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="font-medium">{warning.message}</div>
                      {warning.column && (
                        <div className="text-sm mt-1 text-muted-foreground">
                          Column: {warning.column}
                        </div>
                      )}
                      {warning.suggestedFix && (
                        <div className="text-sm mt-2 flex items-center gap-1 text-blue-600">
                          <Info className="w-3 h-3" />
                          {warning.suggestedFix}
                        </div>
                      )}
                    </div>
                    <Badge
                      variant={
                        warning.severity === 'high'
                          ? 'destructive'
                          : warning.severity === 'medium'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {warning.severity}
                    </Badge>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        </Card>
      )}

      {/* Auto-Fix Suggestions */}
      {suggestions.autoFixes.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-semibold">Auto-Fix Available</h3>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            We can automatically fix these issues for you
          </p>

          <div className="space-y-3">
            {suggestions.autoFixes.map((fix, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg border bg-purple-50 dark:bg-purple-950"
              >
                <div className="flex-1">
                  <div className="font-medium">{fix.description}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Affects: {fix.affectedColumns.join(', ')}
                  </div>
                </div>
                {onApplyAutoFix && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onApplyAutoFix(fix.type)}
                    className="ml-4"
                  >
                    Apply Fix
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Column Structure */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Table className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold">
            Column Structure ({structure.columns.length} columns)
          </h3>
        </div>

        <div className="space-y-2">
          {structure.columns.slice(0, 10).map((column, index) => (
            <div key={index} className="flex items-center gap-3 p-2 rounded-lg border">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{column.name}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>Type: {column.dataType}</span>
                  {column.nullCount > 0 && <span>{column.nullCount} null values</span>}
                  {column.mappedTo && column.mappedTo !== column.name && (
                    <span className="flex items-center gap-1 text-blue-600">
                      <ChevronRight className="w-3 h-3" />
                      Maps to: {column.mappedTo}
                    </span>
                  )}
                </div>
              </div>
              {column.sampleValues.length > 0 && (
                <div className="flex-shrink-0 text-xs text-muted-foreground">
                  Sample: {column.sampleValues.slice(0, 2).join(', ')}
                </div>
              )}
            </div>
          ))}

          {structure.columns.length > 10 && (
            <div className="text-sm text-muted-foreground text-center pt-2">
              + {structure.columns.length - 10} more columns
            </div>
          )}
        </div>
      </Card>

      {/* Sample Records */}
      {preview.sampleRecords.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-semibold">Sample Extracted Records</h3>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Preview of {preview.sampleRecords.length} out of approximately{' '}
            {preview.estimatedRecords.toLocaleString()} records
          </p>

          <div className="space-y-3">
            {preview.sampleRecords.map((record, index) => (
              <div key={index} className="p-3 rounded-lg border bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">{record.type}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Record {index + 1}
                  </span>
                </div>
                <pre className="text-xs overflow-x-auto">
                  {JSON.stringify(record.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>

        <div className="flex items-center gap-3">
          {hasWarnings && !hasErrors && (
            <span className="text-sm text-muted-foreground">
              You can proceed despite warnings
            </span>
          )}
          <Button onClick={onProceed} disabled={hasErrors}>
            {hasErrors
              ? 'Fix Errors to Proceed'
              : hasWarnings
              ? 'Proceed Anyway'
              : 'Proceed with Upload'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ValidationPreview;
