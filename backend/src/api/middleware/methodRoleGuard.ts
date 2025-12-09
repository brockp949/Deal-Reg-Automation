import { Request, Response, NextFunction } from 'express';
import { ApiKeyRole } from './apiKeyAuth';

/**
 * Enforces role-based access based on HTTP method.
 * GET/HEAD/OPTIONS require read|write|admin.
 * Mutations (POST/PUT/PATCH/DELETE) require write|admin.
 * If no apiKeyRole is present (API keys not configured), the request is allowed.
 */
export function methodRoleGuard(req: Request, res: Response, next: NextFunction) {
  const role = req.apiKeyRole;

  // No keys configured or no role set: allow
  if (!role) return next();

  const method = req.method.toUpperCase();

  const readAllowed: ApiKeyRole[] = ['read', 'write', 'admin'];
  const writeAllowed: ApiKeyRole[] = ['write', 'admin'];

  const isReadMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);

  if (isReadMethod && readAllowed.includes(role)) return next();
  if (!isReadMethod && writeAllowed.includes(role)) return next();

  return res.status(403).json({
    success: false,
    error: 'Insufficient permissions for this operation',
    required: isReadMethod ? readAllowed : writeAllowed,
    current: role,
  });
}
