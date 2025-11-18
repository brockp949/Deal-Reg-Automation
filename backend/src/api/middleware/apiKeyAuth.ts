import { Request, Response, NextFunction } from 'express';

export type ApiKeyRole = 'read' | 'write' | 'admin';

interface ApiKeyConfig {
  key: string;
  role: ApiKeyRole;
  description?: string;
}

// Extend Express Request to include user/role
declare global {
  namespace Express {
    interface Request {
      apiKeyRole?: ApiKeyRole;
    }
  }
}

/**
 * Parse API keys from environment variables
 * Format: KEY1:role1:description1,KEY2:role2:description2
 * Example: abc123:read:Read-only key,xyz789:admin:Admin key
 */
function parseApiKeys(): ApiKeyConfig[] {
  const keysEnv = process.env.OPPORTUNITY_API_KEYS || process.env.OPPORTUNITY_API_KEY;
  if (!keysEnv) {
    return [];
  }

  // Handle legacy single-key format (no role specified = admin for backward compat)
  if (!keysEnv.includes(':')) {
    return [{ key: keysEnv, role: 'admin', description: 'Legacy admin key' }];
  }

  // Parse new format: key:role:description
  const keys: ApiKeyConfig[] = [];
  const entries = keysEnv.split(',').map((e) => e.trim());

  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length >= 2) {
      const [key, role, ...descParts] = parts;
      const description = descParts.join(':') || undefined;

      if (['read', 'write', 'admin'].includes(role)) {
        keys.push({
          key: key.trim(),
          role: role as ApiKeyRole,
          description,
        });
      }
    }
  }

  return keys;
}

const apiKeys = parseApiKeys();

/**
 * API key authentication middleware
 * Validates the API key and attaches the role to req.apiKeyRole
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  if (apiKeys.length === 0) {
    // No API keys configured, allow all requests
    return next();
  }

  const headerKey = req.header('x-api-key');
  if (!headerKey) {
    return res.status(401).json({ error: 'Missing API key. Include X-API-Key header.' });
  }

  const keyConfig = apiKeys.find((k) => k.key === headerKey);
  if (!keyConfig) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // Attach role to request for downstream middleware
  req.apiKeyRole = keyConfig.role;

  return next();
}

/**
 * Role-based authorization middleware factory
 * @param allowedRoles - Roles that can access this endpoint
 * @example requireRole(['admin', 'write'])
 */
export function requireRole(allowedRoles: ApiKeyRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKeyRole) {
      // No role set (API keys not configured), allow by default
      return next();
    }

    if (!allowedRoles.includes(req.apiKeyRole)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.apiKeyRole,
      });
    }

    return next();
  };
}

/**
 * Get configured API keys (for testing/debugging)
 */
export function getApiKeyConfigs(): Omit<ApiKeyConfig, 'key'>[] {
  return apiKeys.map(({ role, description }) => ({ role, description }));
}
