import axios, { AxiosProgressEvent, AxiosResponse } from 'axios';
import type {
  ApiResponse,
  VendorQueryParams,
  CreateVendorInput,
  UpdateVendorInput,
  VendorsResponse,
  VendorResponse,
  DealQueryParams,
  CreateDealInput,
  UpdateDealInput,
  DealsResponse,
  DealResponse,
  FileQueryParams,
  FileUploadResponse,
  BatchUploadResponse,
  FilesResponse,
  FileResponse,
  SecurityMetrics,
  ContactQueryParams,
  CreateContactInput,
  UpdateContactInput,
  ContactsResponse,
  ContactResponse,
  ConfigQueryParams,
  ConfigMetrics,
  ApplySnapshotInput,
  ConfigSnapshotsResponse,
  ErrorQueryParams,
  ErrorsResponse,
  ErrorStatistics,
  ErrorLog,
  ResolveErrorInput,
  BulkResolveInput,
  ExportInput,
  DealImportPreviewResponse,
  DealImportJobResponse,
  DealImportJobStatus,
  AgreementsResponse,
  AgreementResponse,
  UpdateAgreementInput,
} from '@/types/api';
import type { ConfigSnapshot } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    // TODO: Add auth token when implemented
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // TODO: Handle unauthorized
    }
    return Promise.reject(error);
  }
);

// Vendor API
export const vendorAPI = {
  getAll: (params?: VendorQueryParams): Promise<AxiosResponse<ApiResponse<VendorsResponse>>> =>
    api.get('/vendors', { params }),
  getById: (id: string): Promise<AxiosResponse<ApiResponse<VendorResponse>>> =>
    api.get(`/vendors/${id}`),
  create: (data: CreateVendorInput): Promise<AxiosResponse<ApiResponse<VendorResponse>>> =>
    api.post('/vendors', data),
  update: (id: string, data: UpdateVendorInput): Promise<AxiosResponse<ApiResponse<VendorResponse>>> =>
    api.put(`/vendors/${id}`, data),
  delete: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/vendors/${id}`),
  getDeals: (id: string): Promise<AxiosResponse<ApiResponse<DealsResponse>>> =>
    api.get(`/vendors/${id}/deals`),
  getContacts: (id: string): Promise<AxiosResponse<ApiResponse<ContactsResponse>>> =>
    api.get(`/vendors/${id}/contacts`),
  getReviewQueue: (): Promise<AxiosResponse<ApiResponse<VendorsResponse>>> =>
    api.get('/vendors/review'),
  approve: (id: string, mergeIntoVendorId?: string): Promise<AxiosResponse<ApiResponse<VendorResponse>>> =>
    api.post(`/vendors/review/${id}/approve`, { merge_into_vendor_id: mergeIntoVendorId }),
  deny: (id: string, notes: string): Promise<AxiosResponse<ApiResponse<VendorResponse>>> =>
    api.post(`/vendors/review/${id}/deny`, { notes }),
};

// Deal API
export const dealAPI = {
  getAll: (params?: DealQueryParams): Promise<AxiosResponse<ApiResponse<DealsResponse>>> =>
    api.get('/deals', { params }),
  getById: (id: string): Promise<AxiosResponse<ApiResponse<DealResponse>>> =>
    api.get(`/deals/${id}`),
  create: (data: CreateDealInput): Promise<AxiosResponse<ApiResponse<DealResponse>>> =>
    api.post('/deals', data),
  update: (id: string, data: UpdateDealInput): Promise<AxiosResponse<ApiResponse<DealResponse>>> =>
    api.put(`/deals/${id}`, data),
  delete: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/deals/${id}`),
  updateStatus: (id: string, status: string): Promise<AxiosResponse<ApiResponse<DealResponse>>> =>
    api.patch(`/deals/${id}/status`, { status }),
};

// File API
// File intent types
export type FileIntent = 'vendor' | 'deal' | 'email' | 'transcript' | 'vendor_spreadsheet' | 'auto';

