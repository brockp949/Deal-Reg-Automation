/**
 * Email Cleaner Service
 *
 * Removes noise from email content:
 * - Signatures
 * - Disclaimers
 * - Quoted text
 * - Forwarded headers
 * - Auto-responder messages
 *
 * This improves extraction accuracy by focusing on relevant content.
 */

import logger from '../utils/logger';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface EmailCleaningResult {
  cleanedText: string;
  originalText: string;
  removedSections: {
    type: 'signature' | 'disclaimer' | 'quoted' | 'forwarded' | 'auto_reply';
    content: string;
    startIndex: number;
    endIndex: number;
  }[];
  linesRemoved: number;
  linesKept: number;
  confidence: number; // 0.0-1.0 how confident we are in the cleaning
}

export interface EmailCleaningOptions {
  removeSignatures?: boolean;
  removeDisclaimers?: boolean;
  removeQuotedText?: boolean;
  removeForwardedHeaders?: boolean;
  removeAutoReplyMessages?: boolean;
  preserveMinLines?: number; // Minimum lines to preserve (safety check)
}

// ============================================================================
// Signature Patterns
// ============================================================================

/**
 * Common signature line starters
 */
const SIGNATURE_PATTERNS = [
  // Common closings
  /^(Best regards?|Best|Regards?|Thanks?|Thank you|Sincerely|Cheers|Warmly|Cordially)/i,

  // Mobile signatures
  /^Sent (from|via) (my )?(iPhone|iPad|Android|BlackBerry|mobile device)/i,
  /^Get Outlook for (iOS|Android)/i,

  // Corporate signatures
  /^[-_=]{3,}/,  // Signature separator lines
  /^[A-Z][a-z]+ [A-Z][a-z]+\s*\|/,  // "John Doe | Title"
  /^\w+@\w+\.\w+/,  // Email addresses
  /^(P|T|F|M|E):\s*[\d\s\(\)\-\+\.]+/,  // Phone/Fax patterns (P: xxx, T: xxx, etc.)

  // Job titles and departments
  /^(Sr\.|Senior|Jr\.|Junior|Chief|Head of|Director of|VP|Vice President|Manager|Engineer|Analyst)/i,

  // Contact info
  /^(Office|Cell|Mobile|Phone|Fax|Tel|Direct):\s*/i,
  /^www\.\w+\.\w+/i,
];

/**
 * Phrases that typically indicate end of main content
 */
const SIGNATURE_INDICATORS = [
  'best regards',
  'best',
  'regards',
  'thank you',
  'thanks',
  'sincerely',
  'cheers',
  'sent from my',
  'get outlook for',
];

// ============================================================================
// Disclaimer Patterns
// ============================================================================

/**
 * Common disclaimer patterns
 */
const DISCLAIMER_PATTERNS = [
  // Confidentiality notices
  /^(CONFIDENTIAL|CONFIDENTIALITY NOTICE|PRIVILEGED AND CONFIDENTIAL)/i,
  /This (email|message|communication) (is|may be) (confidential|privileged)/i,
  /If you (are not|have received this).*(intended recipient|in error)/i,

  // Legal disclaimers
  /^DISCLAIMER:/i,
  /^NOTICE:/i,
  /This email and any (files|attachments)/i,
  /No (virus|confidentiality|warranty)/i,

  // Privacy notices
  /^(PRIVACY|GDPR|Data Protection) (NOTICE|STATEMENT)/i,

  // Environmental messages
  /Please consider (the environment|printing)/i,
  /Think before you print/i,

  // Unsubscribe / marketing
  /To unsubscribe/i,
  /Click here to (unsubscribe|opt out)/i,
];

// ============================================================================
// Quoted Text Patterns
// ============================================================================

/**
 * Patterns indicating quoted/replied text
 */
