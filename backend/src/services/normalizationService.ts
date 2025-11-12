/**
 * Centralized Normalization Service
 *
 * Provides consistent data normalization across all parsers and data sources.
 * All normalization functions are pure and side-effect free.
 */

import logger from '../utils/logger';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface NormalizationResult<T> {
  value: T;
  original: string;
  confidence: number; // 0.0-1.0
  method: string;
  warnings?: string[];
}

export interface DateNormalizationResult extends NormalizationResult<Date | null> {
  format?: string;
}

export interface CurrencyNormalizationResult extends NormalizationResult<number> {
  currency: string;
  formatted: string;
}

export interface PhoneNormalizationResult extends NormalizationResult<string> {
  countryCode?: string;
  isValid: boolean;
}

// ============================================================================
// Date Normalization
// ============================================================================

/**
 * Common date formats to try parsing
 */
const DATE_FORMATS: Array<{ pattern: RegExp; parser: (match: RegExpMatchArray) => Date | null; name: string }> = [
  // ISO 8601: 2024-01-15, 2024-01-15T10:30:00Z
  {
    name: 'ISO8601',
    pattern: /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z?)?$/,
    parser: (m) => {
      const [, year, month, day, hour = '0', min = '0', sec = '0'] = m;
      return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
    },
  },
  // US Format: 01/15/2024, 1/15/24, 01-15-2024
  {
    name: 'US_MDY',
    pattern: /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/,
    parser: (m) => {
      const [, month, day, year] = m;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    },
  },
  // UK Format: 15/01/2024, 15-01-2024
  {
    name: 'UK_DMY',
    pattern: /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/,
    parser: (m) => {
      const [, day, month, year] = m;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    },
  },
  // Text dates: January 15, 2024 | Jan 15, 2024 | 15 January 2024
  {
    name: 'TEXT_MONTH',
    pattern: /^(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
    parser: (m) => {
      const [, day1, monthName, day2, year] = m;
      const day = day1 || day2;
      const date = new Date(`${monthName} ${day}, ${year}`);
      return isNaN(date.getTime()) ? null : date;
    },
  },
  // Relative: "Q1 2024", "Q2 2024"
  {
    name: 'QUARTER',
    pattern: /^Q([1-4])\s+(\d{4})$/i,
    parser: (m) => {
      const [, quarter, year] = m;
      const month = (parseInt(quarter) - 1) * 3 + 1; // Q1=Jan, Q2=Apr, etc.
      return new Date(`${year}-${month.toString().padStart(2, '0')}-01`);
    },
  },
];

/**
 * Normalize a date string to ISO 8601 format
 * Handles multiple input formats and provides confidence scoring
 */
export function normalizeDate(input: string | Date | null | undefined): DateNormalizationResult {
  if (!input) {
    return {
      value: null,
      original: String(input),
      confidence: 1.0,
      method: 'null_input',
    };
  }

  // Already a Date object
  if (input instanceof Date) {
    if (isNaN(input.getTime())) {
      return {
        value: null,
        original: input.toString(),
        confidence: 0.0,
        method: 'invalid_date_object',
        warnings: ['Invalid Date object provided'],
      };
    }
    return {
      value: input,
      original: input.toISOString(),
      confidence: 1.0,
      method: 'date_object',
      format: 'ISO8601',
    };
  }

  const cleaned = input.toString().trim();
  if (!cleaned) {
    return {
      value: null,
      original: input.toString(),
      confidence: 1.0,
      method: 'empty_string',
    };
  }

  // Try native Date parsing first
  const nativeDate = new Date(cleaned);
  if (!isNaN(nativeDate.getTime()) && cleaned.length > 4) {
    // Sanity check: year should be between 1900 and 2100
    const year = nativeDate.getFullYear();
    if (year >= 1900 && year <= 2100) {
      return {
        value: nativeDate,
        original: cleaned,
        confidence: 0.8, // Medium confidence for native parsing
        method: 'native_date_parse',
        format: 'auto',
      };
    }
  }

  // Try each pattern
  for (const format of DATE_FORMATS) {
    const match = cleaned.match(format.pattern);
    if (match) {
      const parsed = format.parser(match);
      if (parsed && !isNaN(parsed.getTime())) {
        const year = parsed.getFullYear();
        if (year >= 1900 && year <= 2100) {
          return {
            value: parsed,
            original: cleaned,
            confidence: 0.95, // High confidence for pattern match
            method: 'pattern_match',
            format: format.name,
          };
        }
      }
    }
  }

  // Failed to parse
  return {
    value: null,
    original: cleaned,
    confidence: 0.0,
    method: 'parse_failed',
    warnings: [`Unable to parse date: "${cleaned}"`],
  };
}

