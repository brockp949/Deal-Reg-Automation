# MBOX & Transcript Processing Pipeline Improvement Plan

## Executive Summary

This plan outlines improvements to the Deal Registration Automation system for processing MBOX files and transcripts. The existing codebase already has sophisticated parsers (`StandardizedMboxParser`, `StandardizedTranscriptParser`), but this plan addresses specific gaps identified in the requirements document.

---

## Phase 1: File Ingestion & Repository Structure

### 1.1 Create Input Directory Structure

**Current State:** Files are uploaded via API to `uploads/` directory.

**Target State:** Add a dedicated `input_transcripts/` directory for batch file processing.

#### Implementation Tasks:

```
backend/
├── input_transcripts/           # NEW - Raw input files
│   ├── mbox/                    # MBOX email archives
│   ├── pdf/                     # PDF transcripts
│   ├── docx/                    # Word documents
│   ├── txt/                     # Plain text files
│   └── processed/               # Archive of processed files
├── output/                      # NEW - Processing results
│   ├── csv/                     # Generated CSV files
│   └── logs/                    # Processing logs
```

#### Files to Create/Modify:

| File | Action | Description |
|------|--------|-------------|
| `backend/src/config/paths.ts` | CREATE | Centralized path configuration |
| `backend/src/services/ingestion/FileWatcher.ts` | CREATE | Watch input directory for new files |
| `backend/src/services/ingestion/BatchProcessor.ts` | CREATE | Process all files in input directory |
| `.gitignore` | MODIFY | Add patterns for input/output dirs |

#### Code: `backend/src/config/paths.ts`

```typescript
import path from 'path';

export const PATHS = {
  INPUT_ROOT: path.resolve(process.cwd(), 'input_transcripts'),
  INPUT_MBOX: path.resolve(process.cwd(), 'input_transcripts/mbox'),
  INPUT_PDF: path.resolve(process.cwd(), 'input_transcripts/pdf'),
  INPUT_DOCX: path.resolve(process.cwd(), 'input_transcripts/docx'),
  INPUT_TXT: path.resolve(process.cwd(), 'input_transcripts/txt'),
  PROCESSED: path.resolve(process.cwd(), 'input_transcripts/processed'),
  OUTPUT_CSV: path.resolve(process.cwd(), 'output/csv'),
  OUTPUT_LOGS: path.resolve(process.cwd(), 'output/logs'),
};

export function ensureDirectories(): void {
  Object.values(PATHS).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}
```

### 1.2 File Naming Convention

**Standard Format:** `{source}_{date}_{description}.{ext}`

Examples:
- `gmail_2024-01-15_q1-deals.mbox`
- `zoom_2024-01-15_partner-call.txt`
- `teams_2024-01-15_quarterly-review.docx`

#### Implementation:

| File | Action | Description |
|------|--------|-------------|
| `backend/src/utils/fileNaming.ts` | CREATE | Parse and generate standardized names |
| `backend/src/services/ingestion/FileNormalizer.ts` | CREATE | Rename files to convention on import |

### 1.3 Git-Based Ingestion Script

**Purpose:** Automate add, commit, push of new files.

#### Script: `scripts/ingest-files.sh`

```bash
#!/bin/bash
# Usage: ./scripts/ingest-files.sh

INPUT_DIR="input_transcripts"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Check for new files
NEW_FILES=$(git status --porcelain "$INPUT_DIR" | grep "^??" | wc -l)

if [ "$NEW_FILES" -gt 0 ]; then
    echo "Found $NEW_FILES new files to ingest"
    git add "$INPUT_DIR"
    git commit -m "chore: ingest $NEW_FILES new transcript(s) - $TIMESTAMP"
    git push origin main
    echo "Files committed and pushed. Workflow will trigger automatically."
else
    echo "No new files to ingest"
fi
```

---

## Phase 2: Document Parsing Pipeline Enhancement

### 2.1 Current Parser Analysis

| Parser | File | Status | Gaps |
|--------|------|--------|------|
| MBOX | `StandardizedMboxParser.ts` | EXISTS | Text order issues, needs OCR fallback |
| Transcript | `StandardizedTranscriptParser.ts` | EXISTS | Needs improved deal separation |
| CSV | `StandardizedCSVParser.ts` | EXISTS | Good - no changes |
| PDF | `pdfParser.ts` | EXISTS | Needs text order fix, OCR support |
| DOCX | `docxParser.ts` | EXISTS | Minor improvements |
| TXT | - | MISSING | Need dedicated parser |

### 2.2 Unified Parser Interface

**Create a factory pattern for consistent parsing:**

#### File: `backend/src/parsers/ParserFactory.ts`

