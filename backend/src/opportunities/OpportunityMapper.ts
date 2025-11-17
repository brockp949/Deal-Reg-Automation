import { createHash } from 'crypto';
import {
  NormalizedContact,
  NormalizedDeal,
  RfqSignals,
  StandardizedParserOutput,
} from '../types/parsing';
import {
  OpportunityMapperOptions,
  OpportunityPriority,
  OpportunityRecord,
  OpportunitySourceReference,
  OpportunityStage,
  StructuredNextStep,
} from './types';

const STAGE_ALIAS_MAP: Record<string, OpportunityStage> = {
  rfq: 'rfq',
  quote: 'quote',
  po_in_progress: 'po_in_progress',
  po: 'po_in_progress',
  purchase_order: 'po_in_progress',
  integration: 'integration',
  deploy: 'integration',
  rollout: 'integration',
  research: 'research',
  discovery: 'research',
};

export class OpportunityMapper {
  constructor(private readonly options: OpportunityMapperOptions = {}) {}

  mapFromParserOutput(output: StandardizedParserOutput): OpportunityRecord[] {
    return output.entities.deals.map((deal, index) =>
      this.mapDeal(deal, index, output, output.entities.contacts)
    );
  }

  private mapDeal(
    deal: NormalizedDeal,
    index: number,
    output: StandardizedParserOutput,
    contacts: NormalizedContact[]
  ): OpportunityRecord {
    const stage = this.inferStage(deal);
    const rfqSignals = deal.rfq_signals;
    const unitRange = this.extractUnitRange(rfqSignals);
    const priceBand = this.extractPriceBand(rfqSignals);
    const costUpside = this.collectCostUpsideNotes(rfqSignals, output);
    const actors = this.collectActors(deal, contacts, rfqSignals, output);
    const nextSteps = this.collectNextSteps(output);
    const sourceTags = this.collectSourceTags(deal, output);
    const opportunityId = this.generateOpportunityId(deal, index, output);
    const lastTouched = this.normalizeTimestamp(output.metadata.parsedAt);
    const structuredNextSteps = this.collectStructuredNextSteps(
      deal,
      output,
      contacts,
      actors
    );

    const sourceSummary = this.buildSourceReference(deal, output);

    return {
      id: opportunityId,
      name: deal.deal_name || output.metadata.fileName,
      stage,
      priority: this.derivePriority(stage, rfqSignals),
      yearlyUnitRange: unitRange,
      priceBand,
      costUpsideNotes: costUpside,
      actors,
      nextSteps,
      structuredNextSteps: structuredNextSteps.length ? structuredNextSteps : undefined,
      sourceTags,
      sourceSummary: [sourceSummary],
      metadata: {
        vendor: deal.vendor_name,
        customer: deal.customer_name,
        parser: output.metadata.parsingMethod,
        confidence: deal.confidence_score,
        lastTouched,
      },
    };
  }

  private inferStage(deal: NormalizedDeal): OpportunityStage {
    if (deal.deal_stage) {
      const normalized = this.normalizeStageToken(deal.deal_stage);
      if (normalized) {
        return normalized;
      }
    }

    if (deal.stage_hints?.length) {
      for (const hint of deal.stage_hints) {
        const normalized = this.normalizeStageToken(hint);
        if (normalized) {
          return normalized;
        }
      }
    }

    return this.options.defaultStage ?? 'unknown';
  }

  private normalizeStageToken(value: string | undefined): OpportunityStage | undefined {
    if (!value) return undefined;
    const token = value.trim().toLowerCase();
    return STAGE_ALIAS_MAP[token];
  }

  private extractUnitRange(signals?: RfqSignals): string | undefined {
    if (!signals || signals.quantities.length === 0) return undefined;
    return signals.quantities[0];
  }

  private extractPriceBand(signals?: RfqSignals): string | undefined {
    if (!signals || signals.priceTargets.length === 0) return undefined;
    return signals.priceTargets[0];
  }

  private collectCostUpsideNotes(
    signals: RfqSignals | undefined,
    output: StandardizedParserOutput
  ): string[] {
    const notes: string[] = [];
    if (signals?.marginNotes?.length) {
      notes.push(...signals.marginNotes);
    }

    output.semanticSections?.margins?.forEach((entry) => notes.push(entry));
    output.semanticSections?.pricing
      ?.filter((line) => /\bmargin\b|\bcost\b/i.test(line))
      .forEach((line) => notes.push(line));

    return this.dedupe(notes);
  }

  private collectActors(
    deal: NormalizedDeal,
    contacts: NormalizedContact[],
    signals: RfqSignals | undefined,
    output: StandardizedParserOutput
  ): string[] {
    const names: string[] = [];

    if (deal.decision_maker_contact) {
      names.push(deal.decision_maker_contact);
    }

    contacts
      .filter((contact) => contact.vendor_name === deal.vendor_name || !contact.vendor_name)
      .forEach((contact) => {
        if (contact.name) {
          names.push(contact.name);
        }
      });

    signals?.actorMentions.forEach((actor) => names.push(actor));

    output.semanticSections?.attendees?.forEach((entry) => {
      const normalized = entry.replace(/^attendees:\s*/i, '').trim();
      if (normalized.length) {
        names.push(normalized);
      }
    });

    return this.dedupe(names);
  }

  private collectNextSteps(output: StandardizedParserOutput): string[] {
    if (!output.semanticSections?.actionItems?.length) {
      return [];
    }
    return this.dedupe(output.semanticSections.actionItems);
  }

