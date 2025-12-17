/**
 * Token Encryption Service
 *
 * Provides AES-256-GCM encryption for OAuth tokens stored in the database.
 * Uses the JWT_SECRET as the encryption key source.
 */

import crypto from 'crypto';
import { config } from '../config';
import logger from '../utils/logger';

// AES-256-GCM requires a 32-byte key
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits for GCM auth tag
const SALT_LENGTH = 32;
const KEY_LENGTH = 32; // 256 bits for AES-256
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive a 256-bit key from the JWT secret using PBKDF2
 */
function deriveKey(salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    config.jwt.secret,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha512'
  );
}

/**
 * Encrypt a token string using AES-256-GCM
 *
 * Output format: salt (32 bytes) + iv (16 bytes) + authTag (16 bytes) + ciphertext
 * Returned as base64 string
 */
export function encryptToken(plaintext: string): string {
  try {
    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key from JWT secret
    const key = deriveKey(salt);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + ciphertext
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);

    return combined.toString('base64');
  } catch (error) {
    logger.error('Token encryption failed', { error: (error as Error).message });
    throw new Error('Failed to encrypt token');
  }
}

/**
 * Decrypt a token string using AES-256-GCM
 *
 * Input format: base64 encoded (salt + iv + authTag + ciphertext)
 */
export function decryptToken(encrypted: string): string {
  try {
    // Decode from base64
    const combined = Buffer.from(encrypted, 'base64');

    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    // Derive the same key
    const key = deriveKey(salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    logger.error('Token decryption failed', { error: (error as Error).message });
    throw new Error('Failed to decrypt token - token may be corrupted or tampered');
  }
}

/**
 * Re-encrypt a token (useful if the encryption key changes)
 */
export function reencryptToken(encrypted: string): string {
  const decrypted = decryptToken(encrypted);
  return encryptToken(decrypted);
}

/**
 * Verify that a token can be decrypted without returning the actual token
 * Useful for health checks
 */
export function verifyTokenEncryption(encrypted: string): boolean {
  try {
    decryptToken(encrypted);
    return true;
  } catch {
    return false;
  }
}

export default {
  encryptToken,
  decryptToken,
  reencryptToken,
  verifyTokenEncryption,
};
