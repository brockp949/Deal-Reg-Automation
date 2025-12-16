/**
 * EnhancedPdfParser - Advanced PDF Text Extraction
 *
 * Features:
 * - Text extraction with proper reading order
 * - OCR fallback for scanned PDFs using tesseract.js
 * - Page-by-page processing
 * - Metadata extraction
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pdf from 'pdf-parse';
import logger from '../utils/logger';
import {
  IDocumentParser,
  ParsedDocument,
  DocumentParserOptions,
  DocumentMetadata,
  DocumentParseError,
  DocumentParseWarning,
  DEFAULT_PARSER_OPTIONS,
  OCRResult,
} from './types/documentTypes';

/**
 * Minimum word count to consider text extraction successful
 */
const MIN_WORDS_THRESHOLD = 10;

/**
 * Enhanced PDF Parser with OCR support
 */
export class EnhancedPdfParser implements IDocumentParser {
  private name = 'EnhancedPdfParser';
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
    return ['.pdf'];
  }

  /**
   * Check if this parser can handle a file
   */
  canParse(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.pdf';
  }

  /**
   * Parse a PDF file and extract text
   */
  async parse(
    filePath: string,
    options: DocumentParserOptions = DEFAULT_PARSER_OPTIONS
  ): Promise<ParsedDocument> {
    const startTime = Date.now();
    const errors: DocumentParseError[] = [];
    const warnings: DocumentParseWarning[] = [];

    logger.info(`Starting PDF parsing: ${filePath}`);

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      return this.createErrorResult(filePath, startTime, [{
        type: 'io',
        message: `File not found: ${filePath}`,
        recoverable: false,
      }]);
    }

    // Read file
    const buffer = fs.readFileSync(filePath);
    const fileStats = fs.statSync(filePath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    try {
      // First attempt: direct text extraction
      let extractedText = await this.extractTextDirect(buffer, options);
      let pageCount = 0;
      let ocrUsed = false;
      let ocrConfidence: number | undefined;

      // Get page count from pdf-parse
      try {
        const pdfData = await pdf(buffer);
        pageCount = pdfData.numpages;
      } catch {
        warnings.push({
          type: 'format',
          message: 'Could not determine page count',
        });
      }

      // Check if we got meaningful text
      const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

      if (wordCount < MIN_WORDS_THRESHOLD && options.enableOCR) {
        logger.info(`Low text content (${wordCount} words), attempting OCR...`);
        warnings.push({
          type: 'quality',
          message: `Low text content detected (${wordCount} words), using OCR`,
        });

        try {
          const ocrResult = await this.performOCR(filePath, options);
          extractedText = ocrResult.text;
          ocrUsed = true;
          ocrConfidence = ocrResult.confidence;
          logger.info(`OCR completed with confidence: ${ocrConfidence}`);
        } catch (ocrError) {
          errors.push({
            type: 'ocr',
            message: `OCR failed: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`,
            recoverable: true,
          });
          // Keep the original extracted text
        }
      }

      // Normalize text
      const normalizedText = this.normalizeText(extractedText, options);

      // Create metadata
      const metadata: DocumentMetadata = {
        fileName: path.basename(filePath),
        fileType: 'pdf',
        filePath,
        fileSize: fileStats.size,
        checksum,
        parseDate: new Date(),
        processingTimeMs: Date.now() - startTime,
        pageCount,
        ocrUsed,
        ocrConfidence,
        ocrEngine: ocrUsed ? 'tesseract.js' : undefined,
      };

      return {
        rawText: normalizedText,
        metadata,
        errors,
        warnings,
        success: errors.filter(e => !e.recoverable).length === 0,
        contentHash: crypto.createHash('md5').update(normalizedText).digest('hex'),
      };

    } catch (error) {
      logger.error(`PDF parsing failed: ${filePath}`, error);
      return this.createErrorResult(filePath, startTime, [{
        type: 'extraction',
        message: error instanceof Error ? error.message : String(error),
        recoverable: false,
      }], checksum, fileStats.size);
    }
  }

  /**
   * Extract text directly from PDF
   */
  private async extractTextDirect(
    buffer: Buffer,
    options: DocumentParserOptions
  ): Promise<string> {
    // pdf-parse accepts options as second argument but types are incomplete
    const pdfOptions = {
      // Custom page renderer for better text ordering
      pagerender: options.sortTextByPosition
        ? this.renderPageWithOrdering.bind(this)
        : undefined,
    };
    // Type assertion needed because @types/pdf-parse is incomplete
    const pdfWithOptions = pdf as (dataBuffer: Buffer, options?: any) => Promise<{ text: string; numpages: number; info: any; metadata: any; version: string }>;
    const data = await pdfWithOptions(buffer, pdfOptions);

    return data.text;
  }

  /**
   * Custom page renderer that extracts text with proper ordering
   */
  private renderPageWithOrdering(pageData: any): Promise<string> {
    return pageData.getTextContent().then((textContent: any) => {
      // Sort text items by position (top to bottom, left to right)
      const items = textContent.items as any[];

      // Group items by approximate Y position (lines)
      const lineThreshold = 5; // pixels
      const lines: Map<number, any[]> = new Map();

      for (const item of items) {
        if (!item.str || item.str.trim() === '') continue;

        const y = Math.round(item.transform[5] / lineThreshold) * lineThreshold;
        if (!lines.has(y)) {
          lines.set(y, []);
        }
        lines.get(y)!.push(item);
      }

      // Sort lines by Y position (descending - PDF coordinates are bottom-up)
      const sortedLines = Array.from(lines.entries())
        .sort((a, b) => b[0] - a[0]);

      // Build text output
      const textLines: string[] = [];
      for (const [, lineItems] of sortedLines) {
        // Sort items within line by X position
        lineItems.sort((a, b) => a.transform[4] - b.transform[4]);

        // Join items with appropriate spacing
        let lineText = '';
        let lastX = 0;
        for (const item of lineItems) {
          const x = item.transform[4];
          const gap = x - lastX;
          // Add space if there's a gap
          if (lineText && gap > 10) {
            lineText += ' ';
          }
          lineText += item.str;
          lastX = x + (item.width || item.str.length * 5);
        }
        textLines.push(lineText);
      }

      return textLines.join('\n');
    });
  }

  /**
   * Perform OCR on a PDF file
   */
  private async performOCR(
    filePath: string,
    options: DocumentParserOptions
  ): Promise<OCRResult> {
    const startTime = Date.now();

    // Try to import tesseract.js dynamically
    let Tesseract: any;
    try {
      Tesseract = await import('tesseract.js');
    } catch {
      throw new Error('tesseract.js is not installed. Run: npm install tesseract.js');
    }

    // For PDF OCR, we need to convert pages to images first
    // This requires additional setup (pdf2pic or similar)
    // For now, we'll attempt direct recognition which works for some PDFs

    logger.info('Attempting OCR with tesseract.js...');

    try {
      // Try to use pdf2pic if available
      let pdfToImage: any;
      try {
        const pdf2picModule = await import('pdf2pic');
        pdfToImage = pdf2picModule.fromPath;
      } catch {
        logger.warn('pdf2pic not available, OCR may be limited');
      }

      if (pdfToImage) {
        // Convert PDF pages to images and OCR
        return await this.ocrWithPageConversion(filePath, Tesseract, pdfToImage, options);
      } else {
        // Fallback: try basic image recognition if the PDF is image-based
        throw new Error('PDF OCR requires pdf2pic. Install with: npm install pdf2pic');
      }
    } catch (error) {
      logger.error('OCR processing failed:', error);
      throw error;
    } finally {
      logger.info(`OCR processing took ${Date.now() - startTime}ms`);
    }
  }

  /**
   * OCR with page-by-page conversion
   */
  private async ocrWithPageConversion(
    filePath: string,
    Tesseract: any,
    pdfToImage: any,
    options: DocumentParserOptions
  ): Promise<OCRResult> {
    const pageTexts: string[] = [];
    const pageConfidences: number[] = [];
    const startTime = Date.now();

    // Configure PDF to image conversion
    const converter = pdfToImage(filePath, {
      density: options.enableOCR ? 300 : 150,
      format: 'png',
      width: 2000,
      height: 2000,
    });

    // Get page count
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(pdfBuffer);
    const pageCount = pdfData.numpages;

    // Create tesseract worker
    const worker = await Tesseract.createWorker(options.ocrLanguage || 'eng');

    try {
      // Process each page
      for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        logger.debug(`OCR processing page ${pageNum}/${pageCount}`);

        try {
          // Convert page to image
          const result = await converter(pageNum);

          // OCR the image
          const { data } = await worker.recognize(result.path);

          pageTexts.push(data.text);
          pageConfidences.push(data.confidence / 100);

          // Clean up temp image
          if (fs.existsSync(result.path)) {
            fs.unlinkSync(result.path);
          }
        } catch (pageError) {
          logger.warn(`Failed to OCR page ${pageNum}:`, pageError);
          pageTexts.push('');
          pageConfidences.push(0);
        }
      }
    } finally {
      await worker.terminate();
    }

    // Calculate average confidence
    const avgConfidence = pageConfidences.length > 0
      ? pageConfidences.reduce((a, b) => a + b, 0) / pageConfidences.length
      : 0;

    return {
      text: pageTexts.join('\n\n--- PAGE BREAK ---\n\n'),
      confidence: avgConfidence,
      language: options.ocrLanguage || 'eng',
      processingTimeMs: Date.now() - startTime,
      pageResults: pageTexts.map((text, i) => ({
        page: i + 1,
        text,
        confidence: pageConfidences[i],
      })),
    };
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

      // Remove excessive blank lines (more than 2)
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
        fileType: 'pdf',
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

export default EnhancedPdfParser;
