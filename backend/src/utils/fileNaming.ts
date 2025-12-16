/**
 * File naming utilities for the transcript processing pipeline.
 *
 * Standard naming convention: {source}_{date}_{description}.{ext}
 *
 * Examples:
 * - gmail_2024-01-15_q1-deals.mbox
 * - zoom_2024-01-15_partner-call.txt
 * - teams_2024-01-15_quarterly-review.docx
 */

import path from 'path';

/**
 * Known source identifiers for file naming
 */
export const FILE_SOURCES = [
  'gmail',
  'outlook',
  'zoom',
  'teams',
  'drive',
  'manual',
  'import',
  'crm',
  'vtiger',
  'salesforce',
] as const;

export type FileSource = (typeof FILE_SOURCES)[number];

/**
 * Parsed components of a standardized filename
 */
export interface ParsedFileName {
  source: string;
  date: string | null;
  description: string;
  extension: string;
  isStandardFormat: boolean;
  originalName: string;
}

/**
 * Options for generating a standardized filename
 */
export interface FileNameOptions {
  source: FileSource | string;
  description: string;
  extension: string;
  date?: Date;
}

/**
 * Parse a filename to extract its components.
 * Handles both standard format and arbitrary filenames.
 *
 * @param fileName - The filename to parse (with or without path)
 * @returns Parsed filename components
 */
export function parseFileName(fileName: string): ParsedFileName {
  const baseName = path.basename(fileName);
  const extension = path.extname(baseName);
  const nameWithoutExt = path.basename(baseName, extension);

  // Try to match standard format: {source}_{date}_{description}
  const standardPattern = /^([a-z]+)_(\d{4}-\d{2}-\d{2})_(.+)$/i;
  const match = nameWithoutExt.match(standardPattern);

  if (match) {
    return {
      source: match[1].toLowerCase(),
      date: match[2],
      description: match[3],
      extension: extension.toLowerCase(),
      isStandardFormat: true,
      originalName: baseName,
    };
  }

  // Try to match partial format: {source}_{description} (no date)
  const partialPattern = /^([a-z]+)_(.+)$/i;
  const partialMatch = nameWithoutExt.match(partialPattern);

  if (partialMatch && FILE_SOURCES.includes(partialMatch[1].toLowerCase() as FileSource)) {
    return {
      source: partialMatch[1].toLowerCase(),
      date: null,
      description: partialMatch[2],
      extension: extension.toLowerCase(),
      isStandardFormat: false,
      originalName: baseName,
    };
  }

  // Non-standard filename - try to extract any date
  const datePattern = /(\d{4}-\d{2}-\d{2})/;
  const dateMatch = nameWithoutExt.match(datePattern);

  return {
    source: 'unknown',
    date: dateMatch ? dateMatch[1] : null,
    description: nameWithoutExt,
    extension: extension.toLowerCase(),
    isStandardFormat: false,
    originalName: baseName,
  };
}

/**
 * Generate a standardized filename.
 *
 * @param options - File naming options
 * @returns Standardized filename
 */
export function generateFileName(options: FileNameOptions): string {
  const date = options.date || new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

  // Sanitize description
  const sanitizedDesc = sanitizeDescription(options.description);

  // Ensure extension starts with a dot
  const ext = options.extension.startsWith('.')
    ? options.extension.toLowerCase()
    : `.${options.extension.toLowerCase()}`;

  return `${options.source.toLowerCase()}_${dateStr}_${sanitizedDesc}${ext}`;
}

/**
 * Sanitize a description for use in a filename.
 * - Converts to lowercase
 * - Replaces spaces and special chars with hyphens
 * - Removes consecutive hyphens
 * - Trims hyphens from ends
 *
 * @param description - Raw description text
 * @returns Sanitized description safe for filenames
 */
export function sanitizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-') // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-') // Collapse consecutive hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .slice(0, 50); // Limit length
}

/**
 * Normalize a filename to the standard format.
 * If already in standard format, returns as-is.
 * Otherwise, generates a new standardized name.
 *
 * @param fileName - Original filename
 * @param source - Source identifier if not in filename
 * @returns Normalized filename
 */
export function normalizeFileName(
  fileName: string,
  source: FileSource | string = 'import'
): string {
  const parsed = parseFileName(fileName);

  if (parsed.isStandardFormat) {
    return parsed.originalName;
  }

  // Determine the source
  const fileSource = parsed.source !== 'unknown' ? parsed.source : source;

  return generateFileName({
    source: fileSource,
    description: parsed.description,
    extension: parsed.extension,
    date: parsed.date ? new Date(parsed.date) : new Date(),
  });
}

/**
 * Extract metadata from a filename.
 * Returns a record of extracted information.
 *
 * @param fileName - The filename to analyze
 * @returns Metadata extracted from the filename
 */
export function extractFileMetadata(fileName: string): Record<string, string | null> {
  const parsed = parseFileName(fileName);

  return {
    source: parsed.source,
    date: parsed.date,
    description: parsed.description,
    extension: parsed.extension,
    format: parsed.isStandardFormat ? 'standard' : 'non-standard',
  };
}

/**
 * Validate if a filename follows the standard naming convention.
 *
 * @param fileName - The filename to validate
 * @returns True if the filename follows the standard format
 */
export function isValidFileName(fileName: string): boolean {
  const parsed = parseFileName(fileName);
  return parsed.isStandardFormat;
}

/**
 * Generate a unique filename by appending a counter if needed.
 *
 * @param baseName - The base filename
 * @param existingNames - Set or array of existing filenames
 * @returns A unique filename
 */
export function generateUniqueFileName(
  baseName: string,
  existingNames: Set<string> | string[]
): string {
  const nameSet = existingNames instanceof Set ? existingNames : new Set(existingNames);

  if (!nameSet.has(baseName)) {
    return baseName;
  }

  const ext = path.extname(baseName);
  const nameWithoutExt = path.basename(baseName, ext);

  let counter = 1;
  let uniqueName: string;

  do {
    uniqueName = `${nameWithoutExt}_${counter}${ext}`;
    counter++;
  } while (nameSet.has(uniqueName) && counter < 1000);

  return uniqueName;
}

/**
 * Detect the likely source of a file based on its content or name patterns.
 *
 * @param fileName - The filename to analyze
 * @param content - Optional file content for deeper analysis
 * @returns Detected source identifier
 */
export function detectFileSource(fileName: string, content?: string): FileSource | 'unknown' {
  const lowerName = fileName.toLowerCase();

  // Check filename patterns
  if (lowerName.includes('gmail') || lowerName.includes('google')) {
    return 'gmail';
  }
  if (lowerName.includes('outlook') || lowerName.includes('microsoft')) {
    return 'outlook';
  }
  if (lowerName.includes('zoom')) {
    return 'zoom';
  }
  if (lowerName.includes('teams')) {
    return 'teams';
  }
  if (lowerName.includes('drive')) {
    return 'drive';
  }
  if (lowerName.includes('vtiger')) {
    return 'vtiger';
  }
  if (lowerName.includes('salesforce') || lowerName.includes('sfdc')) {
    return 'salesforce';
  }

  // Check content patterns if provided
  if (content) {
    if (content.includes('X-Gmail-Labels') || content.includes('@gmail.com')) {
      return 'gmail';
    }
    if (content.includes('X-MS-Exchange') || content.includes('@outlook.com')) {
      return 'outlook';
    }
    if (content.includes('WEBVTT') && content.includes('Zoom')) {
      return 'zoom';
    }
    if (content.includes('Microsoft Teams')) {
      return 'teams';
    }
  }

  return 'unknown';
}