const QUOTED_TEXT_PATTERNS = [
  // Standard quote markers
  /^>/,  // Lines starting with >
  /^\|/,  // Lines starting with |

  // Reply headers
  /^On .+ wrote:$/i,
  /^On .+ at .+ <.+> wrote:$/i,
  /^From: .+/i,
  /^Sent: .+/i,
  /^To: .+/i,
  /^Subject: .+/i,
  /^Date: .+/i,

  // Quote indicators
  /^-+ ?Original Message ?-+/i,
  /^-+ ?Forwarded message ?-+/i,
  /^Begin forwarded message:/i,
  /^-+ ?Reply message ?-+/i,
];

/**
 * Headers that indicate start of quoted section
 */
const QUOTE_HEADER_PATTERNS = [
  /^On .+ wrote:$/i,
  /^On .+ at .+ <.+> wrote:$/i,
  /^From: .+/i,
  /^-+ ?Original Message ?-+/i,
  /^-+ ?Forwarded message ?-+/i,
  /^Begin forwarded message:/i,
];

// ============================================================================
// Auto-Reply Patterns
// ============================================================================

const AUTO_REPLY_PATTERNS = [
  /^(I am|I'm) (currently )?(out of (the )?office|away|unavailable)/i,
  /^(Auto(matic)?|Automatic) (reply|response):/i,
  /^Out of Office AutoReply/i,
  /I will (be|have) (limited|no) access to (email|my email)/i,
  /I will (return|respond|be back) (on|after)/i,
];

// ============================================================================
// Main Cleaning Functions
// ============================================================================

/**
 * Clean email text by removing noise
 */
export function cleanEmailText(
  emailText: string,
  options: EmailCleaningOptions = {}
): EmailCleaningResult {
  const {
    removeSignatures = true,
    removeDisclaimers = true,
    removeQuotedText = true,
    removeForwardedHeaders = true,
    removeAutoReplyMessages = true,
    preserveMinLines = 3,
  } = options;

  const originalText = emailText;
  const lines = emailText.split('\n');
  const result: EmailCleaningResult = {
    cleanedText: emailText,
    originalText,
    removedSections: [],
    linesRemoved: 0,
    linesKept: lines.length,
    confidence: 0.8,
  };

  // Track which lines to keep
  const linesToKeep: boolean[] = new Array(lines.length).fill(true);

  // Step 1: Remove auto-reply messages (do this first as they often appear at the top)
  if (removeAutoReplyMessages) {
    detectAndMarkAutoReply(lines, linesToKeep, result);
  }

  // Step 2: Remove quoted text (do this before signatures as quotes can contain signature-like patterns)
  if (removeQuotedText) {
    detectAndMarkQuotedText(lines, linesToKeep, result);
  }

  // Step 3: Remove forwarded headers
  if (removeForwardedHeaders) {
    detectAndMarkForwardedHeaders(lines, linesToKeep, result);
  }

  // Step 4: Remove signatures
  if (removeSignatures) {
    detectAndMarkSignature(lines, linesToKeep, result);
  }

  // Step 5: Remove disclaimers
  if (removeDisclaimers) {
    detectAndMarkDisclaimers(lines, linesToKeep, result);
  }

  // Build cleaned text
  const cleanedLines = lines.filter((_, i) => linesToKeep[i]);

  // Safety check: preserve minimum lines
  if (cleanedLines.length < preserveMinLines && lines.length >= preserveMinLines) {
    logger.warn('Email cleaning removed too many lines, reverting to original', {
      originalLines: lines.length,
      cleanedLines: cleanedLines.length,
      preserveMinLines,
    });
    return {
      ...result,
      cleanedText: originalText,
      confidence: 0.3, // Low confidence
    };
  }

  result.cleanedText = cleanedLines.join('\n').trim();
  result.linesKept = cleanedLines.length;
  result.linesRemoved = lines.length - cleanedLines.length;

  // Calculate confidence based on how much we removed
  const removalRatio = result.linesRemoved / lines.length;
  if (removalRatio > 0.7) {
    result.confidence = 0.5; // Low confidence if we removed too much
  } else if (removalRatio > 0.3) {
    result.confidence = 0.9; // High confidence for moderate removal
  } else {
    result.confidence = 0.8; // Medium confidence for light removal
  }

  return result;
}

/**
 * Detect and mark auto-reply messages
 */
function detectAndMarkAutoReply(
  lines: string[],
  linesToKeep: boolean[],
  result: EmailCleaningResult
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this line matches auto-reply pattern
    const isAutoReply = AUTO_REPLY_PATTERNS.some(pattern => pattern.test(line));

    if (isAutoReply) {
      // Mark this and next few lines as auto-reply
      const startIndex = i;
      let endIndex = i;

      // Mark next 5 lines or until blank line
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].trim() === '' && j > i) break;
        linesToKeep[j] = false;
        endIndex = j;
      }

      result.removedSections.push({
        type: 'auto_reply',
        content: lines.slice(startIndex, endIndex + 1).join('\n'),
        startIndex,
        endIndex,
      });

      i = endIndex; // Skip marked lines
    }
  }
}