```typescript
import { StandardizedMboxParser } from './StandardizedMboxParser';
import { StandardizedTranscriptParser } from './StandardizedTranscriptParser';
import { EnhancedPdfParser } from './EnhancedPdfParser';
import { EnhancedDocxParser } from './EnhancedDocxParser';
import { PlainTextParser } from './PlainTextParser';

export interface ParsedDocument {
  rawText: string;
  metadata: DocumentMetadata;
  deals: ExtractedDeal[];
  errors: ParseError[];
}

export interface DocumentMetadata {
  fileName: string;
  fileType: string;
  fileSize: number;
  pageCount?: number;
  emailCount?: number;
  parseDate: Date;
  checksum: string;
}

export class ParserFactory {
  static getParser(fileType: string): DocumentParser {
    const extension = fileType.toLowerCase();

    switch (extension) {
      case '.mbox':
        return new StandardizedMboxParser();
      case '.pdf':
        return new EnhancedPdfParser();
      case '.docx':
      case '.doc':
        return new EnhancedDocxParser();
      case '.txt':
        return new PlainTextParser();
      case '.csv':
      case '.xlsx':
      case '.xls':
        return new StandardizedCSVParser();
      default:
        throw new Error(`Unsupported file type: ${extension}`);
    }
  }

  static async parseFile(filePath: string): Promise<ParsedDocument> {
    const ext = path.extname(filePath).toLowerCase();
    const parser = this.getParser(ext);
    return parser.parse(filePath);
  }
}
```

### 2.3 Enhanced PDF Parser with Text Order Fix

**Gap:** Current PDF parser doesn't handle text order correctly.

**Solution:** Use PyMuPDF-style block sorting or `pdf-parse` with position awareness.

#### File: `backend/src/parsers/EnhancedPdfParser.ts`

```typescript
import pdf from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { fromPath } from 'pdf2pic';

export class EnhancedPdfParser implements DocumentParser {
  private ocrEnabled: boolean;

  constructor(options: { enableOCR?: boolean } = {}) {
    this.ocrEnabled = options.enableOCR ?? true;
  }

  async parse(filePath: string): Promise<ParsedDocument> {
    const buffer = await fs.promises.readFile(filePath);

    // First attempt: extract text directly
    let extractedText = await this.extractText(buffer);

    // Check if text extraction was successful (OCR fallback)
    if (this.isScannedPdf(extractedText) && this.ocrEnabled) {
      extractedText = await this.performOCR(filePath);
    }

    // Normalize and order text
    const normalizedText = this.normalizeTextOrder(extractedText);

    return {
      rawText: normalizedText,
      metadata: await this.extractMetadata(buffer, filePath),
      deals: [], // Deals extracted in separate phase
      errors: [],
    };
  }

  private async extractText(buffer: Buffer): Promise<string> {
    const data = await pdf(buffer, {
      // Extract with page breaks preserved
      pagerender: this.renderPage.bind(this),
    });
    return data.text;
  }

  private renderPage(pageData: any): string {
    // Sort text items by y-position (top to bottom), then x-position (left to right)
    const textItems = pageData.getTextContent();
    return textItems.items
      .sort((a: any, b: any) => {
        const yDiff = b.transform[5] - a.transform[5]; // Reverse Y (PDF coords)
        if (Math.abs(yDiff) > 5) return yDiff;
        return a.transform[4] - b.transform[4]; // X position
      })
      .map((item: any) => item.str)
      .join(' ');
  }

  private isScannedPdf(text: string): boolean {
    // Heuristic: if text is very short relative to page count, likely scanned
    const wordCount = text.split(/\s+/).length;
    return wordCount < 50; // Threshold for "no meaningful text"
  }

  private async performOCR(filePath: string): Promise<string> {
    // Convert PDF pages to images
    const converter = fromPath(filePath, {
      density: 300,
      format: 'png',
    });

    const pages: string[] = [];
    let pageNum = 1;

    while (true) {
      try {
        const result = await converter(pageNum);
        const { data: { text } } = await Tesseract.recognize(result.path, 'eng');
        pages.push(text);
        pageNum++;
      } catch {
        break; // No more pages
      }
    }

    return pages.join('\n\n--- PAGE BREAK ---\n\n');
  }

  private normalizeTextOrder(text: string): string {
    return text
      .replace(/\r\n/g, '\n')           // Normalize line endings
      .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
      .replace(/[ \t]+/g, ' ')          // Collapse whitespace
      .trim();
  }
}
```

### 2.4 Enhanced DOCX Parser

#### File: `backend/src/parsers/EnhancedDocxParser.ts`

```typescript
import mammoth from 'mammoth';
import { Document, Packer, Paragraph } from 'docx';

export class EnhancedDocxParser implements DocumentParser {
  async parse(filePath: string): Promise<ParsedDocument> {
    const buffer = await fs.promises.readFile(filePath);

    // Extract text with structure preservation
    const result = await mammoth.extractRawText({ buffer });

    // Also extract with HTML to get structure hints
    const htmlResult = await mammoth.convertToHtml({ buffer });

    return {
      rawText: result.value,
      metadata: {
        fileName: path.basename(filePath),
        fileType: '.docx',
        fileSize: buffer.length,
        parseDate: new Date(),
        checksum: this.computeChecksum(buffer),
      },
      deals: [],
      errors: result.messages.map(m => ({
        type: 'warning',
        message: m.message,
      })),
    };
  }
}
```

