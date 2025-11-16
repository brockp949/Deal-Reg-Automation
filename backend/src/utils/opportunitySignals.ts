import path from 'path';
import fs from 'fs';
import { ParserSemanticSections, RfqSignals } from '../types/parsing';

/**
 * Pattern configuration interface
 */
interface OpportunityPatternsConfig {
  patterns: {
    opportunities: Array<{ tag: string; keywords: string[]; description?: string }>;
    actors: Array<{ label: string; keywords: string[] }>;
    stages: Array<{ hint: string; keywords: string[] }>;
  };
  regexPatterns: {
    quantity: string[];
    price: string[];
    timeline: string[];
    margin: string[];
    actionLine: string;
  };
}

/**
 * Load patterns from configuration file
 * Falls back to default patterns if config file cannot be loaded
 */
function loadPatternsConfig(): OpportunityPatternsConfig {
  const configPath = path.join(__dirname, '../../config/opportunity-patterns.json');

  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData) as OpportunityPatternsConfig;
  } catch (error) {
    // Fallback to default patterns if config file doesn't exist
    return getDefaultPatternsConfig();
  }
}

/**
 * Default patterns configuration (fallback)
 */
function getDefaultPatternsConfig(): OpportunityPatternsConfig {
  return {
    patterns: {
      opportunities: [
        { tag: 'clearled-pdu', keywords: ['clearled', 'media player', 'media-player', 'pdu'] },
        { tag: 'marshalling-cabinet', keywords: ['marshalling', 'cabinet', 'antora'] },
        { tag: 'switchgear', keywords: ['switchgear', 'switch-gear', 'switch gear', 'depcom'] },
        { tag: 'tdr-board', keywords: ['tdr', 'time domain', 'bnc'] },
        { tag: 'buck-converter', keywords: ['buck converter'] },
        { tag: 'graphene-heater', keywords: ['graphene', 'heater'] },
        { tag: 'diamond-semiconductor', keywords: ['diamond fab', 'diamond-based'] },
        { tag: 'monoto-sim-plan', keywords: ['monoto', 'sim plan', 'cellular'] },
        { tag: 'vendor-4iec', keywords: ['4iec'] },
      ],
      actors: [
        { label: 'jeremy nocchi', keywords: ['jeremy nocchi', 'jeremy', 'nocchi'] },
        { label: 'steven moore', keywords: ['steven moore', 'steven', 's moore'] },
        { label: 'vincent', keywords: ['vincent'] },
        { label: 'dan long', keywords: ['dan long', 'dan', 'd long'] },
        { label: 'antora', keywords: ['antora'] },
        { label: 'clearled', keywords: ['clearled'] },
      ],
      stages: [
        { hint: 'rfq', keywords: ['rfq', 'request for quote', 'quote request', 'pricing request'] },
        { hint: 'quote', keywords: ['quote', 'pricing needed', 'price request'] },
        { hint: 'po_in_progress', keywords: ['purchase order', 'PO', 'ordered', 'cutting PO', 'cutting POs'] },
        { hint: 'research', keywords: ['prototype', 'concept', 'research', 'lab', 'materials lab'] },
        { hint: 'integration', keywords: ['field trial', 'rollout', 'integration', 'deploy'] },
      ],
    },
    regexPatterns: {
      quantity: [
        '\\b\\d{1,3}(?:,\\d{3})*(?:\\s*[-–]\\s*\\d{1,3}(?:,\\d{3})*)?\\s*(?:units|pcs|pieces|systems|cabinets|boards|qty|units\\/yr|per year|yr)\\b',
        '\\b\\d+(?:\\s*-\\s*\\d+)?\\s*(?:k|K)\\b',
      ],
      price: [
        '\\$\\s?\\d+(?:,\\d{3})*(?:\\s*[-–]\\s*(?:\\$\\s?)?\\d+(?:,\\d{3})*)?(?:\\s*(?:k|K|m|M))?(?:\\s*per\\s*(?:unit|cabinet|board))?',
        '\\b\\d+(?:\\s*-\\s*\\d+)?\\s*(?:k|K)\\s*(?:USD|usd|dollars)?(?:\\s*per\\s*(?:unit|cabinet|board))?',
      ],
      timeline: [
        '\\bQ[1-4]\\s*20\\d{2}\\b',
        '\\b\\d+\\s*(?:weeks?|months?|days?)\\b',
        '\\b(?:July|August|September|October|November|December|January|February|March|April|May|June)\\s+20\\d{2}\\b',
        '\\bETA\\s*[:\\-]?\\s*[^\\n]+',
      ],
      margin: [
        '\\b\\d{1,2}\\s*[-–]\\s*\\d{1,2}\\s*%',
        '\\b\\d{1,2}\\s*[-–]\\s*\\d{1,2}\\s*%\\s*(?:margin|margins)\\b',
        '\\b\\d{1,2}\\s*%\\s*(?:margin|gm|gross margin)\\b',
        '\\bmargin(?:s)?\\s*(?:target|goal|expected)?\\s*[:\\-]?\\s*\\d{1,2}\\s*%\\b',
      ],
      actionLine: '^[-*•]\\s*(?:\\[.\\]\\s*)?(?:action|todo|follow up|send|schedule|call|email|deliver|ping)\\b',
    },
  };
}

