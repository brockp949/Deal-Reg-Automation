// Export test utilities
export * from './test-utils';

// Export mock data
export { mockVendors, mockDeals, mockFiles } from './mocks/handlers';

// Export server for extending handlers in tests
export { server, handlers } from './mocks/server';
