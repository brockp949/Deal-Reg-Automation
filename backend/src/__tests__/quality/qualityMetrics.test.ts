import * as qualityMetrics from '../../services/qualityMetrics';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const { query } = require('../../db');

function queueQualityScoreQueries() {
  query
    .mockResolvedValueOnce({
      rows: [
        { deal_name: 'Deal A', customer_name: 'Acme', deal_value: 50000, vendor_id: 'vendor-1', close_date: '2024-12-15' },
        { deal_name: 'Deal B', customer_name: null, deal_value: null, vendor_id: null, close_date: null },
      ],
    })
    .mockResolvedValueOnce({
      rows: [{ total_validations: '10', passed_validations: '8', failed_validations: '2' }],
    })
    .mockResolvedValueOnce({
      rows: [{ rule_name: 'missing_email', error_count: '3' }],
    })
    .mockResolvedValueOnce({ rows: [{ total: '50' }] })
    .mockResolvedValueOnce({ rows: [{ cluster_count: '2', total_duplicates: '5', avg_cluster_size: '2.5' }] })
    .mockResolvedValueOnce({ rows: [{ inconsistent_count: '3' }] })
    .mockResolvedValueOnce({
      rows: [{
        avg_days_since_update: '4',
        stale_count: '5',
        recent_count: '15',
        total_count: '25',
      }],
    });
}

describe('Quality Metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateDataQualityScore', () => {
    it('computes weighted overall score from component metrics', async () => {
      queueQualityScoreQueries();

      const score = await qualityMetrics.calculateDataQualityScore('deal');

      expect(score.overall).toBeGreaterThan(0);
      expect(score.breakdown.completenessDetails.totalFields).toBeGreaterThan(0);
      expect(score.breakdown.accuracyDetails.validationPassRate).toBeCloseTo(80);
      expect(score.breakdown.consistencyDetails.duplicateCount).toBe(5);
      expect(score.breakdown.timelinessDetails.avgDaysSinceUpdate).toBe(4);
    });
  });

  describe('getDuplicateStatistics', () => {
    it('returns aggregate stats for clusters and detections', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ total: '40' }] })
        .mockResolvedValueOnce({
          rows: [{ cluster_count: '3', total_duplicates: '9', avg_cluster_size: '3' }],
        })
        .mockResolvedValueOnce({ rows: [{ high_conf_count: '4' }] })
        .mockResolvedValueOnce({ rows: [{ pending_count: '6' }] })
        .mockResolvedValueOnce({ rows: [{ resolved_count: '12' }] });

      const stats = await qualityMetrics.getDuplicateStatistics('deal');
      expect(stats.totalEntities).toBe(40);
      expect(stats.clusterCount).toBe(3);
      expect(stats.duplicatePercentage).toBeCloseTo(22.5);
      expect(stats.highConfidenceDuplicates).toBe(4);
      expect(stats.resolvedDuplicates).toBe(12);
    });
  });

  describe('identifyQualityIssues', () => {
    it('prioritizes issues from duplicates, missing fields, validations, stale data, and conflicts', async () => {
      query
        // High-confidence duplicates
        .mockResolvedValueOnce({
          rows: [{
            id: 'dup-1',
            entity_id_1: 'deal-1',
            entity_id_2: 'deal-2',
            confidence_level: 0.97,
            detected_at: new Date('2024-01-01'),
          }],
        })
        // Missing fields
        .mockResolvedValueOnce({ rows: [{ id: 'deal-3' }] })
        // Validation failures
        .mockResolvedValueOnce({
          rows: [{
            entity_id: 'deal-4',
            validation_failures: [{ rule: 'missing_contact', field: 'contacts', message: 'Required' }],
          }],
        })
        // Stale data
        .mockResolvedValueOnce({
          rows: [{ id: 'deal-5', updated_at: new Date('2023-01-01') }],
        })
        // Inconsistent data
        .mockResolvedValueOnce({
          rows: [{ target_entity_id: 'deal-6', conflict_count: 4 }],
        });

      const issues = await qualityMetrics.identifyQualityIssues('deal', 10);
      expect(issues.length).toBe(5);
      expect(issues[0].severity).toBe('critical');
      expect(issues.some(i => i.issueType === 'stale_data')).toBe(true);
    });
  });

  describe('generateQualityReport', () => {
    it('summarizes scores, issues, and recommendations', async () => {
      queueQualityScoreQueries();
      // identifyQualityIssues queries
      query
        .mockResolvedValueOnce({
          rows: [{
            id: 'dup-1',
            entity_id_1: 'deal-1',
            entity_id_2: 'deal-2',
            confidence_level: 0.97,
            detected_at: new Date('2024-01-01'),
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: 'deal-3' }] })
        .mockResolvedValueOnce({
          rows: [{
            entity_id: 'deal-4',
            validation_failures: [{ rule: 'missing_contact', field: 'contacts', message: 'Required' }],
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'deal-5', updated_at: new Date('2023-01-01') }],
        })
        .mockResolvedValueOnce({
          rows: [{ target_entity_id: 'deal-6', conflict_count: 4 }],
        });

      const report = await qualityMetrics.generateQualityReport(
        { startDate: '2024-01-01', endDate: '2024-01-31' },
        'deal'
      );

      expect(report.overallScore.overall).toBeGreaterThan(0);
      expect(report.issuesSummary.total).toBeGreaterThan(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('getQualityTrends', () => {
    it('returns current score as single trend data point', async () => {
      queueQualityScoreQueries();

      const trend = await qualityMetrics.getQualityTrends(30, 'deal');
      expect(trend.length).toBe(1);
      expect(trend[0].overallScore).toBeGreaterThan(0);
    });
  });
});
