import { AxiosError } from 'axios';

export interface AppError {
  message: string;
  code?: string;
  type: 'network' | 'server' | 'validation' | 'unknown';
  statusCode?: number;
  details?: any;
}

export function parseApiError(error: unknown): AppError {
  if (error instanceof AxiosError) {
    // Network error (no response)
    if (!error.response) {
      return {
        message: 'Unable to connect to the server. Please check your internet connection.',
        type: 'network',
        code: 'NETWORK_ERROR',
      };
    }

    const statusCode = error.response.status;
    const data = error.response.data;

    // Server returned error response
    if (statusCode >= 500) {
      return {
        message: data?.error || 'A server error occurred. Please try again later.',
        type: 'server',
        statusCode,
        code: data?.code || 'SERVER_ERROR',
        details: data?.details,
      };
    }

    // Client error (validation, not found, etc.)
    if (statusCode >= 400) {
      return {
        message: data?.error || 'Invalid request. Please check your input.',
        type: 'validation',
        statusCode,
        code: data?.code || 'VALIDATION_ERROR',
        details: data?.errors || data?.details,
      };
    }
  }

  // Unknown error
  return {
    message: error instanceof Error ? error.message : 'An unexpected error occurred',
    type: 'unknown',
    code: 'UNKNOWN_ERROR',
  };
}

export function getErrorMessage(error: unknown): string {
  return parseApiError(error).message;
}

export function shouldRetry(error: unknown): boolean {
  const appError = parseApiError(error);

  // Retry on network errors and 5xx server errors
  if (appError.type === 'network') return true;
  if (appError.type === 'server' && appError.statusCode && appError.statusCode >= 500) return true;

  // Don't retry on validation errors or 4xx errors
  return false;
}
