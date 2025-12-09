import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';

/**
 * Logs API key role usage for auditing.
 * If no API keys are configured (req.apiKeyRole undefined), no log is emitted.
 */
export function apiKeyUsageLogger(req: Request, _res: Response, next: NextFunction) {
  if (req.apiKeyRole) {
    logger.info('API key access', {
      method: req.method,
      path: req.path,
      role: req.apiKeyRole,
    });
  }
  next();
}
