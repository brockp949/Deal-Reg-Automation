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
  cleaned_text: string;
  signature?: SignatureData;
  removed_quotes: string[];
  normalization_applied: string[];
  char_count_before: number;
  char_count_after: number;
}

export interface CleaningOptions {
  remove_quotes: boolean;
  extract_signature: boolean;
  normalize_text: boolean;
  remove_disclaimers: boolean;
  preserve_urls: boolean;
  preserve_emails: boolean;
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
