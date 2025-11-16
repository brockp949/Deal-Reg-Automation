import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as metricsMain } from '../../scripts/opportunityMetrics';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

describe('opportunityMetrics CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opp-metrics-'));
    jest.resetModules();
    logSpy.mockClear();
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes readiness metrics summary', async () => {
    const opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const opportunitiesPath = path.join(opportunitiesDir, 'opportunities.json');
    const clustersPath = path.join(opportunitiesDir, 'opportunity-clusters.json');
    const outputPath = path.join(opportunitiesDir, 'readiness-metrics.json');

    await fs.writeFile(
      opportunitiesPath,
      JSON.stringify([
        {
          id: 'opp-1',
          name: 'ClearLED PDU',
          stage: 'rfq',
          priority: 'medium',
          sourceTags: ['opportunity:clearled-pdu'],
          metadata: { vendor: 'ClearLED', customer: 'Antora', parser: 'StandardizedMboxParser' },
          sourceSummary: [],
          costUpsideNotes: [],
          actors: [],
          nextSteps: [],
        },
        {
          id: 'opp-2',
          name: 'Marshalling Cabinet',
          stage: 'po_in_progress',
          priority: 'high',
          sourceTags: ['opportunity:marshalling-cabinet'],
          metadata: { vendor: '4IEC', customer: 'Antora', parser: 'StandardizedTranscriptParser' },
          sourceSummary: [],
          costUpsideNotes: [],
          actors: [],
          nextSteps: [],
        },
      ]),
      'utf-8'
    );

    await fs.writeFile(
      clustersPath,
      JSON.stringify([
        {
          clusterId: 'cluster-123',
          score: 0.9,
          records: [{ id: 'opp-1' }, { id: 'opp-2' }],
          signals: { sharedOpportunityTags: [], sharedActors: [] },
        },
      ]),
      'utf-8'
    );

    await metricsMain({
      file: opportunitiesPath,
      clustersFile: clustersPath,
      output: outputPath,
    });

    const metrics = JSON.parse(await fs.readFile(outputPath, 'utf-8'));
    expect(metrics.totalOpportunities).toBe(2);
    expect(metrics.clusterCount).toBe(1);
    expect(metrics.clusteredOpportunityCount).toBe(2);
    expect(logSpy).toHaveBeenCalledWith(
      'Opportunity readiness metrics',
      expect.objectContaining({ totalOpportunities: 2 })
    );
  });
});