// ============================================================================
// Currency Normalization
// ============================================================================

/**
 * Currency symbols and their codes
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  'CAD': 'CAD',
  'AUD': 'AUD',
  'CHF': 'CHF',
};

/**
 * Normalize a currency value to a numeric amount
 * Handles: $100,000 | 100K | $100k USD | 1.5M | etc.
 */
export function normalizeCurrency(input: string | number | null | undefined, defaultCurrency = 'USD'): CurrencyNormalizationResult {
  if (input === null || input === undefined) {
    return {
      value: 0,
      original: String(input),
      currency: defaultCurrency,
      formatted: '0.00',
      confidence: 1.0,
      method: 'null_input',
    };
  }

  // Already a number
  if (typeof input === 'number') {
    return {
      value: input,
      original: input.toString(),
      currency: defaultCurrency,
      formatted: input.toFixed(2),
      confidence: 1.0,
      method: 'number_input',
    };
  }

  const cleaned = input.toString().trim();
  if (!cleaned) {
    return {
      value: 0,
      original: input.toString(),
      currency: defaultCurrency,
      formatted: '0.00',
      confidence: 1.0,
      method: 'empty_string',
    };
  }

  // Extract currency symbol/code
  let currency = defaultCurrency;
  let valueStr = cleaned;

  // Check for currency symbols
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (cleaned.includes(symbol)) {
      currency = code;
      valueStr = cleaned.replace(symbol, '').trim();
      break;
    }
  }

  // Check for currency codes (USD, EUR, etc.)
  const currencyCodeMatch = valueStr.match(/\b([A-Z]{3})\b/);
  if (currencyCodeMatch) {
    currency = currencyCodeMatch[1];
    valueStr = valueStr.replace(currencyCodeMatch[0], '').trim();
  }

  // Remove commas and whitespace
  valueStr = valueStr.replace(/[,\s]/g, '');

  // Handle K/M/B suffixes
  const multipliers: Record<string, number> = {
    'K': 1000,
    'M': 1000000,
    'B': 1000000000,
    'T': 1000000000000,
  };

  let multiplier = 1;
  for (const [suffix, mult] of Object.entries(multipliers)) {
    const regex = new RegExp(`(\\d+\\.?\\d*)${suffix}`, 'i');
    const match = valueStr.match(regex);
    if (match) {
      valueStr = match[1];
      multiplier = mult;
      break;
    }
  }

  // Parse the numeric value
  const numValue = parseFloat(valueStr);
  if (isNaN(numValue)) {
    return {
      value: 0,
      original: cleaned,
      currency: defaultCurrency,
      formatted: '0.00',
      confidence: 0.0,
      method: 'parse_failed',
      warnings: [`Unable to parse currency: "${cleaned}"`],
    };
  }

  const finalValue = numValue * multiplier;

  return {
    value: finalValue,
    original: cleaned,
    currency,
    formatted: finalValue.toFixed(2),
    confidence: 0.9,
    method: multiplier > 1 ? 'with_multiplier' : 'numeric_parse',
  };
}

// ============================================================================
// Phone Number Normalization
// ============================================================================

/**
 * Normalize phone number to consistent format
 * Attempts to produce E.164 format when possible
 */
