/**
 * Phase 2 Parsing Types
 * Type definitions for email parsing and thread reconstruction
 */

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface AttachmentMetadata {
  filename: string;
  content_type: string;
  size_bytes: number;
  content_id?: string;
  is_inline: boolean;
}

export interface ParsedEmailMetadata {
  message_id: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  date: Date;
  references: string[];
  in_reply_to: string | null;
  gmail_thread_id: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments: AttachmentMetadata[];
  headers: Record<string, string | string[]>;
}

export interface EmailThread {
  thread_id: string; // Gmail thread ID or generated UUID
  messages: ParsedEmailMetadata[];
  root_message: ParsedEmailMetadata; // First message in thread
  participants: EmailAddress[]; // Unique participants
  subject: string; // Thread subject (from root)
  date_start: Date;
  date_end: Date;
  message_count: number;
}

export interface TextContent {
  text: string;
  source: 'plain' | 'html';
}
