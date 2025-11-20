/**
 * Enhanced MBOX Parser - Multi-Layered Deal Registration Discovery
 * Based on "Blueprint for an Automated Deal Registration Discovery Tool"
 *
 * Implements:
 * - Tiered keyword lexicon (Tier 1, 2, 3)
 * - Thread correlation
 * - Multi-layer extraction (Triage → Regex → NLP)
 * - Confidence scoring
 * - Enhanced pre-processing
 */

import { simpleParser, ParsedMail, AddressObject } from 'mailparser';
import { readFileSync } from 'fs';
import logger from '../utils/logger';
import { CleaningPipeline } from '../cleaning/CleaningPipeline';

// ============================================================================
// EMAIL CLEANING PIPELINE
// ============================================================================

// Initialize the Phase 3 CleaningPipeline with default options
const cleaningPipeline = new CleaningPipeline({
  remove_quoted_replies: true,
  extract_signatures: true,
  normalize_text: true,
  preserve_structure: true,
  min_content_length: 10, // Minimum 10 characters for valid content
});

// ============================================================================
// TIERED KEYWORD LEXICON
// ============================================================================

export const TIER1_KEYWORDS = [
  // Primary Keywords (High Confidence Indicators)
  'deal registration',
  'opportunity registration',
  'deal reg',
  'registration is confirmed',
  'thank you for registering',
  'registration confirmed',
  'rfp submission',
  'proposal for',
  'submitting a registration',
  'register this deal',
  'registered the following',
  // Added general business terms
  'signed contract',
  'contract signed',
  'purchase order',
  'po number',
  'order placed',
  'agreement signed',
  'won the deal',
  'closed the deal',
  'contract executed',
  'signed agreement',
  'deal closed',
];

export const NEXT_STEPS_KEYWORDS = [
  'next steps',
  'action items',
  'follow up',
  'to do',
  'action required',
  'please provide',
  'schedule a call',
  'set up a meeting',
  'moving forward',
  'plan of action',
];

export const TIER2_KEYWORDS = [
  // Secondary Indicators (Medium Confidence, Context-Dependent)
  'new opportunity',
  'qualified lead',
  'request for quote',
  'rfq',
  'pricing protection',
  'exclusive pricing',
  'please approve',
  'seeking approval for',
  'opportunity approval',
  'quote request',
  // Added common sales terms
  'sales opportunity',
  'business opportunity',
  'potential deal',
  'proposal submitted',
  'quote submitted',
  'bid submitted',
  'customer interested',
  'client interested',
  'ready to buy',
  'moving forward',
  'next steps',
  'decision maker',
  'budget approved',
  'verbal commitment',
  'letter of intent',
  'statement of work',
  'sow',
  'master service agreement',
  'msa',
];

export const TIER3_KEYWORDS = [
  // Associated Terminology (Low Confidence, requires other signals)
  'pipeline',
  'forecast',
  'end customer',
  'end-user',
  'deal size',
  'contract value',
  'tcv',
  'acv',
  'partner program',
  'co-sell',
  'partner-led',
  // Added general business signals
  'project',
  'implementation',
  'deployment',
  'requirements',
  'solution',
  'proposal',
  'pricing',
  'discount',
  'timeline',
  'delivery',
  'services',
  'license',
  'subscription',
  'purchase',
  'vendor',
  'supplier',
  'procurement',
  'evaluation',
  'demo',
  'proof of concept',
  'poc',
  'pilot',
];

export const DEAL_TYPE_KEYWORDS = {
  'co-sell': ['co-sell', 'co sell', 'cosell', 'joint sell'],
  'partner-led': ['partner-led', 'partner led', 'partner driven'],
  'rfp': ['rfp', 'request for proposal', 'tender', 'bid', 'solicitation'],
  'public-tender': ['public tender', 'government bid', 'public bid', 'public sector'],
  'renewal': ['renewal', 'renew', 'extension', 'expiring'],
  'expansion': ['expansion', 'upsell', 'cross-sell', 'add-on'],
};

export const PRICING_MODEL_KEYWORDS = {
  'subscription': ['subscription', 'saas', 'monthly', 'annual subscription'],
  'perpetual': ['perpetual', 'one-time', 'permanent license'],
  'pay-as-you-go': ['pay-as-you-go', 'payg', 'usage-based', 'consumption'],
};

// ============================================================================
// REGEX PATTERNS FOR STRUCTURED DATA EXTRACTION
// ============================================================================

