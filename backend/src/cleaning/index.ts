/**
 * Phase 3: Preprocessing & Content Cleaning
 * Export all cleaning components
 */

export { QuotedReplyRemover } from './QuotedReplyRemover';
export { SignatureExtractor } from './SignatureExtractor';
export { TextNormalizer, NormalizationOptions } from './TextNormalizer';
export { CleaningPipeline } from './CleaningPipeline';

export {
  SignatureData,
  SignatureBoundary,
  QuoteBlock,
  CleanedContent,
  CleaningOptions,
} from './types';
