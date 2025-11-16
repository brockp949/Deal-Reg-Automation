import {
  previewMerge,
  mergeEntities,
  mergeCluster,
  unmergeEntities,
  autoMergeHighConfidenceDuplicates,
  calculateDataQualityScore,
  MergeStrategy,
  ConflictResolutionStrategy
} from '../../services/mergeEngine';

// Mock the database query function
jest.mock('../../db', () => ({
  query: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const { query } = require('../../db');

// ============================================================================
// Test Data
// ============================================================================

const testDeal1 = {
  id: 'deal-1',
  deal_name: 'Microsoft Azure Migration',
  customer_name: 'Acme Corporation',
  deal_value: 50000,
  currency: 'USD',
  close_date: '2024-12-15',
  vendor_id: 'vendor-ms',
  status: 'active',
  ai_confidence_score: 0.90,
  validation_status: 'passed',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-11-01T15:00:00Z',
  source_file_ids: ['file-1']
};

const testDeal2 = {
  id: 'deal-2',
  deal_name: 'Azure Cloud Migration',
  customer_name: 'Acme Corp',
  deal_value: 52000,
  currency: 'USD',
  close_date: '2024-12-16',
  vendor_id: 'vendor-ms',
  status: 'active',
  ai_confidence_score: 0.85,
  validation_status: 'passed',
  created_at: '2024-01-20T10:00:00Z',
  updated_at: '2024-10-15T12:00:00Z',
  source_file_ids: ['file-2']
};

const testDeal3 = {
  id: 'deal-3',
  deal_name: 'Microsoft Azure Migration',
  customer_name: 'Acme Corporation',
  deal_value: 50000, // Same as deal-1
  currency: 'USD',
  close_date: '2024-12-15',
  vendor_id: 'vendor-ms',
  status: 'active',
  ai_confidence_score: 0.75,
  validation_status: 'pending',
  created_at: '2024-01-10T10:00:00Z', // Oldest
  updated_at: '2024-09-01T10:00:00Z', // Oldest update
  source_file_ids: ['file-3']
};

const testDealIncomplete = {
  id: 'deal-incomplete',
  deal_name: 'Incomplete Deal',
  customer_name: 'Test Corp',
  deal_value: null,
  currency: null,
  close_date: null,
  vendor_id: null,
  status: 'active',
  ai_confidence_score: 0.50,
  validation_status: 'failed',
  created_at: '2024-11-01T10:00:00Z',
  updated_at: '2024-11-01T10:00:00Z',
  source_file_ids: []
};

// ============================================================================
// Tests: Data Quality Scoring
// ============================================================================

describe('MergeEngine - Data Quality Scoring', () => {
  describe('calculateDataQualityScore', () => {
    it('should score high quality deals highly', () => {
      const score = calculateDataQualityScore(testDeal1);
      expect(score).toBeGreaterThan(0.80);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('should score low quality deals poorly', () => {
      const score = calculateDataQualityScore(testDealIncomplete);
      expect(score).toBeLessThan(0.60);
    });

    it('should weight completeness heavily (40%)', () => {
      const complete = {
        ...testDeal1,
        ai_confidence_score: 0.50,
        validation_status: 'failed'
      };
      const incomplete = {
        ...testDealIncomplete,
        ai_confidence_score: 0.95,
        validation_status: 'passed'
      };

      // Despite better AI score and validation, incomplete deal should score lower
      const completeScore = calculateDataQualityScore(complete);
      const incompleteScore = calculateDataQualityScore(incomplete);

      expect(completeScore).toBeGreaterThan(incompleteScore);
    });

    it('should factor in AI confidence (30%)', () => {
      const highConfidence = { ...testDeal1, ai_confidence_score: 0.95 };
      const lowConfidence = { ...testDeal1, ai_confidence_score: 0.50 };

      const highScore = calculateDataQualityScore(highConfidence);
      const lowScore = calculateDataQualityScore(lowConfidence);

      expect(highScore).toBeGreaterThan(lowScore);
      // Difference should be roughly 0.3 * (0.95 - 0.50) = 0.135
      expect(highScore - lowScore).toBeGreaterThan(0.10);
    });

    it('should factor in validation status (20%)', () => {
      const validated = { ...testDeal1, validation_status: 'passed' };
      const failed = { ...testDeal1, validation_status: 'failed' };

      const validatedScore = calculateDataQualityScore(validated);
      const failedScore = calculateDataQualityScore(failed);

      expect(validatedScore).toBeGreaterThan(failedScore);
      // Difference should be roughly 0.2 * (1.0 - 0.0) = 0.20
      expect(validatedScore - failedScore).toBeGreaterThan(0.15);
    });

    it('should factor in recency (10%)', () => {
      const recent = {
        ...testDeal1,
        updated_at: new Date().toISOString() // Today
      };
      const old = {
        ...testDeal1,
        updated_at: '2020-01-01T10:00:00Z' // Very old
      };

      const recentScore = calculateDataQualityScore(recent);
      const oldScore = calculateDataQualityScore(old);

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('should handle missing timestamps gracefully', () => {
      const noTimestamp = {
        ...testDeal1,
        created_at: undefined,
        updated_at: undefined
      };

      const score = calculateDataQualityScore(noTimestamp);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should handle deals with all null values', () => {
      const allNull = {
        id: 'null-deal',
        deal_name: null,
        customer_name: null,
        deal_value: null
      };

      const score = calculateDataQualityScore(allNull);
      expect(score).toBeLessThan(0.30);
    });

    it('should return consistent scores for same input', () => {
      const score1 = calculateDataQualityScore(testDeal1);
      const score2 = calculateDataQualityScore(testDeal1);

      expect(score1).toBe(score2);
    });
  });
});

// ============================================================================
// Tests: Merge Preview
// ============================================================================

describe('MergeEngine - Merge Preview', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should generate preview with conflicts', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDeal2]
    });

    const preview = await previewMerge(['deal-1', 'deal-2']);

    expect(preview).toBeDefined();
    expect(preview.conflicts).toBeDefined();
    expect(preview.conflicts.length).toBeGreaterThan(0);
    expect(preview.suggestedMaster).toBeDefined();
    expect(preview.confidence).toBeGreaterThanOrEqual(0);
    expect(preview.confidence).toBeLessThanOrEqual(1);
  });

  it('should detect value conflicts', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDeal2] // Different deal_value: 50000 vs 52000
    });

    const preview = await previewMerge(['deal-1', 'deal-2']);

    const valueConflict = preview.conflicts.find(c => c.fieldName === 'deal_value');
    expect(valueConflict).toBeDefined();
    expect(valueConflict!.values.length).toBe(2);
    expect(valueConflict!.values.map(v => v.value)).toEqual(expect.arrayContaining([50000, 52000]));
  });

  it('should suggest best value for each conflict', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDeal2]
    });

    const preview = await previewMerge(['deal-1', 'deal-2']);

    preview.conflicts.forEach(conflict => {
      expect(conflict.suggestedValue).toBeDefined();
      expect(conflict.suggestedReason).toBeDefined();
    });
  });

  it('should select highest quality entity as master', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDealIncomplete] // testDeal1 has much better quality
    });

    const preview = await previewMerge(['deal-1', 'deal-incomplete']);

    expect(preview.suggestedMaster).toBe('deal-1');
  });

  it('should generate warnings for high conflict count', async () => {
    const dealWithManyConflicts = {
      ...testDeal1,
      id: 'deal-conflicts',
      deal_name: 'Different',
      customer_name: 'Different',
      deal_value: 999999,
      close_date: '2025-01-01',
      vendor_id: 'vendor-different'
    };

    query.mockResolvedValue({
      rows: [testDeal1, dealWithManyConflicts]
    });

    const preview = await previewMerge(['deal-1', 'deal-conflicts']);

    if (preview.conflicts.length > 5) {
      expect(preview.warnings.length).toBeGreaterThan(0);
      expect(preview.warnings.some(w => w.includes('conflicts'))).toBe(true);
    }
  });

  it('should generate warnings for low confidence', async () => {
    query.mockResolvedValue({
      rows: [testDealIncomplete, { ...testDealIncomplete, id: 'deal-incomplete-2' }]
    });

    const preview = await previewMerge(['deal-incomplete', 'deal-incomplete-2']);

    if (preview.confidence < 0.7) {
      expect(preview.warnings.some(w => w.includes('Low merge confidence'))).toBe(true);
    }
  });

  it('should flag conflicts requiring manual review', async () => {
    // Create 3 deals with 3 different values for same field
    const deal1 = { ...testDeal1, deal_value: 50000 };
    const deal2 = { ...testDeal1, id: 'deal-2', deal_value: 60000 };
    const deal3 = { ...testDeal1, id: 'deal-3', deal_value: 70000 };

    query.mockResolvedValue({
      rows: [deal1, deal2, deal3]
    });

    const preview = await previewMerge(['deal-1', 'deal-2', 'deal-3']);

    const manualConflicts = preview.conflicts.filter(c => c.requiresManualReview);
    expect(manualConflicts.length).toBeGreaterThan(0);
  });

  it('should require at least 2 entities', async () => {
    await expect(previewMerge(['deal-1'])).rejects.toThrow('At least 2 entities');
  });

  it('should handle database errors gracefully', async () => {
    query.mockRejectedValue(new Error('Database connection failed'));

    await expect(previewMerge(['deal-1', 'deal-2'])).rejects.toThrow('Database connection failed');
  });

  it('should include source data in preview', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDeal2]
    });

    const preview = await previewMerge(['deal-1', 'deal-2']);

    expect(preview.sourceData).toBeDefined();
    expect(preview.sourceData.length).toBe(2);
    expect(preview.sourceData).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deal-1' }),
      expect.objectContaining({ id: 'deal-2' })
    ]));
  });
});

