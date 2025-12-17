/**
 * Error Guidance Service
 *
 * Generates actionable, contextual error messages with remediation guidance.
 * Uses AI to analyze errors and provide user-friendly explanations with
 * specific fix suggestions.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getLogger } from '../utils/logger';
import config from '../config';

const logger = getLogger('error-guidance-service');

// Singleton instance
let instance: ErrorGuidanceService | null = null;

export interface ProcessingError {
  code?: string;
  message: string;
  context?: {
    fileName?: string;
    fileType?: string;
    stage?: string;
    columnName?: string;
    rowNumber?: number;
    expectedFormat?: string;
    actualValue?: string;
    stackTrace?: string;
  };
}

export interface ActionableError {
  title: string;
  explanation: string;
  technicalDetails: string;
  causes: Array<{
    reason: string;
    likelihood: 'high' | 'medium' | 'low';
  }>;
  quickActions: Array<{
    label: string;
    description: string;
    action: string; // Action identifier for frontend
    automated: boolean; // Can be auto-fixed
  }>;
  preventionTips?: string[];
}

export class ErrorGuidanceService {
  private anthropic: Anthropic;
  private enabled: boolean;

  constructor() {
    this.enabled = config.claude?.apiKey ? true : false;

    if (this.enabled) {
      this.anthropic = new Anthropic({
        apiKey: config.claude!.apiKey,
      });
      logger.info('ErrorGuidanceService initialized with AI support');
    } else {
      logger.warn('ErrorGuidanceService initialized without AI support (no API key)');
    }
  }

  /**
   * Generate actionable error guidance from a processing error
   */
  async generateActionableError(error: ProcessingError): Promise<ActionableError> {
    if (!this.enabled) {
      return this.generateFallbackGuidance(error);
    }

    try {
      const prompt = this.buildErrorAnalysisPrompt(error);

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        temperature: 0.3, // Lower temperature for more consistent, factual responses
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      const guidance = this.parseClaudeResponse(content.text, error);
      logger.info('Generated actionable error guidance', {
        errorMessage: error.message,
        guidanceTitle: guidance.title,
      });

      return guidance;
    } catch (aiError: any) {
      logger.error('Failed to generate AI-powered error guidance, using fallback', {
        error: aiError.message,
      });
      return this.generateFallbackGuidance(error);
    }
  }

  /**
   * Build a prompt for Claude to analyze the error
   */
  private buildErrorAnalysisPrompt(error: ProcessingError): string {
    const context = error.context || {};

    return `You are an expert at analyzing file processing errors and providing actionable guidance to users.

Analyze this error from a deal registration automation system that processes vendor lists, deal spreadsheets, email archives (MBOX), and transcripts:

**Error Message**: ${error.message}
${error.code ? `**Error Code**: ${error.code}` : ''}

**Context**:
- File Name: ${context.fileName || 'Unknown'}
- File Type: ${context.fileType || 'Unknown'}
- Processing Stage: ${context.stage || 'Unknown'}
${context.columnName ? `- Column Name: ${context.columnName}` : ''}
${context.rowNumber ? `- Row Number: ${context.rowNumber}` : ''}
${context.expectedFormat ? `- Expected Format: ${context.expectedFormat}` : ''}
${context.actualValue ? `- Actual Value: ${context.actualValue}` : ''}

Provide your response in this exact JSON format:
{
  "title": "Brief, user-friendly title (e.g., 'Invalid Date Format in Deal Value Column')",
  "explanation": "Clear explanation of what went wrong in 1-2 sentences",
  "causes": [
    {"reason": "Most likely cause", "likelihood": "high"},
    {"reason": "Another possible cause", "likelihood": "medium"}
  ],
  "quickActions": [
    {
      "label": "Action button label",
      "description": "What this action does",
      "action": "ACTION_IDENTIFIER",
      "automated": true
    }
  ],
  "preventionTips": ["Tip 1", "Tip 2"]
}

**Quick Actions should use these identifiers**:
- "FIX_DATE_FORMAT" - Auto-convert dates to expected format
- "FIX_CURRENCY_FORMAT" - Auto-parse currency values
- "SKIP_INVALID_ROWS" - Skip rows with errors
- "MANUAL_COLUMN_MAPPING" - Open column mapping interface
- "DOWNLOAD_TEMPLATE" - Download correct template
- "RETRY_UPLOAD" - Retry the upload
- "CONTACT_SUPPORT" - Contact support with details

Keep explanations simple and actionable. Focus on what the user can do to fix the problem.`;
  }

  /**
   * Parse Claude's JSON response into ActionableError
   */
  private parseClaudeResponse(text: string, originalError: ProcessingError): ActionableError {
    try {
      // Extract JSON from response (Claude sometimes adds text before/after)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        title: parsed.title || 'Processing Error',
        explanation: parsed.explanation || 'An error occurred during file processing.',
        technicalDetails: originalError.message,
        causes: parsed.causes || [{ reason: 'Unknown cause', likelihood: 'medium' }],
        quickActions: parsed.quickActions || [
          {
            label: 'Retry',
            description: 'Try uploading the file again',
            action: 'RETRY_UPLOAD',
            automated: false,
          },
        ],
        preventionTips: parsed.preventionTips || [],
      };
    } catch (parseError: any) {
      logger.error('Failed to parse Claude response', {
        error: parseError.message,
        response: text,
      });
      return this.generateFallbackGuidance(originalError);
    }
  }

  /**
   * Generate fallback guidance when AI is unavailable
   */
  private generateFallbackGuidance(error: ProcessingError): ActionableError {
    const context = error.context || {};

    // Pattern-based error detection
    const errorMessage = error.message.toLowerCase();

    // Date format errors
    if (errorMessage.includes('date') || errorMessage.includes('invalid date')) {
      return {
        title: 'Invalid Date Format',
        explanation: `The date format in ${context.columnName || 'a column'} doesn't match the expected format.`,
        technicalDetails: error.message,
        causes: [
          { reason: 'Date is in an unexpected format (e.g., DD/MM/YYYY vs MM/DD/YYYY)', likelihood: 'high' },
          { reason: 'Date contains invalid characters or text', likelihood: 'medium' },
        ],
        quickActions: [
          {
            label: 'Auto-Fix Dates',
            description: 'Automatically convert dates to the correct format',
            action: 'FIX_DATE_FORMAT',
            automated: true,
          },
          {
            label: 'Download Template',
            description: 'Get a template with correct date format',
            action: 'DOWNLOAD_TEMPLATE',
            automated: false,
          },
        ],
        preventionTips: [
          'Use ISO format (YYYY-MM-DD) for dates',
          'Ensure all date cells are formatted as dates in your spreadsheet',
        ],
      };
    }

    // Currency/number format errors
    if (errorMessage.includes('currency') || errorMessage.includes('number') || errorMessage.includes('numeric')) {
      return {
        title: 'Invalid Number Format',
        explanation: `The value in ${context.columnName || 'a numeric column'} contains non-numeric characters.`,
        technicalDetails: error.message,
        causes: [
          { reason: 'Currency symbols or commas in number field', likelihood: 'high' },
          { reason: 'Text in a numeric column', likelihood: 'medium' },
        ],
        quickActions: [
          {
            label: 'Auto-Fix Numbers',
            description: 'Remove currency symbols and parse numbers',
            action: 'FIX_CURRENCY_FORMAT',
            automated: true,
          },
          {
            label: 'Skip Invalid Rows',
            description: 'Skip rows with invalid numbers',
            action: 'SKIP_INVALID_ROWS',
            automated: false,
          },
        ],
        preventionTips: [
          'Remove currency symbols ($, €, £) from number columns',
          'Use plain numbers without thousand separators',
        ],
      };
    }

    // Column mapping errors
    if (errorMessage.includes('column') || errorMessage.includes('header') || errorMessage.includes('missing')) {
      return {
        title: 'Column Mapping Issue',
        explanation: 'The file structure doesn\'t match the expected format.',
        technicalDetails: error.message,
        causes: [
          { reason: 'Column names don\'t match expected headers', likelihood: 'high' },
          { reason: 'Required columns are missing', likelihood: 'high' },
          { reason: 'File is in an unexpected format', likelihood: 'medium' },
        ],
        quickActions: [
          {
            label: 'Manual Column Mapping',
            description: 'Map columns manually to match expected format',
            action: 'MANUAL_COLUMN_MAPPING',
            automated: false,
          },
          {
            label: 'Download Template',
            description: 'Get a template with correct column structure',
            action: 'DOWNLOAD_TEMPLATE',
            automated: false,
          },
        ],
        preventionTips: [
          'Use the provided template for uploads',
          'Ensure all required columns are present',
        ],
      };
    }

    // File format errors
    if (errorMessage.includes('format') || errorMessage.includes('parse') || errorMessage.includes('corrupted')) {
      return {
        title: 'File Format Error',
        explanation: 'The file could not be parsed or is in an unsupported format.',
        technicalDetails: error.message,
        causes: [
          { reason: 'File is corrupted or incomplete', likelihood: 'high' },
          { reason: 'Unsupported file format or encoding', likelihood: 'medium' },
          { reason: 'File contains mixed data types', likelihood: 'low' },
        ],
        quickActions: [
          {
            label: 'Retry Upload',
            description: 'Upload the file again',
            action: 'RETRY_UPLOAD',
            automated: false,
          },
          {
            label: 'Download Template',
            description: 'Get the correct file template',
            action: 'DOWNLOAD_TEMPLATE',
            automated: false,
          },
        ],
        preventionTips: [
          'Save Excel files as .xlsx (not .xls)',
          'Ensure file is not corrupted before upload',
        ],
      };
    }

    // Generic fallback
    return {
      title: 'Processing Error',
      explanation: 'An error occurred while processing your file.',
      technicalDetails: error.message,
      causes: [
        { reason: 'File format issue', likelihood: 'medium' },
        { reason: 'Data validation error', likelihood: 'medium' },
      ],
      quickActions: [
        {
          label: 'Retry Upload',
          description: 'Try uploading the file again',
          action: 'RETRY_UPLOAD',
          automated: false,
        },
        {
          label: 'Contact Support',
          description: 'Get help from support team',
          action: 'CONTACT_SUPPORT',
          automated: false,
        },
      ],
      preventionTips: [
        'Check that your file matches the expected format',
        'Review file for any unusual characters or formatting',
      ],
    };
  }

  /**
   * Get context-specific help for a file type
   */
  getFileTypeHelp(fileType: string): string {
    const help: Record<string, string> = {
      'vendor': 'Vendor lists should include columns: Vendor Name, Contact Email, Phone, Address',
      'deal': 'Deal lists should include: Deal Name, Vendor, Value, Expected Close Date, Customer',
      'email': 'Email archives should be in MBOX format with valid email structure',
      'transcript': 'Transcripts should be plain text, PDF, or DOCX files with conversation format',
      'vendor_spreadsheet': 'Vendor spreadsheets should follow the "Vendor - Deals.xlsx" format with vendor info and deal details',
    };

    return help[fileType] || 'Please ensure your file matches the expected format for this upload type.';
  }
}

/**
 * Get singleton instance of ErrorGuidanceService
 */
export function getErrorGuidanceService(): ErrorGuidanceService {
  if (!instance) {
    instance = new ErrorGuidanceService();
  }
  return instance;
}

export default ErrorGuidanceService;