### 2.5 Plain Text Parser

#### File: `backend/src/parsers/PlainTextParser.ts`

```typescript
import chardet from 'chardet';
import iconv from 'iconv-lite';

export class PlainTextParser implements DocumentParser {
  async parse(filePath: string): Promise<ParsedDocument> {
    const buffer = await fs.promises.readFile(filePath);

    // Detect encoding
    const encoding = chardet.detect(buffer) || 'utf-8';

    // Convert to UTF-8
    const text = iconv.decode(buffer, encoding);

    // Normalize
    const normalizedText = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();

    return {
      rawText: normalizedText,
      metadata: {
        fileName: path.basename(filePath),
        fileType: '.txt',
        fileSize: buffer.length,
        encoding,
        parseDate: new Date(),
        checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
      },
      deals: [],
      errors: [],
    };
  }
}
```

### 2.6 Dependencies to Add

```json
{
  "dependencies": {
    "pdf-parse": "^1.1.1",
    "pdf2pic": "^3.1.1",
    "tesseract.js": "^5.0.4",
    "mammoth": "^1.6.0",
    "chardet": "^2.0.0",
    "iconv-lite": "^0.6.3"
  }
}
```

---

## Phase 3: Deal Separation & Extraction Logic

### 3.1 Problem Analysis

**Current Issues:**
1. Deals merged when boundaries not detected
2. Deals missed when keywords vary
3. Inconsistent delimiter handling

### 3.2 Enhanced Deal Separator

#### File: `backend/src/services/extraction/DealSeparator.ts`

```typescript
export interface DealBoundary {
  startIndex: number;
  endIndex: number;
  confidence: number;
  detectionMethod: 'keyword' | 'pattern' | 'structure' | 'nlp';
}

export class DealSeparator {
  private readonly DEAL_MARKERS = [
    // Tier 1: High confidence markers
    /^Deal[\s:]+/im,
    /^Opportunity[\s:]+/im,
    /^Deal Name[\s:]+/im,
    /^Account[\s:]+/im,
    /^Customer[\s:]+/im,

    // Tier 2: Medium confidence markers
    /^Prospect[\s:]+/im,
    /^Lead[\s:]+/im,
    /^Company[\s:]+/im,

    // Tier 3: Numbered lists
    /^\d+\.\s+[A-Z]/m,
    /^[-•]\s+[A-Z]/m,
  ];

  private readonly DEAL_END_MARKERS = [
    /^Status[\s:]+/im,
    /^Next Steps[\s:]+/im,
    /^---+/m,
    /^={3,}/m,
    /^\s*$/m, // Blank line (paragraph separator)
  ];

  async separateDeals(text: string): Promise<DealBoundary[]> {
    const boundaries: DealBoundary[] = [];

    // Strategy 1: Keyword-based splitting
    const keywordBoundaries = this.findKeywordBoundaries(text);

    // Strategy 2: Structure-based splitting (blank lines, sections)
    const structureBoundaries = this.findStructureBoundaries(text);

    // Strategy 3: Pattern-based (numbered lists, bullets)
    const patternBoundaries = this.findPatternBoundaries(text);

    // Merge and reconcile boundaries
    const mergedBoundaries = this.reconcileBoundaries([
      ...keywordBoundaries,
      ...structureBoundaries,
      ...patternBoundaries,
    ]);

    // Validate: ensure no deal is too short or too long
    return this.validateBoundaries(mergedBoundaries, text);
  }

  private findKeywordBoundaries(text: string): DealBoundary[] {
    const boundaries: DealBoundary[] = [];
    const lines = text.split('\n');
    let currentStart = 0;
    let currentLineIndex = 0;

    for (const [lineIndex, line] of lines.entries()) {
      const isMarker = this.DEAL_MARKERS.some(marker => marker.test(line));

      if (isMarker && lineIndex > 0) {
        // Found new deal start - close previous
        boundaries.push({
          startIndex: currentStart,
          endIndex: currentLineIndex,
          confidence: 0.9,
          detectionMethod: 'keyword',
        });
        currentStart = currentLineIndex;
      }

      currentLineIndex += line.length + 1; // +1 for newline
    }

    // Add final boundary
    if (currentStart < text.length) {
      boundaries.push({
        startIndex: currentStart,
        endIndex: text.length,
        confidence: 0.9,
        detectionMethod: 'keyword',
      });
    }

    return boundaries;
  }

  private findStructureBoundaries(text: string): DealBoundary[] {
    // Split on double newlines (paragraph boundaries)
    const paragraphs = text.split(/\n\n+/);
    const boundaries: DealBoundary[] = [];
    let currentIndex = 0;

    for (const para of paragraphs) {
      if (this.looksLikeDeal(para)) {
        boundaries.push({
          startIndex: currentIndex,
          endIndex: currentIndex + para.length,
          confidence: 0.7,
          detectionMethod: 'structure',
        });
      }
      currentIndex += para.length + 2; // +2 for \n\n
    }

    return boundaries;
  }

  private looksLikeDeal(text: string): boolean {
    // Check for deal-like characteristics
    const hasCompanyName = /[A-Z][a-z]+ (?:Inc|Corp|LLC|Ltd|Co)/i.test(text);
    const hasValue = /\$[\d,]+(?:\.\d{2})?|\d+k|\d+K|\d+ million/i.test(text);
    const hasDate = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text);

    return hasCompanyName || hasValue || hasDate;
  }

  private reconcileBoundaries(all: DealBoundary[]): DealBoundary[] {
    // Sort by start index
    all.sort((a, b) => a.startIndex - b.startIndex);

    // Merge overlapping boundaries, preferring higher confidence
    const merged: DealBoundary[] = [];

    for (const boundary of all) {
      const last = merged[merged.length - 1];

      if (!last || boundary.startIndex > last.endIndex) {
        merged.push(boundary);
      } else if (boundary.confidence > last.confidence) {
        // Replace with higher confidence boundary
        merged[merged.length - 1] = boundary;
      }
    }

    return merged;
  }

  private validateBoundaries(boundaries: DealBoundary[], text: string): DealBoundary[] {
    return boundaries.filter(b => {
      const length = b.endIndex - b.startIndex;
      const content = text.substring(b.startIndex, b.endIndex);

      // Minimum 20 chars, maximum 10000 chars
      if (length < 20 || length > 10000) return false;

      // Must contain some alphabetic content
      if (!/[a-zA-Z]{3,}/.test(content)) return false;

      return true;
    });
  }
}
```

