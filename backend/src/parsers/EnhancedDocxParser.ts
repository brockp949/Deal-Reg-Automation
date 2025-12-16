/**
 * EnhancedDocxParser - Advanced DOCX Text Extraction
 *
 * Features:
 * - Text extraction using mammoth
 * - Structure preservation (headers, lists, tables)
 * - Metadata extraction
 * - Warning handling for conversion issues
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mammoth from 'mammoth';
import logger from '../utils/logger';
import {
  IDocumentParser,
  ParsedDocument,
  DocumentParserOptions,
  DocumentMetadata,
  DocumentParseError,
  DocumentParseWarning,
  DocumentSection,
  DEFAULT_PARSER_OPTIONS,
} from './types/documentTypes';

/**
 * Enhanced DOCX Parser
 */
export class EnhancedDocxParser implements IDocumentParser {
  private name = 'EnhancedDocxParser';
  private version = '2.0.0';

  /**
   * Get parser info
   */
  getInfo(): { name: string; version: string } {
    return { name: this.name, version: this.version };
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['.docx', '.doc'];
  }

  /**
   * Check if this parser can handle a file
   */
  canParse(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.docx' || ext === '.doc';
  }

  /**
   * Parse a DOCX file and extract text
   */
  async parse(
    filePath: string,
    options: DocumentParserOptions = DEFAULT_PARSER_OPTIONS
  ): Promise<ParsedDocument> {
    const startTime = Date.now();
    const errors: DocumentParseError[] = [];
    const warnings: DocumentParseWarning[] = [];

    logger.info(`Starting DOCX parsing: ${filePath}`);

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      return this.createErrorResult(filePath, startTime, [{
        type: 'io',
        message: `File not found: ${filePath}`,
        recoverable: false,
      }]);
    }

    const ext = path.extname(filePath).toLowerCase();

    // Handle .doc files (older format)
    if (ext === '.doc') {
      warnings.push({
        type: 'format',
        message: 'Legacy .doc format detected. Some formatting may be lost.',
        location: filePath,
      });
    }

    // Read file
    const buffer = fs.readFileSync(filePath);
    const fileStats = fs.statSync(filePath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    try {
      // Extract raw text
      const textResult = await mammoth.extractRawText({ buffer });

      // Also get HTML for structure analysis
      const htmlResult = await mammoth.convertToHtml({ buffer });

      // Process mammoth warnings
      for (const msg of textResult.messages) {
        if (msg.type === 'warning') {
          warnings.push({
            type: 'format',
            message: msg.message,
          });
        }
      }

      for (const msg of htmlResult.messages) {
        if (msg.type === 'warning' && !warnings.some(w => w.message === msg.message)) {
          warnings.push({
            type: 'format',
            message: msg.message,
          });
        }
      }

      // Extract sections from HTML (if available)
      const sections = this.extractSections(htmlResult.value, textResult.value);

      // Normalize text
      const normalizedText = this.normalizeText(textResult.value, options);

      // Create metadata
      const metadata: DocumentMetadata = {
        fileName: path.basename(filePath),
        fileType: 'docx',
        filePath,
        fileSize: fileStats.size,
        checksum,
        parseDate: new Date(),
        processingTimeMs: Date.now() - startTime,
        pageCount: this.estimatePageCount(normalizedText),
      };

      return {
        rawText: normalizedText,
        metadata,
        errors,
        warnings,
        success: errors.filter(e => !e.recoverable).length === 0,
        sections,
        contentHash: crypto.createHash('md5').update(normalizedText).digest('hex'),
      };

    } catch (error) {
      logger.error(`DOCX parsing failed: ${filePath}`, error);
      return this.createErrorResult(filePath, startTime, [{
        type: 'extraction',
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
      }], checksum, fileStats.size);
    }
  }

  /**
   * Extract sections from HTML output
   */
  private extractSections(html: string, rawText: string): DocumentSection[] {
    const sections: DocumentSection[] = [];

    // Simple section detection based on headers
    const headerPattern = /<h([1-6])>(.*?)<\/h[1-6]>/gi;
    let match;
    let lastIndex = 0;

    while ((match = headerPattern.exec(html)) !== null) {
      const level = parseInt(match[1], 10);
      const title = this.stripHtml(match[2]);

      // Find the corresponding position in raw text
      const titleIndex = rawText.indexOf(title, lastIndex);
      if (titleIndex !== -1) {
        // If we have content before this header, add it as a section
        if (sections.length === 0 && titleIndex > 0) {
          sections.push({
            content: rawText.substring(0, titleIndex).trim(),
            startIndex: 0,
            endIndex: titleIndex,
            type: 'body',
          });
        }

        sections.push({
          title,
          content: '', // Will be filled in post-processing
          startIndex: titleIndex,
          endIndex: titleIndex, // Will be updated
          type: 'header',
          level,
        });

        lastIndex = titleIndex + title.length;
      }
    }

    // Fill in section content
    for (let i = 0; i < sections.length; i++) {
      const current = sections[i];
      const next = sections[i + 1];

      if (next) {
        current.endIndex = next.startIndex;
        current.content = rawText.substring(current.startIndex, current.endIndex).trim();
      } else {
        current.endIndex = rawText.length;
        current.content = rawText.substring(current.startIndex).trim();
      }
    }

    // If no sections found, create one section with all content
    if (sections.length === 0 && rawText.trim()) {
      sections.push({
        content: rawText.trim(),
        startIndex: 0,
        endIndex: rawText.length,
        type: 'body',
      });
    }

    return sections;
  }

  /**
   * Strip HTML tags from text
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  /**
   * Estimate page count from text length
   */
  private estimatePageCount(text: string): number {
    // Rough estimate: ~3000 characters per page
    const charsPerPage = 3000;
    return Math.max(1, Math.ceil(text.length / charsPerPage));
  }

  /**
   * Normalize extracted text
   */
  private normalizeText(text: string, options: DocumentParserOptions): string {
    let normalized = text;

    if (options.normalizeWhitespace) {
      // Normalize line endings
      normalized = normalized.replace(/\r\n/g, '\n');
      normalized = normalized.replace(/\r/g, '\n');

      // Remove excessive blank lines
      normalized = normalized.replace(/\n{3,}/g, '\n\n');

      // Collapse multiple spaces
      normalized = normalized.replace(/[ \t]+/g, ' ');

      // Trim lines
      normalized = normalized.split('\n').map(line => line.trim()).join('\n');
    }

    // Trim overall
    normalized = normalized.trim();

    // Enforce max length
    if (options.maxTextLength && normalized.length > options.maxTextLength) {
      normalized = normalized.substring(0, options.maxTextLength);
    }

    return normalized;
  }

  /**
   * Create an error result
   */
  private createErrorResult(
    filePath: string,
    startTime: number,
    errors: DocumentParseError[],
    checksum?: string,
    fileSize?: number
  ): ParsedDocument {
    return {
      rawText: '',
      metadata: {
        fileName: path.basename(filePath),
        fileType: 'docx',
        filePath,
        fileSize: fileSize || 0,
        checksum: checksum || '',
        parseDate: new Date(),
        processingTimeMs: Date.now() - startTime,
      },
      errors,
      warnings: [],
      success: false,
    };
  }
}

export default EnhancedDocxParser;
