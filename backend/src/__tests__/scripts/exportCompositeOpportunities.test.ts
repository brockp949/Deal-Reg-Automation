import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as exportMain } from '../../scripts/exportCompositeOpportunities';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

describe('exportCompositeOpportunities CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-composites-'));
    jest.resetModules();
    logSpy.mockClear();
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('exports composite opportunities to JSON and CSV', async () => {
    const opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const consolidatedPath = path.join(opportunitiesDir, 'consolidated-opportunities.json');
    const composites = [
      {
        composite_id: 'cluster-1',
        cluster_id: 'cluster-1',
        opportunity_ids: ['opp-a', 'opp-b'],
        stage: 'rfq',
        stage_confidence: 0.9,
        priority: 'medium',
        priority_confidence: 0.8,
        vendors: ['ClearLED'],
        customers: ['Antora'],
        actors: [],
        tags: ['opportunity:clearled'],
        score: 0.8,
        conflicts: {
          stages: [],
          priorities: [],
          vendors: [],
          customers: [],
          has_mixed_sources: false,
        },
      },
    ];
    await fs.writeFile(consolidatedPath, JSON.stringify(composites, null, 2), 'utf-8');

    await exportMain({
      input: consolidatedPath,
      outputJson: path.join(opportunitiesDir, 'composite-opportunities.json'),
      outputCsv: path.join(opportunitiesDir, 'composite-opportunities.csv'),
    });

    const jsonData = JSON.parse(
      await fs.readFile(path.join(opportunitiesDir, 'composite-opportunities.json'), 'utf-8')
    );
    expect(jsonData).toHaveLength(1);
    const csvData = await fs.readFile(
      path.join(opportunitiesDir, 'composite-opportunities.csv'),
      'utf-8'
    );
    expect(csvData).toContain('composite_id');
    expect(logSpy).toHaveBeenCalledWith(
      'Composite opportunities exported',
      expect.objectContaining({ count: 1 })
    );
  });
});