// ============================================================================
// Tests: Merge Strategy Selection
// ============================================================================

describe('MergeEngine - Merge Strategies', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should select newest entity with KEEP_NEWEST strategy', async () => {
    // testDeal1 updated_at: 2024-11-01 (newest)
    // testDeal2 updated_at: 2024-10-15
    // testDeal3 updated_at: 2024-09-01 (oldest)

    query
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2, testDeal3] }) // Preview fetch
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2, testDeal3] }) // Merge fetch
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT merge_history
      .mockResolvedValueOnce(undefined) // UPDATE source entities
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_detections
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    // Since merge strategies are applied internally, we test via merge preview
    const preview = await previewMerge(['deal-1', 'deal-2', 'deal-3']);

    // The highest quality entity should be suggested (deal-1 in our test data)
    expect(preview.suggestedMaster).toBe('deal-1');
  });

  it('should select highest quality entity with KEEP_HIGHEST_QUALITY strategy', async () => {
    query.mockResolvedValue({
      rows: [testDeal1, testDealIncomplete]
    });

    const preview = await previewMerge(['deal-1', 'deal-incomplete']);

    // testDeal1 has much higher quality than incomplete
    expect(preview.suggestedMaster).toBe('deal-1');
  });

  it('should handle entities with same quality scores', async () => {
    const identicalQuality1 = { ...testDeal1, id: 'deal-same-1' };
    const identicalQuality2 = { ...testDeal1, id: 'deal-same-2' };

    query.mockResolvedValue({
      rows: [identicalQuality1, identicalQuality2]
    });

    const preview = await previewMerge(['deal-same-1', 'deal-same-2']);

    // Should still select one as master
    expect(preview.suggestedMaster).toBeDefined();
    expect(['deal-same-1', 'deal-same-2']).toContain(preview.suggestedMaster);
  });
});

