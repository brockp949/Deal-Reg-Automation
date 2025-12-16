/**
 * ParserFactory - Unified Parser Selection
 *
 * Factory for creating and managing document parsers.
 * Provides a unified interface for parsing different file types.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  IDocumentParser,
  ParsedDocument,
  DocumentParserOptions,
  DocumentType,
  DEFAULT_PARSER_OPTIONS,
} from './types/documentTypes';
import { EnhancedPdfParser } from './EnhancedPdfParser';
import { EnhancedDocxParser } from './EnhancedDocxParser';
import { PlainTextParser } from './PlainTextParser';
import logger from '../utils/logger';

/**
 * Map of file extensions to document types
 */
const EXTENSION_TO_TYPE: Record<string, DocumentType> = {
  '.mbox': 'mbox',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.txt': 'txt',
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
};

/**
 * Registered parsers
 */
const parsers: Map<DocumentType, IDocumentParser> = new Map();

/**
 * Register a parser for a document type
 */
export function registerParser(type: DocumentType, parser: IDocumentParser): void {
  parsers.set(type, parser);
  logger.debug(`Registered parser for ${type}: ${parser.getInfo().name}`);
}

/**
 * Get a parser for a specific document type
 */
export function getParser(type: DocumentType): IDocumentParser | undefined {
  return parsers.get(type);
}

/**
 * Get the document type from a file path
 */
export function getDocumentType(filePath: string): DocumentType | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_TYPE[ext];
}

/**
 * Check if a file type is supported
 */
export function isSupported(filePath: string): boolean {
  const type = getDocumentType(filePath);
  return type !== undefined && parsers.has(type);
}

/**
 * Get all supported extensions
 */
export function getSupportedExtensions(): string[] {
  const extensions: string[] = [];
  for (const [ext, type] of Object.entries(EXTENSION_TO_TYPE)) {
    if (parsers.has(type)) {
      extensions.push(ext);
    }
  }
  return extensions;
}

/**
 * Calculate SHA256 checksum of a file
 */
async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Parse a file using the appropriate parser
 */
export async function parseFile(
  filePath: string,
  options?: Partial<DocumentParserOptions>
): Promise<ParsedDocument> {
  const startTime = Date.now();
  const mergedOptions = { ...DEFAULT_PARSER_OPTIONS, ...options };

  // Get document type
  const type = getDocumentType(filePath);
  if (!type) {
    const ext = path.extname(filePath);
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  // Get parser
  const parser = parsers.get(type);
  if (!parser) {
    throw new Error(`No parser registered for type: ${type}`);
  }

  logger.info(`Parsing file: ${filePath}`, {
    type,
    parser: parser.getInfo().name,
  });

  // Parse the file
  const result = await parser.parse(filePath, mergedOptions);

  // Add checksum if not already present
  if (!result.metadata.checksum) {
    result.metadata.checksum = await calculateChecksum(filePath);
  }

  // Update processing time
  result.metadata.processingTimeMs = Date.now() - startTime;

  logger.info(`Parsing complete: ${filePath}`, {
    success: result.success,
    textLength: result.rawText.length,
    errors: result.errors.length,
    warnings: result.warnings.length,
    processingTimeMs: result.metadata.processingTimeMs,
  });

  return result;
}

/**
 * Parse multiple files
 */
export async function parseFiles(
  filePaths: string[],
  options?: Partial<DocumentParserOptions>
): Promise<Map<string, ParsedDocument>> {
  const results = new Map<string, ParsedDocument>();

  for (const filePath of filePaths) {
    try {
      const result = await parseFile(filePath, options);
      results.set(filePath, result);
    } catch (error) {
      logger.error(`Failed to parse ${filePath}:`, error);
      // Create error result
      results.set(filePath, {
        rawText: '',
        metadata: {
          fileName: path.basename(filePath),
          fileType: getDocumentType(filePath) || 'txt',
          filePath,
          fileSize: 0,
          checksum: '',
          parseDate: new Date(),
          processingTimeMs: 0,
        },
        errors: [{
          type: 'unknown',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        }],
        warnings: [],
        success: false,
      });
    }
  }

  return results;
}

/**
 * Initialize default parsers
 */
export function initializeParsers(): void {
  // Register PDF parser
  registerParser('pdf', new EnhancedPdfParser());

  // Register DOCX parser
  registerParser('docx', new EnhancedDocxParser());
  registerParser('doc', new EnhancedDocxParser()); // Also handles .doc via conversion

  // Register plain text parser
  registerParser('txt', new PlainTextParser());

  logger.info('Parsers initialized', {
    supportedTypes: Array.from(parsers.keys()),
  });
}

/**
 * ParserFactory class for object-oriented usage
 */
export class ParserFactory {
  private static initialized = false;

  /**
   * Ensure parsers are initialized
   */
  private static ensureInitialized(): void {
    if (!this.initialized) {
      initializeParsers();
      this.initialized = true;
    }
  }

  /**
   * Get a parser for a file
   */
  static getParserForFile(filePath: string): IDocumentParser {
    this.ensureInitialized();
    const type = getDocumentType(filePath);
    if (!type) {
      throw new Error(`Unsupported file type: ${path.extname(filePath)}`);
    }
    const parser = getParser(type);
    if (!parser) {
      throw new Error(`No parser available for type: ${type}`);
    }
    return parser;
  }

  /**
   * Parse a single file
   */
  static async parse(
    filePath: string,
    options?: Partial<DocumentParserOptions>
  ): Promise<ParsedDocument> {
    this.ensureInitialized();
    return parseFile(filePath, options);
  }

  /**
   * Parse multiple files
   */
  static async parseMany(
    filePaths: string[],
    options?: Partial<DocumentParserOptions>
  ): Promise<Map<string, ParsedDocument>> {
    this.ensureInitialized();
    return parseFiles(filePaths, options);
  }

  /**
   * Check if a file can be parsed
   */
  static canParse(filePath: string): boolean {
    this.ensureInitialized();
    return isSupported(filePath);
  }

  /**
   * Get all supported file extensions
   */
  static getSupportedExtensions(): string[] {
    this.ensureInitialized();
    return getSupportedExtensions();
  }

  /**
   * Register a custom parser
   */
  static registerParser(type: DocumentType, parser: IDocumentParser): void {
    this.ensureInitialized();
    registerParser(type, parser);
  }
}

export default ParserFactory;
