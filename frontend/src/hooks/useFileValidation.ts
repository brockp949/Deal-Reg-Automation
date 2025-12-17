/**
 * useFileValidation Hook
 *
 * React hook for validating files before upload using the AI validation agent.
 * Provides pre-upload validation, intent detection, warnings, and preview.
 */

import { useState, useCallback } from 'react';
import { api } from '../lib/api';

export interface ValidationWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestedFix?: string;
  affectedRows?: number;
  canAutoFix?: boolean;
}

export interface PreprocessingStep {
  name: string;
  description: string;
  required: boolean;
  autoApplicable: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  detectedIntent: string;
  intentConfidence: number;
  warnings: ValidationWarning[];
  preprocessing: {
    requiredTransformations: PreprocessingStep[];
    estimatedProcessingTime: number;
  };
  preview: {
    estimatedRecords: number;
    sampleExtractedRecords: Array<{
      type: 'vendor' | 'deal' | 'contact';
      data: Record<string, any>;
      confidence: number;
    }>;
  };
  recommendations: string[];
}

interface UseFileValidationReturn {
  validateFile: (file: File, intent?: string) => Promise<ValidationResult | null>;
  validationResult: ValidationResult | null;
  isValidating: boolean;
  error: string | null;
  clearValidation: () => void;
}

/**
 * Hook to validate files before upload
 *
 * @example
 * ```tsx
 * const { validateFile, validationResult, isValidating } = useFileValidation();
 *
 * const handleFileSelect = async (file: File) => {
 *   const result = await validateFile(file, 'vendor_spreadsheet');
 *   if (result && result.isValid) {
 *     // Proceed with upload
 *   } else {
 *     // Show warnings/errors
 *   }
 * };
 * ```
 */
export function useFileValidation(): UseFileValidationReturn {
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read a sample of the file (first 5KB or 50 rows)
   */
  const readFileSample = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const maxSize = 5 * 1024; // 5KB

      reader.onload = (e) => {
        const content = e.target?.result as string;
        // For text files, limit to first 5KB or 50 lines
        if (content) {
          const lines = content.split('\n').slice(0, 50);
          const sample = lines.join('\n').substring(0, maxSize);
          resolve(sample);
        } else {
          reject(new Error('Failed to read file'));
        }
      };

      reader.onerror = () => reject(new Error('File read error'));

      // Read as text (works for CSV, TXT, etc.)
      const blob = file.slice(0, maxSize);
      reader.readAsText(blob);
    });
  }, []);

  /**
   * Validate a file before upload
   */
  const validateFile = useCallback(
    async (file: File, intent?: string): Promise<ValidationResult | null> => {
      setIsValidating(true);
      setError(null);
      setValidationResult(null);

      try {
        // Read file sample
        const sampleContent = await readFileSample(file);

        // Call validation API
        const response = await api.post<{ data: ValidationResult }>('/files/validate', {
          file: {
            name: file.name,
            type: file.type,
            size: file.size,
            sampleContent,
          },
          intent,
        });

        const result = response.data;
        setValidationResult(result);

        return result;
      } catch (err: any) {
        const errorMessage = err.response?.data?.message || err.message || 'Validation failed';
        setError(errorMessage);
        console.error('File validation error:', err);
        return null;
      } finally {
        setIsValidating(false);
      }
    },
    [readFileSample]
  );

  /**
   * Clear validation state
   */
  const clearValidation = useCallback(() => {
    setValidationResult(null);
    setError(null);
  }, []);

  return {
    validateFile,
    validationResult,
    isValidating,
    error,
    clearValidation,
  };
}

export default useFileValidation;
