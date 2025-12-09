import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Attaches a correlation/request ID to each request for logging/tracing.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const headerId = req.header('x-request-id');
  const id = headerId && headerId.trim().length > 0 ? headerId.trim() : randomUUID();

  // Attach to request and response for downstream use
  (req as any).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
