/**
 * useFeedback Hook
 *
 * React hook for submitting user corrections and feedback to improve
 * extraction accuracy through continuous learning.
 */

import { useState, useCallback } from 'react';
import { api } from '../lib/api';

export type FeedbackType = 'correction' | 'validation' | 'rejection';
export type EntityType = 'vendor' | 'deal' | 'contact';

export interface FeedbackSubmission {
  type: FeedbackType;
  entity: {
    type: EntityType;
    extracted: Record<string, any>;
    corrected?: Record<string, any>;
  };
  fileId: string;
  fileName?: string;
  metadata?: Record<string, any>;
}

export interface LearningInsight {
  pattern: string;
  correction: string;
  frequency: number;
  confidence: number;
  applicableToFiles: string[];
  applicableToVendors?: string[];
  firstSeen: string;
  lastSeen: string;
  examples: Array<{
    extracted: any;
    corrected: any;
    fileId: string;
  }>;
}

interface UseFeedbackReturn {
  submitFeedback: (feedback: FeedbackSubmission) => Promise<boolean>;
  submitBatchFeedback: (feedbacks: FeedbackSubmission[]) => Promise<{ successful: number; failed: number }>;
  getInsights: () => Promise<LearningInsight[]>;
  triggerLearningAnalysis: () => Promise<any>;
  isSubmitting: boolean;
  error: string | null;
}

/**
 * Hook to submit feedback and corrections
 *
 * @example
 * ```tsx
 * const { submitFeedback, isSubmitting } = useFeedback();
 *
 * const handleCorrection = async () => {
 *   await submitFeedback({
 *     type: 'correction',
 *     entity: {
 *       type: 'vendor',
 *       extracted: { name: 'ACME INC' },
 *       corrected: { name: 'Acme Inc.' }
 *     },
 *     fileId: 'file-123',
 *     fileName: 'vendors.csv'
 *   });
 * };
 * ```
 */
export function useFeedback(): UseFeedbackReturn {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Submit a single feedback/correction
   */
  const submitFeedback = useCallback(async (feedback: FeedbackSubmission): Promise<boolean> => {
    setIsSubmitting(true);
    setError(null);

    try {
      await api.post('/feedback', feedback);
      return true;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to submit feedback';
      setError(errorMessage);
      console.error('Feedback submission error:', err);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  /**
   * Submit multiple feedback items at once
   */
  const submitBatchFeedback = useCallback(
    async (feedbacks: FeedbackSubmission[]): Promise<{ successful: number; failed: number }> => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await api.post<{
          data: { successful: number; failed: number; results: Array<{ success: boolean }> };
        }>('/feedback/batch', { feedbacks });

        return {
          successful: response.data.successful,
          failed: response.data.failed,
        };
      } catch (err: any) {
        const errorMessage = err.response?.data?.message || err.message || 'Failed to submit batch feedback';
        setError(errorMessage);
        console.error('Batch feedback error:', err);
        return { successful: 0, failed: feedbacks.length };
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  /**
   * Get learned insights from feedback
   */
  const getInsights = useCallback(async (): Promise<LearningInsight[]> => {
    try {
      const response = await api.get<{ data: { insights: LearningInsight[] } }>('/feedback/insights');
      return response.data.insights;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to get insights';
      setError(errorMessage);
      console.error('Get insights error:', err);
      return [];
    }
  }, []);

  /**
   * Trigger manual learning analysis (admin only)
   */
  const triggerLearningAnalysis = useCallback(async (): Promise<any> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await api.post('/feedback/analyze');
      return response.data;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to trigger analysis';
      setError(errorMessage);
      console.error('Learning analysis error:', err);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    submitFeedback,
    submitBatchFeedback,
    getInsights,
    triggerLearningAnalysis,
    isSubmitting,
    error,
  };
}

export default useFeedback;
