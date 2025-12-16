import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { parseDocxFile, parseDocxTranscript } from '../../parsers/docxParser';

describe('docxParser', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-parser-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parseDocxFile', () => {
    it('throws error for non-existent file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.docx');

      await expect(parseDocxFile(filePath)).rejects.toThrow('Failed to parse DOCX');
    });

    it('throws error for invalid DOCX file (plain text)', async () => {
      const filePath = path.join(tempDir, 'invalid.docx');
      await fs.writeFile(filePath, 'This is not a valid DOCX file');

      await expect(parseDocxFile(filePath)).rejects.toThrow('Failed to parse DOCX');
    });

    it('throws error for empty file', async () => {
      const filePath = path.join(tempDir, 'empty.docx');
      await fs.writeFile(filePath, '');

      await expect(parseDocxFile(filePath)).rejects.toThrow('Failed to parse DOCX');
    });
  });

  describe('parseDocxTranscript', () => {
    it('throws error for non-existent file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.docx');

      await expect(parseDocxTranscript(filePath)).rejects.toThrow('Failed to parse DOCX');
    });

    it('throws error for corrupted DOCX file', async () => {
      const filePath = path.join(tempDir, 'corrupted.docx');
      // Create a file that starts like a ZIP but is corrupted
      await fs.writeFile(filePath, Buffer.from('PK\x03\x04corrupted'));

      await expect(parseDocxTranscript(filePath)).rejects.toThrow('Failed to parse DOCX');
    });
  });
});

// Integration tests - these should use real DOCX fixtures when available
describe('docxParser integration', () => {
  // These tests are skipped by default - enable when you have real DOCX test fixtures
  // in a fixtures directory

  it.skip('parses a real meeting transcript DOCX', async () => {
    // This test would use a real DOCX file from a test fixtures directory
    // const filePath = path.join(__dirname, '../../fixtures/sample-transcript.docx');
    // const result = await parseDocxTranscript(filePath);
    // expect(result).toContain('meeting');
  });

  it.skip('handles DOCX with multiple paragraphs and formatting', async () => {
    // This test would verify handling of complex DOCX structures
  });

  it.skip('extracts text from a valid DOCX file', async () => {
    // This test would use a real DOCX file to verify text extraction
    // const filePath = path.join(__dirname, '../../fixtures/sample.docx');
    // const result = await parseDocxFile(filePath);
    // expect(result.length).toBeGreaterThan(0);
  });
});
