import axios from 'axios';

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
  getAll: (params?: any) => api.get('/vendors', { params }),
  getById: (id: string) => api.get(`/vendors/${id}`),
  create: (data: any) => api.post('/vendors', data),
  update: (id: string, data: any) => api.put(`/vendors/${id}`, data),
  delete: (id: string) => api.delete(`/vendors/${id}`),
  getDeals: (id: string) => api.get(`/vendors/${id}/deals`),
  getContacts: (id: string) => api.get(`/vendors/${id}/contacts`),
};

// Deal API
export const dealAPI = {
  getAll: (params?: any) => api.get('/deals', { params }),
  getById: (id: string) => api.get(`/deals/${id}`),
  create: (data: any) => api.post('/deals', data),
  update: (id: string, data: any) => api.put(`/deals/${id}`, data),
  delete: (id: string) => api.delete(`/deals/${id}`),
  updateStatus: (id: string, status: string) =>
    api.patch(`/deals/${id}/status`, { status }),
};

// File API
export const fileAPI = {
  getAll: (params?: any) => api.get('/files', { params }),
  getById: (id: string) => api.get(`/files/${id}`),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  batchUpload: (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    return api.post('/files/batch-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  delete: (id: string) => api.delete(`/files/${id}`),
  process: (id: string) => api.post(`/files/${id}/process`),
  clearAll: () => api.delete('/files/clear-all'),
};

// Contact API
export const contactAPI = {
  getAll: (params?: any) => api.get('/contacts', { params }),
  create: (data: any) => api.post('/contacts', data),
  update: (id: string, data: any) => api.put(`/contacts/${id}`, data),
  delete: (id: string) => api.delete(`/contacts/${id}`),
};

// Export API
export const exportAPI = {
  excel: (data: any) =>
    api.post('/export/excel', data, {
      responseType: 'blob',
    }),
  csv: (data: any) =>
    api.post('/export/csv', data, {
      responseType: 'blob',
    }),
};
