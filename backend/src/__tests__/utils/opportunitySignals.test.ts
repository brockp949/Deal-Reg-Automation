import {
  analyzeOpportunitySignals,
  extractSemanticSections,
  inferDealStage,
} from '../../utils/opportunitySignals';

describe('opportunitySignals utilities', () => {
  const rfqSample = `
    Jeremy Nocchi requested an RFQ for the Marshalling Cabinet deal covering 5-10 cabinets,
    plus 40 units and 80 unit pilot batches. Target pricing should land at $7-8k per cabinet,
    margins must stay around 27-30%, and the team wants a purchase order in 6 weeks.
  `;

  it('extracts RFQ signals, tags, and stage hints from rich text', () => {
    const analysis = analyzeOpportunitySignals(rfqSample);

    expect(analysis.rfqSignals.quantities).toEqual(
      expect.arrayContaining(['5-10 cabinets', '40 units'])
    );
    expect(analysis.rfqSignals.priceTargets.length).toBeGreaterThan(0);
    expect(analysis.rfqSignals.marginNotes.length).toBeGreaterThan(0);
    expect(analysis.opportunityTags).toContain('marshalling-cabinet');
    expect(analysis.stageHints).toContain('rfq');
  });

  it('infers deal stages from hints and metadata context', () => {
    expect(inferDealStage(['rfq'], 'rfq-intake')).toBe('rfq');
    expect(inferDealStage(['po_in_progress'], undefined, 'PO Update for ClearLED')).toBe(
      'po_in_progress'
    );
    expect(inferDealStage(['research'], 'discovery')).toBe('research');
  });

  it('builds semantic sections with attendees, pricing, margins, and action items', () => {
    const transcript = `
Attendees: Jeremy Nocchi, Steven Moore
Pricing: ClearLED PDU quote for 1,500-4,000 units at $500-700 per unit
Margins stay at 27-30% gross margin
Next Steps:
- Send updated quote and call Antora Tuesday
`;
    const analysis = analyzeOpportunitySignals(transcript);
    const sections = extractSemanticSections(transcript, analysis);

    expect(sections.attendees.some((line) => line.toLowerCase().includes('jeremy nocchi'))).toBe(
      true
    );
    expect(sections.pricing.length).toBeGreaterThan(0);
    expect(sections.margins.length).toBeGreaterThan(0);
    expect(sections.actionItems.some((line) => line.toLowerCase().includes('send updated quote'))).toBe(
      true
    );
    expect(sections.opportunityMentions).toContain('clearled-pdu');
  });
});