/**
 * Detect and mark quoted text sections
 */
function detectAndMarkQuotedText(
  lines: string[],
  linesToKeep: boolean[],
  result: EmailCleaningResult
): void {
  let inQuotedSection = false;
  let quoteSectionStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for quote header (e.g., "On Jan 15, John wrote:")
    const isQuoteHeader = QUOTE_HEADER_PATTERNS.some(pattern => pattern.test(line));

    // Check for quoted line (starts with > or |)
    const isQuotedLine = /^[\s>|]+/.test(line) && line.trim().length > 1;

    if (isQuoteHeader) {
      inQuotedSection = true;
      quoteSectionStart = i;
      linesToKeep[i] = false;
    } else if (inQuotedSection) {
      // Continue marking as quoted if still in quoted section
      if (isQuotedLine || line.trim() === '') {
        linesToKeep[i] = false;
      } else if (line.trim().length > 0 && !isQuotedLine) {
        // End of quoted section
        if (quoteSectionStart >= 0) {
          result.removedSections.push({
            type: 'quoted',
            content: lines.slice(quoteSectionStart, i).join('\n'),
            startIndex: quoteSectionStart,
            endIndex: i - 1,
          });
        }
        inQuotedSection = false;
        quoteSectionStart = -1;
      }
    } else if (isQuotedLine) {
      // Single quoted line
      linesToKeep[i] = false;
    }
  }

  // If still in quoted section at end, mark it
  if (inQuotedSection && quoteSectionStart >= 0) {
    result.removedSections.push({
      type: 'quoted',
      content: lines.slice(quoteSectionStart).join('\n'),
      startIndex: quoteSectionStart,
      endIndex: lines.length - 1,
    });
  }
}

/**
 * Detect and mark forwarded headers
 */
function detectAndMarkForwardedHeaders(
  lines: string[],
  linesToKeep: boolean[],
  result: EmailCleaningResult
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for forwarded header patterns
    if (
      /^-+ ?Forwarded message ?-+/i.test(line) ||
      /^Begin forwarded message:/i.test(line) ||
      /^FW:|^FWD:/i.test(line)
    ) {
      const startIndex = i;
      let endIndex = i;

      // Mark this line and email header lines that follow
      linesToKeep[i] = false;

      // Mark subsequent header lines (From:, To:, Subject:, Date:)
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (
          /^(From|To|Cc|Bcc|Sent|Date|Subject):/i.test(nextLine) ||
          nextLine === ''
        ) {
          linesToKeep[j] = false;
          endIndex = j;
        } else {
          break;
        }
      }

      result.removedSections.push({
        type: 'forwarded',
        content: lines.slice(startIndex, endIndex + 1).join('\n'),
        startIndex,
        endIndex,
      });

      i = endIndex;
    }
  }
}

/**
 * Detect and mark signature sections
 */