### 3.3 Enhanced Deal Extractor

#### File: `backend/src/services/extraction/DealExtractor.ts`

```typescript
export interface ExtractedDeal {
  dealName: string;
  customerName?: string;
  dealValue?: number;
  currency?: string;
  status?: string;
  owner?: string;
  expectedCloseDate?: Date;
  description?: string;
  confidence: number;
  sourceLocation: {
    startIndex: number;
    endIndex: number;
    sourceFile?: string;
  };
  rawText: string;
}

export class DealExtractor {
  private readonly FIELD_PATTERNS = {
    dealName: [
      /Deal(?:\s+Name)?[\s:]+([^\n]+)/i,
      /Opportunity[\s:]+([^\n]+)/i,
      /Account[\s:]+([^\n]+)/i,
    ],
    customerName: [
      /Customer[\s:]+([^\n]+)/i,
      /Company[\s:]+([^\n]+)/i,
      /Client[\s:]+([^\n]+)/i,
      /Account Name[\s:]+([^\n]+)/i,
    ],
    dealValue: [
      /Value[\s:]+\$?([\d,]+(?:\.\d{2})?)/i,
      /Amount[\s:]+\$?([\d,]+(?:\.\d{2})?)/i,
      /Deal Size[\s:]+\$?([\d,]+(?:\.\d{2})?)/i,
      /\$\s*([\d,]+(?:\.\d{2})?)/,
    ],
    status: [
      /Status[\s:]+(\w+(?:\s+\w+)?)/i,
      /Stage[\s:]+(\w+(?:\s+\w+)?)/i,
    ],
    owner: [
      /Owner[\s:]+([^\n]+)/i,
      /Rep[\s:]+([^\n]+)/i,
      /Sales Rep[\s:]+([^\n]+)/i,
      /Assigned[\s:]+([^\n]+)/i,
    ],
    expectedCloseDate: [
      /Close Date[\s:]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Expected[\s:]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Target[\s:]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ],
  };

  extractDeal(text: string, boundary: DealBoundary): ExtractedDeal {
    const content = text.substring(boundary.startIndex, boundary.endIndex);

    const deal: ExtractedDeal = {
      dealName: this.extractField(content, 'dealName') || this.inferDealName(content),
      customerName: this.extractField(content, 'customerName'),
      dealValue: this.parseValue(this.extractField(content, 'dealValue')),
      status: this.extractField(content, 'status'),
      owner: this.extractField(content, 'owner'),
      expectedCloseDate: this.parseDate(this.extractField(content, 'expectedCloseDate')),
      confidence: boundary.confidence,
      sourceLocation: {
        startIndex: boundary.startIndex,
        endIndex: boundary.endIndex,
      },
      rawText: content,
    };

    // Boost confidence if we found multiple fields
    const fieldCount = Object.values(deal).filter(v => v !== undefined && v !== null).length;
    deal.confidence = Math.min(1, deal.confidence + (fieldCount * 0.05));

    return deal;
  }

  private extractField(content: string, field: keyof typeof this.FIELD_PATTERNS): string | undefined {
    const patterns = this.FIELD_PATTERNS[field];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  private inferDealName(content: string): string {
    // Try to infer deal name from first line or company mention
    const lines = content.split('\n').filter(l => l.trim());

    // First non-empty line might be the deal name
    if (lines[0] && lines[0].length < 100) {
      return lines[0].trim();
    }

    // Look for company name pattern
    const companyMatch = content.match(/([A-Z][a-z]+ (?:Inc|Corp|LLC|Ltd|Co)\.?)/);
    if (companyMatch) {
      return companyMatch[1];
    }

    return 'Unknown Deal';
  }

  private parseValue(value: string | undefined): number | undefined {
    if (!value) return undefined;

    // Handle K/M suffixes
    const cleaned = value.replace(/,/g, '');

    if (/k$/i.test(cleaned)) {
      return parseFloat(cleaned) * 1000;
    }
    if (/m$/i.test(cleaned) || /million/i.test(cleaned)) {
      return parseFloat(cleaned) * 1000000;
    }

    return parseFloat(cleaned) || undefined;
  }

  private parseDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;

    // Try multiple formats
    const formats = [
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY
      /(\d{1,2})-(\d{1,2})-(\d{4})/,   // MM-DD-YYYY
      /(\d{4})-(\d{1,2})-(\d{1,2})/,   // YYYY-MM-DD
    ];

    for (const format of formats) {
      const match = value.match(format);
      if (match) {
        return new Date(value);
      }
    }

    return undefined;
  }
}
```