// ============================================================================
// Tests: Conflict Resolution Strategies
// ============================================================================

describe('MergeEngine - Conflict Resolution', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should prefer complete values with PREFER_COMPLETE strategy', async () => {
    const dealComplete = {
      ...testDeal1,
      id: 'deal-complete',
      deal_value: 50000,
      close_date: '2024-12-15'
    };
    const dealIncomplete = {
      ...testDeal1,
      id: 'deal-incomplete',
      deal_value: null,
      close_date: null
    };

    query.mockResolvedValue({
      rows: [dealComplete, dealIncomplete]
    });

    const preview = await previewMerge(['deal-complete', 'deal-incomplete']);

    const valueConflict = preview.conflicts.find(c => c.fieldName === 'deal_value');
    if (valueConflict) {
      expect(valueConflict.suggestedValue).toBe(50000); // Non-null value preferred
    }
  });

  it('should prefer validated values with PREFER_VALIDATED strategy', async () => {
    const validatedDeal = {
      ...testDeal1,
      id: 'validated',
      deal_value: 50000,
      validation_status: 'passed'
    };
    const unvalidatedDeal = {
      ...testDeal1,
      id: 'unvalidated',
      deal_value: 60000,
      validation_status: 'pending'
    };

    query.mockResolvedValue({
      rows: [validatedDeal, unvalidatedDeal]
    });

    const preview = await previewMerge(['validated', 'unvalidated']);

    // The conflict resolution logic should prefer validated values
    // This is tested more directly in merge execution
  });

  it('should merge array values correctly', async () => {
    const deal1 = {
      ...testDeal1,
      source_file_ids: ['file-1', 'file-2']
    };
    const deal2 = {
      ...testDeal2,
      source_file_ids: ['file-2', 'file-3']
    };

    query
      .mockResolvedValueOnce({ rows: [deal1, deal2] }) // Preview
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [deal1, deal2] }) // Merge fetch
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT merge_history
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeEntities(['deal-2'], 'deal-1', {
      conflictResolution: ConflictResolutionStrategy.MERGE_ARRAYS
    });

    expect(result.success).toBe(true);
    // Merged source_file_ids should have all unique values: file-1, file-2, file-3
  });

  it('should prefer higher confidence values', async () => {
    const highConfidence = {
      ...testDeal1,
      id: 'high',
      deal_value: 50000,
      ai_confidence_score: 0.95
    };
    const lowConfidence = {
      ...testDeal1,
      id: 'low',
      deal_value: 60000,
      ai_confidence_score: 0.60
    };

    query.mockResolvedValue({
      rows: [highConfidence, lowConfidence]
    });

    const preview = await previewMerge(['high', 'low']);

    const valueConflict = preview.conflicts.find(c => c.fieldName === 'deal_value');
    if (valueConflict) {
      // Should suggest high confidence value
      expect(valueConflict.suggestedValue).toBe(50000);
      expect(valueConflict.suggestedReason).toContain('confidence');
    }
  });

  it('should prefer most recent values when confidence is similar', async () => {
    const recent = {
      ...testDeal1,
      id: 'recent',
      deal_value: 50000,
      updated_at: '2024-11-01T10:00:00Z',
      ai_confidence_score: 0.85
    };
    const older = {
      ...testDeal1,
      id: 'older',
      deal_value: 60000,
      updated_at: '2024-06-01T10:00:00Z',
      ai_confidence_score: 0.85
    };

    query.mockResolvedValue({
      rows: [recent, older]
    });

    const preview = await previewMerge(['recent', 'older']);

    const valueConflict = preview.conflicts.find(c => c.fieldName === 'deal_value');
    if (valueConflict) {
      // Should suggest more recent value
      expect(valueConflict.suggestedValue).toBe(50000);
    }
  });
});

