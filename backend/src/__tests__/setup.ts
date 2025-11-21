/**
 * Jest Test Setup
 * Sets up environment variables and mocks for testing
 */

// Set required environment variables for tests
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-must-be-32-chars';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.PORT = '4000';
process.env.ANTHROPIC_API_KEY = 'test-api-key';

// Mock logger to suppress logs during tests
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Clean up mocks after each test
// resetAllMocks() clears mock history AND resets implementations
afterEach(() => {
  jest.resetAllMocks();
});

describe('test setup', () => {
  it('should initialize test environment', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });
});