---

## Phase 4: Export Capabilities

### 4.1 CSV Export Enhancement

**Current State:** `exportService.ts` exists with CSV support.

**Enhancement:** Add more flexible column mapping and validation.

#### File: `backend/src/services/export/EnhancedExportService.ts`

```typescript
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';

export interface ExportOptions {
  format: 'csv' | 'xlsx' | 'json';
  columns?: string[];
  includeMetadata?: boolean;
  fileName?: string;
}

export class EnhancedExportService {
  async exportDeals(deals: ExtractedDeal[], options: ExportOptions): Promise<Buffer> {
    // Clean data for export
    const cleanedDeals = deals.map(deal => this.cleanForExport(deal));

    switch (options.format) {
      case 'csv':
        return this.exportToCsv(cleanedDeals, options);
      case 'xlsx':
        return this.exportToExcel(cleanedDeals, options);
      case 'json':
        return Buffer.from(JSON.stringify(cleanedDeals, null, 2));
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  private cleanForExport(deal: ExtractedDeal): Record<string, any> {
    return {
      'Deal Name': deal.dealName,
      'Customer Name': deal.customerName || '',
      'Deal Value': deal.dealValue || '',
      'Currency': deal.currency || 'USD',
      'Status': deal.status || '',
      'Owner': deal.owner || '',
      'Expected Close Date': deal.expectedCloseDate
        ? deal.expectedCloseDate.toISOString().split('T')[0]
        : '',
      'Description': (deal.description || '').replace(/\n/g, ' '), // Flatten newlines
      'Confidence': (deal.confidence * 100).toFixed(1) + '%',
      'Source File': deal.sourceLocation.sourceFile || '',
    };
  }

  private exportToCsv(deals: Record<string, any>[], options: ExportOptions): Buffer {
    const columns = options.columns || Object.keys(deals[0] || {});

    const csv = stringify(deals, {
      header: true,
      columns,
      quoted_string: true, // Quote strings to handle commas/newlines
    });

    return Buffer.from(csv, 'utf-8');
  }

  private async exportToExcel(deals: Record<string, any>[], options: ExportOptions): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Deals');

    if (deals.length === 0) {
      return workbook.xlsx.writeBuffer() as Promise<Buffer>;
    }

    // Add headers
    const columns = options.columns || Object.keys(deals[0]);
    sheet.columns = columns.map(col => ({
      header: col,
      key: col,
      width: 20,
    }));

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data
    deals.forEach(deal => sheet.addRow(deal));

    return workbook.xlsx.writeBuffer() as Promise<Buffer>;
  }
}
```

### 4.2 Google Sheets Integration

#### File: `backend/src/services/export/GoogleSheetsService.ts`