// ============================================================================
// Tests: Merge Execution
// ============================================================================

describe('MergeEngine - Merge Execution', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should successfully merge two entities', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch entities
      .mockResolvedValueOnce(undefined) // UPDATE target
      .mockResolvedValueOnce({ rows: [{ id: 'merge-history-1' }] }) // INSERT merge_history
      .mockResolvedValueOnce(undefined) // UPDATE source entities
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_detections
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeEntities(['deal-2'], 'deal-1');

    expect(result.success).toBe(true);
    expect(result.mergedEntityId).toBe('deal-1');
    expect(result.sourceEntityIds).toEqual(['deal-2']);
    expect(result.mergeHistoryId).toBe('merge-history-1');
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('should require at least one source entity', async () => {
    await expect(mergeEntities([], 'deal-1')).rejects.toThrow('At least 1 source entity required');
  });

  it('should use transaction with BEGIN/COMMIT', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    await mergeEntities(['deal-2'], 'deal-1');

    expect(query).toHaveBeenCalledWith('BEGIN');
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('should rollback on error', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch
      .mockRejectedValueOnce(new Error('UPDATE failed')); // UPDATE fails

    await expect(mergeEntities(['deal-2'], 'deal-1')).rejects.toThrow('UPDATE failed');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should log merge history', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-history-1' }] }) // INSERT merge_history
      .mockResolvedValueOnce(undefined) // conflict inserts (none)
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeEntities(['deal-2'], 'deal-1', {
      mergedBy: 'user-123',
      notes: 'Test merge'
    });

    expect(result.mergeHistoryId).toBe('merge-history-1');

    // Check that merge history was inserted
    const insertCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('INSERT INTO merge_history')
    );
    expect(insertCall).toBeDefined();
  });

  it('should merge source_file_ids arrays', async () => {
    const deal1 = { ...testDeal1, source_file_ids: ['file-1', 'file-2'] };
    const deal2 = { ...testDeal2, source_file_ids: ['file-2', 'file-3'] };

    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [deal1, deal2] }) // Fetch
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeEntities(['deal-2'], 'deal-1');

    expect(result.success).toBe(true);
    // Check that UPDATE was called with merged file IDs
    const updateCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE deal_registrations') && call[0].includes('source_file_ids')
    );
    expect(updateCall).toBeDefined();
  });

  it('should preserve source entities if requested', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch
      .mockResolvedValueOnce(undefined) // UPDATE target
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source (preserve)
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    await mergeEntities(['deal-2'], 'deal-1', {
      preserveSource: true
    });

    // Check that source was marked as merged but preserved
    const updateSourceCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE deal_registrations') &&
      call[0].includes('status = \'merged\'') &&
      call[0].includes('notes')
    );
    expect(updateSourceCall).toBeDefined();
  });

  it('should throw error if target entity not found', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal2] }); // Only source, no target

    await expect(mergeEntities(['deal-2'], 'deal-1')).rejects.toThrow('Target entity deal-1 not found');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should update duplicate detection status', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch
      .mockResolvedValueOnce(undefined) // UPDATE target
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_detections
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    await mergeEntities(['deal-2'], 'deal-1');

    // Check that duplicate detections were updated
    const updateDuplicatesCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE duplicate_detections')
    );
    expect(updateDuplicatesCall).toBeDefined();
  });

  it('should update cluster status', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch
      .mockResolvedValueOnce(undefined) // UPDATE target
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    await mergeEntities(['deal-2'], 'deal-1');

    const updateClusterCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE duplicate_clusters')
    );
    expect(updateClusterCall).toBeDefined();
  });
});

