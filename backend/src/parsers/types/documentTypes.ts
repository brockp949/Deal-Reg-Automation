/**
 * Document Parser Types
 *
 * Types and interfaces for the document parsing layer (text extraction phase).
 * This layer focuses on extracting raw text from various document formats.
 * Entity extraction happens in a separate phase using the StandardizedParserOutput types.
 */

/**
 * Supported document types for text extraction
 */
export type DocumentType = 'mbox' | 'pdf' | 'docx' | 'doc' | 'txt' | 'csv' | 'xlsx' | 'xls';

/**
 * Metadata about the parsed document
 */
export interface DocumentMetadata {
  fileName: string;
  fileType: DocumentType;
  filePath: string;
  fileSize: number;
  checksum: string;
  parseDate: Date;
  processingTimeMs: number;

  // Type-specific metadata
  pageCount?: number;        // For PDF, DOCX
  emailCount?: number;       // For MBOX
  encoding?: string;         // For TXT
  rowCount?: number;         // For CSV
  sheetCount?: number;       // For XLSX

  // OCR metadata
  ocrUsed?: boolean;
  ocrConfidence?: number;
  ocrEngine?: string;
}

/**
 * Error encountered during document parsing
 */
export interface DocumentParseError {
  type: 'extraction' | 'encoding' | 'format' | 'ocr' | 'io' | 'unknown';
  message: string;
  page?: number;
  line?: number;
  recoverable: boolean;
  details?: any;
}

/**
 * Warning encountered during document parsing
 */
export interface DocumentParseWarning {
  type: 'quality' | 'truncation' | 'encoding' | 'format';
  message: string;
  location?: string;
}

/**
 * Result of parsing a document for text extraction
 */
export interface ParsedDocument {
  // Extracted text content
  rawText: string;

  // Document metadata
  metadata: DocumentMetadata;

  // Errors and warnings
  errors: DocumentParseError[];
  warnings: DocumentParseWarning[];

  // Success flag
  success: boolean;

  // Optional: structured sections (if detected)
  sections?: DocumentSection[];

  // Optional: original binary data hash for verification
  contentHash?: string;
}

/**
 * A section within a document
 */
export interface DocumentSection {
  title?: string;
  content: string;
  startIndex: number;
  endIndex: number;
  type?: 'header' | 'body' | 'footer' | 'table' | 'list' | 'email';
  level?: number;  // For hierarchical sections (headings)
}

/**
 * Options for document parsing
 */
export interface DocumentParserOptions {
  // General options
  includeMetadata?: boolean;
  maxTextLength?: number;

  // PDF options
  enableOCR?: boolean;
  ocrLanguage?: string;
  preserveLayout?: boolean;
  sortTextByPosition?: boolean;

  // Text options
  forceEncoding?: string;
  normalizeWhitespace?: boolean;

  // DOCX options
  includeHeaders?: boolean;
  includeFooters?: boolean;
  includeComments?: boolean;
}

/**
 * Interface for document parsers (text extraction layer)
 */
export interface IDocumentParser {
  /**
   * Parse a document and extract text
   */
  parse(filePath: string, options?: DocumentParserOptions): Promise<ParsedDocument>;

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[];

  /**
   * Check if this parser can handle a file
   */
  canParse(filePath: string): boolean;

  /**
   * Get parser name and version
   */
  getInfo(): { name: string; version: string };
}

/**
 * Result of OCR processing
 */
export interface OCRResult {
  text: string;
  confidence: number;
  language: string;
  processingTimeMs: number;
  pageResults?: Array<{
    page: number;
    text: string;
    confidence: number;
  }>;
}

/**
 * Configuration for OCR processing
 */
export interface OCRConfig {
  enabled: boolean;
  language: string;
  engine: 'tesseract' | 'tesseract.js';
  minConfidence: number;
  dpi: number;
  timeout: number;
}

/**
 * Default OCR configuration
 */
export const DEFAULT_OCR_CONFIG: OCRConfig = {
  enabled: true,
  language: 'eng',
  engine: 'tesseract.js',
  minConfidence: 0.6,
  dpi: 300,
  timeout: 60000,
};

/**
 * Default parser options
 */
export const DEFAULT_PARSER_OPTIONS: DocumentParserOptions = {
  includeMetadata: true,
  maxTextLength: 10_000_000, // 10MB text limit
  enableOCR: true,
  ocrLanguage: 'eng',
  preserveLayout: false,
  sortTextByPosition: true,
  normalizeWhitespace: true,
  includeHeaders: true,
  includeFooters: false,
  includeComments: false,
};
