import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as publishMain } from '../../scripts/publishDashboard';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

describe('publishDashboard CLI', () => {
  let tempDir: string;
  let opportunitiesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-dashboard-'));
    opportunitiesDir = path.join(tempDir, 'opportunities');
    await fs.mkdir(opportunitiesDir, { recursive: true });
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
    logSpy.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function buildMetrics(overrides: Partial<any> = {}) {
    return {
      totalOpportunities: 2,
      stageBreakdown: { rfq: 1, quote: 1 },
      priorityBreakdown: { high: 1, medium: 1 },
      clusterCount: 1,
      clusteredOpportunityCount: 2,
      generatedAt: '2025-11-17T12:00:00.000Z',
      processingErrors: 0,
      errorDetails: [],
      actionItems: { total: 1, withOwner: 1, withDueDate: 1 },
      ...overrides,
    };
  }

  function buildQuality(overrides: Partial<any> = {}) {
    return {
      generatedAt: '2025-11-17T12:00:00.000Z',
      totalComposites: 1,
      findings: [],
      averageScore: 85,
      highCount: 0,
      mediumCount: 1,
      lowCount: 0,
      staleCount: 0,
      ...overrides,
    };
  }

  function buildComposites() {
    return [
      {
        composite_id: 'comp-1',
        cluster_id: 'cluster-1',
        opportunity_ids: ['opp-1', 'opp-2'],
        stage: 'rfq',
        stage_confidence: 0.9,
        priority: 'high',
        priority_confidence: 0.8,
        vendors: ['ClearLED'],
        customers: ['Antora'],
        actors: ['Steven'],
        tags: ['opportunity:clearled'],
        score: 0.8,
        conflicts: {
          stages: ['rfq', 'quote'],
          priorities: ['high', 'medium'],
          vendors: ['ClearLED'],
          customers: ['Antora'],
          has_mixed_sources: true,
        },
      },
    ];
  }

  async function writeInputs(metrics: any, quality: any, composites: any) {
    await fs.writeFile(
      path.join(opportunitiesDir, 'readiness-metrics.json'),
      JSON.stringify(metrics, null, 2)
    );
    await fs.writeFile(
      path.join(opportunitiesDir, 'quality-findings.json'),
      JSON.stringify(quality, null, 2)
    );
    await fs.writeFile(
      path.join(opportunitiesDir, 'composite-opportunities.json'),
      JSON.stringify(composites, null, 2)
    );
  }

  it('creates history snapshots, dashboard json, and markdown report', async () => {
    await writeInputs(buildMetrics(), buildQuality(), buildComposites());

    const publishPath = path.join(tempDir, 'docs', 'DASHBOARD.md');
    await publishMain({
      historyLimit: 2,
      trendLimit: 2,
      publishPath,
      dashboardPath: path.join(opportunitiesDir, 'dashboard.json'),
    });

    const historyDir = path.join(opportunitiesDir, 'history');
    const dirEntries = (await fs.readdir(historyDir, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory()
    );
    expect(dirEntries.length).toBe(1);

    const dashboard = JSON.parse(
      await fs.readFile(path.join(opportunitiesDir, 'dashboard.json'), 'utf-8')
    );
    expect(dashboard.stageBreakdown.rfq).toBe(1);
    expect(dashboard.topConflicts).toHaveLength(1);

    const markdown = await fs.readFile(publishPath, 'utf-8');
    expect(markdown).toContain('# Opportunity Dashboard');
    expect(logSpy).toHaveBeenCalledWith(
      'Dashboard published',
      expect.objectContaining({ dashboardPath: path.join(opportunitiesDir, 'dashboard.json') })
    );
  });

  it('honors history limit by pruning old snapshots', async () => {
    await writeInputs(
      buildMetrics({ generatedAt: '2025-11-17T12:00:00.000Z', stageBreakdown: { rfq: 2 } }),
      buildQuality(),
      buildComposites()
    );
    await publishMain({
      historyLimit: 2,
      trendLimit: 2,
      dashboardPath: path.join(opportunitiesDir, 'dashboard.json'),
    });

    await writeInputs(
      buildMetrics({ generatedAt: '2025-11-18T12:00:00.000Z', stageBreakdown: { quote: 3 } }),
      buildQuality({ averageScore: 70 }),
      buildComposites()
    );
    await publishMain({
      historyLimit: 2,
      trendLimit: 2,
      dashboardPath: path.join(opportunitiesDir, 'dashboard.json'),
    });

    await writeInputs(
      buildMetrics({ generatedAt: '2025-11-19T12:00:00.000Z', stageBreakdown: { po_in_progress: 4 } }),
      buildQuality({ averageScore: 60 }),
      buildComposites()
    );
    await publishMain({
      historyLimit: 2,
      trendLimit: 2,
      dashboardPath: path.join(opportunitiesDir, 'dashboard.json'),
    });

    const historyDir = path.join(opportunitiesDir, 'history');
    const historyEntries = (
      await fs.readdir(historyDir, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(historyEntries.length).toBe(2);
    expect(historyEntries[0]).toContain('20251118');
    expect(historyEntries[1]).toContain('20251119');

    const dashboard = JSON.parse(
      await fs.readFile(path.join(opportunitiesDir, 'dashboard.json'), 'utf-8')
    );
    expect(dashboard.history.stageTrend).toHaveLength(2);
  });
});