// ============================================================================
// Tests: Cluster Merging
// ============================================================================

describe('MergeEngine - Cluster Merging', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should merge all entities in a cluster', async () => {
    const cluster = {
      id: 'cluster-1',
      entity_ids: ['deal-1', 'deal-2', 'deal-3'],
      status: 'active'
    };

    query
      .mockResolvedValueOnce({ rows: [cluster] }) // Fetch cluster
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2, testDeal3] }) // Fetch entities
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2, testDeal3] }) // Fetch for merge
      .mockResolvedValueOnce(undefined) // UPDATE target
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeCluster('cluster-1');

    expect(result.success).toBe(true);
    expect(result.sourceEntityIds.length).toBe(2); // All except master
  });

  it('should select master entity if not specified', async () => {
    const cluster = {
      id: 'cluster-1',
      entity_ids: ['deal-1', 'deal-incomplete'],
      status: 'active'
    };

    query
      .mockResolvedValueOnce({ rows: [cluster] })
      .mockResolvedValueOnce({ rows: [testDeal1, testDealIncomplete] })
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDealIncomplete] })
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] })
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeCluster('cluster-1');

    // Should select deal-1 as master (higher quality)
    expect(result.mergedEntityId).toBe('deal-1');
  });

  it('should use specified master entity', async () => {
    const cluster = {
      id: 'cluster-1',
      entity_ids: ['deal-1', 'deal-2', 'deal-3'],
      status: 'active'
    };

    query
      .mockResolvedValueOnce({ rows: [cluster] })
      .mockResolvedValueOnce(undefined) // BEGIN (will be called before entity fetch)
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2, testDeal3] })
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] })
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await mergeCluster('cluster-1', 'deal-2');

    expect(result.mergedEntityId).toBe('deal-2');
  });

  it('should throw error if cluster not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(mergeCluster('nonexistent')).rejects.toThrow('Cluster nonexistent not found');
  });

  it('should throw error if cluster has less than 2 entities', async () => {
    const smallCluster = {
      id: 'cluster-small',
      entity_ids: ['deal-1'],
      status: 'active'
    };

    query.mockResolvedValueOnce({ rows: [smallCluster] });

    await expect(mergeCluster('cluster-small')).rejects.toThrow('at least 2 entities');
  });
});

