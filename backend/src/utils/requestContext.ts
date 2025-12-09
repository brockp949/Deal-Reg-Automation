/**
 * Simple async-local context for request-scoped metadata (e.g., requestId).
 */
import { AsyncLocalStorage } from 'async_hooks';

type RequestContext = {
  requestId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T) {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
