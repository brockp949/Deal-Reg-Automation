import { readFile } from 'fs/promises';
import pdf from 'pdf-parse';
import logger from '../utils/logger';

/**
 * Parse PDF file and extract text content
 */
export async function parsePDFFile(filePath: string): Promise<string> {
  try {
    logger.info('Starting PDF parsing', { filePath });

    // Read the PDF file as a buffer
    const dataBuffer = await readFile(filePath);

    // Parse the PDF
    const data = await pdf(dataBuffer);

    logger.info('PDF parsing complete', {
      filePath,
      pages: data.numpages,
      textLength: data.text.length,
    });

    return data.text;
  } catch (error: any) {
    logger.error('Error parsing PDF', { filePath, error: error.message });
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

/**
 * Parse PDF transcript file and return text for NLP processing
 */
export async function parsePDFTranscript(filePath: string): Promise<string> {
  const text = await parsePDFFile(filePath);

  // Basic cleanup of extracted text
  const cleanedText = text
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
    .trim();

  return cleanedText;
}
