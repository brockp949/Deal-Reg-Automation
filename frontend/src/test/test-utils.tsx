import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

// Create a custom QueryClient for testing
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

interface WrapperProps {
  children: React.ReactNode;
}

// All the providers wrapper
const AllTheProviders = ({ children }: WrapperProps) => {
  const testQueryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={testQueryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

// Custom render function that wraps components with providers
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything from testing-library
export * from '@testing-library/react';
export { userEvent } from '@testing-library/user-event';

// Override render with custom render
export { customRender as render };

// Export for creating isolated query clients in specific tests
export { createTestQueryClient };

// Helper to wait for loading states to resolve
export const waitForLoadingToFinish = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

// Helper to create mock form data
export const createMockFile = (
  name: string,
  size: number,
  type: string
): File => {
  const file = new File([''], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

// Helper to simulate file drop
export const createDataTransfer = (files: File[]): DataTransfer => {
  const dataTransfer = {
    files,
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
    })),
    types: ['Files'],
  } as unknown as DataTransfer;
  return dataTransfer;
};
