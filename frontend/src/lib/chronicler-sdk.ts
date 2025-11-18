import { api } from './api';
import axios from 'axios';

/**
 * ChroniclerClient SDK for parsing meeting notes and transcripts
 * Provides AI-powered extraction with connection state management and mock fallback
 */

export interface MeetingNote {
  title: string;
  content: string;
  date?: Date;
  attendees?: string[];
}

export interface ParsedMeetingData {
  deals?: any[];
  vendors?: any[];
  contacts?: any[];
  summary?: string;
  confidence?: number;
}

export interface SDKConfig {
  apiUrl?: string;
  timeout?: number;
  enableMockFallback?: boolean;
}

class ChroniclerClient {
  private connected: boolean = false;
  private connecting: boolean = false;
  private config: SDKConfig;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 60000; // 1 minute

  constructor(config: SDKConfig = {}) {
    this.config = {
      timeout: 30000,
      enableMockFallback: true,
      ...config,
    };
  }

  /**
   * Initialize and check SDK connection
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting) {
      // Wait for ongoing connection attempt
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.connected;
    }

    this.connecting = true;

    try {
      // Check if backend is available
      const response = await api.get('/health', { timeout: 5000 });
      this.connected = response.status === 200;
      this.lastHealthCheck = Date.now();
      console.log('ChroniclerClient: Connected successfully');
      return true;
    } catch (error) {
      console.warn('ChroniclerClient: Connection failed', error);
      this.connected = false;
      return false;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Check if SDK is connected
   */
  isConnected(): boolean {
    // Invalidate connection if health check is too old
    if (Date.now() - this.lastHealthCheck > this.healthCheckInterval) {
      this.connected = false;
    }
    return this.connected;
  }

  /**
   * Parse meeting notes and extract deal information
   */
  async parseMeetingNotes(
    notes: MeetingNote | string,
    options: { extractionType?: string; context?: any } = {}
  ): Promise<ParsedMeetingData> {
    const noteTitle = typeof notes === 'string' ? 'Meeting Notes' : notes.title;
    const noteContent = typeof notes === 'string' ? notes : notes.content;

    console.log(`ChroniclerClient.parseMeetingNotes: ${noteTitle}`);

    // Check connection state
    if (!this.isConnected()) {
      // Attempt to connect
      const connected = await this.connect();
      if (!connected) {
        const error = new Error('SDK not connected - use mock data');
        console.error('Analysis error:', error);

        if (this.config.enableMockFallback) {
          return this.getMockData(noteTitle);
        }
        throw error;
      }
    }

    try {
      // Call the AI extraction API
      const response = await api.post(
        '/ai/extract',
        {
          text: noteContent,
          extractionType: options.extractionType || 'all',
          context: options.context,
        },
        { timeout: this.config.timeout }
      );

      if (response.data.success) {
        return {
          deals: response.data.result.deals || [],
          vendors: response.data.result.vendors || [],
          contacts: response.data.result.contacts || [],
          summary: response.data.result.summary,
          confidence: response.data.result.confidence || 0.8,
        };
      } else {
        throw new Error(response.data.error || 'Extraction failed');
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.message
        : String(error);

      console.error('ChroniclerClient: Parse failed', errorMessage);

      // Mark as disconnected if it's a network error
      if (axios.isAxiosError(error) && !error.response) {
        this.connected = false;
      }

      // Fallback to mock data if enabled
      if (this.config.enableMockFallback) {
        console.warn('ChroniclerClient: Using mock data fallback');
        return this.getMockData(noteTitle);
      }

      throw new Error(`Failed to parse meeting notes: ${errorMessage}`);
    }
  }

  /**
   * Extract deals specifically from meeting notes
   */
  async extractDeals(notes: MeetingNote | string, context?: any): Promise<any[]> {
    const result = await this.parseMeetingNotes(notes, {
      extractionType: 'deal',
      context,
    });
    return result.deals || [];
  }

  /**
   * Extract vendors from meeting notes
   */
  async extractVendors(notes: MeetingNote | string, context?: any): Promise<any[]> {
    const result = await this.parseMeetingNotes(notes, {
      extractionType: 'vendor',
      context,
    });
    return result.vendors || [];
  }

  /**
   * Extract contacts from meeting notes
   */
  async extractContacts(notes: MeetingNote | string, context?: any): Promise<any[]> {
    const result = await this.parseMeetingNotes(notes, {
      extractionType: 'contact',
      context,
    });
    return result.contacts || [];
  }

  /**
   * Get mock data for development/testing
   */
  private getMockData(noteTitle: string): ParsedMeetingData {
    return {
      deals: [
        {
          deal_name: `${noteTitle} - Extracted Deal`,
          customer_name: 'Mock Customer Inc',
          deal_value: 50000,
          currency: 'USD',
          confidence: 0.65,
          notes: 'Mock data - SDK not connected',
        },
      ],
      vendors: [
        {
          vendor_name: 'Mock Vendor Corp',
          confidence: 0.6,
        },
      ],
      contacts: [
        {
          name: 'John Mock',
          email: 'john@mockcustomer.com',
          role: 'Decision Maker',
          confidence: 0.7,
        },
      ],
      summary: 'Mock summary - SDK connection unavailable',
      confidence: 0.65,
    };
  }

  /**
   * Disconnect and reset SDK state
   */
  disconnect(): void {
    this.connected = false;
    this.lastHealthCheck = 0;
    console.log('ChroniclerClient: Disconnected');
  }
}

// Export singleton instance
export const chroniclerClient = new ChroniclerClient({
  enableMockFallback: import.meta.env.DEV, // Enable mock fallback in development
});

export default ChroniclerClient;
