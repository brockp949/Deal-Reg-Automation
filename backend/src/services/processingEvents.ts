import { EventEmitter } from 'events';

export interface ProcessingEvent {
  fileId: string;
  status: 'started' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  message: string;
  stage?: string;
  dealsFound?: number;
  vendorsFound?: number;
  contactsFound?: number;
  error?: string;
  timestamp: string;
}

class ProcessingEventEmitter extends EventEmitter {
  private activeConnections: Map<string, Set<(data: ProcessingEvent) => void>> = new Map();

  emitProgress(event: ProcessingEvent) {
    // Emit to EventEmitter for general listeners
    this.emit('progress', event);

    // Also emit to file-specific SSE connections
    const connections = this.activeConnections.get(event.fileId);
    if (connections) {
      connections.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error('Error sending SSE event:', error);
        }
      });
    }
  }

  registerConnection(fileId: string, callback: (data: ProcessingEvent) => void) {
    if (!this.activeConnections.has(fileId)) {
      this.activeConnections.set(fileId, new Set());
    }
    this.activeConnections.get(fileId)!.add(callback);
  }

  unregisterConnection(fileId: string, callback: (data: ProcessingEvent) => void) {
    const connections = this.activeConnections.get(fileId);
    if (connections) {
      connections.delete(callback);
      if (connections.size === 0) {
        this.activeConnections.delete(fileId);
      }
    }
  }

  getActiveConnectionCount(fileId?: string): number {
    if (fileId) {
      return this.activeConnections.get(fileId)?.size || 0;
    }
    let total = 0;
    this.activeConnections.forEach((connections) => {
      total += connections.size;
    });
    return total;
  }
}

export const processingEvents = new ProcessingEventEmitter();

// Helper functions for emitting common events
export function emitProcessingStarted(fileId: string, fileName: string) {
  processingEvents.emitProgress({
    fileId,
    status: 'started',
    progress: 0,
    message: `Started processing ${fileName}`,
    timestamp: new Date().toISOString(),
  });
}

export function emitProcessingProgress(
  fileId: string,
  progress: number,
  message: string,
  stage?: string
) {
  processingEvents.emitProgress({
    fileId,
    status: 'processing',
    progress,
    message,
    stage,
    timestamp: new Date().toISOString(),
  });
}

export function emitProcessingCompleted(
  fileId: string,
  dealsFound: number,
  vendorsFound: number,
  contactsFound: number
) {
  processingEvents.emitProgress({
    fileId,
    status: 'completed',
    progress: 100,
    message: 'Processing completed successfully',
    dealsFound,
    vendorsFound,
    contactsFound,
    timestamp: new Date().toISOString(),
  });
}

export function emitProcessingFailed(fileId: string, error: string) {
  processingEvents.emitProgress({
    fileId,
    status: 'failed',
    progress: 0,
    message: 'Processing failed',
    error,
    timestamp: new Date().toISOString(),
  });
}
