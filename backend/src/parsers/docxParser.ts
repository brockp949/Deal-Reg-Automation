import { readFile } from 'fs/promises';
import mammoth from 'mammoth';
import logger from '../utils/logger';

/**
 * Parse DOCX file and extract text content using mammoth
 */
export async function parseDocxFile(filePath: string): Promise<string> {
  try {
    logger.info('Starting DOCX parsing', { filePath });

    // Read the DOCX file as a buffer
    const dataBuffer = await readFile(filePath);

    // Parse the DOCX using mammoth - extract raw text
    const result = await mammoth.extractRawText({ buffer: dataBuffer });

    if (result.messages.length > 0) {
      // Log any warnings from mammoth
      const warnings = result.messages.filter(m => m.type === 'warning');
      if (warnings.length > 0) {
        logger.warn('DOCX parsing warnings', {
          filePath,
          warnings: warnings.map(w => w.message),
        });
      }
    }

    logger.info('DOCX parsing complete', {
      filePath,
      textLength: result.value.length,
      messageCount: result.messages.length,
    });

    return result.value;
  } catch (error: any) {
    logger.error('Error parsing DOCX', { filePath, error: error.message });
    throw new Error(`Failed to parse DOCX: ${error.message}`);
  }
}

/**
 * Parse DOCX transcript file and return text for NLP processing
 */
export async function parseDocxTranscript(filePath: string): Promise<string> {
  const text = await parseDocxFile(filePath);

  // Basic cleanup of extracted text
  const cleanedText = text
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
    .trim();

  return cleanedText;
}
