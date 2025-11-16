import {
  detectDuplicateDeals,
  clusterDuplicates,
  DealData,
  DuplicateStrategy,
} from '../../services/duplicateDetector';
import {
  mergeCluster,
  MergeStrategy,
  ConflictResolutionStrategy,
} from '../../services/mergeEngine';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const { query } = require('../../db');

const baseDeal: DealData = {
  id: 'deal-1',
  dealName: 'Azure Migration for Acme',
  customerName: 'Acme Corporation',
  dealValue: 50000,
  currency: 'USD',
  closeDate: '2024-12-15',
  vendorId: 'vendor-ms',
  status: 'active',
  products: ['Azure'],
  contacts: [{ id: 'contact-1', name: 'John Doe', email: 'john@acme.com' }],
  source_file_ids: ['file-1'],
};

const similarDeal: DealData = {
  id: 'deal-2',
  dealName: 'Microsoft Azure Cloud Migration',
  customerName: 'Acme Corp',
  dealValue: 52000,
  currency: 'USD',
  closeDate: '2024-12-18',
  vendorId: 'vendor-ms',
  status: 'active',
  products: ['Azure'],
  contacts: [{ id: 'contact-2', name: 'Jane Smith', email: 'jane@acme.com' }],
  source_file_ids: ['file-2'],
};

const uniqueDeal: DealData = {
  id: 'deal-3',
  dealName: 'AWS Expansion Initiative',
  customerName: 'Globex Corporation',
  dealValue: 75000,
  currency: 'USD',
  closeDate: '2024-10-01',
  vendorId: 'vendor-aws',
  status: 'active',
  products: ['EC2', 'RDS'],
  contacts: [{ id: 'contact-3', name: 'Mary Major', email: 'mary@globex.com' }],
  source_file_ids: ['file-3'],
};

describe('Phase 6 Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clusters duplicates discovered via detection pipeline', async () => {
    const result = await detectDuplicateDeals(baseDeal, {
      existingDeals: [similarDeal],
      strategies: [DuplicateStrategy.FUZZY_NAME, DuplicateStrategy.MULTI_FACTOR],
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].matchedEntityId).toBe('deal-2');

    const clusters = await clusterDuplicates([baseDeal, similarDeal, uniqueDeal]);
    expect(clusters.length).toBe(1);
    const cluster = clusters[0];

    expect(cluster.entityIds.sort()).toEqual(['deal-1', 'deal-2']);
    expect(cluster.clusterSize).toBe(2);
    expect(cluster.entityType).toBe('deal');
    expect(cluster.confidenceScore).toBeGreaterThanOrEqual(0.8);
  });

  it('merges a detected cluster via merge engine', async () => {
    const clusters = await clusterDuplicates([baseDeal, similarDeal]);
    const cluster = clusters[0];
    const clusterRow = {
      id: cluster.clusterId,
      entity_ids: cluster.entityIds,
      entity_type: 'deal',
      status: 'active',
      confidence_score: cluster.confidenceScore,
      master_entity_id: null,
    };

    query
      .mockResolvedValueOnce({ rows: [clusterRow] }) // load cluster
      .mockResolvedValueOnce({ rows: [baseDeal, similarDeal] }) // select master
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [baseDeal, similarDeal] }) // select for merge
      .mockResolvedValueOnce(undefined) // update target
      .mockResolvedValueOnce({ rows: [{ id: 'merge-history-1' }] }) // insert merge history
      .mockResolvedValueOnce(undefined) // update source entities
      .mockResolvedValueOnce(undefined) // update duplicate detections
      .mockResolvedValueOnce(undefined) // update cluster metadata
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeCluster(clusterRow.id, undefined, {
      mergeStrategy: MergeStrategy.KEEP_HIGHEST_QUALITY,
      conflictResolution: ConflictResolutionStrategy.MERGE_ARRAYS,
      mergedBy: 'phase6-integration',
    });

    expect(result.success).toBe(true);
    expect(result.mergedEntityId).toBeDefined();
    expect(result.sourceEntityIds.sort()).toEqual(['deal-2']);
    expect(result.mergeHistoryId).toBe('merge-history-1');

    const targetUpdateCall = query.mock.calls.find(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('UPDATE deal_registrations SET') &&
        call[0].includes('source_file_ids')
    );

    expect(targetUpdateCall).toBeDefined();
  });
});