  private collectSourceTags(deal: NormalizedDeal, output: StandardizedParserOutput): string[] {
    return this.dedupe([...(deal.source_tags ?? []), ...(output.metadata.sourceTags ?? [])]);
  }

  private collectStructuredNextSteps(
    deal: NormalizedDeal,
    output: StandardizedParserOutput,
    contacts: NormalizedContact[],
    actors: string[]
  ): StructuredNextStep[] {
    const actionItems = output.semanticSections?.actionItems ?? [];
    if (!actionItems.length) return [];

    const candidates = this.buildOwnerCandidates(deal, contacts, actors, output);
    const structured: StructuredNextStep[] = [];

    for (const item of actionItems) {
      const description = this.normalizeActionItem(item);
      if (!description) continue;
      const owner = this.inferOwnerFromAction(description, candidates);
      const dueDate = this.extractDueDateToken(description);
      structured.push({
        description,
        owner,
        dueDate,
        source: output.metadata.fileName,
      });
    }

    return structured;
  }

  private buildOwnerCandidates(
    deal: NormalizedDeal,
    contacts: NormalizedContact[],
    actors: string[],
    output: StandardizedParserOutput
  ): Map<string, string> {
    const candidates = new Map<string, string>();
    const addCandidate = (value?: string) => {
      if (!value) return;
      const normalized = this.normalizeOwnerToken(value);
      if (!normalized) return;
      if (!candidates.has(normalized)) {
        candidates.set(normalized, value.trim());
      }
    };

    actors.forEach((actor) => {
      actor
        .split(/[,/&]|(?:\band\b)/i)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .forEach(addCandidate);
    });

    contacts.forEach((contact) => addCandidate(contact.name));
    addCandidate(deal.decision_maker_contact);

    output.semanticSections?.attendees?.forEach((entry) => {
      const normalizedEntry = entry.replace(/^attendees:\s*/i, '');
      normalizedEntry
        .split(/[,;&]/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .forEach(addCandidate);
    });

    return candidates;
  }

  private normalizeActionItem(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const cleaned = value.replace(/^[\s*\-•\u2022]+/, '').trim();
    return cleaned.length ? cleaned : undefined;
  }

  private normalizeOwnerToken(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.length ? normalized : undefined;
  }

  private inferOwnerFromAction(
    description: string,
    candidates: Map<string, string>
  ): string | undefined {
    const leadingPattern =
      /^(?<owner>[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*(?:[:\-–]\s+|to\s+)/;
    const directMatch = description.match(leadingPattern);
    if (directMatch?.groups?.owner) {
      return directMatch.groups.owner.trim();
    }

    const normalizedDescription = this.normalizeOwnerToken(description) ?? '';
    for (const [normalized, original] of candidates.entries()) {
      if (normalizedDescription.includes(normalized)) {
        return original;
      }
    }
    return undefined;
  }

  private extractDueDateToken(description: string): string | undefined {
    const duePhrase = description.match(
      /\b(?:by|before|due|on|no later than)\s+([A-Za-z0-9\/,\- ]{3,40})/i
    );
    if (duePhrase?.[1]) {
      return duePhrase[1].trim();
    }

    const fallback = description.match(
      /\b(Q[1-4]\s+\d{4}|EOW|EOM|EOD|EOY|next week|next month)\b/i
    );
    if (fallback?.[1]) {
      return fallback[1];
    }

    const explicitDate =
      description.match(/\b\d{4}-\d{2}-\d{2}\b/) ??
      description.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/) ??
      description.match(
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{2,4})?\b/i
      );
    if (explicitDate?.[0]) {
      return explicitDate[0];
    }

    const dayOfWeek = description.match(
      /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i
    );
    if (dayOfWeek?.[0]) {
      return dayOfWeek[0];
    }

    return undefined;
  }

  private buildSourceReference(
    deal: NormalizedDeal,
    output: StandardizedParserOutput
  ): OpportunitySourceReference {
    const sourceMetadata = output.metadata.sourceMetadata;
    return {
      parser: output.metadata.parsingMethod,
      fileName: output.metadata.fileName,
      sourceType: output.metadata.sourceType,
      connector: sourceMetadata?.connector,
      queryName: sourceMetadata?.queryName,
      referenceIds: this.dedupe(
        [deal.source_email_id, sourceMetadata?.connector === 'drive' ? sourceMetadata.file.id : undefined].filter(
          (value): value is string => Boolean(value)
        )
      ),
    };
  }

  private derivePriority(stage: OpportunityStage, signals?: RfqSignals): OpportunityPriority {
    if (stage === 'po_in_progress' || stage === 'integration') {
      return 'high';
    }
    if (stage === 'rfq' || stage === 'quote') {
      return 'medium';
    }

    if (signals?.quantities.length && signals.priceTargets.length) {
      return 'medium';
    }

    return this.options.defaultPriority ?? 'low';
  }

  private generateOpportunityId(
    deal: NormalizedDeal,
    index: number,
    output: StandardizedParserOutput
  ): string {
    const hash = createHash('sha1')
      .update([
        deal.deal_name,
        deal.customer_name,
        deal.vendor_name,
        deal.source_email_id,
        output.metadata.fileName,
        output.metadata.parsingMethod,
        index,
      ]
        .filter(Boolean)
        .join('|'))
      .digest('hex')
      .slice(0, 10);
    return `opp-${hash}`;
  }

  private dedupe(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
  }

  private normalizeTimestamp(value: Date | string | undefined): string | undefined {
    if (!value) return undefined;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed.toISOString();
  }
}