function detectAndMarkSignature(
  lines: string[],
  linesToKeep: boolean[],
  result: EmailCleaningResult
): void {
  // Start from the bottom and work up (signatures are at the end)
  let signatureStart = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Skip blank lines at the end
    if (line === '') continue;

    // Check if line matches signature pattern
    const matchesPattern = SIGNATURE_PATTERNS.some(pattern => pattern.test(line));

    // Check if line contains signature indicator
    const lowerLine = line.toLowerCase();
    const containsIndicator = SIGNATURE_INDICATORS.some(indicator =>
      lowerLine.startsWith(indicator)
    );

    if (matchesPattern || containsIndicator) {
      signatureStart = i;
      // Continue going up to capture full signature
      continue;
    } else if (signatureStart !== -1) {
      // Found start of signature, mark everything after this as signature
      break;
    } else {
      // Haven't found signature yet, this is content
      break;
    }
  }

  // Mark signature lines
  if (signatureStart !== -1 && signatureStart < lines.length - 1) {
    for (let i = signatureStart; i < lines.length; i++) {
      linesToKeep[i] = false;
    }

    result.removedSections.push({
      type: 'signature',
      content: lines.slice(signatureStart).join('\n'),
      startIndex: signatureStart,
      endIndex: lines.length - 1,
    });
  }
}

/**
 * Detect and mark disclaimer sections
 */
function detectAndMarkDisclaimers(
  lines: string[],
  linesToKeep: boolean[],
  result: EmailCleaningResult
): void {
  let inDisclaimer = false;
  let disclaimerStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if line matches disclaimer pattern
    const matchesPattern = DISCLAIMER_PATTERNS.some(pattern => pattern.test(line));

    if (matchesPattern && !inDisclaimer) {
      inDisclaimer = true;
      disclaimerStart = i;
      linesToKeep[i] = false;
    } else if (inDisclaimer) {
      // Continue marking lines as part of disclaimer
      // Stop when we hit a blank line followed by content, or end of email
      if (line === '') {
        linesToKeep[i] = false;
        // Check if next line has content
        if (i + 1 < lines.length && lines[i + 1].trim().length > 0) {
          // Check if next line is also disclaimer-like
          const nextMatches = DISCLAIMER_PATTERNS.some(pattern =>
            pattern.test(lines[i + 1])
          );
          if (!nextMatches) {
            // End disclaimer
            result.removedSections.push({
              type: 'disclaimer',
              content: lines.slice(disclaimerStart, i + 1).join('\n'),
              startIndex: disclaimerStart,
              endIndex: i,
            });
            inDisclaimer = false;
            disclaimerStart = -1;
          }
        }
      } else {
        linesToKeep[i] = false;
      }
    }
  }

  // If still in disclaimer at end
  if (inDisclaimer && disclaimerStart !== -1) {
    result.removedSections.push({
      type: 'disclaimer',
      content: lines.slice(disclaimerStart).join('\n'),
      startIndex: disclaimerStart,
      endIndex: lines.length - 1,
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get statistics about cleaned email
 */
export function getCleaningStats(result: EmailCleaningResult): {
  totalLines: number;
  linesKept: number;
  linesRemoved: number;
  removalPercentage: number;
  sectionCounts: Record<string, number>;
} {
  const sectionCounts: Record<string, number> = {};

  for (const section of result.removedSections) {
    sectionCounts[section.type] = (sectionCounts[section.type] || 0) + 1;
  }

  const totalLines = result.linesKept + result.linesRemoved;

  return {
    totalLines,
    linesKept: result.linesKept,
    linesRemoved: result.linesRemoved,
    removalPercentage: totalLines > 0 ? (result.linesRemoved / totalLines) * 100 : 0,
    sectionCounts,
  };
}

/**
 * Batch clean multiple emails
 */
export function cleanMultipleEmails(
  emails: string[],
  options?: EmailCleaningOptions
): EmailCleaningResult[] {
  return emails.map(email => cleanEmailText(email, options));
}

export default {
  cleanEmailText,
  getCleaningStats,
  cleanMultipleEmails,
};
