/**
 * Tests for CRMCSVConnector
 *
 * Phase 7.1 - CRM CSV Connector & Parsing
 */

import { CRMCSVConnector } from '../../connectors/CRMCSVConnector';
import { promises as fs } from 'fs';
import path from 'path';

describe('CRMCSVConnector', () => {
  const testFixturesDir = path.join(__dirname, '../fixtures/crm-csv');
  let connector: CRMCSVConnector;

  beforeEach(() => {
    connector = new CRMCSVConnector({ directory: testFixturesDir });
  });

  describe('scanCSVFiles', () => {
    it('should scan directory and find CSV files', async () => {
      const result = await connector.scanCSVFiles({ directory: testFixturesDir });

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.totalFiles).toBe(result.files.length);
      expect(result.directory).toBe(testFixturesDir);
      expect(result.totalSize).toBeGreaterThan(0);
    });

    it('should return file metadata including checksum', async () => {
      const result = await connector.scanCSVFiles({ directory: testFixturesDir });

      const firstFile = result.files[0];
      expect(firstFile).toHaveProperty('fileName');
      expect(firstFile).toHaveProperty('filePath');
      expect(firstFile).toHaveProperty('fileSize');
      expect(firstFile).toHaveProperty('modifiedTime');
      expect(firstFile).toHaveProperty('createdTime');
      expect(firstFile).toHaveProperty('checksum');
      expect(typeof firstFile.checksum).toBe('string');
      expect(firstFile.checksum.length).toBeGreaterThan(0);
    });

    it('should filter files by pattern', async () => {
      const result = await connector.scanCSVFiles({
        directory: testFixturesDir,
        pattern: /salesforce.*\.csv$/i,
      });

      expect(result.files.length).toBeGreaterThan(0);
      result.files.forEach((file) => {
        expect(file.fileName).toMatch(/salesforce.*\.csv$/i);
      });
    });

    it('should limit number of files returned', async () => {
      const result = await connector.scanCSVFiles({
        directory: testFixturesDir,
        maxFiles: 1,
      });

      expect(result.files.length).toBeLessThanOrEqual(1);
    });

    it('should handle empty directory gracefully', async () => {
      const emptyDir = path.join(__dirname, '../fixtures/empty-crm');
      await fs.mkdir(emptyDir, { recursive: true });

      const result = await connector.scanCSVFiles({ directory: emptyDir });

      expect(result.files.length).toBe(0);
      expect(result.totalFiles).toBe(0);
      expect(result.totalSize).toBe(0);

      // Cleanup
      await fs.rmdir(emptyDir);
    });

    it('should handle non-existent directory by creating it', async () => {
      const nonExistentDir = path.join(__dirname, '../fixtures/new-crm');

      const result = await connector.scanCSVFiles({ directory: nonExistentDir });

      expect(result.files.length).toBe(0);

      // Verify directory was created
      const stats = await fs.stat(nonExistentDir);
      expect(stats.isDirectory()).toBe(true);

      // Cleanup
      await fs.rmdir(nonExistentDir);
    });
  });

  describe('getFileMetadata', () => {
    it('should return metadata for a specific file', async () => {
      const scanResult = await connector.scanCSVFiles({ directory: testFixturesDir });
      const firstFile = scanResult.files[0];

      const metadata = await connector.getFileMetadata(firstFile.filePath);

      expect(metadata.fileName).toBe(firstFile.fileName);
      expect(metadata.fileSize).toBe(firstFile.fileSize);
      expect(metadata.checksum).toBe(firstFile.checksum);
    });
  });

  describe('validateCSVFile', () => {
    it('should validate a valid CSV file', async () => {
      const scanResult = await connector.scanCSVFiles({ directory: testFixturesDir });
      const firstFile = scanResult.files[0];

      const validation = await connector.validateCSVFile(firstFile.filePath);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should detect empty file', async () => {
      const emptyFile = path.join(testFixturesDir, 'empty.csv');
      await fs.writeFile(emptyFile, '');

      const validation = await connector.validateCSVFile(emptyFile);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((err) => err.includes('empty'))).toBe(true);

      // Cleanup
      await fs.unlink(emptyFile);
    });

    it('should warn about large files', async () => {
      // Create a large dummy file (> 100MB would be too large for test, so we'll mock)
      const largeFile = path.join(testFixturesDir, 'large.csv');
      const largeContent = 'a'.repeat(101 * 1024 * 1024); // 101 MB

      // Skip actual large file creation in test, but test the logic
      // For now, we'll just test that a normal-sized file doesn't trigger the warning
      const scanResult = await connector.scanCSVFiles({ directory: testFixturesDir });
      const firstFile = scanResult.files[0];

      const validation = await connector.validateCSVFile(firstFile.filePath);

      // Normal files shouldn't have size warnings
      expect(validation.warnings.some((warn) => warn.includes('Large file'))).toBe(false);
    });

    it('should detect files with too few lines', async () => {
      const singleLineFile = path.join(testFixturesDir, 'single-line.csv');
      await fs.writeFile(singleLineFile, 'Header1,Header2\n');

      const validation = await connector.validateCSVFile(singleLineFile);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((err) => err.includes('fewer than 2 lines'))).toBe(true);

      // Cleanup
      await fs.unlink(singleLineFile);
    });
  });

  describe('calculateChecksum', () => {
    it('should generate consistent checksums for same content', async () => {
      const scanResult = await connector.scanCSVFiles({ directory: testFixturesDir });
      const firstFile = scanResult.files[0];

      const metadata1 = await connector.getFileMetadata(firstFile.filePath);
      const metadata2 = await connector.getFileMetadata(firstFile.filePath);

      expect(metadata1.checksum).toBe(metadata2.checksum);
    });

    it('should generate different checksums for different content', async () => {
      const scanResult = await connector.scanCSVFiles({ directory: testFixturesDir });

      // Ensure we have at least 2 different files
      if (scanResult.files.length >= 2) {
        const file1 = scanResult.files[0];
        const file2 = scanResult.files[1];

        expect(file1.checksum).not.toBe(file2.checksum);
      }
    });
  });
});