```typescript
import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';

export interface SheetsConfig {
  spreadsheetId: string;
  sheetName?: string;
  serviceAccountKey: {
    client_email: string;
    private_key: string;
  };
}

export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets;
  private config: SheetsConfig;

  constructor(config: SheetsConfig) {
    this.config = config;

    const auth = new JWT({
      email: config.serviceAccountKey.client_email,
      key: config.serviceAccountKey.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async updateSheet(deals: ExtractedDeal[], mode: 'append' | 'replace' = 'append'): Promise<void> {
    const sheetName = this.config.sheetName || 'Deals';
    const range = `${sheetName}!A1`;

    // Convert deals to rows
    const headers = [
      'Deal Name', 'Customer Name', 'Deal Value', 'Currency',
      'Status', 'Owner', 'Expected Close', 'Confidence', 'Source'
    ];

    const rows = deals.map(deal => [
      deal.dealName,
      deal.customerName || '',
      deal.dealValue || '',
      deal.currency || 'USD',
      deal.status || '',
      deal.owner || '',
      deal.expectedCloseDate?.toISOString().split('T')[0] || '',
      `${(deal.confidence * 100).toFixed(1)}%`,
      deal.sourceLocation.sourceFile || '',
    ]);

    if (mode === 'replace') {
      // Clear existing data first
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.config.spreadsheetId,
        range: `${sheetName}!A:Z`,
      });

      // Write headers + data
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers, ...rows],
        },
      });
    } else {
      // Append mode
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows,
        },
      });
    }
  }

  async getExistingDeals(): Promise<string[][]> {
    const sheetName = this.config.sheetName || 'Deals';

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    return response.data.values || [];
  }
}
```

### 4.3 Environment Variables for Google Sheets

Add to `.env.example`:

```env
# Google Sheets Integration
GOOGLE_SHEETS_ENABLED=false
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SHEETS_SHEET_NAME=Deals
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

---

## Phase 5: GitHub Actions Automation

### 5.1 Enhanced Workflow

#### File: `.github/workflows/process-transcripts.yml`

```yaml
name: Process Transcripts

on:
  push:
    paths:
      - 'input_transcripts/**'
  workflow_dispatch:
    inputs:
      force_reprocess:
        description: 'Force reprocess all files'
        type: boolean
        default: false

env:
  NODE_VERSION: '20'

jobs:
  process:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for diff

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y poppler-utils tesseract-ocr

      - name: Install Node dependencies
        working-directory: backend
        run: npm ci

      - name: Determine files to process
        id: files
        run: |
          if [ "${{ github.event.inputs.force_reprocess }}" == "true" ]; then
            echo "Processing all files (force mode)"
            FILES=$(find input_transcripts -type f \( -name "*.mbox" -o -name "*.pdf" -o -name "*.docx" -o -name "*.txt" \) | tr '\n' ' ')
          else
            echo "Processing changed files only"
            FILES=$(git diff --name-only HEAD~1 HEAD -- 'input_transcripts/**' | tr '\n' ' ')
          fi
          echo "files=$FILES" >> $GITHUB_OUTPUT
          echo "Files to process: $FILES"

      - name: Run parsing pipeline
        if: steps.files.outputs.files != ''
        working-directory: backend
        run: |
          npm run parse:transcripts -- --files="${{ steps.files.outputs.files }}"
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          NODE_ENV: production

      - name: Export to CSV
        working-directory: backend
        run: npm run export:csv -- --output=../output/deals_$(date +%Y%m%d).csv

      - name: Update Google Sheets
        if: env.GOOGLE_SHEETS_ENABLED == 'true'
        working-directory: backend
        run: npm run export:sheets
        env:
          GOOGLE_SHEETS_SPREADSHEET_ID: ${{ secrets.GOOGLE_SHEETS_SPREADSHEET_ID }}
          GOOGLE_SERVICE_ACCOUNT_EMAIL: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_EMAIL }}
          GOOGLE_SERVICE_ACCOUNT_KEY: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_KEY }}

      - name: Move processed files
        run: |
          mkdir -p input_transcripts/processed/$(date +%Y%m%d)
          for file in ${{ steps.files.outputs.files }}; do
            if [ -f "$file" ]; then
              mv "$file" input_transcripts/processed/$(date +%Y%m%d)/
            fi
          done

      - name: Commit results
        uses: EndBug/add-and-commit@v9
        with:
          add: |
            output/
            input_transcripts/processed/
          message: 'chore: processed transcripts and exported deals'
          default_author: github_actions

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: deal-export-${{ github.run_number }}
          path: output/
          retention-days: 30

      - name: Post summary
        run: |
          echo "## Processing Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "- Files processed: $(echo '${{ steps.files.outputs.files }}' | wc -w)" >> $GITHUB_STEP_SUMMARY
          echo "- Output: output/deals_$(date +%Y%m%d).csv" >> $GITHUB_STEP_SUMMARY
          echo "- Timestamp: $(date -u)" >> $GITHUB_STEP_SUMMARY
```

### 5.2 NPM Scripts to Add

Add to `backend/package.json`:

```json
{
  "scripts": {
    "parse:transcripts": "ts-node src/scripts/parseTranscripts.ts",
    "export:csv": "ts-node src/scripts/exportToCsv.ts",
    "export:sheets": "ts-node src/scripts/exportToSheets.ts",
    "ingest:watch": "ts-node src/scripts/watchInputDir.ts"
  }
}
```

### 5.3 Parse Transcripts Script

#### File: `backend/src/scripts/parseTranscripts.ts`

```typescript
import { ParserFactory } from '../parsers/ParserFactory';
import { DealSeparator } from '../services/extraction/DealSeparator';
import { DealExtractor } from '../services/extraction/DealExtractor';
import { EnhancedExportService } from '../services/export/EnhancedExportService';
import { PATHS, ensureDirectories } from '../config/paths';
import fs from 'fs';
import path from 'path';

