import { extname } from 'path';
import { config } from '../config';
import { FileType } from '../types';

/**
 * Determine file type from filename extension
 */
export function getFileType(filename: string): FileType {
  const ext = extname(filename).toLowerCase();

  switch (ext) {
    case '.mbox':
      return 'mbox';
    case '.csv':
      return 'csv';
    case '.pdf':
      return 'pdf';
    case '.docx':
      return 'docx';
    case '.txt':
      return 'txt';
    default:
      return 'txt';
  }
}

/**
 * Validate file type is allowed
 */
export function isValidFileType(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return config.upload.allowedTypes.includes(ext);
}

/**
 * Validate file size
 */
export function isValidFileSize(size: number): boolean {
  return size <= config.upload.maxFileSize;
}

/**
 * Generate unique filename
 */
export function generateUniqueFilename(originalFilename: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const ext = extname(originalFilename);
  const baseName = originalFilename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
  return `${baseName}_${timestamp}_${random}${ext}`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Normalize vendor name for matching
 */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b\.?/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Extract email domain from email address
 */
export function extractEmailDomain(email: string): string | null {
  const match = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Extract email domains from various sources
 */
export function extractEmailDomains(data: any): string[] {
  const domains = new Set<string>();

  // From email field
  if (data.email) {
    const domain = extractEmailDomain(data.email);
    if (domain) domains.add(domain);
  }

  // From website field
  if (data.website) {
    try {
      const url = new URL(data.website.startsWith('http') ? data.website : `https://${data.website}`);
      domains.add(url.hostname.replace('www.', ''));
    } catch (error) {
      // Invalid URL, skip
    }
  }

  // From contacts array
  if (data.contacts && Array.isArray(data.contacts)) {
    data.contacts.forEach((contact: any) => {
      if (contact.email) {
        const domain = extractEmailDomain(contact.email);
        if (domain) domains.add(domain);
      }
    });
  }

  return Array.from(domains);
}

/**
 * Convert email domain to company name
 * Examples:
 *   cisco.com -> Cisco
 *   vmware.com -> VMware
 *   dell-emc.com -> Dell EMC
 *   salesforce.com -> Salesforce
 */
export function domainToCompanyName(domain: string): string {
  if (!domain) return 'Unknown';

  // Remove common TLDs and www
  let companyPart = domain
    .replace(/^www\./, '')
    .replace(/\.(com|net|org|io|co|edu|gov)$/, '');

  // Handle special cases
  const specialCases: { [key: string]: string } = {
    'dell-emc': 'Dell EMC',
    'hpe': 'HPE',
    'aws': 'AWS',
    'microsoft': 'Microsoft',
    'google': 'Google',
    'oracle': 'Oracle',
    'ibm': 'IBM',
    'cisco': 'Cisco',
    'vmware': 'VMware',
    'redhat': 'Red Hat',
    'salesforce': 'Salesforce',
    'adobe': 'Adobe',
    'sap': 'SAP',
  };

  const lowerCompany = companyPart.toLowerCase();
  if (specialCases[lowerCompany]) {
    return specialCases[lowerCompany];
  }

  // Convert hyphens to spaces and capitalize each word
  companyPart = companyPart
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return companyPart;
}

/**
 * Extract commodity/product type from deal data
 * Looks for keywords in deal name, notes, or project name
 */
export function extractCommodityType(dealData: {
  deal_name?: string;
  project_name?: string;
  notes?: string;
  product_name?: string;
  product_service_requirements?: string;
}): string | null {
  const commodityKeywords = [
    'cable', 'cables', 'cabling',
    'fiber', 'fibre', 'ftth', 'fttx',
    'transformer', 'transformers',
    'switch', 'switches', 'switching',
    'router', 'routers', 'routing',
    'copper',
    'power', 'electrical',
    'battery', 'batteries',
    'solar', 'photovoltaic', 'pv',
    'inverter', 'inverters',
    'ups', 'backup power', 'generator', 'generators',
    'network', 'networking', 'sd-wan', 'firewall',
    'server', 'servers',
    'storage', 'san', 'nas',
    'compute', 'datacenter', 'data center',
    'wireless', 'wi-fi', 'wifi', '5g',
    'antenna', 'antennas', 'tower', 'towers',
    'conduit',
    'panel', 'panels',
    'equipment',
    'hardware',
    'software', 'platform',
    'license', 'licenses', 'licensing',
    'security', 'surveillance', 'camera', 'cameras',
    'sensing', 'scada', 'automation',
    'hvac', 'cooling',
  ];

  const searchText = [
    dealData.deal_name,
    dealData.project_name,
    dealData.notes,
    dealData.product_name,
    dealData.product_service_requirements,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const keyword of commodityKeywords) {
    if (searchText.includes(keyword)) {
      // Capitalize first letter
      return keyword.charAt(0).toUpperCase() + keyword.slice(1);
    }
  }

  return null;
}

/**
 * Normalize company name to proper format
 * Examples:
 *   Javelintelecom -> Javelin Telecom
 *   ACME_CORP -> ACME Corp
 *   microsoftcorp -> Microsoft Corp
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return name;

  let normalized = name;

  // Common word separations
  const compoundWords: Record<string, string> = {
    'telecom': ' Telecom',
    'communications': ' Communications',
    'electric': ' Electric',
    'power': ' Power',
    'energy': ' Energy',
    'solutions': ' Solutions',
    'systems': ' Systems',
    'technologies': ' Technologies',
    'services': ' Services',
    'networks': ' Networks',
    'cable': ' Cable',
    'fiber': ' Fiber',
    'wireless': ' Wireless',
    'broadband': ' Broadband',
    'internet': ' Internet',
    'digital': ' Digital',
    'group': ' Group',
    'corporation': ' Corporation',
    'incorporated': ' Incorporated',
    'company': ' Company',
    'enterprises': ' Enterprises',
    'industries': ' Industries',
  };

  // Replace underscores and hyphens with spaces
  normalized = normalized.replace(/[_-]/g, ' ');

  // Handle camelCase or joined words
  for (const [word, replacement] of Object.entries(compoundWords)) {
    const regex = new RegExp(word, 'gi');
    if (regex.test(normalized) && !normalized.toLowerCase().includes(` ${word}`)) {
      // Only replace if not already separated
      normalized = normalized.replace(regex, replacement);
    }
  }

  // Capitalize each word properly
  normalized = normalized
    .split(/\s+/)
    .map((word) => {
      // Preserve all-caps acronyms (2-4 letters)
      if (word.length >= 2 && word.length <= 4 && word === word.toUpperCase()) {
        return word;
      }
      // Capitalize first letter of each word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();

  return normalized;
}

/**
 * Enrich customer name by looking up domain or normalizing
 */
export async function enrichCustomerName(customerName: string, email?: string, website?: string): Promise<string> {
  if (!customerName) return customerName;

  // First, normalize the name
  let enriched = normalizeCompanyName(customerName);

  // If we have an email domain or website, we could potentially look it up
  // For now, we'll use the normalized name
  // TODO: Implement external API lookup (Clearbit, Hunter.io, etc.) for company enrichment

  return enriched;
}

type DealNameContext = {
  customer_name?: string;
  vendor_name?: string;
  project_name?: string;
  deal_value?: number;
  registration_date?: Date;
  end_user_name?: string;
  deal_name?: string;
  notes?: string;
  product_name?: string;
  product_service_requirements?: string;
};

const SPEC_PATTERNS: Array<{ regex: RegExp; formatter: (match: RegExpMatchArray) => string }> = [
  {
    regex: /(\d+(?:\.\d+)?)\s*(mw|gw|kw|kva|kv)\b/i,
    formatter: (match) => `${formatNumericToken(match[1])}${match[2].toUpperCase()}`,
  },
  {
    regex: /(\d+(?:\.\d+)?)\s*(gbps|tbps|mbps|gbit|gbe)\b/i,
    formatter: (match) => `${formatNumericToken(match[1])}${match[2].toUpperCase()}`,
  },
  {
    regex: /(\d+)\s*(strand|fiber|pair)s?\b/i,
    formatter: (match) => `${match[1]}-${capitalizeWord(singularize(match[2]))}`,
  },
  {
    regex: /(\d+)\s*(port|ports|lane|lanes)\b/i,
    formatter: (match) => `${match[1]}-Port`,
  },
  {
    regex: /(\d+)\s*(rack|racks|cabinet|cabinets|panel|panels)\b/i,
    formatter: (match) => `${match[1]} ${capitalizeWord(singularize(match[2]))}`,
  },
  {
    regex: /(\d+(?:\.\d+)?)\s*(mile|mi|km|kilometer|meter|m)\b.*?(fiber|conduit|cable)/i,
    formatter: (match) => `${formatNumericToken(match[1])}${match[2].toUpperCase()} ${capitalizeWord(match[4])}`,
  },
];

const SCOPE_PATTERNS: Array<{ regex: RegExp; formatter: (match: RegExpMatchArray) => string }> = [
  {
    regex: /(\d+)\s*(site|sites|location|locations|store|stores|branch|branches|facility|facilities|tower|towers|campus|campuses)\b/i,
    formatter: (match) => `${match[1]}-${capitalizeWord(singularize(match[2]))}`,
  },
  {
    regex: /phase\s*(\d+)/i,
    formatter: (match) => `Phase ${match[1]}`,
  },
  {
    regex: /(wave\s*[1-9])/i,
    formatter: (match) => match[1].replace(/\s+/g, ' ').toUpperCase(),
  },
];

function formatNumericToken(value: string): string {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) {
    return value.trim();
  }

  if (Number.isInteger(parsed)) {
    return parsed.toString();
  }

  const rounded = parsed < 10 ? parsed.toFixed(1) : parsed.toFixed(0);
  return rounded.replace(/\.0+$/, '');
}

function capitalizeWord(value: string): string {
  if (!value) return value;
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function singularize(value: string): string {
  if (!value) return value;
  return value.replace(/(?:es|s)$/i, '');
}

function buildContextText(dealData: DealNameContext): string {
  return [
    dealData.deal_name,
    dealData.project_name,
    dealData.product_name,
    dealData.product_service_requirements,
    dealData.notes,
  ]
    .filter((fragment): fragment is string => Boolean(fragment))
    .join(' ');
}

function extractSpecDetail(dealData: DealNameContext): string | null {
  const text = buildContextText(dealData);
  if (!text) return null;

  for (const pattern of SPEC_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      return pattern.formatter(match);
    }
  }

  return null;
}

function extractScopeDescriptor(dealData: DealNameContext): string | null {
  const text = buildContextText(dealData);
  if (!text) return null;

  for (const pattern of SCOPE_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      return pattern.formatter(match);
    }
  }

  return null;
}