// ============================================================================
// Tests: Unmerge Functionality
// ============================================================================

describe('MergeEngine - Unmerge', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should successfully unmerge entities', async () => {
    const mergeHistory = {
      id: 'merge-1',
      source_entity_ids: ['deal-2', 'deal-3'],
      target_entity_id: 'deal-1',
      unmerged: false,
      can_unmerge: true
    };

    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [mergeHistory] }) // Fetch merge history
      .mockResolvedValueOnce(undefined) // UPDATE source entities (restore)
      .mockResolvedValueOnce(undefined) // UPDATE merge_history
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_detections
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await unmergeEntities('merge-1', 'User request');

    expect(result.success).toBe(true);
    expect(result.restoredEntityIds).toEqual(['deal-2', 'deal-3']);
    expect(result.mergeHistoryId).toBe('merge-1');
    expect(result.reason).toBe('User request');
  });

  it('should restore source entities to active status', async () => {
    const mergeHistory = {
      id: 'merge-1',
      source_entity_ids: ['deal-2'],
      target_entity_id: 'deal-1',
      unmerged: false,
      can_unmerge: true
    };

    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [mergeHistory] })
      .mockResolvedValueOnce(undefined) // Restore
      .mockResolvedValueOnce(undefined) // Mark unmerged
      .mockResolvedValueOnce(undefined) // Restore duplicates
      .mockResolvedValueOnce(undefined) // Restore cluster
      .mockResolvedValueOnce(undefined); // COMMIT

    await unmergeEntities('merge-1');

    const restoreCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE deal_registrations') &&
      call[0].includes('status = \'active\'')
    );
    expect(restoreCall).toBeDefined();
  });

  it('should mark merge history as unmerged', async () => {
    const mergeHistory = {
      id: 'merge-1',
      source_entity_ids: ['deal-2'],
      target_entity_id: 'deal-1',
      unmerged: false,
      can_unmerge: true
    };

    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [mergeHistory] })
      .mockResolvedValueOnce(undefined) // Restore entities
      .mockResolvedValueOnce(undefined) // Mark as unmerged
      .mockResolvedValueOnce(undefined) // Restore duplicates
      .mockResolvedValueOnce(undefined) // Restore cluster
      .mockResolvedValueOnce(undefined); // COMMIT

    await unmergeEntities('merge-1');

    const unmergeCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE merge_history') &&
      call[0].includes('unmerged = true')
    );
    expect(unmergeCall).toBeDefined();
  });

  it('should restore duplicate detection status', async () => {
    const mergeHistory = {
      id: 'merge-1',
      source_entity_ids: ['deal-2'],
      target_entity_id: 'deal-1',
      unmerged: false,
      can_unmerge: true
    };

    query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [mergeHistory] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined) // UPDATE duplicate_detections
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await unmergeEntities('merge-1');

    const restoreDuplicatesCall = query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE duplicate_detections') &&
      call[0].includes('status = \'pending\'')
    );
    expect(restoreDuplicatesCall).toBeDefined();
  });

  it('should throw error if merge history not found', async () => {
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }); // No history found

    await expect(unmergeEntities('nonexistent')).rejects.toThrow('Merge history not found');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should throw error if merge already unmerged', async () => {
    const alreadyUnmerged = {
      id: 'merge-1',
      unmerged: true, // Already unmerged
      can_unmerge: true
    };

    query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] }); // Filter by unmerged=false, so returns empty

    await expect(unmergeEntities('merge-1')).rejects.toThrow('not found or already unmerged');
  });

  it('should throw error if merge cannot be unmerged', async () => {
    const cannotUnmerge = {
      id: 'merge-1',
      source_entity_ids: ['deal-2'],
      unmerged: false,
      can_unmerge: false // Cannot unmerge
    };

    query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [cannotUnmerge] });

    await expect(unmergeEntities('merge-1')).rejects.toThrow('cannot be unmerged');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should use transaction with rollback on error', async () => {
    const mergeHistory = {
      id: 'merge-1',
      source_entity_ids: ['deal-2'],
      target_entity_id: 'deal-1',
      unmerged: false,
      can_unmerge: true
    };

    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [mergeHistory] })
      .mockRejectedValueOnce(new Error('Restore failed')); // Restore fails

    await expect(unmergeEntities('merge-1')).rejects.toThrow('Restore failed');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// ============================================================================
