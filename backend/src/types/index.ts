// Vendor Types
export type VendorApprovalStatus = 'approved' | 'pending' | 'denied';
export type VendorOrigin = 'user_upload' | 'manual' | 'system_inferred' | 'approved_from_queue';

export interface Vendor {
  id: string;
  name: string;
  normalized_name: string;
  email_domains: string[];
  industry?: string;
  website?: string;
  notes?: string;
  status: 'active' | 'inactive' | 'merged';
  origin: VendorOrigin;
  approval_status: VendorApprovalStatus;
  approval_notes?: string;
  approved_at?: Date;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, any>;
}

export interface CreateVendorInput {
  name: string;
  email_domains?: string[];
  industry?: string;
  website?: string;
  notes?: string;
  origin?: VendorOrigin;
  approval_status?: VendorApprovalStatus;
  status?: 'active' | 'inactive' | 'merged';
}

export interface UpdateVendorInput extends Partial<CreateVendorInput> {
  status?: 'active' | 'inactive' | 'merged';
  approval_notes?: string;
}

// Deal Registration Types
export interface DealRegistration {
  id: string;
  vendor_id: string;
  deal_name: string;
  deal_value: number;
  currency: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: Date;
  expected_close_date?: Date;
  status: DealStatus;
  deal_stage?: string;
  probability?: number;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, any>;
}

export type DealStatus =
  | 'registered'
  | 'approved'
  | 'rejected'
  | 'closed-won'
  | 'closed-lost';

export interface CreateDealInput {
  vendor_id: string;
  deal_name: string;
  deal_value: number;
  currency?: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: Date;
  expected_close_date?: Date;
  status?: DealStatus;
  deal_stage?: string;
  probability?: number;
  notes?: string;
}

export interface UpdateDealInput extends Partial<CreateDealInput> {}

// Source File Types
export interface SourceFile {
  id: string;
  filename: string;
  file_type: FileType;
  file_size: number;
  storage_path: string;
  upload_date: Date;
  processing_status: ProcessingStatus;
  processing_started_at?: Date;
  processing_completed_at?: Date;
  error_message?: string;
  metadata: Record<string, any>;
  checksum_sha256?: string;
  checksum_verified_at?: Date;
  scan_status?: FileScanStatus;
  scan_engine?: string;
  scan_details?: Record<string, any>;
  scan_completed_at?: Date;
  quarantined_at?: Date;
  quarantine_reason?: string;
  uploaded_by?: string;
  upload_metadata?: Record<string, any>;
  duplicate_of_id?: string;
}

export type FileType = 'mbox' | 'transcript' | 'vtiger_csv' | 'csv' | 'pdf' | 'docx' | 'txt';

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'blocked';

export type FileScanStatus = 'not_scanned' | 'pending' | 'passed' | 'failed' | 'error';

export type FileSecurityEventType =
  | 'upload_received'
  | 'checksum_recorded'
  | 'scan_passed'
  | 'scan_failed'
  | 'scan_error'
  | 'quarantined'
  | 'duplicate_detected';

export interface FileSecurityEvent {
  id: string;
  source_file_id: string;
  event_type: FileSecurityEventType;
  actor?: string;
  details: Record<string, any>;
  created_at: Date;
}

// Extracted Entity Types
export interface ExtractedEntity {
  id: string;
  source_file_id: string;
  entity_type: EntityType;
  raw_text: string;
  normalized_data: Record<string, any>;
  confidence_score: number;
  source_location?: string;
  created_at: Date;
}

export type EntityType = 'vendor' | 'deal' | 'contact' | 'product';

// Contact Types
export interface Contact {
  id: string;
  vendor_id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_primary: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateContactInput {
  vendor_id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_primary?: boolean;
}

// Processing Job Types
export interface ProcessingJob {
  id: string;
  source_file_id: string;
  job_type: string;
  status: JobStatus;
  progress: number;
  result_summary: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

// Parsed Email Data
export interface ParsedEmail {
  from: string;
  to: string;
  subject: string;
  date: Date;
  body: string;
  html?: string;
}

// Parsed Transcript Data
export interface ParsedTranscript {
  text: string;
  sections?: TranscriptSection[];
}

export interface TranscriptSection {
  speaker?: string;
  timestamp?: string;
  content: string;
}

// Parsed CSV Data
export interface ParsedCSVRow {
  [key: string]: string | number | null;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  duplicate?: boolean;
  duplicateOf?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Filter and Query Types
export interface VendorFilters {
  status?: string;
  industry?: string;
  search?: string;
}

export interface DealFilters {
  vendor_id?: string;
  status?: DealStatus;
  min_value?: number;
  max_value?: number;
  start_date?: Date;
  end_date?: Date;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface VendorReviewItem {
  id: string;
  alias_name: string;
  normalized_alias: string;
  status: VendorApprovalStatus;
  detection_count: number;
  first_detected_at: Date;
  last_detected_at: Date;
  latest_context: Record<string, any>;
  metadata: Record<string, any>;
  approved_vendor_id?: string;
  decision_notes?: string;
  resolved_at?: Date;
  resolved_by?: string;
}

// Export Report Types
export interface ExportOptions {
  vendor_ids: string[];
  include_deals?: boolean;
  include_contacts?: boolean;
  include_source_attribution?: boolean;
  date_from?: Date;
  date_to?: Date;
  format: 'xlsx' | 'csv' | 'pdf';
}

export interface EmailReportOptions extends ExportOptions {
  to: string;
  subject: string;
  message?: string;
}