export function normalizePhone(input: string | null | undefined, defaultCountryCode = '+1'): PhoneNormalizationResult {
  if (!input) {
    return {
      value: '',
      original: String(input),
      confidence: 1.0,
      method: 'null_input',
      isValid: false,
    };
  }

  const cleaned = input.toString().trim();
  if (!cleaned) {
    return {
      value: '',
      original: input.toString(),
      confidence: 1.0,
      method: 'empty_string',
      isValid: false,
    };
  }

  // Remove all non-digit characters except + at start
  const digits = cleaned.replace(/[^\d+]/g, '');

  if (digits.length === 0) {
    return {
      value: '',
      original: cleaned,
      confidence: 0.0,
      method: 'no_digits',
      warnings: [`No digits found in phone: "${cleaned}"`],
      isValid: false,
    };
  }

  // Already in E.164 format (+1234567890)
  if (digits.startsWith('+') && digits.length >= 11 && digits.length <= 15) {
    return {
      value: digits,
      original: cleaned,
      confidence: 0.95,
      method: 'e164_format',
      countryCode: digits.substring(0, digits.length - 10),
      isValid: true,
    };
  }

  // US/Canada number (10 digits)
  if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
    const phoneDigits = digits.length === 11 ? digits.substring(1) : digits;
    const formatted = `${defaultCountryCode}${phoneDigits}`;
    return {
      value: formatted,
      original: cleaned,
      confidence: 0.85,
      method: 'us_format',
      countryCode: defaultCountryCode,
      isValid: true,
    };
  }

  // International format without + (starts with country code)
  if (digits.length >= 11 && digits.length <= 15) {
    const formatted = `+${digits}`;
    return {
      value: formatted,
      original: cleaned,
      confidence: 0.7,
      method: 'international_assumed',
      isValid: true,
    };
  }

  // Invalid length
  return {
    value: digits,
    original: cleaned,
    confidence: 0.3,
    method: 'unknown_format',
    warnings: [`Phone number has unusual length: ${digits.length} digits`],
    isValid: false,
  };
}

// ============================================================================
// Email Normalization
// ============================================================================

/**
 * Normalize email address
 * - Lowercase
 * - Trim whitespace
 * - Basic validation
 */
