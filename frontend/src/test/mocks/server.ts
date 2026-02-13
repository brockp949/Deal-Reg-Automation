import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// Setup MSW server with the handlers
export const server = setupServer(...handlers);

// Export handlers for extending in individual tests
export { handlers };
