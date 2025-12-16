/**
 * PlainTextParser - Plain Text File Parsing with Encoding Detection
 *
 * Features:
 * - Automatic encoding detection
 * - Multiple encoding support (UTF-8, Latin-1, etc.)
 * - Line ending normalization
 * - Section detection
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
 * Common encodings to try in order of likelihood
 */
const ENCODINGS_TO_TRY = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'latin1',
  'ascii',
  'windows-1252',
];

/**
 * BOM (Byte Order Mark) signatures
 */
const BOM_SIGNATURES: { [key: string]: Buffer } = {
  'utf-8': Buffer.from([0xEF, 0xBB, 0xBF]),
  'utf-16le': Buffer.from([0xFF, 0xFE]),
  'utf-16be': Buffer.from([0xFE, 0xFF]),
  'utf-32le': Buffer.from([0xFF, 0xFE, 0x00, 0x00]),
  'utf-32be': Buffer.from([0x00, 0x00, 0xFE, 0xFF]),
};

/**
 * Plain Text Parser with encoding detection
 */
export class PlainTextParser implements IDocumentParser {
  private name = 'PlainTextParser';
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
    return ['.txt', '.text', '.log', '.md', '.markdown'];
  }

  /**
   * Check if this parser can handle a file
   */
  canParse(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.getSupportedExtensions().includes(ext);
  }

  /**
   * Parse a text file and extract content
   */
  async parse(
    filePath: string,
    options: DocumentParserOptions = DEFAULT_PARSER_OPTIONS
  ): Promise<ParsedDocument> {
    const startTime = Date.now();
    const errors: DocumentParseError[] = [];
    const warnings: DocumentParseWarning[] = [];

    logger.info(`Starting text file parsing: ${filePath}`);

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      return this.createErrorResult(filePath, startTime, [{
        type: 'io',
        message: `File not found: ${filePath}`,
        recoverable: false,
      }]);
    }

    // Read file as buffer
    const buffer = fs.readFileSync(filePath);
    const fileStats = fs.statSync(filePath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    try {
      // Detect encoding
      let encoding: string;
      let text: string;

      if (options.forceEncoding) {
        encoding = options.forceEncoding;
        text = this.decodeBuffer(buffer, encoding);
      } else {
        const detected = this.detectEncoding(buffer);
        encoding = detected.encoding;
        text = detected.text;

        if (detected.confidence < 0.9) {
          warnings.push({
            type: 'encoding',
            message: `Encoding detected with low confidence: ${encoding} (${Math.round(detected.confidence * 100)}%)`,
          });
        }
      }

      // Count lines
      const lineCount = text.split('\n').length;

      // Normalize text
      const normalizedText = this.normalizeText(text, options);

      // Detect sections
      const sections = this.detectSections(normalizedText);

      // Create metadata
      const metadata: DocumentMetadata = {
        fileName: path.basename(filePath),
        fileType: 'txt',
        filePath,
        fileSize: fileStats.size,
        checksum,
        parseDate: new Date(),
        processingTimeMs: Date.now() - startTime,
        encoding,
        rowCount: lineCount,
      };

      return {
        rawText: normalizedText,
        metadata,
        errors,
        warnings,
        success: true,
        sections,
        contentHash: crypto.createHash('md5').update(normalizedText).digest('hex'),
      };

    } catch (error) {
      logger.error(`Text file parsing failed: ${filePath}`, error);
      return this.createErrorResult(filePath, startTime, [{
        type: 'encoding',
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
      }], checksum, fileStats.size);
    }
  }

  /**
   * Detect the encoding of a buffer
   */
  private detectEncoding(buffer: Buffer): { encoding: string; text: string; confidence: number } {
    // Check for BOM
    for (const [encoding, bom] of Object.entries(BOM_SIGNATURES)) {
      if (buffer.subarray(0, bom.length).equals(bom)) {
        const textBuffer = buffer.subarray(bom.length);
        return {
          encoding,
          text: this.decodeBuffer(textBuffer, encoding),
          confidence: 1.0,
        };
      }
    }

    // Try each encoding and score the result
    let bestResult = { encoding: 'utf-8', text: '', confidence: 0 };

    for (const encoding of ENCODINGS_TO_TRY) {
      try {
        const text = this.decodeBuffer(buffer, encoding);
        const confidence = this.scoreText(text);

        if (confidence > bestResult.confidence) {
          bestResult = { encoding, text, confidence };
        }

        // If we get a perfect score, stop
        if (confidence >= 0.99) {
          break;
        }
      } catch {
        // Encoding failed, skip
      }
    }

    return bestResult;
  }

  /**
   * Decode a buffer using a specific encoding
   */
  private decodeBuffer(buffer: Buffer, encoding: string): string {
    // Node.js supports these encodings directly
    const nodeEncodings: { [key: string]: BufferEncoding } = {
      'utf-8': 'utf-8',
      'utf8': 'utf-8',
      'utf-16le': 'utf16le',
      'utf16le': 'utf16le',
      'latin1': 'latin1',
      'ascii': 'ascii',
      'windows-1252': 'latin1', // Close approximation
    };

    const nodeEncoding = nodeEncodings[encoding.toLowerCase()] || 'utf-8';
    return buffer.toString(nodeEncoding);
  }

  /**
   * Score text quality to determine encoding confidence
   */
  private scoreText(text: string): number {
    let score = 1.0;

    // Penalize replacement characters (encoding errors)
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    score -= Math.min(0.5, replacementCount * 0.01);

    // Penalize control characters (except common ones)
    const controlChars = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || [];
    score -= Math.min(0.3, controlChars.length * 0.01);

    // Reward common characters
    const commonChars = text.match(/[a-zA-Z0-9\s.,!?;:'"()-]/g) || [];
    const commonRatio = commonChars.length / Math.max(1, text.length);
    score = score * (0.5 + commonRatio * 0.5);

    // Penalize very high proportion of non-ASCII
    const nonAscii = text.match(/[^\x00-\x7F]/g) || [];
    const nonAsciiRatio = nonAscii.length / Math.max(1, text.length);
    if (nonAsciiRatio > 0.3) {
      score -= (nonAsciiRatio - 0.3) * 0.5;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Detect sections in text
   */
  private detectSections(text: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = text.split('\n');

    let currentSection: DocumentSection | null = null;
    let currentContent: string[] = [];
    let currentStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check if this line looks like a header
      const isHeader = this.isLikelyHeader(trimmedLine, i, lines);

      if (isHeader) {
        // Save previous section
        if (currentContent.length > 0 || currentSection) {
          sections.push({
            title: currentSection?.title,
            content: currentContent.join('\n'),
            startIndex: currentStart,
            endIndex: text.indexOf(line),
            type: currentSection?.type || 'body',
            level: currentSection?.level,
          });
        }

        // Start new section
        currentSection = {
          title: trimmedLine,
          content: '',
          startIndex: text.indexOf(line, currentStart),
          endIndex: 0,
          type: 'header',
          level: this.getHeaderLevel(trimmedLine),
        };
        currentContent = [];
        currentStart = text.indexOf(line, currentStart);
      } else {
        currentContent.push(line);
      }
    }

    // Add final section
    if (currentContent.length > 0 || currentSection) {
      sections.push({
        title: currentSection?.title,
        content: currentContent.join('\n'),
        startIndex: currentStart,
        endIndex: text.length,
        type: currentSection?.type || 'body',
        level: currentSection?.level,
      });
    }

    // If no sections detected, return single body section
    if (sections.length === 0 && text.trim()) {
      sections.push({
        content: text,
        startIndex: 0,
        endIndex: text.length,
        type: 'body',
      });
    }

    return sections;
  }

  /**
   * Check if a line is likely a header
   */
  private isLikelyHeader(line: string, index: number, allLines: string[]): boolean {
    if (!line || line.length === 0) return false;
    if (line.length > 100) return false; // Too long for a header

    // Markdown headers
    if (/^#{1,6}\s+/.test(line)) return true;

    // All caps lines (potential headers)
    if (line === line.toUpperCase() && line.length >= 3 && /[A-Z]/.test(line)) {
      // Check if next line is empty or different style
      const nextLine = allLines[index + 1];
      if (!nextLine || nextLine.trim() === '' || nextLine.trim().length > line.length * 2) {
        return true;
      }
    }

    // Underlined headers (next line is all = or -)
    const nextLine = allLines[index + 1]?.trim();
    if (nextLine && /^[=\-]{3,}$/.test(nextLine)) {
      return true;
    }

    // Lines ending with colon followed by empty line
    if (line.endsWith(':') && allLines[index + 1]?.trim() === '') {
      return true;
    }

    return false;
  }

  /**
   * Get header level from text
   */
  private getHeaderLevel(line: string): number {
    // Markdown headers
    const mdMatch = line.match(/^(#{1,6})\s+/);
    if (mdMatch) {
      return mdMatch[1].length;
    }

    // All caps is usually top-level
    if (line === line.toUpperCase()) {
      return 1;
    }

    return 2;
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

      // Collapse multiple spaces (but preserve indentation)
      normalized = normalized.split('\n').map(line => {
        const leadingSpace = line.match(/^\s*/)?.[0] || '';
        const rest = line.substring(leadingSpace.length).replace(/[ \t]+/g, ' ');
        return leadingSpace + rest;
      }).join('\n');
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
        fileType: 'txt',
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

export default PlainTextParser;
