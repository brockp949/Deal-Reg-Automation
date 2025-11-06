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
 * Generate a descriptive deal name from deal data
 * Priority order:
 * 1. "{Customer} - {Vendor} - ${Value}" if all available
 * 2. "{Customer} - {Vendor}" if both available
 * 3. "{Project Name}" if available
 * 4. "{Customer} - ${Value}" if both available
 * 5. "{Vendor} Opportunity - {Date}" as fallback
 */
export function generateDealName(dealData: {
  customer_name?: string;
  vendor_name?: string;
  project_name?: string;
  deal_value?: number;
  registration_date?: Date;
  end_user_name?: string;
}): string {
  const customer = dealData.customer_name || dealData.end_user_name;
  const vendor = dealData.vendor_name;
  const project = dealData.project_name;
  const value = dealData.deal_value;
  const date = dealData.registration_date || new Date();

  // Format value for display
  const formattedValue = value && value > 0
    ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : null;

  // Priority 1: Customer + Vendor + Value
  if (customer && vendor && formattedValue) {
    return `${customer} - ${vendor} - ${formattedValue}`;
  }

  // Priority 2: Customer + Vendor
  if (customer && vendor) {
    return `${customer} - ${vendor}`;
  }

  // Priority 3: Project Name (if descriptive enough)
  if (project && project.length > 5 && project !== 'Unknown') {
    return project;
  }

  // Priority 4: Customer + Value
  if (customer && formattedValue) {
    return `${customer} - ${formattedValue}`;
  }

  // Priority 5: Vendor + Customer
  if (vendor && customer) {
    return `${vendor} - ${customer}`;
  }

  // Priority 6: Just Customer
  if (customer && customer !== 'Unknown') {
    return `${customer} Deal`;
  }

  // Priority 7: Just Vendor
  if (vendor && vendor !== 'Unknown') {
    const monthYear = date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    return `${vendor} Opportunity - ${monthYear}`;
  }

  // Fallback: Generic with date
  const monthDay = date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  return `Deal Registration - ${monthDay}`;
}