export function normalizeEmail(input: string | null | undefined): NormalizationResult<string> {
  if (!input) {
    return {
      value: '',
      original: String(input),
      confidence: 1.0,
      method: 'null_input',
    };
  }

  const cleaned = input.toString().trim().toLowerCase();

  if (!cleaned) {
    return {
      value: '',
      original: input.toString(),
      confidence: 1.0,
      method: 'empty_string',
    };
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = emailRegex.test(cleaned);

  if (!isValid) {
    return {
      value: cleaned,
      original: input.toString(),
      confidence: 0.3,
      method: 'invalid_format',
      warnings: [`Email appears invalid: "${cleaned}"`],
    };
  }

  return {
    value: cleaned,
    original: input.toString(),
    confidence: 1.0,
    method: 'lowercase_trim',
  };
}

// ============================================================================
// Company Name Normalization
// ============================================================================

/**
 * Common company suffixes to remove or standardize
 */
const COMPANY_SUFFIXES = [
  'Inc',
  'Inc.',
  'Incorporated',
  'LLC',
  'L.L.C.',
  'LLP',
  'Ltd',
  'Ltd.',
  'Limited',
  'Corp',
  'Corp.',
  'Corporation',
  'Co',
  'Co.',
  'Company',
  'GmbH',
  'AG',
  'S.A.',
  'S.A',
  'SA',
  'Pty',
  'Pty.',
  'PLC',
];

/**
 * Normalize company name
 * - Remove common suffixes (Inc, LLC, etc.)
 * - Standardize whitespace
 * - Title case
 */
export function normalizeCompanyName(input: string | null | undefined, options: {
  removeSuffixes?: boolean;
  titleCase?: boolean;
} = {}): NormalizationResult<string> {
  const { removeSuffixes = true, titleCase = false } = options;

  if (!input) {
    return {
      value: '',
      original: String(input),
      confidence: 1.0,
      method: 'null_input',
    };
  }

  let normalized = input.toString().trim();

  if (!normalized) {
    return {
      value: '',
      original: input.toString(),
      confidence: 1.0,
      method: 'empty_string',
    };
  }

  // Standardize whitespace (multiple spaces → single space)
  normalized = normalized.replace(/\s+/g, ' ');

  // Remove suffixes if requested
  if (removeSuffixes) {
    for (const suffix of COMPANY_SUFFIXES) {
      const regex = new RegExp(`[,\\s]+${suffix}$`, 'i');
      if (regex.test(normalized)) {
        normalized = normalized.replace(regex, '').trim();
        break; // Only remove one suffix
      }
    }
  }

  // Apply title case if requested
  if (titleCase) {
    normalized = normalized
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  const confidence = normalized !== input ? 0.9 : 1.0;
  const method = removeSuffixes ? 'remove_suffixes' : 'standardize_whitespace';

  return {
    value: normalized,
    original: input.toString(),
    confidence,
    method,
  };
}

// ============================================================================
// Status Value Normalization
// ============================================================================

/**
 * Common status mappings for deals
 */
const DEAL_STATUS_MAP: Record<string, string> = {
  'new': 'registered',
  'pending': 'pending',
  'in progress': 'in_progress',
  'in-progress': 'in_progress',
  'approved': 'approved',
  'rejected': 'rejected',
  'denied': 'rejected',
  'closed': 'closed_won',
  'won': 'closed_won',
  'closed won': 'closed_won',
  'lost': 'closed_lost',
  'closed lost': 'closed_lost',
  'cancelled': 'cancelled',
  'canceled': 'cancelled',
};

/**
 * Normalize status value to standard enum
 */
export function normalizeStatus(input: string | null | undefined, type: 'deal' | 'vendor' = 'deal'): NormalizationResult<string> {
  if (!input) {
    return {
      value: type === 'deal' ? 'registered' : 'active',
      original: String(input),
      confidence: 1.0,
      method: 'default_value',
    };
  }

  const cleaned = input.toString().trim().toLowerCase();

  if (!cleaned) {
    return {
      value: type === 'deal' ? 'registered' : 'active',
      original: input.toString(),
      confidence: 1.0,
      method: 'default_value',
    };
  }

  const statusMap = type === 'deal' ? DEAL_STATUS_MAP : {};
  const normalized = statusMap[cleaned] || cleaned;

  return {
    value: normalized,
    original: input.toString(),
    confidence: statusMap[cleaned] ? 0.95 : 0.7,
    method: statusMap[cleaned] ? 'mapped' : 'passthrough',
  };
}

// ============================================================================
// Batch Normalization
// ============================================================================

/**
 * Normalize all fields in a vendor object
 */
export function normalizeVendorData(vendor: any): any {
  return {
    ...vendor,
    name: normalizeCompanyName(vendor.name, { removeSuffixes: true }).value,
    email_domains: vendor.email_domains ?
      (Array.isArray(vendor.email_domains) ? vendor.email_domains : [vendor.email_domains])
        .map((e: string) => e.toLowerCase().trim()) : null,
    website: vendor.website ? vendor.website.toLowerCase().trim() : null,
  };
}

/**
 * Normalize all fields in a deal object
 */
export function normalizeDealData(deal: any): any {
  const dealValueResult = normalizeCurrency(deal.deal_value, deal.currency || 'USD');
  const expectedCloseDateResult = normalizeDate(deal.expected_close_date);
  const statusResult = normalizeStatus(deal.status, 'deal');

  return {
    ...deal,
    deal_value: dealValueResult.value,
    currency: dealValueResult.currency,
    customer_name: deal.customer_name ?
      normalizeCompanyName(deal.customer_name, { removeSuffixes: false }).value : null,
    expected_close_date: expectedCloseDateResult.value,
    status: statusResult.value,
    decision_maker_email: deal.decision_maker_email ?
      normalizeEmail(deal.decision_maker_email).value : null,
    decision_maker_phone: deal.decision_maker_phone ?
      normalizePhone(deal.decision_maker_phone).value : null,
  };
}

/**
 * Normalize all fields in a contact object
 */
export function normalizeContactData(contact: any): any {
  return {
    ...contact,
    name: contact.name ? contact.name.trim() : null,
    email: contact.email ? normalizeEmail(contact.email).value : null,
    phone: contact.phone ? normalizePhone(contact.phone).value : null,
  };
}

// ============================================================================
// Export Service
// ============================================================================

export const NormalizationService = {
  // Individual normalizers
  normalizeDate,
  normalizeCurrency,
  normalizePhone,
  normalizeEmail,
  normalizeCompanyName,
  normalizeStatus,

  // Batch normalizers
  normalizeVendorData,
  normalizeDealData,
  normalizeContactData,
};

export default NormalizationService;
