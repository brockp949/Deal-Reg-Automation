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
  batchUpload: (files: File[], onUploadProgress: (progressEvent: any) => void): Promise<AxiosResponse<ApiResponse<BatchUploadResponse>>> => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    return api.post('/files/batch-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  delete: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete(`/files/${id}`),
  process: (id: string): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.post(`/files/${id}/process`),
  clearAll: (): Promise<AxiosResponse<ApiResponse<void>>> =>
    api.delete('/files/clear-all'),
  getSecurityMetrics: (): Promise<AxiosResponse<ApiResponse<SecurityMetrics>>> =>
    api.get('/files/metrics/security'),
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