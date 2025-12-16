/**
 * ExportManager Unit Tests
 */

import { ExportManager } from '../../src/services/export/ExportManager';
import { EnhancedExportService } from '../../src/services/export/EnhancedExportService';
import { ExtractedDeal } from '../../src/services/extraction/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ExportManager', () => {
  let exportManager: ExportManager;
  let tempDir: string;

  const sampleDeals: ExtractedDeal[] = [
    {
      dealName: 'Acme Corporation',
      customerName: 'Acme Corp',
      dealValue: 150000,
      currency: 'USD',
      status: 'Qualified',
      owner: 'John Smith',
      expectedCloseDate: new Date('2025-03-30'),
      probability: 75,
      decisionMaker: 'Jane Doe',
      confidence: 0.95,
      sourceLocation: {
        startIndex: 0,
        endIndex: 100,
        sourceFile: 'test.txt',
        startLine: 1,
        endLine: 10,
      },
      rawText: 'Sample deal text',
    },
    {
      dealName: 'Beta Technologies',
      customerName: 'Beta Tech',
      dealValue: 75000,
      currency: 'USD',
      status: 'Discovery',
      confidence: 0.85,
      sourceLocation: {
        startIndex: 101,
        endIndex: 200,
        sourceFile: 'test.txt',
        startLine: 11,
        endLine: 20,
      },
      rawText: 'Another deal text',
    },
  ];

  beforeEach(() => {
    exportManager = new ExportManager({
      includeExtendedColumns: true,
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('exportToCsv', () => {
    it('should export deals to CSV', async () => {
      const result = await exportManager.exportToCsv(sampleDeals, {
        outputDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('csv');
      expect(result.recordCount).toBe(2);
      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath!)).toBe(true);
    });

    it('should include headers in CSV', async () => {
      const result = await exportManager.exportToCsv(sampleDeals, {
        outputDir: tempDir,
      });

      const content = fs.readFileSync(result.filePath!, 'utf-8');
      expect(content).toContain('Deal Name');
      expect(content).toContain('Customer Name');
      expect(content).toContain('Deal Value');
    });

    it('should include deal data in CSV', async () => {
      const result = await exportManager.exportToCsv(sampleDeals, {
        outputDir: tempDir,
      });

      const content = fs.readFileSync(result.filePath!, 'utf-8');
      expect(content).toContain('Acme Corporation');
      expect(content).toContain('Beta Technologies');
    });

    it('should handle empty deals array', async () => {
      const result = await exportManager.exportToCsv([], {
        outputDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.recordCount).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('exportToExcel', () => {
    it('should export deals to Excel', async () => {
      const result = await exportManager.exportToExcel(sampleDeals, {
        outputDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('xlsx');
      expect(result.recordCount).toBe(2);
      expect(result.filePath).toBeDefined();
      expect(result.filePath!.endsWith('.xlsx')).toBe(true);
      expect(fs.existsSync(result.filePath!)).toBe(true);
    });

    it('should create valid Excel file', async () => {
      const result = await exportManager.exportToExcel(sampleDeals, {
        outputDir: tempDir,
      });

      // Check file size is reasonable (Excel files are larger)
      const stats = fs.statSync(result.filePath!);
      expect(stats.size).toBeGreaterThan(1000); // At least 1KB
    });

    it('should include metadata sheet when requested', async () => {
      const result = await exportManager.exportToExcel(sampleDeals, {
        outputDir: tempDir,
        includeMetadata: true,
      });

      expect(result.success).toBe(true);
      // File should be larger with metadata sheet
      const stats = fs.statSync(result.filePath!);
      expect(stats.size).toBeGreaterThan(1000);
    });
  });

  describe('exportToJson', () => {
    it('should export deals to JSON', async () => {
      const result = await exportManager.exportToJson(sampleDeals, {
        outputDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('json');
      expect(result.recordCount).toBe(2);
      expect(result.filePath).toBeDefined();
      expect(result.filePath!.endsWith('.json')).toBe(true);
    });

    it('should create valid JSON', async () => {
      const result = await exportManager.exportToJson(sampleDeals, {
        outputDir: tempDir,
      });

      const content = fs.readFileSync(result.filePath!, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toBeDefined();
    });

    it('should include metadata when requested', async () => {
      const result = await exportManager.exportToJson(sampleDeals, {
        outputDir: tempDir,
        includeMetadata: true,
      });

      const content = fs.readFileSync(result.filePath!, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.recordCount).toBe(2);
      expect(parsed.deals).toBeDefined();
    });

    it('should export as array without metadata', async () => {
      const result = await exportManager.exportToJson(sampleDeals, {
        outputDir: tempDir,
        includeMetadata: false,
      });

      const content = fs.readFileSync(result.filePath!, 'utf-8');
      const parsed = JSON.parse(content);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
    });
  });

  describe('exportMultiple', () => {
    it('should export to multiple formats', async () => {
      const results = await exportManager.exportMultiple(
        sampleDeals,
        ['csv', 'xlsx', 'json'],
        { outputDir: tempDir }
      );

      expect(results.size).toBe(3);
      expect(results.get('csv')?.success).toBe(true);
      expect(results.get('xlsx')?.success).toBe(true);
      expect(results.get('json')?.success).toBe(true);
    });

    it('should continue on partial failure', async () => {
      // Export to valid and invalid (sheets without config)
      const results = await exportManager.exportMultiple(
        sampleDeals,
        ['csv', 'sheets'],
        { outputDir: tempDir }
      );

      expect(results.size).toBe(2);
      expect(results.get('csv')?.success).toBe(true);
      expect(results.get('sheets')?.success).toBe(false);
    });
  });

  describe('getBuffer', () => {
    it('should return CSV buffer without file', async () => {
      const buffer = await exportManager.getBuffer(sampleDeals, 'csv');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      const content = buffer.toString('utf-8');
      expect(content).toContain('Acme Corporation');
    });

    it('should return Excel buffer without file', async () => {
      const buffer = await exportManager.getBuffer(sampleDeals, 'xlsx');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it('should return JSON buffer without file', async () => {
      const buffer = await exportManager.getBuffer(sampleDeals, 'json');

      expect(buffer).toBeInstanceOf(Buffer);

      const parsed = JSON.parse(buffer.toString('utf-8'));
      expect(parsed).toBeDefined();
    });
  });

  describe('getSupportedFormats', () => {
    it('should return supported formats', () => {
      const formats = exportManager.getSupportedFormats();

      expect(formats).toContain('csv');
      expect(formats).toContain('xlsx');
      expect(formats).toContain('json');
    });

    it('should not include sheets when not configured', () => {
      const formats = exportManager.getSupportedFormats();

      // Sheets requires configuration
      expect(formats).not.toContain('sheets');
    });
  });

  describe('isSheetsEnabled', () => {
    it('should return false when not configured', () => {
      expect(exportManager.isSheetsEnabled()).toBe(false);
    });
  });
});

describe('EnhancedExportService', () => {
  let exportService: EnhancedExportService;
  let tempDir: string;

  const sampleDeals: ExtractedDeal[] = [
    {
      dealName: 'Test Deal',
      dealValue: 50000,
      currency: 'USD',
      confidence: 0.9,
      sourceLocation: { startIndex: 0, endIndex: 50, startLine: 1 },
      rawText: 'Test',
    },
  ];

  beforeEach(() => {
    exportService = new EnhancedExportService({
      includeExtendedColumns: false,
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-service-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should format deal values correctly', async () => {
    const result = await exportService.exportDeals(sampleDeals, {
      format: 'json',
      outputDir: tempDir,
    });

    const content = fs.readFileSync(result.filePath!, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed[0]['Deal Value']).toBe('$50,000');
    expect(parsed[0]['Confidence']).toBe('90%');
  });

  it('should handle missing optional fields', async () => {
    const sparseDeals: ExtractedDeal[] = [
      {
        dealName: 'Sparse Deal',
        confidence: 0.5,
        sourceLocation: { startIndex: 0, endIndex: 20, startLine: 1 },
        rawText: 'Sparse',
      },
    ];

    const result = await exportService.exportDeals(sparseDeals, {
      format: 'csv',
      outputDir: tempDir,
    });

    expect(result.success).toBe(true);

    const content = fs.readFileSync(result.filePath!, 'utf-8');
    expect(content).toContain('Sparse Deal');
  });

  it('should use custom filename when provided', async () => {
    const result = await exportService.exportDeals(sampleDeals, {
      format: 'csv',
      outputDir: tempDir,
      fileName: 'custom-export',
    });

    expect(result.filePath).toContain('custom-export.csv');
  });
});
