/**
 * Google OAuth2 Authentication Routes
 *
 * Handles OAuth2 authorization flow for Gmail and Google Drive.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db';
import { config } from '../config';
import logger from '../utils/logger';
import { getOAuth2AuthManager, GoogleService } from '../connectors/OAuth2AuthManager';
import { encryptToken, decryptToken } from '../services/tokenEncryption';

const router = Router();

/**
 * Helper to resolve operator/user ID from request headers
 */
function resolveUserId(req: Request): string {
  return (
    req.header('x-operator-id') ||
    req.header('x-user-id') ||
    req.header('x-requested-by') ||
    'default'
  );
}

/**
 * GET /api/google-auth/status
 * Check which services are configured
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const authManager = getOAuth2AuthManager();

    res.json({
      success: true,
      data: {
        gmail: {
          configured: authManager.isServiceConfigured('gmail'),
        },
        drive: {
          configured: authManager.isServiceConfigured('drive'),
        },
        redirectUri: config.connectors.googleOAuth2.redirectUri,
      },
    });
  } catch (error: any) {
    logger.error('Error checking Google auth status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to check Google auth status',
    });
  }
});

/**
 * GET /api/google-auth/authorize/:service
 * Initiate OAuth2 authorization flow
 */
router.get('/authorize/:service', async (req: Request, res: Response) => {
  const { service } = req.params;
  const userId = resolveUserId(req);

  // Validate service
  if (service !== 'gmail' && service !== 'drive') {
    return res.status(400).json({
      success: false,
      error: 'Invalid service. Must be "gmail" or "drive".',
    });
  }

  try {
    const authManager = getOAuth2AuthManager();

    // Check if service is configured
    if (!authManager.isServiceConfigured(service as GoogleService)) {
      return res.status(400).json({
        success: false,
        error: `${service} OAuth2 credentials are not configured`,
      });
    }

    // Generate authorization URL
    const { url, state } = authManager.generateAuthUrl(service as GoogleService, userId);

    logger.info('OAuth2 authorization initiated', { service, userId, state: state.substring(0, 8) });

    res.json({
      success: true,
      data: {
        authUrl: url,
        state,
      },
    });
  } catch (error: any) {
    logger.error('Failed to generate OAuth2 authorization URL', {
      service,
      userId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to initiate authorization',
    });
  }
});

/**
 * GET /api/google-auth/callback
 * Handle OAuth2 callback after user authorization
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error: authError } = req.query;

  // Handle authorization errors
  if (authError) {
    logger.warn('OAuth2 authorization was denied or failed', { error: authError });
    return res.redirect(`${config.cors.origin[0]}/settings/sync?error=authorization_denied`);
  }

  // Validate required parameters
  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    logger.warn('OAuth2 callback missing required parameters');
    return res.redirect(`${config.cors.origin[0]}/settings/sync?error=invalid_callback`);
  }

  try {
    const authManager = getOAuth2AuthManager();

    // Verify state and get pending authorization info
    const pending = authManager.verifyState(state);
    if (!pending) {
      logger.warn('OAuth2 callback with invalid or expired state', { state: state.substring(0, 8) });
      return res.redirect(`${config.cors.origin[0]}/settings/sync?error=invalid_state`);
    }

    const { service, codeVerifier, userId } = pending;

    // Exchange code for tokens
    const tokens = await authManager.exchangeCode(service, code, codeVerifier);

    // Get user email
    const accountEmail = await authManager.getUserEmail(service, tokens.accessToken);

    // Encrypt tokens before storing
    const encryptedAccessToken = encryptToken(tokens.accessToken);
    const encryptedRefreshToken = encryptToken(tokens.refreshToken);

    // Check if we already have a token for this user/account/service combination
    const existingToken = await query(
      `SELECT id FROM google_oauth_tokens
       WHERE user_id = $1 AND account_email = $2 AND service_type = $3 AND revoked_at IS NULL`,
      [userId, accountEmail, service]
    );

    if (existingToken.rows.length > 0) {
      // Update existing token
      await query(
        `UPDATE google_oauth_tokens
         SET access_token = $1, refresh_token = $2, token_expiry = $3, scopes = $4, updated_at = NOW()
         WHERE id = $5`,
        [
          encryptedAccessToken,
          encryptedRefreshToken,
          new Date(tokens.expiryDate),
          tokens.scope.split(' '),
          existingToken.rows[0].id,
        ]
      );

      logger.info('Updated existing OAuth2 token', { service, userId, accountEmail });
    } else {
      // Insert new token
      await query(
        `INSERT INTO google_oauth_tokens
         (user_id, account_email, access_token, refresh_token, token_expiry, scopes, service_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          accountEmail,
          encryptedAccessToken,
          encryptedRefreshToken,
          new Date(tokens.expiryDate),
          tokens.scope.split(' '),
          service,
        ]
      );

      logger.info('Stored new OAuth2 token', { service, userId, accountEmail });
    }

    // Redirect back to frontend with success
    res.redirect(`${config.cors.origin[0]}/settings/sync?connected=${service}&email=${encodeURIComponent(accountEmail)}`);
  } catch (error: any) {
    logger.error('OAuth2 callback failed', { error: error.message });
    res.redirect(`${config.cors.origin[0]}/settings/sync?error=callback_failed`);
  }
});

/**
 * GET /api/google-auth/accounts
 * List connected Google accounts for the current user
 */
