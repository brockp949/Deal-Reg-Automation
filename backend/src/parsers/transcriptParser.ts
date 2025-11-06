import { readFileSync } from 'fs';
import { ParsedTranscript, TranscriptSection } from '../types';
import logger from '../utils/logger';

/**
 * Parse text transcript file
 */
export function parseTextTranscript(filePath: string): ParsedTranscript {
  try {
    const text = readFileSync(filePath, 'utf-8');
    const sections = parseTranscriptSections(text);

    logger.info(`Successfully parsed transcript with ${sections.length} sections`);

    return {
      text,
      sections,
    };
  } catch (error: any) {
    logger.error('Error parsing transcript', { error: error.message });
    throw new Error(`Failed to parse transcript: ${error.message}`);
  }
}

/**
 * Split transcript into logical sections based on patterns
 */
function parseTranscriptSections(text: string): TranscriptSection[] {
  const sections: TranscriptSection[] = [];

  // Pattern 1: Speaker name followed by colon (e.g., "John Smith: Hello...")
  const speakerPattern = /^([A-Z][a-zA-Z\s]+):\s*(.+)$/gm;
  let matches = [...text.matchAll(speakerPattern)];

  if (matches.length > 0) {
    matches.forEach((match) => {
      sections.push({
        speaker: match[1].trim(),
        content: match[2].trim(),
      });
    });
    return sections;
  }

  // Pattern 2: Timestamp followed by speaker and content
  // (e.g., "[00:05:23] John Smith: Hello...")
  const timestampPattern = /\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*([A-Z][a-zA-Z\s]+):\s*(.+)$/gm;
  matches = [...text.matchAll(timestampPattern)];

  if (matches.length > 0) {
    matches.forEach((match) => {
      sections.push({
        timestamp: match[1].trim(),
        speaker: match[2].trim(),
        content: match[3].trim(),
      });
    });
    return sections;
  }

  // Pattern 3: Paragraph breaks (double newlines)
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());

  if (paragraphs.length > 1) {
    paragraphs.forEach((paragraph) => {
      sections.push({
        content: paragraph.trim(),
      });
    });
    return sections;
  }

  // Fallback: treat entire text as one section
  sections.push({
    content: text.trim(),
  });

  return sections;
}

/**
 * Extract vendor and deal information from transcript
 * This is a simplified keyword-based approach
 * Phase 2 will use AI for better extraction
 */
export function extractInfoFromTranscript(transcript: ParsedTranscript): {
  vendors: any[];
  deals: any[];
  contacts: any[];
} {
  const vendors: any[] = [];
  const deals: any[] = [];
  const contacts: any[] = [];

  const text = transcript.text.toLowerCase();

  // Keywords that might indicate vendor/partner mentions
  const vendorKeywords = [
    'partner',
    'vendor',
    'company',
    'corporation',
    'solutions',
    'technologies',
    'systems',
  ];

  // Keywords that might indicate deal discussions
  const dealKeywords = [
    'deal',
    'opportunity',
    'quote',
    'proposal',
    'contract',
    'agreement',
    'customer',
    'client',
  ];

  // Simple sentence extraction
  const sentences = transcript.text.split(/[.!?]+/);

  sentences.forEach((sentence) => {
    const lowerSentence = sentence.toLowerCase();

    // Check for deal-related content
    const hasDealKeyword = dealKeywords.some((keyword) =>
      lowerSentence.includes(keyword)
    );

    if (hasDealKeyword) {
      // Try to extract dollar amounts
      const valueMatch = sentence.match(/\$([0-9,]+(?:\.\d{2})?)/);

      if (valueMatch) {
        deals.push({
          deal_name: sentence.substring(0, 100).trim() + '...',
          deal_value: parseFloat(valueMatch[1].replace(/,/g, '')),
          source: 'transcript',
          notes: sentence.trim(),
        });
      }
    }

    // Check for vendor mentions
    const hasVendorKeyword = vendorKeywords.some((keyword) =>
      lowerSentence.includes(keyword)
    );

    if (hasVendorKeyword) {
      // Try to extract capitalized company names
      const companyMatch = sentence.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\b/);

      if (companyMatch) {
        vendors.push({
          name: companyMatch[1],
          source: 'transcript',
        });
      }
    }
  });

  // Extract potential contacts from speaker names
  if (transcript.sections) {
    const uniqueSpeakers = new Set<string>();

    transcript.sections.forEach((section) => {
      if (section.speaker) {
        uniqueSpeakers.add(section.speaker);
      }
    });

    uniqueSpeakers.forEach((speaker) => {
      contacts.push({
        name: speaker,
        source: 'transcript',
      });
    });
  }

  logger.info('Extracted info from transcript', {
    vendors: vendors.length,
    deals: deals.length,
    contacts: contacts.length,
  });

  return { vendors, deals, contacts };
}