async function main() {
  ensureDirectories();

  // Parse CLI args
  const args = process.argv.slice(2);
  const filesArg = args.find(a => a.startsWith('--files='));

  let filesToProcess: string[];

  if (filesArg) {
    filesToProcess = filesArg.replace('--files=', '').split(' ').filter(Boolean);
  } else {
    // Default: process all files in input directory
    filesToProcess = getAllInputFiles();
  }

  console.log(`Processing ${filesToProcess.length} file(s)...`);

  const separator = new DealSeparator();
  const extractor = new DealExtractor();
  const allDeals: ExtractedDeal[] = [];

  for (const filePath of filesToProcess) {
    console.log(`\nProcessing: ${filePath}`);

    try {
      // Parse document
      const parsed = await ParserFactory.parseFile(filePath);
      console.log(`  - Extracted ${parsed.rawText.length} characters`);

      // Separate deals
      const boundaries = await separator.separateDeals(parsed.rawText);
      console.log(`  - Found ${boundaries.length} deal boundaries`);

      // Extract deal details
      for (const boundary of boundaries) {
        const deal = extractor.extractDeal(parsed.rawText, boundary);
        deal.sourceLocation.sourceFile = path.basename(filePath);
        allDeals.push(deal);
      }

      console.log(`  - Extracted ${boundaries.length} deal(s)`);
    } catch (error) {
      console.error(`  - ERROR: ${error.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total deals extracted: ${allDeals.length}`);

  // Save results
  const exportService = new EnhancedExportService();
  const csvBuffer = await exportService.exportDeals(allDeals, { format: 'csv' });

  const outputPath = path.join(PATHS.OUTPUT_CSV, `deals_${Date.now()}.csv`);
  fs.writeFileSync(outputPath, csvBuffer);
  console.log(`Output saved to: ${outputPath}`);
}

function getAllInputFiles(): string[] {
  const files: string[] = [];
  const extensions = ['.mbox', '.pdf', '.docx', '.txt'];

  for (const ext of extensions) {
    const dir = PATHS[`INPUT_${ext.toUpperCase().slice(1)}`] || PATHS.INPUT_ROOT;
    if (fs.existsSync(dir)) {
      const found = fs.readdirSync(dir)
        .filter(f => f.endsWith(ext))
        .map(f => path.join(dir, f));
      files.push(...found);
    }
  }

  return files;
}

main().catch(console.error);
```

---

## Phase 6: Testing & Validation

### 6.1 Test Files

Create sample test files for each format:

```
backend/tests/fixtures/
├── sample.mbox         # Sample MBOX with 3 emails containing deals
├── sample.pdf          # Sample PDF with 2 deals
├── sample.docx         # Sample DOCX with 4 deals
├── sample.txt          # Sample TXT with 2 deals
└── expected/           # Expected output for comparison
    ├── sample_mbox_deals.json
    ├── sample_pdf_deals.json
    ├── sample_docx_deals.json
    └── sample_txt_deals.json
```

### 6.2 Unit Tests

#### File: `backend/tests/parsers/DealSeparator.test.ts`

```typescript
import { DealSeparator } from '../../src/services/extraction/DealSeparator';

describe('DealSeparator', () => {
  const separator = new DealSeparator();

  test('separates deals by keyword markers', async () => {
    const text = `
Deal: Acme Corp
Value: $50,000
Status: Open

Deal: Beta Inc
Value: $75,000
Status: Closed
    `;

    const boundaries = await separator.separateDeals(text);
    expect(boundaries).toHaveLength(2);
  });

  test('handles numbered lists', async () => {
    const text = `
1. First Company - $100K opportunity
2. Second Company - $200K opportunity
3. Third Company - $150K opportunity
    `;

    const boundaries = await separator.separateDeals(text);
    expect(boundaries).toHaveLength(3);
  });

  test('does not merge deals without clear boundaries', async () => {
    const text = `
Customer: Alpha Corp
Deal Value: $50,000

Customer: Beta LLC
Deal Value: $30,000
    `;

    const boundaries = await separator.separateDeals(text);
    expect(boundaries).toHaveLength(2);
  });
});
```

### 6.3 Integration Tests

#### File: `backend/tests/integration/pipeline.test.ts`

```typescript
import { ParserFactory } from '../../src/parsers/ParserFactory';
import path from 'path';

describe('Full Pipeline Integration', () => {
  const fixturesDir = path.join(__dirname, '../fixtures');

  test('processes MBOX file end-to-end', async () => {
    const result = await ParserFactory.parseFile(
      path.join(fixturesDir, 'sample.mbox')
    );

    expect(result.rawText).toBeTruthy();
    expect(result.errors).toHaveLength(0);
  });

  test('processes PDF file end-to-end', async () => {
    const result = await ParserFactory.parseFile(
      path.join(fixturesDir, 'sample.pdf')
    );

    expect(result.rawText).toBeTruthy();
    expect(result.metadata.pageCount).toBeGreaterThan(0);
  });
});
```

---

## Implementation Timeline

### Week 1: Foundation
| Task | Files | Priority |
|------|-------|----------|
| Create directory structure | `config/paths.ts` | HIGH |
| Implement ParserFactory | `parsers/ParserFactory.ts` | HIGH |
| Add PlainTextParser | `parsers/PlainTextParser.ts` | HIGH |
| Add npm scripts | `package.json` | HIGH |

### Week 2: Parser Enhancements
| Task | Files | Priority |
|------|-------|----------|
| Enhance PDF parser with OCR | `parsers/EnhancedPdfParser.ts` | HIGH |
| Enhance DOCX parser | `parsers/EnhancedDocxParser.ts` | MEDIUM |
| Add dependencies | `package.json` | HIGH |
| Write unit tests | `tests/parsers/*.test.ts` | MEDIUM |

### Week 3: Deal Extraction
| Task | Files | Priority |
|------|-------|----------|
| Implement DealSeparator | `services/extraction/DealSeparator.ts` | HIGH |
| Implement DealExtractor | `services/extraction/DealExtractor.ts` | HIGH |
| Test with real transcripts | Manual testing | HIGH |
| Fix edge cases | Various | MEDIUM |

### Week 4: Export & Automation
| Task | Files | Priority |
|------|-------|----------|
| Enhance ExportService | `services/export/EnhancedExportService.ts` | HIGH |
| Add Google Sheets integration | `services/export/GoogleSheetsService.ts` | MEDIUM |
| Create GitHub Action | `.github/workflows/process-transcripts.yml` | HIGH |
| Create CLI scripts | `scripts/*.ts` | HIGH |

### Week 5: Testing & Documentation
| Task | Files | Priority |
|------|-------|----------|
| Integration tests | `tests/integration/*.test.ts` | HIGH |
| End-to-end testing | Manual | HIGH |
| Update documentation | `docs/*.md` | MEDIUM |
| Performance testing | Manual | LOW |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| OCR accuracy issues | Use high-resolution images, test multiple Tesseract configs |
| Deal boundary detection failures | Add manual review queue, log low-confidence extractions |
| Google Sheets API limits | Implement batch updates, add retry logic |
| Large file processing | Add streaming, chunking for files > 10MB |
| Encoding issues | Use chardet for detection, normalize to UTF-8 |

---

## Success Metrics

1. **Accuracy**: 95%+ of deals correctly separated
2. **Coverage**: All file types (MBOX, PDF, DOCX, TXT) supported
3. **Automation**: Zero manual intervention for standard files
4. **Speed**: < 30 seconds processing per file
5. **Reliability**: < 1% error rate on valid input files

---

## Dependencies Summary

```json
{
  "new_dependencies": {
    "pdf-parse": "^1.1.1",
    "pdf2pic": "^3.1.1",
    "tesseract.js": "^5.0.4",
    "mammoth": "^1.6.0",
    "chardet": "^2.0.0",
    "iconv-lite": "^0.6.3",
    "googleapis": "^130.0.0"
  },
  "system_dependencies": [
    "poppler-utils (for pdf2pic)",
    "tesseract-ocr (for OCR fallback)"
  ]
}
```

---

## Files to Create/Modify Summary

| Action | Path | Description |
|--------|------|-------------|
| CREATE | `backend/src/config/paths.ts` | Path configuration |
| CREATE | `backend/src/parsers/ParserFactory.ts` | Unified parser factory |
| CREATE | `backend/src/parsers/EnhancedPdfParser.ts` | PDF with OCR |
| CREATE | `backend/src/parsers/EnhancedDocxParser.ts` | DOCX parser |
| CREATE | `backend/src/parsers/PlainTextParser.ts` | TXT parser |
| CREATE | `backend/src/services/extraction/DealSeparator.ts` | Deal boundary detection |
| CREATE | `backend/src/services/extraction/DealExtractor.ts` | Deal field extraction |
| CREATE | `backend/src/services/export/EnhancedExportService.ts` | Multi-format export |
| CREATE | `backend/src/services/export/GoogleSheetsService.ts` | Sheets integration |
| CREATE | `backend/src/scripts/parseTranscripts.ts` | CLI script |
| CREATE | `.github/workflows/process-transcripts.yml` | GitHub Action |
| MODIFY | `backend/package.json` | Add scripts & deps |
| MODIFY | `.env.example` | Add Sheets config |
| CREATE | `scripts/ingest-files.sh` | Git automation |
