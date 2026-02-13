import { http, HttpResponse } from 'msw';

const API_URL = 'http://localhost:4000/api';

// Mock data
const mockVendors = [
  {
    id: '1',
    name: 'Acme Corporation',
    status: 'active',
    deal_count: 5,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
  },
  {
    id: '2',
    name: 'TechCorp Inc',
    status: 'active',
    deal_count: 3,
    created_at: '2024-01-05T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
  },
];

const mockDeals = [
  {
    id: '1',
    vendor_id: '1',
    customer_name: 'Customer A',
    opportunity_name: 'Enterprise Deal',
    deal_value: 50000,
    currency: 'USD',
    status: 'pending',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
  },
  {
    id: '2',
    vendor_id: '1',
    customer_name: 'Customer B',
    opportunity_name: 'SMB Deal',
    deal_value: 15000,
    currency: 'USD',
    status: 'approved',
    created_at: '2024-01-05T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
  },
];

const mockFiles = [
  {
    id: '1',
    filename: 'vendor_data.xlsx',
    original_filename: 'vendor_data.xlsx',
    size: 1024,
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    status: 'processed',
    created_at: '2024-01-01T00:00:00Z',
    processed_at: '2024-01-01T00:05:00Z',
  },
  {
    id: '2',
    filename: 'meeting_notes.txt',
    original_filename: 'meeting_notes.txt',
    size: 512,
    mime_type: 'text/plain',
    status: 'pending',
    created_at: '2024-01-05T00:00:00Z',
    processed_at: null,
  },
];

// Helper to create API response
const createApiResponse = <T>(data: T) => ({
  success: true,
  data,
  message: 'Success',
});

export const handlers = [
  // Vendors
  http.get(`${API_URL}/vendors`, () => {
    return HttpResponse.json(
      createApiResponse({
        vendors: mockVendors,
        total: mockVendors.length,
        page: 1,
        limit: 10,
      })
    );
  }),

  http.get(`${API_URL}/vendors/:id`, ({ params }) => {
    const vendor = mockVendors.find((v) => v.id === params.id);
    if (!vendor) {
      return HttpResponse.json(
        { success: false, message: 'Vendor not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(createApiResponse({ vendor }));
  }),

  http.post(`${API_URL}/vendors`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const newVendor = {
      id: String(mockVendors.length + 1),
      ...body,
      deal_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(createApiResponse({ vendor: newVendor }), {
      status: 201,
    });
  }),

  http.put(`${API_URL}/vendors/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const vendor = mockVendors.find((v) => v.id === params.id);
    if (!vendor) {
      return HttpResponse.json(
        { success: false, message: 'Vendor not found' },
        { status: 404 }
      );
    }
    const updatedVendor = {
      ...vendor,
      ...body,
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(createApiResponse({ vendor: updatedVendor }));
  }),

  http.delete(`${API_URL}/vendors/:id`, ({ params }) => {
    const vendor = mockVendors.find((v) => v.id === params.id);
    if (!vendor) {
      return HttpResponse.json(
        { success: false, message: 'Vendor not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(createApiResponse(null));
  }),

  // Deals
  http.get(`${API_URL}/deals`, () => {
    return HttpResponse.json(
      createApiResponse({
        deals: mockDeals,
        total: mockDeals.length,
        page: 1,
        limit: 10,
      })
    );
  }),

  http.get(`${API_URL}/deals/:id`, ({ params }) => {
    const deal = mockDeals.find((d) => d.id === params.id);
    if (!deal) {
      return HttpResponse.json(
        { success: false, message: 'Deal not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(createApiResponse({ deal }));
  }),

  http.post(`${API_URL}/deals`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const newDeal = {
      id: String(mockDeals.length + 1),
      ...body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(createApiResponse({ deal: newDeal }), {
      status: 201,
    });
  }),

  http.put(`${API_URL}/deals/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const deal = mockDeals.find((d) => d.id === params.id);
    if (!deal) {
      return HttpResponse.json(
        { success: false, message: 'Deal not found' },
        { status: 404 }
      );
    }
    const updatedDeal = {
      ...deal,
      ...body,
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(createApiResponse({ deal: updatedDeal }));
  }),

  http.delete(`${API_URL}/deals/:id`, ({ params }) => {
    const deal = mockDeals.find((d) => d.id === params.id);
    if (!deal) {
      return HttpResponse.json(
        { success: false, message: 'Deal not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(createApiResponse(null));
  }),

  // Files
  http.get(`${API_URL}/files`, () => {
    return HttpResponse.json(
      createApiResponse({
        files: mockFiles,
        total: mockFiles.length,
        page: 1,
        limit: 10,
      })
    );
  }),

  http.get(`${API_URL}/files/:id`, ({ params }) => {
    const file = mockFiles.find((f) => f.id === params.id);
    if (!file) {
      return HttpResponse.json(
        { success: false, message: 'File not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(createApiResponse({ file }));
  }),

  http.post(`${API_URL}/files/upload`, () => {
    const newFile = {
      id: String(mockFiles.length + 1),
      filename: 'uploaded_file.xlsx',
      original_filename: 'uploaded_file.xlsx',
      size: 2048,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      status: 'pending',
      created_at: new Date().toISOString(),
      processed_at: null,
    };
    return HttpResponse.json(createApiResponse({ file: newFile }), {
      status: 201,
    });
  }),

  http.delete(`${API_URL}/files/:id`, ({ params }) => {
    const file = mockFiles.find((f) => f.id === params.id);
    if (!file) {
      return HttpResponse.json(
        { success: false, message: 'File not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(createApiResponse(null));
  }),

  http.post(`${API_URL}/files/:id/process`, ({ params }) => {
    const file = mockFiles.find((f) => f.id === params.id);
    if (!file) {
      return HttpResponse.json(
        { success: false, message: 'File not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(
      createApiResponse({ message: 'Processing started' })
    );
  }),

  // Progress/Status endpoints
  http.get(`${API_URL}/progress/:fileId/status`, ({ params }) => {
    return HttpResponse.json(
      createApiResponse({
        fileId: params.fileId,
        status: 'processing',
        progress: 50,
        message: 'Processing file...',
      })
    );
  }),

  http.get(`${API_URL}/progress/files/processing`, () => {
    return HttpResponse.json(
      createApiResponse({
        files: [],
      })
    );
  }),

  http.get(`${API_URL}/progress/queue/stats`, () => {
    return HttpResponse.json(
      createApiResponse({
        pending: 0,
        processing: 0,
        completed: 5,
        failed: 0,
      })
    );
  }),
];

// Export mock data for use in tests
export { mockVendors, mockDeals, mockFiles };
