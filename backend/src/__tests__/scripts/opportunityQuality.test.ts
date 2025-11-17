import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as qualityMain } from '../../scripts/opportunityQuality';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

describe('opportunityQuality CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quality-test-'));
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
    logSpy.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('evaluates composites and writes findings summary', async () => {
    const opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const recordsPath = path.join(opportunitiesDir, 'opportunities.json');
    const compositesPath = path.join(opportunitiesDir, 'composite-opportunities.json');
    const outputPath = path.join(opportunitiesDir, 'quality-findings.json');

    const records = [
      {
        id: 'opp-1',
        name: 'Complete Deal',
        stage: 'rfq',
        priority: 'medium',
        yearlyUnitRange: '100-200',
        priceBand: '$500-700',
        costUpsideNotes: [],
        actors: ['Alice'],
        nextSteps: ['Send proposal'],
        sourceTags: ['opportunity:complete'],
        sourceSummary: [],
        metadata: {
          parser: 'StandardizedParser',
          vendor: 'ClearLED',
          customer: 'Antora',
          confidence: 0.9,
          lastTouched: '2025-11-10T00:00:00.000Z',
        },
      },
      {
        id: 'opp-2',
        name: 'Missing Data Deal',
        stage: 'unknown',
        priority: 'low',
        costUpsideNotes: [],
        actors: [],
        nextSteps: [],
        sourceTags: [],
        sourceSummary: [],
        metadata: {
          parser: 'StandardizedParser',
          confidence: 0.5,
          lastTouched: '2025-09-01T00:00:00.000Z',
        },
      },
    ];

    const composites = [
      {
        composite_id: 'comp-1',
        cluster_id: 'cluster-1',
        opportunity_ids: ['opp-1'],
        stage: 'rfq',
        stage_confidence: 0.9,
        priority: 'medium',
        priority_confidence: 0.85,
        vendors: ['ClearLED'],
        customers: ['Antora'],
        actors: ['Alice'],
        tags: ['opportunity:complete'],
        score: 0.88,
        conflicts: {
          stages: ['rfq'],
          priorities: ['medium'],
          vendors: ['ClearLED'],
          customers: ['Antora'],
          has_mixed_sources: false,
        },
      },
      {
        composite_id: 'comp-2',
        cluster_id: 'cluster-2',
        opportunity_ids: ['opp-2'],
        stage: 'unknown',
        stage_confidence: 0.5,
        priority: 'low',
        priority_confidence: 0.4,
        vendors: [],
        customers: [],
        actors: [],
        tags: [],
        score: 0.4,
        conflicts: {
          stages: ['rfq', 'quote'],
          priorities: ['low', 'medium'],
          vendors: [],
          customers: [],
          has_mixed_sources: true,
        },
      },
    ];

    await fs.writeFile(recordsPath, JSON.stringify(records, null, 2), 'utf-8');
    await fs.writeFile(compositesPath, JSON.stringify(composites, null, 2), 'utf-8');

    const summary = await qualityMain({
      recordsFile: recordsPath,
      compositesFile: compositesPath,
      output: outputPath,
      staleWarningDays: 10,
      staleCriticalDays: 20,
    });

    expect(summary.totalComposites).toBe(2);
    expect(summary.highCount).toBeGreaterThanOrEqual(1);
    expect(summary.findings[0]).toHaveProperty('completenessScore');
    expect(summary.findings[1].missingFields.length).toBeGreaterThan(0);
    const stored = JSON.parse(await fs.readFile(outputPath, 'utf-8'));
    expect(stored.findings).toHaveLength(2);
    expect(logSpy).toHaveBeenCalledWith(
      'Opportunity quality findings generated',
      expect.objectContaining({ total: 2 })
    );
  });
});
