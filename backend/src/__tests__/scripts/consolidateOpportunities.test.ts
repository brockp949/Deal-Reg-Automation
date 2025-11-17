import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as consolidateMain } from '../../scripts/consolidateOpportunities';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

const sampleOpportunity = (id: string, sourceTag: string) => ({
  id,
  name: `Opp ${id}`,
  stage: 'rfq',
  priority: 'medium',
  sourceTags: [sourceTag],
  actors: [],
  costUpsideNotes: [],
  nextSteps: [],
  sourceSummary: [],
  metadata: {
    parser: 'StandardizedMboxParser',
    vendor: 'ClearLED',
    customer: 'Antora',
  },
});

describe('consolidateOpportunities CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'consolidate-'));
    jest.resetModules();
    logSpy.mockClear();
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes consolidated opportunities to disk', async () => {
    const opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const inputPath = path.join(opportunitiesDir, 'opportunities.json');
    const outputPath = path.join(opportunitiesDir, 'consolidated-opportunities.json');

    await fs.writeFile(
      inputPath,
      JSON.stringify(
        [
          sampleOpportunity('opp-a', 'opportunity:clearled'),
          sampleOpportunity('opp-b', 'opportunity:clearled'),
          sampleOpportunity('opp-c', 'opportunity:other'),
        ],
        null,
        2
      ),
      'utf-8'
    );

    await consolidateMain({
      input: inputPath,
      output: outputPath,
      minScore: 0.2,
      log: true,
    });

    const consolidated = JSON.parse(await fs.readFile(outputPath, 'utf-8'));
    expect(consolidated.length).toBe(2);
    const clusterEntry = consolidated.find((entry: any) =>
      entry.cluster_id.startsWith('cluster-')
    );
    expect(clusterEntry?.opportunity_ids).toEqual(
      expect.arrayContaining(['opp-a', 'opp-b'])
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Opportunity consolidation complete',
      expect.objectContaining({ outputPath })
    );
  });
});