function formatDealValue(value?: number): string | null {
  if (!value || value <= 0) {
    return null;
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const decimals = millions >= 10 ? 0 : 1;
    return `$${millions.toFixed(decimals)}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    const decimals = thousands >= 10 ? 0 : 1;
    return `$${thousands.toFixed(decimals)}K`;
  }

  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function deriveDealSizeDescriptor(value?: number): string | null {
  if (!value || value <= 0) {
    return null;
  }

  let label = 'Micro Engagement';
  if (value >= 5_000_000) {
    label = 'Mega Program';
  } else if (value >= 1_000_000) {
    label = 'Large Build';
  } else if (value >= 250_000) {
    label = 'Expansion Scope';
  } else if (value >= 75_000) {
    label = 'Pilot Rollout';
  }

  const formatted = formatDealValue(value);
  return formatted ? `${label} (${formatted})` : label;
}

function shortenDescriptor(value?: string | null, maxLength = 60): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function combineUniqueParts(parts: Array<string | null | undefined>): string {
  const unique: string[] = [];
  parts.forEach((part) => {
    const normalized = part?.trim();
    if (!normalized) return;
    const exists = unique.some(existing => existing.toLowerCase() === normalized.toLowerCase());
    if (!exists) {
      unique.push(normalized);
    }
  });
  return unique.join(' - ');
}

/**
 * Generate a descriptive deal name from deal data
 * Priority order:
 * 1. "{Customer} - {Commodity}" if both available
 * 2. "{Customer} - {Vendor} - ${Value}" if all available
 * 3. "{Customer} - {Vendor}" if both available
 * 4. "{Commodity} - ${Value}" if both available
 * 5. "{Project Name}" if available
 * 6. "{Customer} - ${Value}" if both available
 * 7. "{Vendor} - {Commodity}" if both available
 * 8. "{Vendor} Opportunity - {Date}" as fallback
 */
export function generateDealName(dealData: DealNameContext): string {
  const customer = dealData.customer_name || dealData.end_user_name;
  const vendor = dealData.vendor_name;
  const project = dealData.project_name;
  const value = dealData.deal_value;
  const date = dealData.registration_date || new Date();

  const commodity = extractCommodityType({
    deal_name: dealData.deal_name,
    project_name: dealData.project_name,
    notes: dealData.notes,
    product_name: dealData.product_name,
    product_service_requirements: dealData.product_service_requirements,
  });

  const specDetail = extractSpecDetail(dealData);
  const scopeDescriptor = extractScopeDescriptor(dealData);
  const sizeDescriptor = deriveDealSizeDescriptor(value);
  const formattedValue = formatDealValue(value);

  const commodityHeadline = [commodity, specDetail].filter(Boolean).join(' ').trim() || null;

  const advancedName = combineUniqueParts([
    commodityHeadline || scopeDescriptor,
    sizeDescriptor,
    scopeDescriptor && scopeDescriptor !== commodityHeadline ? scopeDescriptor : null,
    shortenDescriptor(project, 60),
    shortenDescriptor(customer || vendor, 40),
  ]);

  if (advancedName) {
    return advancedName;
  }

  if (customer && commodity) {
    return `${customer} - ${commodity}`;
  }

  if (customer && vendor && formattedValue) {
    return `${customer} - ${vendor} - ${formattedValue}`;
  }

  if (customer && vendor) {
    return `${customer} - ${vendor}`;
  }

  if (commodity && formattedValue) {
    return `${commodity} - ${formattedValue}`;
  }

  if (project && project.length > 5 && project !== 'Unknown') {
    return project;
  }

  if (customer && formattedValue) {
    return `${customer} - ${formattedValue}`;
  }

  if (vendor && commodity) {
    return `${vendor} - ${commodity}`;
  }

  if (vendor && customer) {
    return `${vendor} - ${customer}`;
  }

  if (customer && customer !== 'Unknown') {
    return `${customer} Deal`;
  }

  if (commodity) {
    return `${commodity} Deal`;
  }

  if (vendor && vendor !== 'Unknown') {
    const monthYear = date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    return `${vendor} - ${monthYear}`;
  }

  const monthDay = date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  return `Deal Registration - ${monthDay}`;
}
