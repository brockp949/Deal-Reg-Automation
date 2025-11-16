import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { OpportunityStore } from '../../opportunities/OpportunityStore';
import { OpportunityRecord } from '../../opportunities/types';

const sampleSourceSummary = [
  {
    parser: 'StandardizedMboxParser',
    fileName: 'sample.eml',
    sourceType: 'email' as const,
    referenceIds: ['msg-1'],
  },
];

const buildOpportunity = (overrides: Partial<OpportunityRecord>): OpportunityRecord => ({
  id: overrides.id ?? 'opp-1',
  name: overrides.name ?? 'ClearLED PDU',
  stage: overrides.stage ?? 'rfq',
  priority: overrides.priority ?? 'medium',
  costUpsideNotes: overrides.costUpsideNotes ?? [],
  actors: overrides.actors ?? [],
  nextSteps: overrides.nextSteps ?? [],
  sourceTags: overrides.sourceTags ?? [],
  sourceSummary: overrides.sourceSummary ?? sampleSourceSummary,
  metadata: overrides.metadata ?? { parser: 'StandardizedMboxParser' },
});

describe('OpportunityStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opp-store-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes new opportunities file and upserts records by ID', async () => {
    const store = new OpportunityStore({ baseDir: tempDir });

    const firstRecord = buildOpportunity({ id: 'opp-1', name: 'ClearLED PDU' });
    const firstResult = await store.upsert([firstRecord]);
    expect(firstResult.storedRecords).toHaveLength(1);

    const filePath = path.join(tempDir, 'opportunities', 'opportunities.json');
    const fileContents = JSON.parse(await fs.readFile(filePath, 'utf-8')) as OpportunityRecord[];
    expect(fileContents[0].name).toBe('ClearLED PDU');

    const secondRecord = buildOpportunity({ id: 'opp-1', name: 'ClearLED PDU (Updated)' });
    const thirdRecord = buildOpportunity({ id: 'opp-2', name: 'Marshalling Cabinet' });
    const secondResult = await store.upsert([secondRecord, thirdRecord]);

    expect(secondResult.storedRecords).toHaveLength(2);
    const byId = Object.fromEntries(secondResult.storedRecords.map((r) => [r.id, r]));
    expect(byId['opp-1'].name).toBe('ClearLED PDU (Updated)');
    expect(byId['opp-2'].name).toBe('Marshalling Cabinet');
  });
});
