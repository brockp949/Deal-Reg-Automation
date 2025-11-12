export interface Vendor {
  id: string;
  name: string;
  normalized_name: string;
  email_domains: string[];
  industry?: string;
  website?: string;
  notes?: string;
  status: 'active' | 'inactive' | 'merged';
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
}

export interface DealRegistration {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  deal_name: string;
  deal_value: number;
  currency: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: string;
  expected_close_date?: string;
  status: DealStatus;
  deal_stage?: string;
  probability?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
}

export type DealStatus =
  | 'registered'
  | 'approved'
  | 'rejected'
  | 'closed-won'
  | 'closed-lost';

export interface SourceFile {
  id: string;
  filename: string;
  file_type: FileType;
  file_size: number;
  storage_path: string;
  upload_date: string;
  processing_status: ProcessingStatus;
  processing_started_at?: string;
  processing_completed_at?: string;
  error_message?: string;
  metadata: Record<string, any>;
  checksum_sha256?: string;
  checksum_verified_at?: string;
  scan_status?: FileScanStatus;
  scan_engine?: string;
  scan_details?: Record<string, any>;
  scan_completed_at?: string;
  quarantined_at?: string;
  quarantine_reason?: string;
  uploaded_by?: string;
  upload_metadata?: Record<string, any>;
  duplicate_of_id?: string;
}

export type FileType = 'mbox' | 'transcript' | 'vtiger_csv' | 'csv' | 'pdf' | 'docx' | 'txt' | 'json';

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'blocked';

export type FileScanStatus = 'not_scanned' | 'pending' | 'passed' | 'failed' | 'error';

export interface Contact {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

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

export interface ExportOptions {
  vendor_ids: string[];
  include_deals?: boolean;
  include_contacts?: boolean;
  include_source_attribution?: boolean;
  date_from?: string;
  date_to?: string;
  format: 'xlsx' | 'csv' | 'pdf';
}
