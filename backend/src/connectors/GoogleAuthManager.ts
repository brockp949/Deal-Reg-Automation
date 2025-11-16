import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { GoogleAuthConfig } from './types';

export class GoogleAuthManager {
  private jwtClient: JWT;

  constructor(private readonly config: GoogleAuthConfig, private readonly scopes: string[]) {
    if (!config.clientEmail || !config.privateKey) {
      throw new Error('GoogleAuthManager requires client email and private key');
    }

    this.jwtClient = new google.auth.JWT({
      email: config.clientEmail,
      key: config.privateKey.replace(/\\n/g, '\n'),
      scopes: this.scopes,
      subject: config.impersonatedUser,
    });
  }

  /**
   * Authorizes the underlying JWT client and returns it.
   */
  async authorize(): Promise<JWT> {
    await this.jwtClient.authorize();
    return this.jwtClient;
  }
}

export default GoogleAuthManager;
