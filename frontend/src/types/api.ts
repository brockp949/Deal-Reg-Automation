/**
 * API Types
 * Type-safe interfaces for API requests and responses.
 */

import type {
  Vendor,
  DealRegistration,
  SourceFile,
  Contact,
  ConfigSnapshot,
  DealStatus,
  ProcessingStatus,
  FileScanStatus,
  FileType,
} from './index';

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============================================================================
// Generic API Response Types
// ============================================================================

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginatedData<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ============================================================================
// Vendor API Types
// ============================================================================

export interface VendorQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'active' | 'inactive' | 'merged' | 'all';
  sort_by?: 'name' | 'created_at' | 'updated_at';
  sort_order?: 'asc' | 'desc';
}

export interface CreateVendorInput {
  name: string;
  email_domains?: string[];
  industry?: string;
  website?: string;
  notes?: string;
  status?: 'active' | 'inactive';
}

export interface UpdateVendorInput extends Partial<CreateVendorInput> {}

export type VendorsResponse = PaginatedData<Vendor>;
export type VendorResponse = Vendor;

// ============================================================================
// Deal API Types
// ============================================================================

export interface DealQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: DealStatus | 'all';
  vendor_id?: string;
  sort_by?: 'deal_name' | 'deal_value' | 'created_at' | 'expected_close_date';
  sort_order?: 'asc' | 'desc';
}

export interface CreateDealInput {
  vendor_id: string;
  deal_name: string;
  deal_value?: number;
  currency?: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: string;
  expected_close_date?: string;
  status?: DealStatus;
  deal_stage?: string;
  probability?: number;
  notes?: string;
}

export interface UpdateDealInput extends Partial<Omit<CreateDealInput, 'vendor_id'>> {
  vendor_id?: string;
}

export interface UpdateDealStatusInput {
  status: DealStatus;
}

export type DealsResponse = PaginatedData<DealRegistration>;
export type DealResponse = DealRegistration;

// ============================================================================
// File API Types
// ============================================================================

export interface FileQueryParams {
  page?: number;
  limit?: number;
  file_type?: FileType;
  processing_status?: ProcessingStatus;
  scan_status?: FileScanStatus;
}

export interface FileUploadResponse {
  id: string;
  filename: string;
  file_type: FileType;
  processing_status: ProcessingStatus;
  message?: string;
}

export interface BatchUploadResponse {
  files: FileUploadResponse[];
  message: string;
}

export interface SecurityMetrics {
  scanStatus: Record<string, number>;
  blockedCount: number;
  quarantinedCount: number;
  duplicateEventsLast30Days: number;
}

export type FilesResponse = PaginatedData<SourceFile>;
export type FileResponse = SourceFile;

// ============================================================================
// Contact API Types
// ============================================================================

export interface ContactQueryParams {
  page?: number;
  limit?: number;
  vendor_id?: string;
}

export interface CreateContactInput {
  vendor_id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_primary?: boolean;
}

export interface UpdateContactInput extends Partial<Omit<CreateContactInput, 'vendor_id'>> {}

export type ContactsResponse = PaginatedData<Contact>;
export type ContactResponse = Contact;

// ============================================================================
// Config API Types
// ============================================================================

export interface ConfigQueryParams {
  limit?: number;
}

export interface ConfigMetrics {
  totalSnapshots: number;
  appliedSnapshots: number;
  pendingSnapshots: number;
}

export interface ApplySnapshotInput {
  appliedBy?: string;
  notes?: string;
}

export type ConfigSnapshotsResponse = PaginatedData<ConfigSnapshot>;

// ============================================================================
// Error API Types
// ============================================================================

export interface ErrorQueryParams {
  category?: string;
  severity?: 'critical' | 'error' | 'warning' | 'info';
  unresolved_only?: boolean;
  limit?: number;
  days?: number;
}

export interface ErrorLog {
  id: string;
  errorCategory: string;
  errorType: string;
  errorSeverity: 'critical' | 'error' | 'warning' | 'info';
  errorMessage: string;
  sourceComponent?: string;
  fileName?: string;
  lineNumber?: number;
  isResolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
  occurredAt: string;
  createdAt: string;
}

export interface ResolveErrorInput {
  resolved_by: string;
  resolution_notes?: string;
}

export interface BulkResolveInput {
  error_type?: string;
  source_file_id?: string;
  resolved_by: string;
  resolution_notes?: string;
}

export interface ErrorStatistics {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  unresolvedCount: number;
}

export type ErrorsResponse = PaginatedData<ErrorLog>;

// ============================================================================
// Export API Types
// ============================================================================

export interface ExportInput {
  vendor_ids?: string[];
  entity?: 'deals' | 'vendors' | 'contacts';
  include_deals?: boolean;
  include_contacts?: boolean;
  include_source_attribution?: boolean;
  date_from?: string;
  date_to?: string;
  format?: 'xlsx' | 'csv' | 'pdf';
}

// ============================================================================
// Deal Import API Types
// ============================================================================

export interface DealImportPreviewDeal {
  deal_name: string;
  deal_value?: number;
  currency?: string;
  customer_name?: string;
  customer_industry?: string;
  registration_date?: string;
  expected_close_date?: string;
  status?: string;
  deal_stage?: string;
  probability?: number;
  notes?: string;
}

export interface DealImportPreview {
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicates: number;
  deals: DealImportPreviewDeal[];
  errors: string[];
}

export interface DealImportPreviewResponse {
  vendorId: string;
  vendorName: string;
  preview: DealImportPreview;
}

export interface DealImportJobResponse {
  vendorId: string;
  vendorName: string;
  jobId: string;
  checkStatusUrl: string;
}

export interface DealImportJobResult {
  vendorId: string;
  vendorName: string;
  parsed: {
    total: number;
    success: number;
    errors: number;
    duplicates: number;
  };
  imported: {
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  };
  errors: string[];
}

export interface DealImportJobStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  vendorId: string;
  filename: string;
  result?: DealImportJobResult;
  failedReason?: string;
  attemptsMade: number;
  processedOn?: number;
  finishedOn?: number;
}

// ============================================================================
// Agreement API Types
// ============================================================================

// Re-export from agreement types for convenience
export type {
  VendorAgreement,
  CommissionStructure,
  CommissionRate,
  KeyTerms,
  AgreementType,
  UpdateAgreementInput,
} from './agreement';

export interface AgreementsResponse {
  data: import('./agreement').VendorAgreement[];
}

export interface AgreementResponse {
  data: import('./agreement').VendorAgreement;
  message?: string;
}
