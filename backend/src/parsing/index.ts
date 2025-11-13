/**
 * Phase 2 Parsing Module - Export Index
 * Exports all parsing and thread reconstruction components
 */

export { EmailParser } from './EmailParser';
export { ThreadBuilder, ThreadBuilderOptions } from './ThreadBuilder';
export { MultipartHandler } from './MultipartHandler';
export { HtmlToTextConverter, ConverterOptions } from './HtmlToTextConverter';

export {
  EmailAddress,
  AttachmentMetadata,
  ParsedEmailMetadata,
  EmailThread,
  TextContent,
} from './types';

export {
  ParsingConfig,
  DEFAULT_PARSING_CONFIG,
  getParsingConfig,
  loadParsingConfigFromEnv,
} from '../config/parsing';