export const REGEX_PATTERNS = {
  // Financial Data - matches various currency formats
  currency: {
    usd: /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
    eur: /€\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
    gbp: /£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
    general: /(?:USD|EUR|GBP|CAD|AUD)?\s?\$?\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s?(?:USD|EUR|GBP|CAD|AUD)?/gi,
    withLabel: /(?:deal (?:size|value)|tcv|acv|contract value|amount):\s?\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
    abbreviated: /\$?(\d+)k/gi, // $75k format
    jpy: /¥\s?(\d{1,3}(?:,\d{3})*)/g,
    inr: /₹\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
    cny: /¥\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
  },

  // Dates - multiple formats
  date: {
    mmddyyyy: /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g,
    ddmmyyyy: /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g,
    iso: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    monthDayYear: /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/gi,
    relative: /(?:next|within|in)\s+(\d+)\s+(days?|weeks?|months?|quarters?)/gi,
    quarter: /Q([1-4])\s+(\d{4})/gi,
  },

  // Contact Information
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,

  // Company/Organization Names - limit to max 6 words before suffix to avoid greedy matching
  company: /\b((?:[A-Z][A-Za-z0-9&.,'-]+\s+){0,5}(?:Inc|LLC|Corp|Corporation|Ltd|Limited|GmbH)\.?)\b/g,

  // Opportunity/Deal IDs
  opportunityId: /(?:opportunity|deal|opp)[\s#:]+([A-Z0-9-]+)/gi,
  rfpNumber: /RFP[\s#:]+([A-Z0-9-]+)/gi,

  // Product Names and SKUs
  sku: /\b(?:SKU|Model|Part)[\s#:]+([A-Z0-9-]+)/gi,

  // Contextual Patterns
  endUser: /(?:end[- ]user|customer|client):\s*([A-Z][A-Za-z0-9\s&.,'-]+)/gi,
  decisionMaker: /(?:decision[- ]maker|contact|spoke with|met with):\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/gi,
  projectName: /(?:project|initiative):\s*([A-Z][A-Za-z0-9\s&.,'-]+)/gi,
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ExtractedDeal {
  // Core Fields
  end_user_name?: string;
  end_user_address?: string;
  decision_maker_contact?: string;
  decision_maker_email?: string;
  decision_maker_phone?: string;

  // Product/Service
  deal_name?: string;
  product_name?: string;
  product_service_requirements?: string;
  solution_category?: string;
  deployment_environment?: string;

  // Financial
  deal_value?: number;
  currency?: string;
  pricing_model?: string;

  // Temporal
  registration_date?: Date;
  contract_start_date?: Date;
  contract_end_date?: Date;
  expected_close_date?: Date;
  registration_term_days?: number;

  // Context
  deal_type?: string;
  project_name?: string;
  pre_sales_efforts?: string;
  next_steps?: string[];

  // Metadata
  confidence_score: number;
  source_email_id: string;
  source_email_from?: string; // Email address of sender
  source_email_domain?: string; // Domain of sender for vendor identification
  tier1_matches: string[];
  tier2_matches: string[];
  tier3_matches: string[];
  extraction_method: string;
}

export interface EmailThread {
  thread_id: string;
  subject_normalized: string;
  messages: ParsedEmailMessage[];
  first_message_date: Date;
  last_message_date: Date;
  participant_emails: string[];
}

export interface ParsedEmailMessage {
  message_id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  body_text: string;
  body_html?: string;
  in_reply_to?: string;
  references: string[];
  cleaned_body: string; // After pre-processing
  tier1_matches: string[];
  tier2_matches: string[];
  tier3_matches: string[];
}

// ============================================================================
// PRE-PROCESSING FUNCTIONS
// ============================================================================

/**
 * Strip HTML tags and convert to clean plain text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove email signatures
 */
function removeSignatures(text: string): string {
  // Common signature patterns
  const signaturePatterns = [
    /^--+\s*$/m,
    /^Sent from my (?:iPhone|iPad|Android|Samsung)/mi,
    /^Thanks?,?\s*$/mi,
    /^Best regards?,?\s*$/mi,
    /^Sincerely,?\s*$/mi,
    /^Confidentiality Notice:?/mi,
  ];

  let cleaned = text;

  // Find first signature pattern and truncate
  for (const pattern of signaturePatterns) {
    const match = cleaned.match(pattern);
    if (match && match.index) {
      cleaned = cleaned.substring(0, match.index);
      break;
    }
  }

  return cleaned.trim();
}

/**
 * Remove quoted replies (> or | prefixed lines)
 */
function removeQuotedReplies(text: string): string {
  const lines = text.split('\n');
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('>') && !trimmed.startsWith('|');
  });

  // Also remove "On [date], [person] wrote:" patterns
  return cleanedLines
    .join('\n')
    .replace(/^On\s+.+?wrote:$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalize text for processing
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s@.$,\-]/g, ' ')
    .trim();
}

/**
 * Complete pre-processing pipeline
 * Now uses the Phase 3 CleaningPipeline for comprehensive noise removal
 */
export function preprocessEmail(text: string, isHtml: boolean = false): string {
  let cleaned = text;

  if (isHtml) {
    cleaned = stripHtml(cleaned);
  }

  // Use Phase 3 CleaningPipeline for comprehensive cleaning
  const cleaningResult = cleaningPipeline.clean(cleaned);

  logger.debug('Email cleaning complete', {
    originalLength: cleaningResult.original_length,
    cleanedLength: cleaningResult.cleaned_length,
    bytesRemoved: cleaningResult.original_length - cleaningResult.cleaned_length,
    reductionPercent: Math.round((1 - cleaningResult.cleaned_length / cleaningResult.original_length) * 100),
    hadQuotedReplies: cleaningResult.had_quoted_replies,
    hadSignature: cleaningResult.had_signature,
    hasMinimumContent: cleaningResult.has_minimum_content,
    processingTimeMs: cleaningResult.processing_time_ms,
  });

  return cleaningResult.cleaned_body;
}

// ============================================================================
// THREAD CORRELATION
// ============================================================================

/**
 * Normalize subject line for thread matching
 */
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(Re|Fw|Fwd):\s*/gi, '')
    .toLowerCase()
    .trim();
}

/**
 * Extract email address from AddressObject
 */
export function extractEmailAddress(addr: AddressObject | AddressObject[] | undefined): string {
  if (!addr) return '';
  if (Array.isArray(addr)) {
    return addr[0]?.value?.[0]?.address || addr[0]?.text || '';
  }
  return addr.value?.[0]?.address || addr.text || '';
}

/**
 * Extract all email addresses from AddressObject
 */
export function extractEmailAddresses(addr: AddressObject | AddressObject[] | undefined): string[] {
  if (!addr) return [];
  if (Array.isArray(addr)) {
    return addr.flatMap(a => a.value?.map(v => v.address).filter((a): a is string => !!a) || []);
  }
  return addr.value?.map(v => v.address).filter((a): a is string => !!a) || [];
}

/**
 * Correlate emails into threads
 */
export function correlateThreads(messages: ParsedEmailMessage[]): EmailThread[] {
  const threadsMap = new Map<string, EmailThread>();
  const messagesByMessageId = new Map<string, ParsedEmailMessage>();

  // Index messages by Message-ID
  for (const msg of messages) {
    messagesByMessageId.set(msg.message_id, msg);
  }

  for (const msg of messages) {
    let threadId: string | null = null;

    // Try to find thread by in-reply-to or references
    if (msg.in_reply_to) {
      const parentMsg = messagesByMessageId.get(msg.in_reply_to);
      if (parentMsg) {
        // Find which thread the parent belongs to
        for (const [tid, thread] of threadsMap.entries()) {
          if (thread.messages.some(m => m.message_id === parentMsg.message_id)) {
            threadId = tid;
            break;
          }
        }
      }
    }

    // Fallback to subject-based threading
    if (!threadId) {
      const normalizedSubj = normalizeSubject(msg.subject);
      for (const [tid, thread] of threadsMap.entries()) {
        if (thread.subject_normalized === normalizedSubj) {
          threadId = tid;
          break;
        }
      }
    }

    // Create new thread if needed
    if (!threadId) {
      threadId = msg.message_id; // Use first message ID as thread ID
      threadsMap.set(threadId, {
        thread_id: threadId,
        subject_normalized: normalizeSubject(msg.subject),
        messages: [],
        first_message_date: msg.date,
        last_message_date: msg.date,
        participant_emails: [],
      });
    }

    // Add message to thread
    const thread = threadsMap.get(threadId)!;
    thread.messages.push(msg);

    // Update thread metadata
    if (msg.date < thread.first_message_date) {
      thread.first_message_date = msg.date;
    }
    if (msg.date > thread.last_message_date) {
      thread.last_message_date = msg.date;
    }

    // Add participants
    const participants = new Set(thread.participant_emails);
    participants.add(msg.from);
    msg.to.forEach(email => participants.add(email));
    msg.cc.forEach(email => participants.add(email));
    thread.participant_emails = Array.from(participants);
  }

  // Sort messages within each thread by date
  for (const thread of threadsMap.values()) {
    thread.messages.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  return Array.from(threadsMap.values());
}

// ============================================================================
// LAYER 1: HIGH-SPEED TRIAGE AND FILTERING
// ============================================================================

/**
 * Quick check if email is potentially relevant
 */
export function isRelevantEmail(message: ParsedEmailMessage, vendorDomains: string[] = []): boolean {
  const subjectLower = message.subject.toLowerCase();
  const bodyLower = message.cleaned_body.toLowerCase();

  // Check Tier 1 keywords in subject (high priority)
  for (const keyword of TIER1_KEYWORDS) {
    if (subjectLower.includes(keyword)) {
      return true;
    }
  }

  // Check domain filtering
  if (vendorDomains.length > 0) {
    const fromDomain = message.from.split('@')[1];
    if (fromDomain && vendorDomains.some(d => fromDomain.includes(d))) {
      // Check if body has any tier keywords
      const allKeywords = [...TIER1_KEYWORDS, ...TIER2_KEYWORDS, ...TIER3_KEYWORDS];
      if (allKeywords.some(kw => bodyLower.includes(kw))) {
        return true;
      }
    }
  }

  // Check Tier 1 keywords in body
  for (const keyword of TIER1_KEYWORDS) {
    if (bodyLower.includes(keyword)) {
      return true;
    }
  }

  return false;
}

// Continue in next part due to length...
