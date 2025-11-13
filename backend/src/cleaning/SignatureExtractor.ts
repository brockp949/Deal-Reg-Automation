/**
 * Signature Extractor - Phase 3 Implementation
 * Extracts and parses email signatures
 */

import logger from '../utils/logger';
import { SignatureData, SignatureBoundary } from './types';

export class SignatureExtractor {
  private signatureDelimiters: RegExp[];
  private signaturePatterns: RegExp[];
  private phonePattern: RegExp;
  private emailPattern: RegExp;
  private disclaimerPatterns: RegExp[];

  constructor() {
    // RFC 3676 and common delimiters
    this.signatureDelimiters = [
      /^--\s*$/,                             // RFC 3676: "-- "
      /^-- $/,                               // Exact RFC delimiter
      /^___+$/,                              // Underscores
      /^-{3,}$/,                             // Multiple dashes
    ];

    // Common signature patterns
    this.signaturePatterns = [
      /^(Best regards|Regards|Sincerely|Thanks|Thank you|Cheers|BR)/i,
      /^Sent from my (iPhone|iPad|Android|BlackBerry)/i,
      /^Get Outlook for (iOS|Android)/i,
    ];

    // Contact info patterns
    this.phonePattern = /(\+?[\d\s\-\(\)\.]{10,20})/;
    this.emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

    // Disclaimer patterns
    this.disclaimerPatterns = [
      /This email.*confidential/i,
      /This message.*intended.*recipient/i,
      /CONFIDENTIALITY NOTICE/i,
      /If you are not the intended recipient/i,
    ];
  }

  /**
   * Extract signature from text
   */
  extractSignature(text: string): { body: string; signature: SignatureData | null } {
    if (!text || text.trim().length === 0) {
      return { body: text, signature: null };
    }

    const boundary = this.detectSignatureBoundary(text);

    if (!boundary) {
      // No signature found
      return { body: text, signature: null };
    }

    const lines = text.split('\n');
    const bodyLines = lines.slice(0, boundary.line_number);
    const signatureLines = lines.slice(boundary.line_number);

    const body = bodyLines.join('\n').trim();
    const signatureText = signatureLines.join('\n').trim();

    const signature = this.parseSignature(signatureText);

    logger.debug('Extracted signature', {
      boundary_line: boundary.line_number,
      confidence: boundary.confidence,
      marker_type: boundary.marker_type,
      has_contact_info: !!signature.email || !!signature.phone,
    });

    return { body, signature };
  }

  /**
   * Parse signature text into structured data
   */
  parseSignature(sigText: string): SignatureData {
    const lines = sigText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const signature: SignatureData = {
      raw_text: sigText,
    };

    // Extract email
    const emailMatch = sigText.match(this.emailPattern);
    if (emailMatch) {
      signature.email = emailMatch[1];
    }

    // Extract phone
    const phoneMatch = sigText.match(this.phonePattern);
    if (phoneMatch) {
      signature.phone = phoneMatch[1].trim();
    }

    // Extract name (first non-empty line, if not a closing)
    if (lines.length > 0) {
      const firstLine = lines[0];
      if (!this.isClosing(firstLine) && !this.emailPattern.test(firstLine)) {
        signature.name = firstLine;
      }
    }

    // Extract title and company (heuristic: lines 2-3 after name)
    if (lines.length > 1) {
      for (let i = 1; i < Math.min(lines.length, 4); i++) {
        const line = lines[i];

        // Skip email/phone lines
        if (this.emailPattern.test(line) || this.phonePattern.test(line)) {
          continue;
        }

        // Check if it looks like a title
        if (this.looksLikeTitle(line) && !signature.title) {
          signature.title = line;
        }
        // Check if it looks like a company
        else if (this.looksLikeCompany(line) && !signature.company) {
          signature.company = line;
        }
      }
    }

    // Extract disclaimer
    const disclaimer = this.extractDisclaimer(sigText);
    if (disclaimer) {
      signature.disclaimer = disclaimer;
    }

    return signature;
  }

  /**
   * Detect signature boundary
   */
  detectSignatureBoundary(text: string): SignatureBoundary | null {
    const lines = text.split('\n');

    // Strategy 1: Look for RFC delimiter ("-- ")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      for (const delimiter of this.signatureDelimiters) {
        if (delimiter.test(line)) {
          return {
            line_number: i,
            confidence: 1.0,
            marker_type: 'delimiter',
          };
        }
      }
    }

    // Strategy 2: Look for signature patterns in last 10 lines
    const searchStart = Math.max(0, lines.length - 10);

    for (let i = searchStart; i < lines.length; i++) {
      const line = lines[i].trim();

      for (const pattern of this.signaturePatterns) {
        if (pattern.test(line)) {
          return {
            line_number: i,
            confidence: 0.8,
            marker_type: 'pattern',
          };
        }
      }
    }

    // Strategy 3: Heuristic - look for contact info in last 5 lines
    const heuristicStart = Math.max(0, lines.length - 5);
    const lastLines = lines.slice(heuristicStart).join('\n');

    if (this.emailPattern.test(lastLines) || this.phonePattern.test(lastLines)) {
      // Find the line where contact info starts
      for (let i = heuristicStart; i < lines.length; i++) {
        const line = lines[i];
        if (this.emailPattern.test(line) || this.phonePattern.test(line)) {
          // Go back a few lines to include name/title
          const sigStart = Math.max(0, i - 2);
          return {
            line_number: sigStart,
            confidence: 0.6,
            marker_type: 'heuristic',
          };
        }
      }
    }

    // No signature found
    return null;
  }

  /**
   * Check if line is a closing (Best regards, etc.)
   */
  private isClosing(line: string): boolean {
    const closingPattern = /^(Best regards|Regards|Sincerely|Thanks|Thank you|Cheers|BR|Best|Kind regards)/i;
    return closingPattern.test(line.trim());
  }

  /**
   * Check if line looks like a job title
   */
  private looksLikeTitle(line: string): boolean {
    const titleKeywords = [
      'manager', 'director', 'engineer', 'developer', 'analyst',
      'consultant', 'specialist', 'coordinator', 'executive', 'officer',
      'VP', 'CEO', 'CTO', 'CFO', 'president', 'lead', 'senior',
    ];

    const lower = line.toLowerCase();
    return titleKeywords.some(keyword => lower.includes(keyword));
  }

  /**
   * Check if line looks like a company name
   */
  private looksLikeCompany(line: string): boolean {
    const companyKeywords = [
      'Inc.', 'LLC', 'Ltd.', 'Corp.', 'Corporation', 'Company',
      'Technologies', 'Solutions', 'Systems', 'Services', 'Group',
    ];

    return companyKeywords.some(keyword =>
      line.includes(keyword) || line.includes(keyword.toLowerCase())
    );
  }

  /**
   * Extract disclaimer text
   */
  private extractDisclaimer(text: string): string | undefined {
    for (const pattern of this.disclaimerPatterns) {
      const match = text.match(pattern);
      if (match) {
        // Find the full disclaimer (usually multiple lines)
        const startIndex = text.indexOf(match[0]);
        const disclaimer = text.substring(startIndex);

        // Limit to reasonable length
        return disclaimer.substring(0, 500).trim();
      }
    }

    return undefined;
  }

  /**
   * Check if text has a signature
   */
  hasSignature(text: string): boolean {
    return this.detectSignatureBoundary(text) !== null;
  }

  /**
   * Get signature confidence score
   */
  getSignatureConfidence(text: string): number {
    const boundary = this.detectSignatureBoundary(text);
    return boundary?.confidence || 0;
  }
}
