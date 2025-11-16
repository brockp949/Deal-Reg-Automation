import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as reportMain } from '../../scripts/opportunityReport';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

describe('opportunityReport CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opp-report-'));
    jest.resetModules();
    logSpy.mockClear();
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates markdown report from metrics file', async () => {
    const opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const metricsPath = path.join(opportunitiesDir, 'readiness-metrics.json');
    const reportPath = path.join(opportunitiesDir, 'opportunity-readiness-report.md');

    await fs.writeFile(
      metricsPath,
      JSON.stringify({
        totalOpportunities: 2,
        stageBreakdown: { rfq: 1, po_in_progress: 1 },
        priorityBreakdown: { medium: 1, high: 1 },
        clusterCount: 1,
        clusteredOpportunityCount: 2,
        generatedAt: '2025-11-14T12:00:00Z',
      }),
      'utf-8'
    );

    await reportMain({
      metricsFile: metricsPath,
      output: reportPath,
    });

    const reportContents = await fs.readFile(reportPath, 'utf-8');
    expect(reportContents).toContain('# Opportunity Readiness Report');
    expect(reportContents).toContain('Total opportunities: **2**');
    expect(reportContents).toContain('- rfq: 1');
    expect(reportContents).toContain('- high: 1');
    expect(logSpy).toHaveBeenCalledWith(
      'Opportunity readiness report generated',
      expect.objectContaining({ outputPath: reportPath })
    );
  });
});