export interface UnifiedUploadOptions {
  uploadIntent?: FileIntent;
  vendorId?: string;
  vendorName?: string;
}

export const fileAPI = {
  getAll: (params?: FileQueryParams): Promise<AxiosResponse<ApiResponse<FilesResponse>>> =>
    api.get('/files', { params }),
  getById: (id: string): Promise<AxiosResponse<ApiResponse<FileResponse>>> =>
    api.get(`/files/${id}`),
  upload: (file: File, onUploadProgress: (progressEvent: any) => void): Promise<AxiosResponse<ApiResponse<FileUploadResponse>>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  // New unified upload with intent support
  uploadWithIntent: (
    file: File,
    options: UnifiedUploadOptions,
    onUploadProgress?: (progressEvent: any) => void
  ): Promise<AxiosResponse<ApiResponse<FileUploadResponse>>> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options.uploadIntent) formData.append('uploadIntent', options.uploadIntent);
    if (options.vendorId) formData.append('vendorId', options.vendorId);
    if (options.vendorName) formData.append('vendorName', options.vendorName);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  batchUpload: (files: File[], onUploadProgress: (progressEvent: any) => void): Promise<AxiosResponse<ApiResponse<BatchUploadResponse>>> => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    return api.post('/files/batch-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  // New batch upload with intent
  batchUploadWithIntent: (
    files: File[],
    options: UnifiedUploadOptions,
    onUploadProgress?: (progressEvent: any) => void
  ): Promise<AxiosResponse<ApiResponse<BatchUploadResponse>>> => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    if (options.uploadIntent) formData.append('uploadIntent', options.uploadIntent);
    if (options.vendorId) formData.append('vendorId', options.vendorId);
    if (options.vendorName) formData.append('vendorName', options.vendorName);
    return api.post('/files/batch-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  delete: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/files/${id}`),
  process: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.post(`/files/${id}/process`),
  clearAll: (adminToken?: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete('/files/clear-all', {
      headers: adminToken ? { 'X-Admin-Token': adminToken } : undefined,
    }),
  getSecurityMetrics: (): Promise<AxiosResponse<ApiResponse<SecurityMetrics>>> =>
    api.get('/files/metrics/security'),
};

// Progress API for real-time updates
export const progressAPI = {
  getStatus: (fileId: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.get(`/progress/${fileId}/status`),
  getProcessingFiles: (): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.get('/progress/files/processing'),
  getQueueStats: (): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.get('/progress/queue/stats'),
  // SSE subscription - returns EventSource
  subscribe: (fileId: string): EventSource => {
    const url = `${API_URL}/api/progress/${fileId}`;
    return new EventSource(url);
  },
};

export const configAPI = {
  getSnapshots: (params?: ConfigQueryParams): Promise<AxiosResponse<ApiResponse<ConfigSnapshotsResponse>>> =>
    api.get('/configs/snapshots', { params }),
  getMetrics: (): Promise<AxiosResponse<ApiResponse<ConfigMetrics>>> =>
    api.get('/configs/metrics'),
  applySnapshot: (id: string, data: ApplySnapshotInput): Promise<AxiosResponse<ApiResponse<ConfigSnapshot>>> =>
    api.post(`/configs/snapshots/${id}/apply`, data),
};

// Contact API
export const contactAPI = {
  getAll: (params?: ContactQueryParams): Promise<AxiosResponse<ApiResponse<ContactsResponse>>> =>
    api.get('/contacts', { params }),
  create: (data: CreateContactInput): Promise<AxiosResponse<ApiResponse<ContactResponse>>> =>
    api.post('/contacts', data),
  update: (id: string, data: UpdateContactInput): Promise<AxiosResponse<ApiResponse<ContactResponse>>> =>
    api.put(`/contacts/${id}`, data),
  delete: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/contacts/${id}`),
};

// Export API
export const exportAPI = {
  excel: (data: ExportInput): Promise<AxiosResponse<Blob>> =>
    api.post('/export/excel', data, {
      responseType: 'blob',
    }),
  csv: (data: ExportInput): Promise<AxiosResponse<Blob>> =>
    api.post('/export/csv', data, {
      responseType: 'blob',
    }),
};

// Reprocess API
export const reprocessAPI = {
  detailed: (): Promise<AxiosResponse<ApiResponse<{ message: string }>>> =>
    api.post('/reprocess/detailed'),
};

// Error Tracking API
export const errorAPI = {
  getAll: (params?: ErrorQueryParams): Promise<AxiosResponse<ApiResponse<ErrorsResponse>>> =>
    api.get('/errors', { params }),
  getById: (id: string): Promise<AxiosResponse<ApiResponse<ErrorLog>>> =>
    api.get(`/errors/${id}`),
  getStatistics: (): Promise<AxiosResponse<ApiResponse<ErrorStatistics>>> =>
    api.get('/errors/statistics/summary'),
  getByFile: (fileId: string): Promise<AxiosResponse<ApiResponse<ErrorsResponse>>> =>
    api.get(`/errors/file/${fileId}`),
  getByCategory: (
    category: string,
    params?: { severity?: string; limit?: number }
  ): Promise<AxiosResponse<ApiResponse<ErrorsResponse>>> =>
    api.get(`/errors/category/${category}`, { params }),
  resolve: (id: string, data: ResolveErrorInput): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.patch(`/errors/${id}/resolve`, data),
  bulkResolve: (data: BulkResolveInput): Promise<AxiosResponse<ApiResponse<{ resolved: number }>>> =>
    api.post('/errors/bulk-resolve', data),
};

// Deal Import API
export const dealImportAPI = {
  previewImport: (
    vendorId: string,
    file: File,
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
  ): Promise<AxiosResponse<ApiResponse<DealImportPreviewResponse>>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/vendors/${vendorId}/deals/preview-import`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  startImport: (
    vendorId: string,
    file: File,
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
  ): Promise<AxiosResponse<ApiResponse<DealImportJobResponse>>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/vendors/${vendorId}/deals/import`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  getJobStatus: (
    vendorId: string,
    jobId: string
  ): Promise<AxiosResponse<ApiResponse<DealImportJobStatus>>> =>
    api.get(`/vendors/${vendorId}/deals/import/${jobId}/status`),
};

// Vendor Spreadsheet API
export interface VendorSpreadsheetDeal {
  opportunity: string;
  stage: string;
  nextSteps: string;
  lastUpdate: string | null;
  yearlyUnitOpportunity: string;
  costUpside: string;
  parsedDealValue: number | null;
  parsedCurrency: string;
  rowNumber: number;
}

export interface VendorMatch {
  id: string;
  name: string;
  matchType: 'exact' | 'similar';
}

export interface SpreadsheetPreviewResponse {
  extractedVendorName: string | null;
  matchingVendors: VendorMatch[];
  preview: {
    totalRows: number;
    successCount: number;
    errorCount: number;
    deals: VendorSpreadsheetDeal[];
    errors: string[];
    warnings: string[];
  };
}

export interface SpreadsheetImportResponse {
  vendorId: string;
  vendorName: string;
  filename: string;
  totalDeals: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export const vendorSpreadsheetAPI = {
  extractVendor: (
    filename: string
  ): Promise<AxiosResponse<ApiResponse<{
    extractedVendorName: string | null;
    matchingVendors: VendorMatch[];
    canCreateNew: boolean;
  }>>> =>
    api.post('/vendors/0/deals/spreadsheet/extract-vendor', { filename }),

  preview: (
    file: File,
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
  ): Promise<AxiosResponse<ApiResponse<SpreadsheetPreviewResponse>>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/vendors/0/deals/spreadsheet/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },

  import: (
    file: File,
    options: {
      vendorId?: string;
      vendorName?: string;
      createNewVendor?: boolean;
    },
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
  ): Promise<AxiosResponse<ApiResponse<SpreadsheetImportResponse>>> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options.vendorId) formData.append('vendorId', options.vendorId);
    if (options.vendorName) formData.append('vendorName', options.vendorName);
    if (options.createNewVendor) formData.append('createNewVendor', 'true');
    return api.post('/vendors/0/deals/spreadsheet/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },

  exportSpreadsheet: (vendorId: string): Promise<AxiosResponse<Blob>> =>
    api.get(`/vendors/${vendorId}/deals/export-spreadsheet`, {
      responseType: 'blob',
    }),

  exportSelectedDeals: (
    vendorId: string,
    dealIds: string[]
  ): Promise<AxiosResponse<Blob>> =>
    api.post(`/vendors/${vendorId}/deals/export-spreadsheet`, { dealIds }, {
      responseType: 'blob',
    }),
};

// Agreement API
export const agreementAPI = {
  getAll: (vendorId: string): Promise<AxiosResponse<ApiResponse<AgreementsResponse>>> =>
    api.get(`/vendors/${vendorId}/agreements`),
  getById: (
    vendorId: string,
    agreementId: string
  ): Promise<AxiosResponse<ApiResponse<AgreementResponse>>> =>
    api.get(`/vendors/${vendorId}/agreements/${agreementId}`),
  upload: (
    vendorId: string,
    file: File,
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
  ): Promise<AxiosResponse<ApiResponse<AgreementResponse>>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/vendors/${vendorId}/agreements`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  update: (
    vendorId: string,
    agreementId: string,
    data: UpdateAgreementInput
  ): Promise<AxiosResponse<ApiResponse<AgreementResponse>>> =>
    api.put(`/vendors/${vendorId}/agreements/${agreementId}`, data),
  delete: (vendorId: string, agreementId: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/vendors/${vendorId}/agreements/${agreementId}`),
};

// ChroniclerClient SDK for meeting notes parsing
export { chroniclerClient } from './chronicler-sdk';

// Google Auth API
export const googleAuthAPI = {
  getStatus: (): Promise<AxiosResponse<ApiResponse<{ gmailConfigured: boolean; driveConfigured: boolean }>>> =>
    api.get('/google-auth/status'),
  startAuthorization: (service: 'gmail' | 'drive'): Promise<AxiosResponse<ApiResponse<{ authUrl: string; state: string }>>> =>
    api.get(`/google-auth/authorize/${service}`),
  getAccounts: (): Promise<AxiosResponse<ApiResponse<{ accounts: Array<{
    id: string;
    account_email: string;
    service_type: 'gmail' | 'drive';
    scopes: string[];
    created_at: string;
    updated_at: string;
  }> }>>> =>
    api.get('/google-auth/accounts'),
  disconnectAccount: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/google-auth/accounts/${id}`),
  refreshToken: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.post(`/google-auth/accounts/${id}/refresh`),
};

// Gmail Sync API
export const gmailSyncAPI = {
  getLabels: (tokenId: string): Promise<AxiosResponse<ApiResponse<{ accountEmail: string; labels: Array<{
    id: string;
    name: string;
    type: 'system' | 'user';
  }> }>>> =>
    api.get('/sync/gmail/labels', { params: { tokenId } }),
  getConfigs: (): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    api.get('/sync/gmail/configs'),
  getConfig: (id: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.get(`/sync/gmail/configs/${id}`),
  createConfig: (data: {
    tokenId: string;
    name: string;
    labelIds?: string[];
    dateFrom?: string;
    dateTo?: string;
    syncFrequency?: string;
  }): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.post('/sync/gmail/configs', data),
  updateConfig: (id: string, data: {
    name?: string;
    labelIds?: string[];
    dateFrom?: string;
    dateTo?: string;
    syncFrequency?: string;
    enabled?: boolean;
  }): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.put(`/sync/gmail/configs/${id}`, data),
  deleteConfig: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/sync/gmail/configs/${id}`),
  triggerSync: (id: string): Promise<AxiosResponse<ApiResponse<{ jobId: string }>>> =>
    api.post(`/sync/gmail/configs/${id}/trigger`),
  getHistory: (id: string, limit?: number): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    api.get(`/sync/gmail/configs/${id}/history`, { params: { limit } }),
  getJobs: (id: string): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    api.get(`/sync/gmail/configs/${id}/jobs`),
  preview: (data: {
    tokenId: string;
    labelIds?: string[];
    dateFrom?: string;
    dateTo?: string;
    maxResults?: number;
  }): Promise<AxiosResponse<ApiResponse<{ count: number; sample: Array<{
    id: string;
    subject: string;
    from: string;
    date: string;
  }> }>>> =>
    api.post('/sync/gmail/preview', data),
  getJobStatus: (jobId: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.get(`/sync/gmail/job/${jobId}`),
};

// Drive Sync API
export const driveSyncAPI = {
  getRootFolders: (tokenId: string): Promise<AxiosResponse<ApiResponse<{ accountEmail: string; folders: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    createdTime?: string;
  }> }>>> =>
    api.get('/sync/drive/folders', { params: { tokenId } }),
  getFolderChildren: (folderId: string, tokenId: string, pageToken?: string): Promise<AxiosResponse<ApiResponse<{
    items: any[];
    nextPageToken?: string;
  }>>> =>
    api.get(`/sync/drive/folders/${folderId}/children`, { params: { tokenId, pageToken } }),
  resolveUrl: (url: string, tokenId?: string): Promise<AxiosResponse<ApiResponse<{
    folderId: string;
    folderInfo?: any;
  }>>> =>
    api.post('/sync/drive/resolve-url', { url, tokenId }),
  getConfigs: (): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    api.get('/sync/drive/configs'),
  getConfig: (id: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.get(`/sync/drive/configs/${id}`),
  createConfig: (data: {
    tokenId: string;
    name: string;
    folderId?: string;
    folderUrl?: string;
    includeSubfolders?: boolean;
    syncFrequency?: string;
  }): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.post('/sync/drive/configs', data),
  updateConfig: (id: string, data: {
    name?: string;
    folderId?: string;
    folderUrl?: string;
    includeSubfolders?: boolean;
    syncFrequency?: string;
    enabled?: boolean;
  }): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.put(`/sync/drive/configs/${id}`, data),
  deleteConfig: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/sync/drive/configs/${id}`),
  triggerSync: (id: string): Promise<AxiosResponse<ApiResponse<{ jobId: string }>>> =>
    api.post(`/sync/drive/configs/${id}/trigger`),
  getHistory: (id: string, limit?: number): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    api.get(`/sync/drive/configs/${id}/history`, { params: { limit } }),
  getJobs: (id: string): Promise<AxiosResponse<ApiResponse<any[]>>> =>
    api.get(`/sync/drive/configs/${id}/jobs`),
  preview: (data: {
    tokenId: string;
    folderId?: string;
    folderUrl?: string;
    includeSubfolders?: boolean;
    maxResults?: number;
  }): Promise<AxiosResponse<ApiResponse<{ count: number; sample: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
  }> }>>> =>
    api.post('/sync/drive/preview', data),
  getJobStatus: (jobId: string): Promise<AxiosResponse<ApiResponse<any>>> =>
    api.get(`/sync/drive/job/${jobId}`),
};

// Sync Statistics API
export const syncStatsAPI = {
  getStats: (): Promise<AxiosResponse<ApiResponse<{
    activeConfigs: number;
    lastSyncAt: string | null;
    nextSyncAt: string | null;
    recentRuns: Array<{
      id: string;
      config_id: string;
      config_name: string;
      service_type: 'gmail' | 'drive';
      status: string;
      started_at: string;
      completed_at?: string;
      items_found: number;
      items_processed: number;
      deals_created: number;
      errors_count: number;
      error_message?: string;
      trigger_type: string;
    }>;
    totalItemsSynced: number;
  }>>> =>
    api.get('/sync/stats'),
  getSummary: (): Promise<AxiosResponse<ApiResponse<{
    activeConfigs: number;
    lastSyncAt: string | null;
    runningSyncs: number;
  }>>> =>
    api.get('/sync/stats/summary'),
};