import { useState, useEffect, useCallback } from 'react';
import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { chroniclerClient, MeetingNote, ParsedMeetingData } from '../chronicler-sdk';

export interface UseChroniclerResult {
  isConnected: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  parseMutation: UseMutationResult<
    ParsedMeetingData,
    Error,
    { notes: MeetingNote | string; options?: any }
  >;
}

/**
 * React hook for using ChroniclerClient SDK
 * Provides connection state management and mutation for parsing meeting notes
 */
export function useChronicler(): UseChroniclerResult {
  const [isConnected, setIsConnected] = useState(false);

  // Check connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      const connected = await chroniclerClient.connect();
      setIsConnected(connected);
    };

    checkConnection();
  }, []);

  // Connect function
  const connect = useCallback(async () => {
    const connected = await chroniclerClient.connect();
    setIsConnected(connected);
    return connected;
  }, []);

  // Disconnect function
  const disconnect = useCallback(() => {
    chroniclerClient.disconnect();
    setIsConnected(false);
  }, []);

  // Parse mutation
  const parseMutation = useMutation<
    ParsedMeetingData,
    Error,
    { notes: MeetingNote | string; options?: any }
  >({
    mutationFn: async ({ notes, options }) => {
      return await chroniclerClient.parseMeetingNotes(notes, options);
    },
    onError: (error) => {
      console.error('Parse meeting notes failed:', error);
      // Mark as disconnected on network errors
      if (error.message.includes('SDK not connected')) {
        setIsConnected(false);
      }
    },
  });

  return {
    isConnected,
    connect,
    disconnect,
    parseMutation,
  };
}

/**
 * Hook for parsing meeting notes with automatic retry
 */
export function useMeetingNotesParser() {
  const { parseMutation, isConnected, connect } = useChronicler();

  const parseWithRetry = useCallback(
    async (notes: MeetingNote | string, options?: any) => {
      // If not connected, try to connect first
      if (!isConnected) {
        await connect();
      }

      return parseMutation.mutateAsync({ notes, options });
    },
    [isConnected, connect, parseMutation]
  );

  return {
    parse: parseWithRetry,
    isLoading: parseMutation.isPending,
    error: parseMutation.error,
    data: parseMutation.data,
    isConnected,
  };
}
