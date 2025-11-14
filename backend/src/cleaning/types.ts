/**
 * Phase 3 Cleaning Types
 * Type definitions for content cleaning and normalization
 */

export interface SignatureData {
  raw_text: string;
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
  disclaimer?: string;
}

export interface CleanedContent {
  original_text: string;
  cleaned_body: string;
  signature?: SignatureData;
  had_quoted_replies: boolean;
  had_signature: boolean;
  original_length: number;
  cleaned_length: number;
  processing_time_ms: number;
  has_minimum_content: boolean;
}

export interface CleaningOptions {
  remove_quoted_replies?: boolean;
  extract_signatures?: boolean;
  normalize_text?: boolean;
  preserve_structure?: boolean;
  min_content_length?: number;
}

export interface QuoteBlock {
  start_line: number;
  end_line: number;
  content: string;
  quote_type: 'reply' | 'forward' | 'inline';
}

export interface SignatureBoundary {
  line_number: number;
  confidence: number;
  marker_type: 'delimiter' | 'pattern' | 'heuristic';
}
