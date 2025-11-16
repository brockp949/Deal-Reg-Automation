import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { StandardizedTranscriptParser } from '../../parsers/StandardizedTranscriptParser';

const createTempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'phase2-transcript-'));

describe('StandardizedTranscriptParser Phase 2 features', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('injects Drive metadata, semantic sections, and RFQ signals', async () => {
    const filePath = path.join(tempDir, 'meeting.txt');
    const transcriptText = `
Attendees: Jeremy Nocchi, Steven Moore
Steven Moore: ClearLED PDU RFQ opportunity with Antora for 1,500-4,000 units at $500-700 per unit.
Jeremy Nocchi: This deal must hit 27-30% margins and Antora expects a PO in 6 weeks.
Next Steps:
- Send updated quote and schedule follow up call.
`;
    await fs.writeFile(filePath, transcriptText, 'utf-8');

    const metadata = {
      connector: 'drive',
      queryName: '4iec-meetings',
      file: {
        id: 'drive-file-1',
        name: 'Project review - Next Gen / 4iec',
        mimeType: 'application/vnd.google-apps.document',
        createdTime: '2025-11-05T17:00:00Z',
        modifiedTime: '2025-11-05T18:00:00Z',
        owners: [{ displayName: 'Steven Moore', emailAddress: 'steven@4iec.com' }],
      },
    };
    await fs.writeFile(`${filePath}.json`, JSON.stringify(metadata, null, 2), 'utf-8');

    const parser = new StandardizedTranscriptParser();
    const result = await parser.parse(filePath, { useEnhancedParsing: false });

    expect(result.metadata.sourceTags).toEqual(
      expect.arrayContaining([
        'query:4iec-meetings',
        'doc:drive-file-1',
        'doc-name:Project review - Next Gen / 4iec',
        'doc-owner:Steven Moore',
      ])
    );

    expect(result.semanticSections?.attendees.some((line) => line.includes('Jeremy Nocchi'))).toBe(
      true
    );
    expect(result.semanticSections?.pricing.length).toBeGreaterThan(0);
    expect(result.semanticSections?.actionItems.length).toBeGreaterThan(0);

    expect(result.entities.deals.length).toBeGreaterThan(0);
    const deal = result.entities.deals[0];
    expect(
      deal.rfq_signals?.quantities.some((entry) => entry.includes('1,500-4,000'))
    ).toBe(true);
    expect(deal.rfq_signals?.priceTargets.some((price) => price.includes('$500-700'))).toBe(true);
    expect(deal.stage_hints).toEqual(expect.arrayContaining(['rfq', 'po_in_progress']));
    expect(deal.deal_stage).toBe('po_in_progress');
    expect(deal.source_tags).toEqual(expect.arrayContaining(['opportunity:clearled-pdu']));

    expect(result.entities.contacts[0]?.source_tags).toEqual(
      expect.arrayContaining(['doc:drive-file-1'])
    );
  });
});
