/**
 * OAuth2AuthManager - Handles OAuth 2.0 authentication for Google APIs
 *
 * Unlike GoogleAuthManager (which uses service accounts), this manager handles
 * the user authorization flow with browser-based consent for personal accounts.
 */

import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';
import logger from '../utils/logger';

export type GoogleService = 'gmail' | 'drive';

export interface OAuth2Credentials {
  installed: {
    client_id: string;
    project_id: string;
    auth_uri: string;
    token_uri: string;
    auth_provider_x509_cert_url: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export interface OAuth2TokenSet {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
}

// Scopes for each service
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * OAuth2AuthManager handles the OAuth 2.0 authorization flow for Google APIs.
 */
export class OAuth2AuthManager {
  private gmailCredentials?: OAuth2Credentials;
  private driveCredentials?: OAuth2Credentials;
  private redirectUri: string;

  // PKCE state cache (in production, use Redis or database)
  private pendingStates: Map<string, { service: GoogleService; codeVerifier: string; userId: string }> = new Map();

  constructor() {
    this.redirectUri = config.connectors.googleOAuth2.redirectUri;
    this.loadCredentials();
  }

  /**
   * Load OAuth2 credentials from files
   */
  private loadCredentials(): void {
    const gmailPath = config.connectors.googleOAuth2.gmailCredentialsPath;
    const drivePath = config.connectors.googleOAuth2.driveCredentialsPath;

    if (gmailPath && fs.existsSync(gmailPath)) {
      try {
        const content = fs.readFileSync(gmailPath, 'utf-8');
        this.gmailCredentials = JSON.parse(content);
        logger.info('Gmail OAuth2 credentials loaded', { path: gmailPath });
      } catch (error) {
        logger.error('Failed to load Gmail credentials', { path: gmailPath, error: (error as Error).message });
      }
    }

    if (drivePath && fs.existsSync(drivePath)) {
      try {
        const content = fs.readFileSync(drivePath, 'utf-8');
        this.driveCredentials = JSON.parse(content);
        logger.info('Drive OAuth2 credentials loaded', { path: drivePath });
      } catch (error) {
        logger.error('Failed to load Drive credentials', { path: drivePath, error: (error as Error).message });
      }
    }
  }

  /**
   * Check if a service is configured
   */
  isServiceConfigured(service: GoogleService): boolean {
    if (service === 'gmail') {
      return !!this.gmailCredentials;
    } else if (service === 'drive') {
      return !!this.driveCredentials;
    }
    return false;
  }

  /**
   * Get the credentials for a service
   */
  private getCredentials(service: GoogleService): OAuth2Credentials {
    const credentials = service === 'gmail' ? this.gmailCredentials : this.driveCredentials;
    if (!credentials) {
      throw new Error(`OAuth2 credentials not configured for ${service}`);
    }
    return credentials;
  }

  /**
   * Get the scopes for a service
   */
  private getScopes(service: GoogleService): string[] {
    return service === 'gmail' ? GMAIL_SCOPES : DRIVE_SCOPES;
  }

  /**
   * Create an OAuth2 client for a service
   */
  createClient(service: GoogleService): OAuth2Client {
    const credentials = this.getCredentials(service);
    return new google.auth.OAuth2(
      credentials.installed.client_id,
      credentials.installed.client_secret,
      this.redirectUri
    );
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate an authorization URL for a service
   */
  generateAuthUrl(service: GoogleService, userId: string): { url: string; state: string } {
    const oauth2Client = this.createClient(service);
    const scopes = this.getScopes(service);
    const { codeVerifier, codeChallenge } = this.generatePKCE();

    // Generate state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state for verification during callback
    this.pendingStates.set(state, { service, codeVerifier, userId });

    // Clean up old states after 10 minutes
    setTimeout(() => {
      this.pendingStates.delete(state);
    }, 10 * 60 * 1000);

    // Note: PKCE code_challenge_method needs any cast as googleapis types are incomplete
    const authOptions: Record<string, any> = {
      access_type: 'offline', // Get refresh token
      scope: scopes,
      state,
      prompt: 'consent', // Force consent to get refresh token
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
    const url = oauth2Client.generateAuthUrl(authOptions);

    logger.info('Generated OAuth2 authorization URL', { service, userId, state: state.substring(0, 8) });

    return { url, state };
  }

  /**
   * Verify and retrieve pending state
   */
  verifyState(state: string): { service: GoogleService; codeVerifier: string; userId: string } | null {
    const pending = this.pendingStates.get(state);
    if (pending) {
      this.pendingStates.delete(state);
      return pending;
    }
    return null;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(
    service: GoogleService,
    code: string,
    codeVerifier: string
  ): Promise<OAuth2TokenSet> {
    const oauth2Client = this.createClient(service);

    try {
      const { tokens } = await oauth2Client.getToken({
        code,
        codeVerifier,
      });

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Token exchange did not return required tokens');
      }

      logger.info('Successfully exchanged authorization code for tokens', { service });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date || Date.now() + 3600 * 1000,
        scope: tokens.scope || this.getScopes(service).join(' '),
      };
    } catch (error) {
      logger.error('Failed to exchange authorization code', {
        service,
        error: (error as Error).message,
      });
      throw new Error(`Failed to exchange authorization code: ${(error as Error).message}`);
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(
    service: GoogleService,
    refreshToken: string
  ): Promise<{ accessToken: string; expiryDate: number }> {
    const oauth2Client = this.createClient(service);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('Token refresh did not return an access token');
      }

      logger.info('Successfully refreshed access token', { service });

      return {
        accessToken: credentials.access_token,
        expiryDate: credentials.expiry_date || Date.now() + 3600 * 1000,
      };
    } catch (error) {
      logger.error('Failed to refresh access token', {
        service,
        error: (error as Error).message,
      });
      throw new Error(`Failed to refresh access token: ${(error as Error).message}`);
    }
  }

  /**
   * Get user info (email) from a token
   */
  async getUserEmail(service: GoogleService, accessToken: string): Promise<string> {
    const oauth2Client = this.createClient(service);
    oauth2Client.setCredentials({ access_token: accessToken });

    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      if (!data.email) {
        throw new Error('Could not retrieve user email');
      }

      return data.email;
    } catch (error) {
      logger.error('Failed to get user email', {
        service,
        error: (error as Error).message,
      });
      throw new Error(`Failed to get user email: ${(error as Error).message}`);
    }
  }

  /**
   * Create an authenticated OAuth2 client with existing tokens
   */
  createAuthenticatedClient(
    service: GoogleService,
    accessToken: string,
    refreshToken: string,
    expiryDate: number
  ): OAuth2Client {
    const oauth2Client = this.createClient(service);
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: expiryDate,
    });

    // Set up automatic token refresh
    oauth2Client.on('tokens', (tokens) => {
      logger.debug('OAuth2 client received new tokens', { service });
    });

    return oauth2Client;
  }

  /**
   * Revoke a token
   */
  async revokeToken(service: GoogleService, token: string): Promise<void> {
    const oauth2Client = this.createClient(service);

    try {
      await oauth2Client.revokeToken(token);
      logger.info('Successfully revoked token', { service });
    } catch (error) {
      logger.error('Failed to revoke token', {
        service,
        error: (error as Error).message,
      });
      throw new Error(`Failed to revoke token: ${(error as Error).message}`);
    }
  }
}

// Singleton instance
let instance: OAuth2AuthManager | null = null;

export function getOAuth2AuthManager(): OAuth2AuthManager {
  if (!instance) {
    instance = new OAuth2AuthManager();
  }
  return instance;
}

export default OAuth2AuthManager;
