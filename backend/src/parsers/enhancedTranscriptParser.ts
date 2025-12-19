// @ts-nocheck
/**
 * Enhanced Transcript Parser - NLP-based Deal Registration Extraction
 * Based on "From Dialogue to Deal" NLP Framework
 *
 * Implements a 5-stage NLP pipeline for extracting comprehensive deal registration
 * data from meeting transcripts with confidence scoring and buying signal analysis.
 *
 * Stages:
 * 1. Pre-processing (speaker diarization, ASR correction, noise removal)
 * 2. Named Entity Recognition (NER)
 * 3. Intent Classification
 * 4. Relationship Extraction
 * 5. Data Synthesis and Population
 */

import { readFileSync } from 'fs';
import logger from '../utils/logger';
import { analyzeBuyingSignalsWithAI } from './aiEnhancedExtraction';
import { config } from '../config';
import { getEntityExtractor } from '../skills/SemanticEntityExtractor';
import { isSkillEnabled } from '../config/claude';

/**
 * Buying Signals Taxonomy
 * Used to identify if a transcript contains a registerable deal opportunity
 */
export const BUYING_SIGNALS = {
  // Explicit (High Intent) - Direct commercial interest signals
  EXPLICIT: {
    pricing_inquiry: [
      /what\s+(is|are|would)\s+the\s+(price|cost|pricing|fee)/i,
      /how\s+much\s+(does|would|will)\s+(it|this|that)\s+cost/i,
      /what.*typical\s+(ROI|return\s+on\s+investment)/i,
      /what\s+does.*subscription\s+include/i,
      /pricing\s+(structure|model|tiers)/i,
      /what.*budget.*require/i,
    ],
    implementation: [
      /what\s+does.*implementation.*look\s+like/i,
      /how\s+(soon|quickly)\s+can\s+we\s+(get\s+started|begin|deploy)/i,
      /what.*timeline\s+for\s+(deployment|implementation|rollout)/i,
      /when\s+can\s+we\s+(go\s+live|launch|start)/i,
      /onboarding\s+process/i,
    ],
    comparison: [
      /how\s+does\s+(this|your\s+solution)\s+compare\s+to\s+(\w+)/i,
      /what.*different\s+from\s+(\w+)/i,
      /(advantages|benefits)\s+(over|versus|compared\s+to)\s+(\w+)/i,
      /why\s+should\s+we\s+choose\s+you\s+over/i,
    ],
  },

  // Implicit (Medium Intent) - Pain points and needs
  IMPLICIT: {
    pain_points: [
      /(struggling|challenge|problem|issue|difficulty)\s+with/i,
      /(need|looking\s+for|seeking)\s+(a\s+solution|help|way\s+to)/i,
      /currently\s+using.*but\s+(it'?s|lacking|missing)/i,
      /this\s+(could|would|might)\s+(really\s+)?help\s+(us|with)/i,
      /we'?re\s+(having|facing)\s+(issues|problems)/i,
    ],
    dissatisfaction: [
      /(frustrated|unhappy|dissatisfied)\s+with/i,
      /current\s+(system|vendor|solution)\s+is\s+(too\s+)?(slow|expensive|limited)/i,
      /lack(s|ing)\s+(features|capabilities|functionality)/i,
      /not\s+(happy|satisfied)\s+with\s+(our\s+)?(current|existing)/i,
    ],
    future_pacing: [
      /(if|when)\s+we\s+had\s+this/i,
      /imagine\s+(if|that|we\s+could)/i,
      /we\s+could\s+(reduce|improve|increase|save).*by/i,
      /this\s+would\s+allow\s+us\s+to/i,
    ],
  },

  // Engagement Markers (Supporting) - Conversation progression signals
  ENGAGEMENT: {
    next_steps: [
      /let'?s\s+(schedule|set\s+up)\s+(another|a\s+follow-up)\s+meeting/i,
      /can\s+we\s+(meet|talk)\s+again/i,
      /i'?ll\s+(connect\s+you|introduce\s+you)\s+to\s+(my\s+team|stakeholders)/i,
      /need\s+to\s+(discuss|review|run\s+this\s+by)\s+this\s+with\s+(my\s+)?team/i,
      /send\s+(me|us)\s+(information|a\s+proposal)/i,
    ],
    detailed_questioning: [
      /can\s+you\s+(explain|clarify|elaborate|walk\s+me\s+through)/i,
      /what\s+about\s+(edge\s+cases|integration|customization|security)/i,
      /how\s+does.*handle\s+(\w+)/i,
      /tell\s+me\s+more\s+about/i,
    ],
    consensus: [
      /(let'?s|we\s+should)\s+align\s+on/i,
      /are\s+we\s+(in\s+)?agreement/i,
      /have\s+we\s+reached\s+(a\s+)?consensus/i,
      /sounds\s+good/i,
      /that\s+makes\s+sense/i,
    ],
  },

  // Sales Objections (Risk Factors)
  OBJECTIONS: {
    price: [
      /(too|very)\s+expensive/i,
      /over\s+(our\s+)?budget/i,
      /cost\s+is\s+(a\s+)?concern/i,
      /price\s+is\s+(too\s+)?high/i,
      /can'?t\s+afford/i,
    ],
    timing: [
      /not\s+(the\s+right|a\s+good)\s+time/i,
      /too\s+soon/i,
      /wait\s+until\s+(next\s+)?(year|quarter)/i,
      /busy\s+with\s+other\s+projects/i,
    ],
    authority: [
      /need\s+approval/i,
      /not\s+my\s+decision/i,
      /speak\s+with\s+(my\s+)?boss/i,
      /decision\s+maker/i,
    ],
    competition: [
      /happy\s+with\s+(current|existing)/i,
      /already\s+have\s+a\s+solution/i,
      /competitor\s+is\s+cheaper/i,
      /switching\s+costs/i,
    ],
  },
};

/**
 * Intent categories for utterance classification
 */
export enum IntentType {
  STATING_PROBLEM = 'stating_problem',
  INQUIRING_PRICE = 'inquiring_price',
  REQUESTING_DEMO = 'requesting_demo',
  EXPRESSING_DISSATISFACTION = 'expressing_dissatisfaction',
  AGREEING_NEXT_STEPS = 'agreeing_next_steps',
  TECHNICAL_QUESTION = 'technical_question',
  COMPETITOR_COMPARISON = 'competitor_comparison',
  BUDGET_DISCUSSION = 'budget_discussion',
  TIMELINE_INQUIRY = 'timeline_inquiry',
  FEATURE_INQUIRY = 'feature_inquiry',
  RAISING_OBJECTION = 'raising_objection',
  OFF_TOPIC = 'off_topic',
}

/**
 * Comprehensive Deal Registration Schema
 * Based on canonical data model from Section 2 of the framework
 */
export interface EnhancedDealData {
  // Partner & Representative Information
  partner_company_name?: string;
  partner_contact_name?: string;
  partner_email?: string;
  partner_phone?: string;
  partner_role?: string;

  // Prospective Customer & End-User Information
  prospect_company_name?: string;
  prospect_website?: string;
  prospect_address?: string;
  industry?: string;
  company_size?: string;
  end_user_company_name?: string;
  end_user_address?: string;
  tax_id?: string;

  // Prospect Contact Information
  prospect_contact_name?: string;
  prospect_contact_email?: string;
  prospect_contact_phone?: string;
  prospect_job_title?: string;

  // Opportunity Specifics
  deal_name?: string;
  deal_description?: string;
  estimated_deal_value?: number;
  currency?: string;
  expected_close_date?: Date;
  deal_expiration_date?: Date;
  deal_stage?: string;
  product_service_requirements?: string;
  product_line?: string;
  new_or_existing_customer?: boolean;

  // Contextual Sales Intelligence
  substantiated_presales_efforts?: string;
  current_vendor?: string;
  reason_for_change?: string;
  identified_competitors?: string[];
  potential_challenges?: string;
  requested_support?: string;
  objections?: string[];
  competitor_insights?: string[];

  // Confidence & Metadata
  confidence_score: number;
  buying_signal_score: number;
  extraction_method: 'transcript_nlp';
  source_transcript_id?: string;
  speaker_attributions?: Record<string, string[]>;
}

/**
 * Parsed speaker turn/utterance
 */
export interface SpeakerTurn {
  speaker: string;
  utterance: string;
  timestamp?: string;
  intent?: IntentType;
  entities?: ExtractedEntity[];
  confidence?: number;
}

/**
 * Extracted entity from NER
 */
export interface ExtractedEntity {
  text: string;
  type: 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'DATE' | 'MONEY' | 'PRODUCT' | 'COMPETITOR' | 'EMAIL' | 'PHONE' | 'JOB_TITLE';
  confidence: number;
  position: { start: number; end: number };
}

/**
 * Relationship triple for knowledge graph
 */
export interface Relationship {
  entity1: ExtractedEntity;
  relation: string; // e.g., "works_for", "uses_product", "has_title"
  entity2: ExtractedEntity;
  confidence: number;
}

/**
 * STAGE 1: Pre-processing and Normalization
 * Cleans and standardizes raw transcript text
 */
export class TranscriptPreprocessor {
  /**
   * Remove conversational filler words and disfluencies
   */
  static removeDisfluencies(text: string): string {
    const fillers = /\b(um|uh|like|you know|kind of|sort of|i mean|basically|actually|literally|right|okay|so)\b/gi;
    return text.replace(fillers, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Clean up ASR artifacts and common transcription errors
   */
  static cleanASRErrors(text: string): string {
    // Remove timestamps like [00:12:34]
    let cleaned = text.replace(/\[\d{2}:\d{2}:\d{2}\]/g, '');

    // Remove generic speaker labels like "Speaker 1:"
    cleaned = cleaned.replace(/^(Speaker|Participant)\s+\d+:\s*/gim, '');

    // Fix common ASR errors for business terms (add company-specific corrections)
    const corrections: Record<string, string> = {
      'sales force': 'Salesforce',
      'micro soft': 'Microsoft',
      'amaz on': 'Amazon',
      'go ogle': 'Google',
      'face book': 'Facebook',
      'lin ked in': 'LinkedIn',
    };

    for (const [wrong, right] of Object.entries(corrections)) {
      cleaned = cleaned.replace(new RegExp(wrong, 'gi'), right);
    }

    return cleaned.trim();
  }

  /**
   * Parse speaker diarization from transcript
   * Supports formats: "Name: text" or "Role: text"
   */
  static parseSpeakerTurns(transcript: string): SpeakerTurn[] {
    const turns: SpeakerTurn[] = [];
    const lines = transcript.split('\n');
    let currentSpeaker = 'Unknown';
    let currentUtterance = '';
    let currentTimestamp: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for timestamp + speaker label: [00:12:34] Name: text
      const timestampSpeakerMatch = trimmed.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*([^:]+):\s*(.*)$/);
      if (timestampSpeakerMatch) {
        // Save previous turn
        if (currentUtterance) {
          turns.push({
            speaker: currentSpeaker,
            utterance: this.removeDisfluencies(this.cleanASRErrors(currentUtterance)),
            timestamp: currentTimestamp,
          });
        }

        // Start new turn with timestamp
        currentTimestamp = timestampSpeakerMatch[1];
        currentSpeaker = timestampSpeakerMatch[2].trim();
        currentUtterance = timestampSpeakerMatch[3].trim();
        continue;
      }

      // Check for speaker label only: Name: text
      const speakerMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (speakerMatch && !speakerMatch[1].includes(' ')) {
        // Likely a speaker (no spaces in name = probably a label)
        if (currentUtterance) {
          turns.push({
            speaker: currentSpeaker,
            utterance: this.removeDisfluencies(this.cleanASRErrors(currentUtterance)),
            timestamp: currentTimestamp,
          });
        }

        currentSpeaker = speakerMatch[1].trim();
        currentUtterance = speakerMatch[2].trim();
        currentTimestamp = undefined;
        continue;
      }

      // Continuation of current speaker's utterance
      currentUtterance += ' ' + trimmed;
    }

    // Add final turn
    if (currentUtterance) {
      turns.push({
        speaker: currentSpeaker,
        utterance: this.removeDisfluencies(this.cleanASRErrors(currentUtterance)),
        timestamp: currentTimestamp,
      });
    }

    logger.info('Parsed speaker turns', { count: turns.length });
    return turns;
  }
}

/**
 * STAGE 2: Named Entity Recognition (NER)
 * Extracts key entities using pattern matching and context
 */
export class TranscriptNER {
  /**
   * Extract entities using semantic AI extraction
   */
  static async extractEntitiesSemantic(text: string): Promise<ExtractedEntity[]> {
    const entities: ExtractedEntity[] = [];

    // Check if skill is enabled
    if (!isSkillEnabled('semanticEntityExtractor')) {
      logger.debug('SemanticEntityExtractor skill disabled, falling back to regex');
      return TranscriptNER.extractEntities(text);
    }

    try {
      logger.info('Using SemanticEntityExtractor skill for transcript entity extraction');
      const extractor = getEntityExtractor();

      const result = await extractor.extract({
        text,
        entityTypes: [
          'organization', // Company names
          'person', // Person names
          'email', // Email addresses
          'phone', // Phone numbers
          'value', // Monetary values
          'currency', // Currency codes
          'date', // Dates and timelines
          'product', // Product names
          'deal', // Deal names
          'contact', // Contact information
        ],
        context: {
          documentType: 'transcript',
          language: 'auto-detect',
          additionalInfo: {
            type: 'meeting_transcript',
          },
        },
      });

      logger.info('Semantic entity extraction completed', {
        entityCount: result.entities.length,
        averageConfidence: result.summary.averageConfidence,
        byType: result.summary.byType,
      });

      // Map extracted entities to TranscriptNER format
      for (const entity of result.entities) {
        let type: ExtractedEntity['type'] = 'TEXT';

        // Map entity types to TranscriptNER types
        switch (entity.type) {
          case 'email':
            type = 'EMAIL';
            break;
          case 'phone':
            type = 'PHONE';
            break;
          case 'value':
          case 'currency':
            type = 'MONEY';
            break;
          case 'date':
            type = 'DATE';
            break;
          case 'organization':
            type = 'ORGANIZATION';
            break;
          case 'person':
            type = 'PERSON';
            break;
          case 'product':
            type = 'PRODUCT';
            break;
          default:
            type = 'TEXT';
        }

        entities.push({
          text: entity.value,
          type,
          confidence: entity.confidence,
          position: entity.position || { start: 0, end: entity.value.length },
          metadata: entity.metadata,
        });
      }

      logger.info('Mapped semantic entities to transcript format', {
        entityCount: entities.length,
      });

      return entities;
    } catch (error: any) {
      logger.error('Semantic entity extraction failed, falling back to regex', {
        error: error.message,
      });
      // Fallback to regex extraction
      return TranscriptNER.extractEntities(text);
    }
  }

  /**
   * Extract all entities from text using regex patterns (fallback method)
   */
  static extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Extract email addresses (HIGH CONFIDENCE)
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    let match;
    while ((match = emailRegex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        type: 'EMAIL',
        confidence: 1.0,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract phone numbers
    const phoneRegex = /\b(\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g;
    while ((match = phoneRegex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        type: 'PHONE',
        confidence: 0.9,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract monetary values (multiple formats)
    const moneyRegex = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(million|thousand|k|M)?|(\d+)\s*(million|thousand|k|M)\s*dollars?/gi;
    while ((match = moneyRegex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        type: 'MONEY',
        confidence: 0.95,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract dates (multiple formats)
    const dateRegex = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|Q[1-4]\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|end\s+of\s+(month|quarter|year|Q[1-4])|next\s+(week|month|quarter)/gi;
    while ((match = dateRegex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        type: 'DATE',
        confidence: 0.85,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract company names (with suffixes)
    const companyRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(Inc|Corp|Corporation|LLC|Ltd|Limited|Co|Company|Technologies|Systems|Solutions|Group|Partners|Associates)\b/g;
    while ((match = companyRegex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        type: 'ORGANIZATION',
        confidence: 0.9,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Extract person names in context
    const nameContextRegex = /\b(my\s+name\s+is|this\s+is|i'm|speaking\s+with|talk\s+to|reach\s+out\s+to)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/gi;
    while ((match = nameContextRegex.exec(text)) !== null) {
      entities.push({
        text: match[2],
        type: 'PERSON',
        confidence: 0.85,
        position: { start: match.index + match[1].length + 1, end: match.index + match[0].length },
      });
    }

    // Extract job titles
    const titleRegex = /\b(CEO|CTO|CFO|COO|Director|Manager|VP|Vice\s+President|President|Head\s+of|Chief)\s+[A-Za-z\s]+\b/gi;
    while ((match = titleRegex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        type: 'JOB_TITLE',
        confidence: 0.8,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    logger.info('Extracted entities', { count: entities.length });
    return entities;
  }

  /**
   * Normalize monetary value to number
   */
  static normalizeMoneyValue(moneyText: string): number {
    let value = 0;
    const cleaned = moneyText.replace(/[$,\s]/g, '');

    if (/million|M/i.test(moneyText)) {
      value = parseFloat(cleaned) * 1000000;
    } else if (/thousand|k/i.test(moneyText)) {
      value = parseFloat(cleaned) * 1000;
    } else {
      value = parseFloat(cleaned);
    }

    return value;
  }

  /**
   * Normalize date expression to Date object
   */
  static normalizeDate(dateText: string): Date | null {
    try {
      // Handle Q1/Q2/Q3/Q4
      const quarterMatch = dateText.match(/Q([1-4])\s+(\d{4})/i);
      if (quarterMatch) {
        const quarter = parseInt(quarterMatch[1]);
        const year = parseInt(quarterMatch[2]);
        const month = (quarter - 1) * 3 + 2; // End month of quarter
        return new Date(year, month, 30);
      }

      // Handle "end of month/quarter/year"
      if (/end\s+of\s+(month|quarter|year|Q[1-4])/i.test(dateText)) {
        const now = new Date();
        if (/month/i.test(dateText)) {
          return new Date(now.getFullYear(), now.getMonth() + 1, 0);
        } else if (/quarter|Q/i.test(dateText)) {
          const quarter = Math.floor(now.getMonth() / 3) + 1;
          return new Date(now.getFullYear(), quarter * 3, 0);
        } else {
          return new Date(now.getFullYear(), 11, 31);
        }
      }

      // Handle relative dates
      if (/next\s+(week|month|quarter)/i.test(dateText)) {
        const now = new Date();
        if (/week/i.test(dateText)) {
          return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else if (/month/i.test(dateText)) {
          return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        } else {
          const quarter = Math.floor(now.getMonth() / 3) + 1;
          return new Date(now.getFullYear(), (quarter + 1) * 3, 0);
        }
      }

      // Try standard Date parsing
      return new Date(dateText);
    } catch (error) {
      logger.warn('Failed to normalize date', { dateText });
      return null;
    }
  }
}

/**
 * STAGE 3: Intent Classification
 * Classifies the purpose/intent of each utterance
 */
export class IntentClassifier {
  /**
   * Classify utterance intent with confidence
   */
  static classifyIntent(utterance: string): { intent: IntentType; confidence: number } {
    const lower = utterance.toLowerCase();

    // Objections (HIGH PRIORITY - Check first to avoid misclassification)
    for (const category of Object.values(BUYING_SIGNALS.OBJECTIONS)) {
      for (const pattern of category) {
        if (pattern.test(utterance)) {
          return { intent: IntentType.RAISING_OBJECTION, confidence: 0.85 };
        }
      }
    }

    // Pricing/Budget inquiries (HIGH PRIORITY)
    if (/(price|cost|pricing|budget|spend|investment)/i.test(utterance)) {
      if (/\b(price|cost|pricing)\b/i.test(utterance)) {
        return { intent: IntentType.INQUIRING_PRICE, confidence: 0.9 };
      }
      if (/budget/i.test(utterance)) {
        return { intent: IntentType.BUDGET_DISCUSSION, confidence: 0.85 };
      }
    }

    // Problem/pain point statements
    if (/(problem|issue|challenge|struggle|struggling|difficult|pain|trouble)/i.test(utterance)) {
      return { intent: IntentType.STATING_PROBLEM, confidence: 0.85 };
    }

    // Dissatisfaction with current solution
    if (/(current|existing|incumbent).*\b(slow|expensive|limited|lacking|poor)/i.test(utterance) ||
      /(frustrated|unhappy|dissatisfied|not\s+happy)\s+with/i.test(utterance)) {
      return { intent: IntentType.EXPRESSING_DISSATISFACTION, confidence: 0.85 };
    }

    // Demo requests
    if (/(demo|demonstration|show\s+me|walk\s+me\s+through|can\s+you\s+show)/i.test(utterance)) {
      return { intent: IntentType.REQUESTING_DEMO, confidence: 0.9 };
    }

    // Timeline/implementation questions
    if (/(when|timeline|how\s+soon|how\s+quickly|how\s+long|implementation|deployment|go\s+live|launch)/i.test(utterance)) {
      return { intent: IntentType.TIMELINE_INQUIRY, confidence: 0.8 };
    }



    // Competitor comparison
    if (/(compare|versus|vs\.|different\s+from|advantage\s+over|better\s+than|why\s+choose|cheaper|more\s+expensive)/i.test(utterance)) {
      return { intent: IntentType.COMPETITOR_COMPARISON, confidence: 0.85 };
    }

    // Next steps agreement
    if (/(next\s+steps|follow\s+up|schedule|meet\s+again|let'?s\s+talk|reach\s+out)/i.test(utterance)) {
      return { intent: IntentType.AGREEING_NEXT_STEPS, confidence: 0.8 };
    }

    // Feature/capability inquiries
    if (/(can\s+it|does\s+it\s+support|what\s+about|feature|capability|functionality)/i.test(utterance)) {
      return { intent: IntentType.FEATURE_INQUIRY, confidence: 0.75 };
    }

    // Technical questions
    if (/(how\s+does|technical|integration|api|architecture|infrastructure|security)/i.test(utterance)) {
      return { intent: IntentType.TECHNICAL_QUESTION, confidence: 0.75 };
    }



    // Default: off-topic
    return { intent: IntentType.OFF_TOPIC, confidence: 0.5 };
  }
}

/**
 * Buying Signal Detector
 * Determines if transcript contains a registerable deal opportunity
 */
export class BuyingSignalDetector {
  /**
   * Calculate buying signal score (0.0 to 1.0)
   * Enhanced with AI-powered analysis when enabled, with fallback to regex
   */
  static async calculateBuyingSignalScore(turns: SpeakerTurn[]): Promise<number> {
    // Build transcript text from turns
    const transcriptText = turns.map(t => `${t.speaker}: ${t.utterance}`).join('\n');

    // === AI-ENHANCED BUYING SIGNAL ANALYSIS ===
    try {
      const aiAnalysis = await analyzeBuyingSignalsWithAI(
        {
          transcript: transcriptText,
        },
        () => {
          // Fallback to regex-based analysis
          return BuyingSignalDetector.calculateBuyingSignalScoreRegex(turns);
        }
      );

      logger.info('AI-powered buying signal analysis completed', {
        overallScore: aiAnalysis.overallScore.toFixed(2),
        signalCount: aiAnalysis.signals.length,
        objectionCount: aiAnalysis.objections.length,
        isRegisterable: aiAnalysis.isRegisterable,
        confidence: aiAnalysis.confidence.toFixed(2),
      });

      return aiAnalysis.overallScore;
    } catch (error: any) {
      logger.error('AI buying signal analysis failed, using regex fallback', {
        error: error.message,
      });

      // Fallback to regex-based analysis
      return BuyingSignalDetector.calculateBuyingSignalScoreRegex(turns);
    }
  }

  /**
   * Legacy regex-based buying signal scoring
   * Used as fallback when AI is disabled or fails
   */
  static calculateBuyingSignalScoreRegex(turns: SpeakerTurn[]): number {
    let score = 0.0;
    const weights = {
      explicit: 0.4,
      implicit: 0.3,
      engagement: 0.3,
    };

    let explicitCount = 0;
    let implicitCount = 0;
    let engagementCount = 0;

    for (const turn of turns) {
      const text = turn.utterance;

      // Check explicit signals (highest value)
      for (const category of Object.values(BUYING_SIGNALS.EXPLICIT)) {
        for (const pattern of category) {
          if (pattern.test(text)) {
            explicitCount++;
            break; // Count once per turn
          }
        }
      }

      // Check implicit signals
      for (const category of Object.values(BUYING_SIGNALS.IMPLICIT)) {
        for (const pattern of category) {
          if (pattern.test(text)) {
            implicitCount++;
            break;
          }
        }
      }

      // Check engagement markers
      for (const category of Object.values(BUYING_SIGNALS.ENGAGEMENT)) {
        for (const pattern of category) {
          if (pattern.test(text)) {
            engagementCount++;
            break;
          }
        }
      }
    }

    // Calculate weighted score (normalize by expected counts)
    const explicitScore = Math.min(explicitCount / 3, 1.0); // 3+ explicit signals = max
    const implicitScore = Math.min(implicitCount / 5, 1.0); // 5+ implicit signals = max
    const engagementScore = Math.min(engagementCount / 4, 1.0); // 4+ engagement markers = max

    score = (explicitScore * weights.explicit) +
      (implicitScore * weights.implicit) +
      (engagementScore * weights.engagement);

    logger.info('Regex-based buying signal analysis', {
      score: score.toFixed(2),
      explicit: explicitCount,
      implicit: implicitCount,
      engagement: engagementCount,
      method: config.featureFlags.buyingSignalAnalyzer ? 'fallback' : 'primary',
    });

    return Math.min(score, 1.0);
  }

  /**
   * Determine if transcript contains a registerable deal
   */
  static isRegisterableDeal(buyingSignalScore: number, threshold = 0.5): boolean {
    return buyingSignalScore >= threshold;
  }
}

/**
 * STAGE 4: Relationship Extraction
 * Identifies semantic relationships between entities
 */
export class RelationshipExtractor {
  /**
   * Extract relationships from text with entities
   */
  static extractRelationships(text: string, entities: ExtractedEntity[]): Relationship[] {
    const relationships: Relationship[] = [];

    // Extract "works for" relationships
    const worksForPattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(works?\s+for|at|with)\s+([A-Z][a-zA-Z\s]+(?:Inc|Corp|LLC|Company))/gi;
    let match: RegExpExecArray | null;
    while ((match = worksForPattern.exec(text)) !== null) {
      const person = entities.find(e => e.type === 'PERSON' && e.text === match![1]);
      const org = entities.find(e => e.type === 'ORGANIZATION' && e.text.includes(match![3]));

      if (person && org) {
        relationships.push({
          entity1: person,
          relation: 'works_for',
          entity2: org,
          confidence: 0.9,
        });
      }
    }

    // Extract "has title" relationships
    const titlePattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+),?\s+((?:CEO|CTO|CFO|Director|Manager|VP)[^,.\n]+)/gi;
    while ((match = titlePattern.exec(text)) !== null) {
      const person = entities.find(e => e.type === 'PERSON' && e.text === match![1]);
      const title = entities.find(e => e.type === 'JOB_TITLE' && e.text.includes(match![2]));

      if (person && title) {
        relationships.push({
          entity1: person,
          relation: 'has_title',
          entity2: title,
          confidence: 0.85,
        });
      }
    }

    // Extract "uses product" relationships
    const usesPattern = /\b([A-Z][a-zA-Z\s]+(?:Inc|Corp|LLC|Company))\s+(?:is\s+)?(?:currently\s+)?(?:using|uses?|has)\s+([A-Z][a-zA-Z\s]+)/gi;
    while ((match = usesPattern.exec(text)) !== null) {
      const org1 = entities.find(e => e.type === 'ORGANIZATION' && e.text.includes(match![1]));
      const org2 = entities.find(e => e.type === 'ORGANIZATION' && e.text.includes(match![2]));

      if (org1 && org2) {
        relationships.push({
          entity1: org1,
          relation: 'uses_product',
          entity2: org2,
          confidence: 0.8,
        });
      }
    }

    logger.info('Extracted relationships', { count: relationships.length });
    return relationships;
  }
}

/**
 * STAGE 5: Data Synthesis and Population
 * Consolidates all extracted information into final schema
 */
export class DataSynthesizer {
  /**
   * Calculate overall confidence score
   * Based on data completeness, corroboration, and buying signals
   */
  static calculateConfidenceScore(
    dealData: Partial<EnhancedDealData>,
    buyingSignalScore: number
  ): number {
    const weights = {
      buying_signals: 0.30,
      data_completeness: 0.30,
      corroboration: 0.20,
      entity_confidence: 0.20,
    };

    // Data completeness score (how many fields are filled)
    const totalFields = 25; // Approximate compulsory + important fields
    const filledFields = Object.keys(dealData).filter(k => dealData[k as keyof typeof dealData] !== undefined).length;
    const completenessScore = Math.min(filledFields / totalFields, 1.0);

    // Corroboration score (do multiple signals point to same data)
    let corroborationScore = 0.7; // Default moderate corroboration

    // Entity confidence (average of all extracted entity confidences)
    let entityConfidenceScore = 0.75; // Default good confidence

    const finalScore = (buyingSignalScore * weights.buying_signals) +
      (completenessScore * weights.data_completeness) +
      (corroborationScore * weights.corroboration) +
      (entityConfidenceScore * weights.entity_confidence);

    return Math.min(finalScore, 1.0);
  }

  /**
   * Synthesize all extracted data into final deal registration format
   */
  static synthesizeDealData(
    turns: SpeakerTurn[],
    entities: ExtractedEntity[],
    relationships: Relationship[],
    buyingSignalScore: number
  ): EnhancedDealData {
    const dealData: Partial<EnhancedDealData> = {};

    // Extract prospect company (look for ORGANIZATION entities)
    const organizations = entities.filter(e => e.type === 'ORGANIZATION');
    if (organizations.length > 0) {
      // First organization is likely the prospect
      dealData.prospect_company_name = organizations[0].text;

      // Additional organizations might be competitors or current vendors
      if (organizations.length > 1) {
        dealData.identified_competitors = organizations.slice(1).map(o => o.text);

        // Extract competitor insights (context around mentions)
        const competitorInsights: string[] = [];
        for (const competitor of organizations.slice(1)) {
          const mentions = turns.filter(t => t.utterance.includes(competitor.text));
          mentions.forEach(m => {
            if (m.intent === IntentType.COMPETITOR_COMPARISON || m.intent === IntentType.RAISING_OBJECTION) {
              competitorInsights.push(`${competitor.text}: ${m.utterance}`);
            }
          });
        }
        if (competitorInsights.length > 0) {
          dealData.competitor_insights = competitorInsights;
        }
      }
    }

    // Extract contact information
    const persons = entities.filter(e => e.type === 'PERSON');
    if (persons.length > 0) {
      dealData.prospect_contact_name = persons[0].text;
    }

    const emails = entities.filter(e => e.type === 'EMAIL');
    if (emails.length > 0) {
      dealData.prospect_contact_email = emails[0].text;
    }

    const phones = entities.filter(e => e.type === 'PHONE');
    if (phones.length > 0) {
      dealData.prospect_contact_phone = phones[0].text;
    }

    // Extract job titles from relationships
    const titleRelations = relationships.filter(r => r.relation === 'has_title');
    if (titleRelations.length > 0) {
      dealData.prospect_job_title = titleRelations[0].entity2.text;
    }

    // Extract deal value
    const moneyEntities = entities.filter(e => e.type === 'MONEY');
    if (moneyEntities.length > 0) {
      dealData.estimated_deal_value = TranscriptNER.normalizeMoneyValue(moneyEntities[0].text);
      dealData.currency = 'USD'; // Default, could be extracted
    }

    // Extract dates
    const dateEntities = entities.filter(e => e.type === 'DATE');
    if (dateEntities.length > 0) {
      const normalizedDate = TranscriptNER.normalizeDate(dateEntities[0].text);
      if (normalizedDate) {
        dealData.expected_close_date = normalizedDate;
      }
    }

    // Extract contextual intelligence from intents
    const problemStatements = turns.filter(t => t.intent === IntentType.STATING_PROBLEM);
    if (problemStatements.length > 0) {
      dealData.reason_for_change = problemStatements.map(t => t.utterance).join(' ');
    }

    const dissatisfactionStatements = turns.filter(t => t.intent === IntentType.EXPRESSING_DISSATISFACTION);
    if (dissatisfactionStatements.length > 0) {
      const currentVendorMention = dissatisfactionStatements[0].utterance.match(/\b([A-Z][a-zA-Z\s]+)\b/);
      if (currentVendorMention) {
        dealData.current_vendor = currentVendorMention[1];
      }
    }

    // Extract objections
    const objectionStatements = turns.filter(t => t.intent === IntentType.RAISING_OBJECTION);
    if (objectionStatements.length > 0) {
      dealData.objections = objectionStatements.map(t => t.utterance);
    }

    // Generate deal description from conversation
    const keyUtterances = turns
      .filter(t => t.intent !== IntentType.OFF_TOPIC)
      .slice(0, 5)
      .map(t => t.utterance)
      .join(' ');
    dealData.deal_description = keyUtterances.substring(0, 500);

    // Calculate final confidence
    const confidenceScore = this.calculateConfidenceScore(dealData, buyingSignalScore);

    const enhancedDeal: EnhancedDealData = {
      ...dealData,
      confidence_score: confidenceScore,
      buying_signal_score: buyingSignalScore,
      extraction_method: 'transcript_nlp',
    };

    logger.info('Synthesized deal data', {
      confidence: confidenceScore.toFixed(2),
      fieldsExtracted: Object.keys(dealData).length,
    });

    return enhancedDeal;
  }
}

/**
 * Main Enhanced Transcript Parser
 * Orchestrates the 5-stage NLP pipeline
 */
export async function parseEnhancedTranscript(
  filePath: string,
  options: {
    buyingSignalThreshold?: number;
    confidenceThreshold?: number;
    allowLowSignal?: boolean;
  } = {}
): Promise<{
  deal: EnhancedDealData | null;
  turns: SpeakerTurn[];
  isRegisterable: boolean;
  buyingSignalScore: number;
}> {
  const { buyingSignalThreshold = 0.5, confidenceThreshold = 0.6, allowLowSignal = false } = options;

  logger.info('Starting enhanced transcript parsing', { filePath });

  // Read transcript
  const rawTranscript = readFileSync(filePath, 'utf-8');

  // STAGE 1: Pre-processing
  const turns = TranscriptPreprocessor.parseSpeakerTurns(rawTranscript);

  // Early exit if no valid turns
  if (turns.length === 0) {
    logger.warn('No valid speaker turns found in transcript');
    return {
      deal: null,
      turns: [],
      isRegisterable: false,
      buyingSignalScore: 0,
    };
  }

  // STAGE 2: Buying Signal Detection (Triage) - Now AI-enhanced
  const buyingSignalScore = await BuyingSignalDetector.calculateBuyingSignalScore(turns);
  const isRegisterable = BuyingSignalDetector.isRegisterableDeal(buyingSignalScore, buyingSignalThreshold);

  if (!isRegisterable && !allowLowSignal) {
    logger.info('Transcript does not contain sufficient buying signals', { buyingSignalScore });
    return {
      deal: null,
      turns,
      isRegisterable: false,
      buyingSignalScore,
    };
  }

  if (!isRegisterable) {
    logger.info('Transcript below buying signal threshold; continuing extraction due to allowLowSignal', {
      buyingSignalScore,
      buyingSignalThreshold,
    });
  }

  // STAGE 3: Named Entity Recognition (AI-enhanced)
  const fullText = turns.map(t => t.utterance).join(' ');
  const entities = await TranscriptNER.extractEntitiesSemantic(fullText);

  // STAGE 4: Intent Classification
  for (const turn of turns) {
    const { intent, confidence } = IntentClassifier.classifyIntent(turn.utterance);
    turn.intent = intent;
    turn.confidence = confidence;
  }

  // STAGE 5: Relationship Extraction
  const relationships = RelationshipExtractor.extractRelationships(fullText, entities);

  // STAGE 6: Data Synthesis
  const deal = DataSynthesizer.synthesizeDealData(turns, entities, relationships, buyingSignalScore);

  // Final confidence check
  if (deal.confidence_score < confidenceThreshold) {
    logger.warn('Deal confidence below threshold', {
      confidence: deal.confidence_score,
      threshold: confidenceThreshold,
    });
  }

  logger.info('Enhanced transcript parsing completed', {
    isRegisterable,
    buyingSignalScore: buyingSignalScore.toFixed(2),
    confidence: deal.confidence_score.toFixed(2),
    entitiesFound: entities.length,
    relationshipsFound: relationships.length,
  });

  return {
    deal,
    turns,
    isRegisterable,
    buyingSignalScore,
  };
}

export default {
  parseEnhancedTranscript,
  TranscriptPreprocessor,
  TranscriptNER,
  IntentClassifier,
  BuyingSignalDetector,
  RelationshipExtractor,
  DataSynthesizer,
  BUYING_SIGNALS,
  IntentType,
};
