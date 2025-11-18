import { Request, Response, NextFunction } from 'express';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const configuredKey = process.env.OPPORTUNITY_API_KEY;
  if (!configuredKey) {
    return next();
  }

  const headerKey = req.header('x-api-key');
  if (!headerKey || headerKey !== configuredKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  return next();
}
