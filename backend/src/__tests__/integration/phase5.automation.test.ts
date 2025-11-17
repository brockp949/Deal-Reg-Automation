import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as qualityMain } from '../../scripts/opportunityQuality';
import { main as metricsMain } from '../../scripts/opportunityMetrics';
import {
  OpportunityRecord,
  CompositeOpportunity,
  OpportunityStage,
  OpportunityPriority,
} from '../../opportunities/types';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

describe('Phase 5 automation scenarios', () => {
  let tempDir: string;
  let opportunitiesDir: string;
  let recordsPath: string;
  let compositesPath: string;
  let clustersPath: string;
  let qualityPath: string;
  let metricsPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase5-automation-'));
    opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    recordsPath = path.join(opportunitiesDir, 'opportunities.json');
    compositesPath = path.join(opportunitiesDir, 'composite-opportunities.json');
    clustersPath = path.join(opportunitiesDir, 'opportunity-clusters.json');
    qualityPath = path.join(opportunitiesDir, 'quality-findings.json');
    metricsPath = path.join(opportunitiesDir, 'readiness-metrics.json');

    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
    logSpy.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function buildRecord(overrides: Partial<OpportunityRecord>): OpportunityRecord {
    const base: OpportunityRecord = {
      id: 'opp-generic',
      name: 'Generic Opportunity',
      stage: 'rfq',
      priority: 'medium',
      yearlyUnitRange: undefined,
      priceBand: undefined,
      costUpsideNotes: [],
      actors: [],
      nextSteps: [],
      structuredNextSteps: [],
      sourceTags: ['opportunity:generic'],
      sourceSummary: [],
      metadata: {
        vendor: 'Vendor',
        customer: 'Customer',
        parser: 'StandardizedMboxParser',
        lastTouched: '2025-11-10T00:00:00.000Z',
      },
    };

    return {
      ...base,
      ...overrides,
      actors: overrides.actors ?? base.actors,
      nextSteps: overrides.nextSteps ?? base.nextSteps,
      structuredNextSteps: overrides.structuredNextSteps ?? base.structuredNextSteps,
      sourceTags: overrides.sourceTags ?? base.sourceTags,
      sourceSummary: overrides.sourceSummary ?? base.sourceSummary,
      costUpsideNotes: overrides.costUpsideNotes ?? base.costUpsideNotes,
      metadata: {
        ...base.metadata,
        ...(overrides.metadata ?? {}),
      },
    };
  }

  function buildComposite(overrides: Partial<CompositeOpportunity>): CompositeOpportunity {
    const base: CompositeOpportunity = {
      composite_id: 'comp-generic',
      cluster_id: 'cluster-generic',
      opportunity_ids: ['opp-generic'],
      stage: 'rfq' as OpportunityStage,
      stage_confidence: 0.9,
      priority: 'medium' as OpportunityPriority,
      priority_confidence: 0.9,
      vendors: ['Vendor'],
      customers: ['Customer'],
      actors: [],
      tags: ['opportunity:generic'],
      score: 0.9,
      conflicts: {
        stages: ['rfq'],
        priorities: ['medium'],
        vendors: ['Vendor'],
        customers: ['Customer'],
        has_mixed_sources: false,
      },
    };

    return {
      ...base,
      ...overrides,
      vendors: overrides.vendors ?? base.vendors,
      customers: overrides.customers ?? base.customers,
      actors: overrides.actors ?? base.actors,
      tags: overrides.tags ?? base.tags,
      conflicts: overrides.conflicts ?? base.conflicts,
    };
  }

  async function writeClusters(recordIds: string[]) {
    await fs.writeFile(
      clustersPath,
      JSON.stringify([
        {
          clusterId: 'cluster-generic',
          score: 0.9,
          records: recordIds.map((id) => ({ id })),
          signals: { sharedOpportunityTags: [] },
        },
      ]),
      'utf-8'
    );
  }

  it('runs Gmail-only scenario through quality + metrics', async () => {
    const records = [
      buildRecord({
        id: 'opp-gmail',
        name: 'ClearLED PDU',
        actors: ['Steven Moore'],
        nextSteps: ['Send deck'],
        structuredNextSteps: [
          { description: 'Steven send deck by Friday', owner: 'Steven', dueDate: 'Friday', source: 'mail.eml' },
        ],
        sourceSummary: [
          {
            parser: 'StandardizedMboxParser',
            fileName: 'mail.eml',
            sourceType: 'email',
            connector: 'gmail',
            queryName: 'rfq',
            referenceIds: ['msg-1'],
          },
        ],
        metadata: {
          vendor: 'ClearLED',
          customer: 'Antora',
          parser: 'StandardizedMboxParser',
          lastTouched: '2025-11-10T00:00:00.000Z',
        },
      }),
    ];
    const composites = [
      buildComposite({
        composite_id: 'comp-gmail',
        cluster_id: 'cluster-gmail',
        opportunity_ids: ['opp-gmail'],
        stage: 'rfq',
        vendors: ['ClearLED'],
        customers: ['Antora'],
        actors: ['Steven Moore'],
        tags: ['opportunity:clearled'],
      }),
    ];

    await fs.writeFile(recordsPath, JSON.stringify(records, null, 2), 'utf-8');
    await fs.writeFile(compositesPath, JSON.stringify(composites, null, 2), 'utf-8');
    await writeClusters(['opp-gmail']);

    const qualitySummary = await qualityMain({
      recordsFile: recordsPath,
      compositesFile: compositesPath,
      output: qualityPath,
    });

    await metricsMain(
      { file: recordsPath, clustersFile: clustersPath, output: metricsPath },
      [],
      composites,
      qualitySummary
    );

    expect(qualitySummary.totalComposites).toBe(1);
    expect(qualitySummary.highCount).toBe(0);
    const metrics = JSON.parse(await fs.readFile(metricsPath, 'utf-8'));
    expect(metrics.actionItems).toEqual({ total: 1, withOwner: 1, withDueDate: 1 });
    expect(metrics.quality).toMatchObject({ findings: 1, high: 0, medium: 0 });
  });

  it('flags Drive-only action items missing owners/due dates', async () => {
    const records = [
      buildRecord({
        id: 'opp-drive',
        name: 'Graphene Heater',
        stage: 'quote',
        structuredNextSteps: [{ description: 'Follow up with Antora lab' }],
        sourceSummary: [
          {
            parser: 'StandardizedTranscriptParser',
            fileName: 'meeting.docx',
            sourceType: 'transcript',
            connector: 'drive',
            queryName: 'meetings',
            referenceIds: ['file-1'],
          },
        ],
        metadata: {
          vendor: '4IEC',
          customer: 'Antora',
          parser: 'StandardizedTranscriptParser',
          lastTouched: '2025-10-01T00:00:00.000Z',
        },
      }),
    ];
    const composites = [
      buildComposite({
        composite_id: 'comp-drive',
        cluster_id: 'cluster-drive',
        opportunity_ids: ['opp-drive'],
        stage: 'quote',
        vendors: ['4IEC'],
        customers: ['Antora'],
      }),
    ];

    await fs.writeFile(recordsPath, JSON.stringify(records, null, 2), 'utf-8');
    await fs.writeFile(compositesPath, JSON.stringify(composites, null, 2), 'utf-8');
    await writeClusters(['opp-drive']);

    const qualitySummary = await qualityMain({
      recordsFile: recordsPath,
      compositesFile: compositesPath,
      output: qualityPath,
      staleWarningDays: 1,
      staleCriticalDays: 2,
    });

    const finding = qualitySummary.findings[0];
    expect(finding.actionItems).toEqual({ total: 1, withOwner: 0, withDueDate: 0 });
    expect(finding.issues.some((issue) => issue.message.includes('owners'))).toBe(true);
    expect(finding.issues.some((issue) => issue.message.includes('due dates'))).toBe(true);
    expect(finding.severity).not.toBe('low');
  });

  it('detects mixed-source conflicts in consolidated scenarios', async () => {
    const records = [
      buildRecord({
        id: 'opp-gmail',
        name: 'Marshalling Cabinet',
        stage: 'rfq',
        sourceSummary: [
          {
            parser: 'StandardizedMboxParser',
            fileName: 'rfq.eml',
            sourceType: 'email',
            connector: 'gmail',
            referenceIds: ['msg-2'],
          },
        ],
        metadata: {
          vendor: 'Vendor A',
          customer: 'Customer X',
          parser: 'StandardizedMboxParser',
          lastTouched: '2025-11-05T00:00:00.000Z',
        },
      }),
      buildRecord({
        id: 'opp-drive',
        name: 'Marshalling Cabinet',
        stage: 'quote',
        sourceSummary: [
          {
            parser: 'StandardizedTranscriptParser',
            fileName: 'notes.docx',
            sourceType: 'transcript',
            connector: 'drive',
            referenceIds: ['file-9'],
          },
        ],
        metadata: {
          vendor: 'Vendor B',
          customer: 'Customer Y',
          parser: 'StandardizedTranscriptParser',
          lastTouched: '2025-09-20T00:00:00.000Z',
        },
      }),
    ];
    const composites = [
      buildComposite({
        composite_id: 'comp-mixed',
        cluster_id: 'cluster-mixed',
        opportunity_ids: ['opp-gmail', 'opp-drive'],
        stage: 'rfq',
        vendors: ['Vendor A', 'Vendor B'],
        customers: ['Customer X', 'Customer Y'],
        conflicts: {
          stages: ['rfq', 'quote'],
          priorities: ['medium'],
          vendors: ['Vendor A', 'Vendor B'],
          customers: ['Customer X', 'Customer Y'],
          has_mixed_sources: true,
        },
      }),
    ];

    await fs.writeFile(recordsPath, JSON.stringify(records, null, 2), 'utf-8');
    await fs.writeFile(compositesPath, JSON.stringify(composites, null, 2), 'utf-8');
    await writeClusters(['opp-gmail', 'opp-drive']);

    const qualitySummary = await qualityMain({
      recordsFile: recordsPath,
      compositesFile: compositesPath,
      output: qualityPath,
    });

    const finding = qualitySummary.findings[0];
    expect(finding.conflictFields).toEqual(
      expect.arrayContaining(['stage', 'vendor', 'customer'])
    );
    expect(finding.issues.some((issue) => issue.category === 'consistency')).toBe(true);
    expect(finding.severity).not.toBe('low');
  });
});