// Load configuration at module initialization
const CONFIG = loadPatternsConfig();

// Convert keyword arrays to regex patterns
function keywordsToRegex(keywords: string[]): RegExp {
  const pattern = keywords.map((kw) => kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
  return new RegExp(`\\b(?:${pattern})\\b`, 'i');
}

// Build runtime regex patterns from configuration
const QUANTITY_REGEXES = CONFIG.regexPatterns.quantity.map((p) => new RegExp(p, 'gi'));
const PRICE_REGEXES = CONFIG.regexPatterns.price.map((p) => new RegExp(p, 'gi'));
const TIMELINE_REGEXES = CONFIG.regexPatterns.timeline.map((p) => new RegExp(p, 'gi'));
const MARGIN_REGEXES = CONFIG.regexPatterns.margin.map((p) => new RegExp(p, 'gi'));
const ACTION_LINE_REGEX = new RegExp(CONFIG.regexPatterns.actionLine, 'i');

const STAGE_HINT_PATTERNS = CONFIG.patterns.stages.map((stage) => ({
  hint: stage.hint,
  regex: keywordsToRegex(stage.keywords),
}));

const OPPORTUNITY_PATTERNS = CONFIG.patterns.opportunities.map((opp) => ({
  tag: opp.tag,
  regex: keywordsToRegex(opp.keywords),
}));

const ACTOR_PATTERNS = CONFIG.patterns.actors.map((actor) => ({
  label: actor.label,
  regex: keywordsToRegex(actor.keywords),
}));

const SECTION_LABEL_REGEXES = {
  attendees: /\b(attendees|participants|present|in attendance)\b/i,
  action: /\b(next steps?|action items?|todo|follow ups?)\b/i,
  pricing: /\b(pricing|price|cost|quote|rfq|margin)\b/i,
};

const dedupe = (values: string[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );

const collectMatches = (text: string, regexes: RegExp[]): string[] => {
  const matches: string[] = [];
  for (const regex of regexes) {
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const globalRegex = new RegExp(regex.source, flags);
    let match: RegExpExecArray | null;
    while ((match = globalRegex.exec(text)) !== null) {
      const normalized = match[0].replace(/\s+/g, ' ').trim();
      if (normalized.length) {
        matches.push(normalized);
      }
      if (match[0].length === 0) {
        break;
      }
    }
  }
  return matches;
};

const detectPatterns = (text: string, patterns: Array<{ tag: string; regex: RegExp }>): string[] => {
  const hits: string[] = [];
  for (const { tag, regex } of patterns) {
    if (regex.test(text)) {
      hits.push(tag);
    }
  }
  return hits;
};

const detectActors = (text: string): string[] => {
  const hits: string[] = [];
  for (const { label, regex } of ACTOR_PATTERNS) {
    if (regex.test(text)) {
      hits.push(label);
    }
  }
  return hits;
};

const detectStageHints = (text: string): string[] => {
  const hints: string[] = [];
  for (const { hint, regex } of STAGE_HINT_PATTERNS) {
    if (regex.test(text)) {
      hints.push(hint);
    }
  }
  return hints;
};

export interface OpportunitySignalAnalysis {
  rfqSignals: RfqSignals;
  stageHints: string[];
  opportunityTags: string[];
}

export function analyzeOpportunitySignals(text: string): OpportunitySignalAnalysis {
  const rfqSignals: RfqSignals = {
    quantities: dedupe(collectMatches(text, QUANTITY_REGEXES)),
    priceTargets: dedupe(collectMatches(text, PRICE_REGEXES)),
    timelineRequests: dedupe(collectMatches(text, TIMELINE_REGEXES)),
    marginNotes: dedupe(collectMatches(text, MARGIN_REGEXES)),
    actorMentions: dedupe(detectActors(text)),
  };

  const opportunityTags = dedupe(detectPatterns(text, OPPORTUNITY_PATTERNS));
  const stageHints = dedupe(detectStageHints(text));

  return {
    rfqSignals,
    stageHints,
    opportunityTags,
  };
}

export function inferDealStage(stageHints: string[], queryName?: string, subject?: string): string | undefined {
  const normalizedHints = new Set(stageHints);
  const normalizedQuery = queryName?.toLowerCase() || '';
  const normalizedSubject = subject?.toLowerCase() || '';

  const matchHint = (token: string, ...aliases: string[]) => {
    if (normalizedHints.has(token)) return true;
    return aliases.some((alias) => normalizedHints.has(alias));
  };

  if (
    matchHint('po_in_progress', 'po', 'purchase-order') ||
    normalizedQuery.includes('po') ||
    normalizedSubject.includes('po')
  ) {
    return 'po_in_progress';
  }

  if (
    normalizedHints.has('rfq') ||
    normalizedHints.has('quote') ||
    normalizedQuery.includes('rfq') ||
    normalizedQuery.includes('quote') ||
    normalizedSubject.includes('rfq')
  ) {
    return 'rfq';
  }

  if (normalizedHints.has('integration')) {
    return 'integration';
  }

  if (normalizedHints.has('research')) {
    return 'research';
  }

  return undefined;
}

export function extractSemanticSections(
  text: string,
  analysis?: OpportunitySignalAnalysis
): ParserSemanticSections {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sections: ParserSemanticSections = {
    attendees: [],
    pricing: [],
    margins: [],
    actionItems: [],
    opportunityMentions: [],
  };

  let currentSection: keyof typeof sections | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (ACTION_LINE_REGEX.test(line)) {
      sections.actionItems.push(line);
      continue;
    }
    if (SECTION_LABEL_REGEXES.attendees.test(lower)) {
      currentSection = 'attendees';
      sections.attendees.push(line);
      continue;
    }
    if (SECTION_LABEL_REGEXES.action.test(lower)) {
      currentSection = 'actionItems';
      sections.actionItems.push(line);
      continue;
    }
    if (SECTION_LABEL_REGEXES.pricing.test(lower)) {
      currentSection = 'pricing';
      sections.pricing.push(line);
      continue;
    }

    if (currentSection === 'attendees') {
      sections.attendees.push(line);
    } else if (currentSection === 'actionItems') {
      sections.actionItems.push(line);
    } else if (currentSection === 'pricing') {
      if (line.includes('%')) {
        sections.margins.push(line);
      } else {
        sections.pricing.push(line);
      }
    }

  }

  const computedAnalysis = analysis ?? analyzeOpportunitySignals(text);
  const { opportunityTags, rfqSignals } = computedAnalysis;
  sections.opportunityMentions = opportunityTags;

  sections.pricing.push(
    ...rfqSignals.priceTargets.map((price) => `Price mention: ${price}`),
    ...rfqSignals.quantities.map((qty) => `Quantity mention: ${qty}`)
  );
  sections.margins.push(...rfqSignals.marginNotes);
  sections.attendees.push(...rfqSignals.actorMentions.map((actor) => `Mentioned: ${actor}`));

  sections.attendees = dedupe(sections.attendees);
  sections.pricing = dedupe(sections.pricing);
  sections.margins = dedupe(sections.margins);
  sections.actionItems = dedupe(sections.actionItems);
  sections.opportunityMentions = dedupe(sections.opportunityMentions);

  return sections;
}