router.get('/accounts', async (req: Request, res: Response) => {
  const userId = resolveUserId(req);

  try {
    const result = await query(
      `SELECT id, account_email, service_type, scopes, token_expiry, created_at, updated_at
       FROM google_oauth_tokens
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );

    const accounts = result.rows.map((row) => ({
      id: row.id,
      accountEmail: row.account_email,
      serviceType: row.service_type,
      scopes: row.scopes,
      tokenExpiry: row.token_expiry,
      isExpired: new Date(row.token_expiry) < new Date(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({
      success: true,
      data: accounts,
    });
  } catch (error: any) {
    logger.error('Failed to fetch connected accounts', { userId, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch connected accounts',
    });
  }
});

/**
 * DELETE /api/google-auth/accounts/:id
 * Disconnect a Google account (revoke and mark as revoked)
 */
router.delete('/accounts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = resolveUserId(req);

  try {
    // Get the token record
    const result = await query(
      `SELECT id, service_type, refresh_token FROM google_oauth_tokens
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Account not found or already disconnected',
      });
    }

    const { service_type, refresh_token } = result.rows[0];

    // Try to revoke the token with Google
    try {
      const authManager = getOAuth2AuthManager();
      const decryptedRefreshToken = decryptToken(refresh_token);
      await authManager.revokeToken(service_type as GoogleService, decryptedRefreshToken);
    } catch (revokeError: any) {
      // Log but don't fail - the token may already be invalid
      logger.warn('Failed to revoke token with Google', { id, error: revokeError.message });
    }

    // Mark as revoked in database
    await query(
      `UPDATE google_oauth_tokens SET revoked_at = NOW() WHERE id = $1`,
      [id]
    );

    // Delete any sync configurations associated with this token
    await query(
      `DELETE FROM sync_configurations WHERE token_id = $1`,
      [id]
    );

    logger.info('Google account disconnected', { id, userId, service: service_type });

    res.json({
      success: true,
      message: 'Account disconnected successfully',
    });
  } catch (error: any) {
    logger.error('Failed to disconnect Google account', { id, userId, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect account',
    });
  }
});

/**
 * POST /api/google-auth/accounts/:id/refresh
 * Force refresh an access token
 */
router.post('/accounts/:id/refresh', async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = resolveUserId(req);

  try {
    // Get the token record
    const result = await query(
      `SELECT id, service_type, refresh_token FROM google_oauth_tokens
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
      });
    }

    const { service_type, refresh_token } = result.rows[0];

    // Decrypt refresh token
    const decryptedRefreshToken = decryptToken(refresh_token);

    // Refresh the token
    const authManager = getOAuth2AuthManager();
    const { accessToken, expiryDate } = await authManager.refreshAccessToken(
      service_type as GoogleService,
      decryptedRefreshToken
    );

    // Encrypt and store new access token
    const encryptedAccessToken = encryptToken(accessToken);
    await query(
      `UPDATE google_oauth_tokens
       SET access_token = $1, token_expiry = $2, updated_at = NOW()
       WHERE id = $3`,
      [encryptedAccessToken, new Date(expiryDate), id]
    );

    logger.info('Access token refreshed', { id, userId, service: service_type });

    res.json({
      success: true,
      data: {
        tokenExpiry: new Date(expiryDate),
      },
    });
  } catch (error: any) {
    logger.error('Failed to refresh access token', { id, userId, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to refresh token. You may need to reconnect the account.',
    });
  }
});

export default router;
