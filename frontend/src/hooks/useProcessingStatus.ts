import { useEffect, useState, useRef } from 'react';

export interface ProcessingStatus {
  fileId: string;
  status: 'started' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  stage?: string;
  dealsFound?: number;
  vendorsFound?: number;
  contactsFound?: number;
  error?: string;
  timestamp: string;
}

interface UseProcessingStatusOptions {
  enabled?: boolean;
  onComplete?: (status: ProcessingStatus) => void;
  onError?: (error: string) => void;
}

export function useProcessingStatus(
  fileId: string | null,
  options: UseProcessingStatusOptions = {}
) {
  const { enabled = true, onComplete, onError } = options;
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!fileId || !enabled) {
      return;
    }

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    const eventSource = new EventSource(`${apiUrl}/api/events/processing/${fileId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
      console.log(`[SSE] Connected to processing updates for file ${fileId}`);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle connection confirmation
        if (data.type === 'connected') {
          console.log('[SSE] Connection confirmed:', data);
          return;
        }

        // Handle processing status update
        const statusUpdate = data as ProcessingStatus;
        setStatus(statusUpdate);

        console.log('[SSE] Status update:', statusUpdate);

        // Call completion callback
        if (statusUpdate.status === 'completed' && onComplete) {
          onComplete(statusUpdate);
        }

        // Call error callback
        if (statusUpdate.status === 'failed' && onError) {
          onError(statusUpdate.error || 'Processing failed');
        }
      } catch (error) {
        console.error('[SSE] Error parsing event data:', error);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[SSE] Connection error:', err);
      setIsConnected(false);
      setError('Connection to server lost');

      // EventSource will automatically try to reconnect
      // But we'll close it after 3 failed attempts
      if (eventSource.readyState === EventSource.CLOSED) {
        eventSource.close();
      }
    };

    // Cleanup on unmount or when fileId changes
    return () => {
      console.log(`[SSE] Closing connection for file ${fileId}`);
      eventSource.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [fileId, enabled, onComplete, onError]);

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  };

  return {
    status,
    isConnected,
    error,
    disconnect,
  };
}