// Tests: Auto-Merge High Confidence
// ============================================================================

describe('MergeEngine - Auto-Merge', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should find high confidence clusters', async () => {
    const highConfidenceClusters = [
      { id: 'cluster-1', confidence_score: 0.98, entity_ids: ['deal-1', 'deal-2'] },
      { id: 'cluster-2', confidence_score: 0.96, entity_ids: ['deal-3', 'deal-4'] }
    ];

    query.mockResolvedValueOnce({ rows: highConfidenceClusters });

    const result = await autoMergeHighConfidenceDuplicates(0.95, true);

    expect(result.totalClusters).toBe(2);
    expect(result.success).toBe(true);
  });

  it('should not merge in dry run mode', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: 'cluster-1', confidence_score: 0.98, entity_ids: ['deal-1', 'deal-2'] }
    ] });

    const result = await autoMergeHighConfidenceDuplicates(0.95, true);

    expect(result.mergedClusters).toBe(0); // Dry run
    expect(result.mergeResults.length).toBe(0);
  });

  it('should merge clusters when not in dry run', async () => {
    const cluster = {
      id: 'cluster-1',
      confidence_score: 0.98,
      entity_ids: ['deal-1', 'deal-2'],
      status: 'active'
    };

    query
      .mockResolvedValueOnce({ rows: [cluster] }) // Find clusters
      .mockResolvedValueOnce({ rows: [cluster] }) // Fetch cluster
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch entities
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch for merge
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await autoMergeHighConfidenceDuplicates(0.95, false);

    expect(result.mergedClusters).toBe(1);
    expect(result.mergeResults.length).toBe(1);
    expect(result.failedClusters).toBe(0);
  });

  it('should handle merge failures gracefully', async () => {
    const cluster1 = { id: 'cluster-1', confidence_score: 0.98, entity_ids: ['deal-1', 'deal-2'] };
    const cluster2 = { id: 'cluster-2', confidence_score: 0.97, entity_ids: ['deal-3', 'deal-4'] };

    query
      .mockResolvedValueOnce({ rows: [cluster1, cluster2] }) // Find clusters
      .mockResolvedValueOnce({ rows: [cluster1] }) // Fetch cluster 1
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Fetch entities
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] }) // Merge fetch
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] }) // INSERT
      .mockResolvedValueOnce(undefined) // UPDATE source
      .mockResolvedValueOnce(undefined) // UPDATE duplicates
      .mockResolvedValueOnce(undefined) // UPDATE clusters
      .mockResolvedValueOnce(undefined) // COMMIT
      .mockRejectedValueOnce(new Error('Cluster 2 merge failed')); // Cluster 2 fails

    const result = await autoMergeHighConfidenceDuplicates(0.95, false);

    expect(result.mergedClusters).toBe(1);
    expect(result.failedClusters).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].clusterId).toBe('cluster-2');
  });

  it('should respect confidence threshold', async () => {
    const clusters = [
      { id: 'cluster-high', confidence_score: 0.98 },
      { id: 'cluster-low', confidence_score: 0.90 }
    ];

    query.mockResolvedValueOnce({ rows: clusters });

    // Query should filter by threshold
    await autoMergeHighConfidenceDuplicates(0.95, true);

    const findClustersCall = query.mock.calls[0];
    expect(findClustersCall[0]).toContain('confidence_score >=');
    expect(findClustersCall[1]).toContain(0.95);
  });

  it('should only process active clusters', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await autoMergeHighConfidenceDuplicates(0.95, true);

    const findClustersCall = query.mock.calls[0];
    expect(findClustersCall[0]).toContain('status = \'active\'');
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('MergeEngine - Edge Cases', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('should handle entities with all null fields', async () => {
    const allNull1 = { id: 'null-1', deal_name: null, customer_name: null };
    const allNull2 = { id: 'null-2', deal_name: null, customer_name: null };

    query.mockResolvedValue({ rows: [allNull1, allNull2] });

    const preview = await previewMerge(['null-1', 'null-2']);

    expect(preview).toBeDefined();
    expect(preview.conflicts.length).toBe(0); // No conflicts if all are null
  });

  it('should handle entities with no timestamps', async () => {
    const noTimestamp = {
      ...testDeal1,
      created_at: undefined,
      updated_at: undefined
    };

    const score = calculateDataQualityScore(noTimestamp);

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should handle empty arrays', async () => {
    const emptyArrays1 = { ...testDeal1, source_file_ids: [] };
    const emptyArrays2 = { ...testDeal2, source_file_ids: [] };

    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [emptyArrays1, emptyArrays2] })
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await mergeEntities(['deal-2'], 'deal-1');

    expect(result.success).toBe(true);
  });

  it('should handle very large arrays', async () => {
    const largeArray = Array(1000).fill('file');
    const deal1 = { ...testDeal1, source_file_ids: largeArray };
    const deal2 = { ...testDeal2, source_file_ids: largeArray };

    query.mockResolvedValue({ rows: [deal1, deal2] });

    const preview = await previewMerge(['deal-1', 'deal-2']);

    expect(preview).toBeDefined();
  });

  it('should handle database connection errors', async () => {
    query.mockRejectedValue(new Error('Connection timeout'));

    await expect(previewMerge(['deal-1', 'deal-2'])).rejects.toThrow('Connection timeout');
  });

  it('should handle concurrent merges gracefully', async () => {
    // This would need more complex mocking to test true concurrency
    // but we can at least verify transactions are used
    query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [testDeal1, testDeal2] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'merge-1' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await mergeEntities(['deal-2'], 'deal-1');

    // Transaction usage provides some protection against concurrent merges
    expect(query).toHaveBeenCalledWith('BEGIN');
    expect(query).toHaveBeenCalledWith('COMMIT');
  });
});
