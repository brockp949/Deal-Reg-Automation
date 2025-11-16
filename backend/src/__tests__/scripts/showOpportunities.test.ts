import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as showOpportunitiesMain } from '../../scripts/showOpportunities';

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

describe('showOpportunities CLI', () => {
  const scriptPath = path.resolve(__dirname, '../../scripts/showOpportunities.ts');
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'show-opp-'));
    jest.resetModules();
    logSpy.mockClear();
    errorSpy.mockClear();
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('prints filtered opportunities and clusters', async () => {
    const opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const opportunitiesPath = path.join(opportunitiesDir, 'opportunities.json');
    const clustersPath = path.join(opportunitiesDir, 'opportunity-clusters.json');

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
      ]),
      'utf-8'
    );

    await fs.writeFile(
      clustersPath,
      JSON.stringify([
        {
          clusterId: 'cluster-123',
          score: 0.8,
          records: [{ id: 'opp-1' }],
          signals: { sharedOpportunityTags: ['clearled-pdu'], sharedActors: [] },
        },
      ]),
      'utf-8'
    );

    await showOpportunitiesMain({
      clusters: true,
      filter: 'clearled',
      limit: 5,
      file: opportunitiesPath,
      clustersFile: clustersPath,
    });

    expect(logSpy).toHaveBeenCalledWith(
      'Opportunities overview',
      expect.objectContaining({ stored: 1 })
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Opportunity',
      expect.objectContaining({ id: 'opp-1' })
    );
  });
});
