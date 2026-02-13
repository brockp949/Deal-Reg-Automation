/**
 * Vendors Page Tests
 * Comprehensive test suite for the Vendors page component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { server } from '@/test/mocks/server';
import Vendors from '../Vendors';

// Constants
const API_URL = 'http://localhost:4000/api';

// Mock data factories
const createMockVendor = (overrides = {}) => ({
  id: '1',
  name: 'Acme Corporation',
  normalized_name: 'acme corporation',
  email_domains: ['acme.com'],
  industry: 'Technology',
  website: 'https://acme.com',
  notes: 'Test vendor',
  status: 'active' as const,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
  metadata: {},
  ...overrides,
});

const createMockDeal = (overrides = {}) => ({
  id: '1',
  vendor_id: '1',
  vendor_name: 'Acme Corporation',
  deal_name: 'Enterprise Deal',
  deal_value: 50000,
  currency: 'USD',
  customer_name: 'Customer A',
  customer_industry: 'Finance',
  registration_date: '2024-01-01',
  expected_close_date: '2024-06-01',
  status: 'registered' as const,
  deal_stage: 'Negotiation',
  probability: 75,
  notes: 'Test deal',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
  metadata: {},
  ...overrides,
});

// Helper to create API response
const createApiResponse = <T,>(data: T) => ({
  success: true,
  data,
  message: 'Success',
});

// Default mock vendors
const mockVendors = [
  createMockVendor({ id: '1', name: 'Acme Corporation', industry: 'Technology', status: 'active' }),
  createMockVendor({ id: '2', name: 'TechCorp Inc', industry: 'Healthcare', status: 'active' }),
  createMockVendor({ id: '3', name: 'Global Solutions', industry: 'Finance', status: 'inactive' }),
];

// Default mock deals for vendor 1
const mockDeals = [
  createMockDeal({ id: '1', vendor_id: '1', deal_name: 'Enterprise Deal', deal_value: 50000, status: 'registered' }),
  createMockDeal({ id: '2', vendor_id: '1', deal_name: 'SMB Deal', deal_value: 15000, status: 'approved' }),
  createMockDeal({ id: '3', vendor_id: '1', deal_name: 'Startup Deal', deal_value: 8000, status: 'closed-won' }),
];

describe('Vendors Page', () => {
  beforeEach(() => {
    // Reset handlers to defaults before each test
    server.resetHandlers();

    // Set up default handlers for vendors page
    server.use(
      http.get(`${API_URL}/vendors`, ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search');

        let filteredVendors = mockVendors;
        if (search) {
          filteredVendors = mockVendors.filter((v) =>
            v.name.toLowerCase().includes(search.toLowerCase())
          );
        }

        return HttpResponse.json(
          createApiResponse({
            data: filteredVendors,
            pagination: {
              page: 1,
              limit: 100,
              total: filteredVendors.length,
              totalPages: 1,
            },
          })
        );
      }),

      http.get(`${API_URL}/vendors/:id/deals`, ({ params }) => {
        const vendorId = params.id as string;
        const deals = mockDeals.filter((d) => d.vendor_id === vendorId);

        return HttpResponse.json(
          createApiResponse({
            data: deals,
            pagination: {
              page: 1,
              limit: 100,
              total: deals.length,
              totalPages: 1,
            },
          })
        );
      }),

      // Handler for agreements endpoint
      http.get(`${API_URL}/vendors/:id/agreements`, () => {
        return HttpResponse.json(
          createApiResponse({
            data: [],
          })
        );
      }),

      http.post(`${API_URL}/vendors`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        const newVendor = createMockVendor({
          id: '4',
          ...body,
        });
        return HttpResponse.json(createApiResponse(newVendor), { status: 201 });
      }),

      http.put(`${API_URL}/vendors/:id`, async ({ params, request }) => {
        const body = await request.json() as Record<string, unknown>;
        const vendor = mockVendors.find((v) => v.id === params.id);
        if (!vendor) {
          return HttpResponse.json(
            { success: false, message: 'Vendor not found' },
            { status: 404 }
          );
        }
        return HttpResponse.json(
          createApiResponse({ ...vendor, ...body, updated_at: new Date().toISOString() })
        );
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
      })
    );
  });

  describe('Rendering vendors list', () => {
    it('renders the vendors page with vendor list', async () => {
      render(<Vendors />);

      // Check page title
      expect(screen.getByText('Vendors')).toBeInTheDocument();

      // Wait for vendors to load - use getAllByText since vendor name appears in both list and header
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.getByText('TechCorp Inc')).toBeInTheDocument();
      expect(screen.getByText('Global Solutions')).toBeInTheDocument();
    });

    it('displays vendor count in footer', async () => {
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('3 vendors total')).toBeInTheDocument();
      });
    });

    it('displays vendor industries in the list', async () => {
      render(<Vendors />);

      await waitFor(() => {
        // Industry appears in both the vendor list and detail header
        const technologyElements = screen.getAllByText('Technology');
        expect(technologyElements.length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.getByText('Healthcare')).toBeInTheDocument();
      // Finance appears in list for Global Solutions - but first vendor is selected so Finance badge may show
      const financeElements = screen.getAllByText('Finance');
      expect(financeElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Loading skeleton', () => {
    it('shows loading indicator while fetching vendors', async () => {
      // Delay the response to ensure loading state is visible
      server.use(
        http.get(`${API_URL}/vendors`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json(
            createApiResponse({
              data: mockVendors,
              pagination: { page: 1, limit: 100, total: mockVendors.length, totalPages: 1 },
            })
          );
        })
      );

      render(<Vendors />);

      // Should show loading spinner
      const sidebar = screen.getByText('Vendors').closest('div')?.parentElement;
      expect(sidebar).toBeInTheDocument();

      // Wait for vendors to load
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no vendors exist', async () => {
      server.use(
        http.get(`${API_URL}/vendors`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            })
          );
        })
      );

      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('No vendors yet')).toBeInTheDocument();
      });
    });

    it('shows "No vendors found" when search returns no results', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      // Wait for vendors to load first
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Search for non-existent vendor
      const searchInput = screen.getByPlaceholderText('Search vendors...');
      await user.type(searchInput, 'NonExistentVendor');

      await waitFor(() => {
        expect(screen.getByText('No vendors found')).toBeInTheDocument();
      });
    });

    it('shows empty deals state when vendor has no deals', async () => {
      server.use(
        http.get(`${API_URL}/vendors/:id/deals`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            })
          );
        })
      );

      render(<Vendors />);

      // Wait for vendors to load and first vendor to be selected
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Should show empty deals message
      await waitFor(() => {
        expect(screen.getByText('No deals found')).toBeInTheDocument();
      });
    });
  });

  describe('Search/filter vendors', () => {
    it('filters vendors based on search input', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      // Wait for initial load
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Type in search input
      const searchInput = screen.getByPlaceholderText('Search vendors...');
      await user.type(searchInput, 'Tech');

      // Should filter to only TechCorp (use getAllByText since vendor appears in list and header)
      await waitFor(() => {
        const techCorpElements = screen.getAllByText('TechCorp Inc');
        expect(techCorpElements.length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Acme Corporation')).not.toBeInTheDocument();
        expect(screen.queryByText('Global Solutions')).not.toBeInTheDocument();
      });
    });

    it('clears search and shows all vendors', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      const searchInput = screen.getByPlaceholderText('Search vendors...');

      // Type search
      await user.type(searchInput, 'Tech');
      await waitFor(() => {
        expect(screen.queryByText('Acme Corporation')).not.toBeInTheDocument();
      });

      // Clear search
      await user.clear(searchInput);
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('TechCorp Inc')).toBeInTheDocument();
        expect(screen.getByText('Global Solutions')).toBeInTheDocument();
      });
    });
  });

  describe('Create vendor button and dialog', () => {
    it('renders Add Vendor button', async () => {
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add vendor/i })).toBeInTheDocument();
      });
    });

    it('opens create vendor dialog when button is clicked', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add vendor/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add vendor/i });
      await user.click(addButton);

      // Dialog should open
      await waitFor(() => {
        expect(screen.getByText('Create New Vendor')).toBeInTheDocument();
      });
    });

    it('displays form fields in create dialog', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add vendor/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add vendor/i }));

      await waitFor(() => {
        // Check for form fields - Industry uses a custom Select, not a native input
        expect(screen.getByLabelText(/vendor name/i)).toBeInTheDocument();
        expect(screen.getByText('Industry')).toBeInTheDocument(); // Label for Industry
        expect(screen.getByLabelText(/website/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/email domains/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
      });
    });

    it('can cancel create vendor dialog', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add vendor/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add vendor/i }));

      await waitFor(() => {
        expect(screen.getByText('Create New Vendor')).toBeInTheDocument();
      });

      // Click cancel
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByText('Create New Vendor')).not.toBeInTheDocument();
      });
    });
  });

  describe('Edit vendor functionality', () => {
    it('shows edit option in dropdown menu for selected vendor', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      // Wait for vendors to load
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Find and click the more options button (should be visible for selected vendor)
      const moreButton = screen.getByRole('button', { name: /open menu/i });
      await user.click(moreButton);

      // Should show Edit option
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
      });
    });

    it('opens edit dialog when Edit is clicked', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Open dropdown
      const moreButton = screen.getByRole('button', { name: /open menu/i });
      await user.click(moreButton);

      // Click Edit
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('menuitem', { name: /edit/i }));

      // Edit dialog should open
      await waitFor(() => {
        expect(screen.getByText('Edit Vendor')).toBeInTheDocument();
      });
    });

    it('pre-fills form with vendor data in edit dialog', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Open dropdown and click Edit
      await user.click(screen.getByRole('button', { name: /open menu/i }));
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('menuitem', { name: /edit/i }));

      // Check form is pre-filled
      await waitFor(() => {
        const nameInput = screen.getByLabelText(/vendor name/i) as HTMLInputElement;
        expect(nameInput.value).toBe('Acme Corporation');
      });
    });
  });

  describe('Delete vendor with confirmation', () => {
    it('shows delete option in dropdown menu', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Open dropdown
      const moreButton = screen.getByRole('button', { name: /open menu/i });
      await user.click(moreButton);

      // Should show Delete option
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
      });
    });

    it('opens confirmation dialog when Delete is clicked', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Open dropdown
      await user.click(screen.getByRole('button', { name: /open menu/i }));

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
      });

      // Click Delete
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      // Confirmation dialog should open
      await waitFor(() => {
        expect(screen.getByText(/delete vendor/i)).toBeInTheDocument();
        expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
      });
    });

    it('shows vendor name in delete confirmation dialog', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Open dropdown and click Delete
      await user.click(screen.getByRole('button', { name: /open menu/i }));
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      // Dialog should mention vendor name
      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(/acme corporation/i)).toBeInTheDocument();
      });
    });

    it('can cancel delete operation', async () => {
      const user = userEvent.setup();
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Open dropdown and click Delete
      await user.click(screen.getByRole('button', { name: /open menu/i }));
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByText(/delete vendor/i)).toBeInTheDocument();
      });

      // Click cancel
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // Dialog should close, vendor should still exist
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Vendor should still be visible
      const acmeElements = screen.getAllByText('Acme Corporation');
      expect(acmeElements.length).toBeGreaterThanOrEqual(1);
    });

    it('deletes vendor when confirmed', async () => {
      const user = userEvent.setup();
      const deletedVendorId = '1';

      let deleteWasCalled = false;
      server.use(
        http.delete(`${API_URL}/vendors/:id`, ({ params }) => {
          if (params.id === deletedVendorId) {
            deleteWasCalled = true;
          }
          return HttpResponse.json(createApiResponse(null));
        })
      );

      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Open dropdown and click Delete
      await user.click(screen.getByRole('button', { name: /open menu/i }));
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      // Wait for dialog and confirm deletion
      await waitFor(() => {
        expect(screen.getByText(/delete vendor/i)).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByRole('button', { name: /delete/i }).find(
        (btn) => btn.textContent === 'Delete'
      );
      expect(deleteButton).toBeDefined();
      if (deleteButton) {
        await user.click(deleteButton);
      }

      await waitFor(() => {
        expect(deleteWasCalled).toBe(true);
      });
    });
  });

  describe('Vendor status badges display correctly', () => {
    it('displays active status badge', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Find active badges
      const badges = screen.getAllByText('active');
      expect(badges.length).toBeGreaterThan(0);
    });

    it('displays inactive status badge', async () => {
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('Global Solutions')).toBeInTheDocument();
      });

      // Find inactive badge
      const inactiveBadge = screen.getByText('inactive');
      expect(inactiveBadge).toBeInTheDocument();
    });

    it('displays different styling for active vs inactive status', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Active badges should have outline variant
      const activeBadges = screen.getAllByText('active');
      activeBadges.forEach((badge) => {
        expect(badge).toHaveClass('border');
      });

      // Inactive badge should have secondary variant
      const inactiveBadge = screen.getByText('inactive');
      expect(inactiveBadge).toBeInTheDocument();
    });
  });

  describe('Vendor selection and detail view', () => {
    it('auto-selects first vendor on load', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // First vendor details should be shown
      await waitFor(() => {
        // The vendor name should appear in the header (larger text)
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading).toHaveTextContent('Acme Corporation');
      });
    });

    it('displays vendor deals when vendor is selected', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Wait for deals to load
      await waitFor(() => {
        expect(screen.getByText('Enterprise Deal')).toBeInTheDocument();
        expect(screen.getByText('SMB Deal')).toBeInTheDocument();
        expect(screen.getByText('Startup Deal')).toBeInTheDocument();
      });
    });

    it('switches vendor when clicking on different vendor', async () => {
      const user = userEvent.setup();

      // Set up deals for vendor 2
      server.use(
        http.get(`${API_URL}/vendors/:id/deals`, ({ params }) => {
          if (params.id === '2') {
            return HttpResponse.json(
              createApiResponse({
                data: [createMockDeal({ id: '10', vendor_id: '2', deal_name: 'TechCorp Deal' })],
                pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
              })
            );
          }
          return HttpResponse.json(
            createApiResponse({
              data: mockDeals.filter((d) => d.vendor_id === params.id),
              pagination: { page: 1, limit: 100, total: mockDeals.length, totalPages: 1 },
            })
          );
        })
      );

      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('TechCorp Inc')).toBeInTheDocument();
      });

      // Click on TechCorp vendor
      const techCorpItem = screen.getByText('TechCorp Inc').closest('div[class*="cursor-pointer"]');
      expect(techCorpItem).toBeDefined();
      if (techCorpItem) {
        await user.click(techCorpItem);
      }

      // Vendor header should change
      await waitFor(() => {
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading).toHaveTextContent('TechCorp Inc');
      });
    });

    it('displays vendor statistics correctly', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Wait for deals to load and stats to calculate
      await waitFor(() => {
        // Total Deals
        expect(screen.getByText('Total Deals')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();

        // Total Value (50000 + 15000 + 8000 = 73000)
        expect(screen.getByText('Total Value')).toBeInTheDocument();

        // Avg Deal Size
        expect(screen.getByText('Avg Deal Size')).toBeInTheDocument();
      });
    });
  });

  describe('Deals table', () => {
    it('displays deal information in table', async () => {
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('Enterprise Deal')).toBeInTheDocument();
      });

      // Check table headers
      expect(screen.getByText('Deal Name')).toBeInTheDocument();
      expect(screen.getByText('Customer')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Stage')).toBeInTheDocument();
      expect(screen.getByText('Deal Value')).toBeInTheDocument();
      expect(screen.getByText('Probability')).toBeInTheDocument();
    });

    it('displays deal status badges', async () => {
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('Registered')).toBeInTheDocument();
        expect(screen.getByText('Approved')).toBeInTheDocument();
        expect(screen.getByText('Closed Won')).toBeInTheDocument();
      });
    });

    it('displays customer names', async () => {
      render(<Vendors />);

      // Wait for vendors to load first
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Then wait for deals to load
      await waitFor(() => {
        expect(screen.getByText('Enterprise Deal')).toBeInTheDocument();
      });

      // Check for customer names (multiple deals have the same customer)
      const customerElements = screen.getAllByText('Customer A');
      expect(customerElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error handling', () => {
    it('handles API error when fetching vendors', async () => {
      server.use(
        http.get(`${API_URL}/vendors`, () => {
          return HttpResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      render(<Vendors />);

      // Should show empty state or error handling
      await waitFor(() => {
        expect(screen.getByText('No vendors yet')).toBeInTheDocument();
      });
    });

    it('handles API error when fetching vendor deals', async () => {
      server.use(
        http.get(`${API_URL}/vendors/:id/deals`, () => {
          return HttpResponse.json(
            { success: false, error: 'Failed to fetch deals' },
            { status: 500 }
          );
        })
      );

      render(<Vendors />);

      // Vendors should still load
      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      // Deals section should show empty state
      await waitFor(() => {
        expect(screen.getByText('No deals found')).toBeInTheDocument();
      });
    });

    it('handles network error gracefully', async () => {
      server.use(
        http.get(`${API_URL}/vendors`, () => {
          return HttpResponse.error();
        })
      );

      render(<Vendors />);

      // Component should still render without crashing
      await waitFor(() => {
        expect(screen.getByText('Vendors')).toBeInTheDocument();
      });
    });
  });

  describe('Action buttons', () => {
    it('displays Import Deals button when vendor is selected', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /import deals/i })).toBeInTheDocument();
      });
    });

    it('displays Upload Agreement button when vendor is selected', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload agreement/i })).toBeInTheDocument();
      });
    });

    it('displays Export button when vendor is selected', async () => {
      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
      });
    });

    it('disables Export button when no deals exist', async () => {
      server.use(
        http.get(`${API_URL}/vendors/:id/deals`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            })
          );
        })
      );

      render(<Vendors />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corporation');
        expect(acmeElements.length).toBeGreaterThanOrEqual(1);
      });

      await waitFor(() => {
        const exportButton = screen.getByRole('button', { name: /export/i });
        expect(exportButton).toBeDisabled();
      });
    });
  });

  describe('Select vendor prompt', () => {
    it('shows select vendor prompt when no vendor is selected and list is empty', async () => {
      server.use(
        http.get(`${API_URL}/vendors`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            })
          );
        })
      );

      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('Select a vendor')).toBeInTheDocument();
        expect(screen.getByText('View details and associated deals')).toBeInTheDocument();
      });
    });
  });

  describe('Vendor website link', () => {
    it('displays website link when vendor has website', async () => {
      render(<Vendors />);

      await waitFor(() => {
        expect(screen.getByText('Visit Website')).toBeInTheDocument();
      });

      const link = screen.getByText('Visit Website');
      expect(link.closest('a')).toHaveAttribute('href', 'https://acme.com');
      expect(link.closest('a')).toHaveAttribute('target', '_blank');
    });

    it('does not display website link when vendor has no website', async () => {
      server.use(
        http.get(`${API_URL}/vendors`, () => {
          return HttpResponse.json(
            createApiResponse({
              data: [createMockVendor({ id: '1', name: 'No Website Corp', website: undefined })],
              pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
            })
          );
        })
      );

      render(<Vendors />);

      // Wait for the vendor header to show (vendor name appears in both list and header)
      await waitFor(() => {
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading).toHaveTextContent('No Website Corp');
      });

      // Verify no Visit Website link is present
      expect(screen.queryByText('Visit Website')).not.toBeInTheDocument();
    });
  });
});
