import { query } from '../db';
import logger from '../utils/logger';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface QualityScore {
  overall: number;               // 0-100
  completeness: number;          // % of fields populated
  accuracy: number;              // Based on validation pass rate
  consistency: number;           // 100% - duplicate percentage
  timeliness: number;            // Data freshness
  uniqueness: number;            // 100% - duplicate percentage
  breakdown: {
    completenessDetails: CompletenessDetails;
    accuracyDetails: AccuracyDetails;
    consistencyDetails: ConsistencyDetails;
    timelinessDetails: TimelinessDetails;
  };
}

export interface CompletenessDetails {
  totalFields: number;
  populatedFields: number;
  missingCriticalFields: string[];
  missingOptionalFields: string[];
}

export interface AccuracyDetails {
  totalValidations: number;
  passedValidations: number;
  failedValidations: number;
  validationPassRate: number;
  commonErrors: Array<{ rule: string; count: number }>;
}

export interface ConsistencyDetails {
  totalEntities: number;
  duplicateCount: number;
  duplicatePercentage: number;
  inconsistentFieldCount: number;
}

export interface TimelinessDetails {
  avgDaysSinceUpdate: number;
  staleRecordsCount: number;
  staleRecordsPercentage: number;
  recentRecordsCount: number;
}

export interface DuplicateStats {
  totalEntities: number;
  duplicateCount: number;
  duplicatePercentage: number;
  clusterCount: number;
  averageClusterSize: number;
  highConfidenceDuplicates: number;
  pendingReviews: number;
  resolvedDuplicates: number;
}

export interface QualityIssue {
  id: string;
  issueType: 'duplicate' | 'missing_field' | 'validation_failure' | 'stale_data' | 'inconsistent_data';
  severity: 'critical' | 'high' | 'medium' | 'low';
  entityId: string;
  entityType: 'deal' | 'vendor' | 'contact';
  description: string;
  affectedField?: string;
  suggestedFix?: string;
  detectedAt: Date;
  priority: number;
}

export interface QualityReport {
  generatedAt: Date;
  period: { startDate: Date; endDate: Date };
  overallScore: QualityScore;
  issuesSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  topIssues: QualityIssue[];
  trends: {
    scoreTrend: Array<{ date: Date; score: number }>;
    issuesTrend: Array<{ date: Date; count: number }>;
  };
  recommendations: string[];
}

export interface QualityTrend {
  date: Date;
  overallScore: number;
  completeness: number;
  accuracy: number;
  consistency: number;
  timeliness: number;
  uniqueness: number;
}

// ============================================================================
// Quality Score Calculations
// ============================================================================

/**
 * Calculate completeness score
 */
async function calculateCompleteness(entityType: 'deal' | 'vendor' | 'contact' = 'deal'): Promise<CompletenessDetails> {
  try {
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;

    // Get sample of entities to analyze
    const result = await query(`SELECT * FROM ${tableName} LIMIT 100`);
    const entities = result.rows;

    if (entities.length === 0) {
      return {
        totalFields: 0,
        populatedFields: 0,
        missingCriticalFields: [],
        missingOptionalFields: []
      };
    }

    // Define critical and optional fields
    const criticalFields = entityType === 'deal'
      ? ['deal_name', 'customer_name', 'deal_value', 'vendor_id']
      : entityType === 'vendor'
      ? ['vendor_name', 'email_domains']
      : ['name', 'email'];

    const optionalFields = entityType === 'deal'
      ? ['close_date', 'products', 'description', 'status']
      : entityType === 'vendor'
      ? ['products', 'tier', 'notes']
      : ['phone', 'role', 'company'];

    // Calculate field population
    let totalFieldCount = 0;
    let populatedFieldCount = 0;
    const missingCriticalFields = new Set<string>();
    const missingOptionalFields = new Set<string>();

    entities.forEach(entity => {
      [...criticalFields, ...optionalFields].forEach(field => {
        totalFieldCount++;
        const value = entity[field] || entity[field.replace(/_/g, '')]; // Try snake_case and camelCase

        if (value !== null && value !== undefined && value !== '') {
          populatedFieldCount++;
        } else {
          if (criticalFields.includes(field)) {
            missingCriticalFields.add(field);
          } else {
            missingOptionalFields.add(field);
          }
        }
      });
    });

    return {
      totalFields: totalFieldCount,
      populatedFields: populatedFieldCount,
      missingCriticalFields: Array.from(missingCriticalFields),
      missingOptionalFields: Array.from(missingOptionalFields)
    };

  } catch (error: any) {
    logger.error('Failed to calculate completeness', { error: error.message });
    throw error;
  }
}

/**
 * Calculate accuracy score based on validation results
 */
async function calculateAccuracy(entityType: 'deal' | 'vendor' | 'contact' = 'deal'): Promise<AccuracyDetails> {
  try {
    // Get validation statistics
    const result = await query(
      `SELECT
        COUNT(*) as total_validations,
        COUNT(*) FILTER (WHERE validation_status = 'passed') as passed_validations,
        COUNT(*) FILTER (WHERE validation_status = 'failed') as failed_validations
      FROM extracted_entities
      WHERE entity_type = $1`,
      [entityType]
    );

    const stats = result.rows[0];
    const totalValidations = parseInt(stats.total_validations) || 0;
    const passedValidations = parseInt(stats.passed_validations) || 0;
    const failedValidations = parseInt(stats.failed_validations) || 0;

    // Get common validation errors from JSONB validation_failures column
    const errorsResult = await query(
      `SELECT
         jsonb_array_elements(validation_failures)->>'rule' as rule_name,
         COUNT(*) as error_count
       FROM extracted_entities
       WHERE entity_type = $1
         AND validation_status = 'failed'
         AND jsonb_array_length(validation_failures) > 0
       GROUP BY jsonb_array_elements(validation_failures)->>'rule'
       ORDER BY error_count DESC
       LIMIT 10`,
      [entityType]
    );

    const commonErrors = errorsResult.rows.map(row => ({
      rule: row.rule_name || 'unknown',
      count: parseInt(row.error_count)
    }));

    const validationPassRate = totalValidations > 0
      ? (passedValidations / totalValidations) * 100
      : 100;

    return {
      totalValidations,
      passedValidations,
      failedValidations,
      validationPassRate,
      commonErrors
    };

  } catch (error: any) {
    logger.error('Failed to calculate accuracy', { error: error.message });
    throw error;
  }
}

/**
 * Calculate consistency score (inverse of duplicate rate)
 */
async function calculateConsistency(entityType: 'deal' | 'vendor' | 'contact' = 'deal'): Promise<ConsistencyDetails> {
  try {
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;

    // Get total entities
    const totalResult = await query(
      `SELECT COUNT(*) as total FROM ${tableName} WHERE status != 'rejected'`
    );
    const totalEntities = parseInt(totalResult.rows[0].total) || 0;

    // Get duplicate count from clusters
    const duplicatesResult = await query(
      `SELECT
        COUNT(*) as cluster_count,
        SUM(cluster_size) as total_duplicates
      FROM duplicate_clusters
      WHERE entity_type = $1 AND status = 'active'`,
      [entityType]
    );

    const clusterCount = parseInt(duplicatesResult.rows[0].cluster_count) || 0;
    const totalDuplicates = parseInt(duplicatesResult.rows[0].total_duplicates) || 0;

    // Count entities with inconsistent fields (from merge conflicts)
    const inconsistentResult = await query(
      `SELECT COUNT(DISTINCT mh.target_entity_id) as inconsistent_count
       FROM field_conflicts fc
       JOIN merge_history mh ON fc.merge_history_id = mh.id
       WHERE mh.entity_type = $1 AND fc.manual_override = false`,
      [entityType]
    );

    const inconsistentFieldCount = parseInt(inconsistentResult.rows[0].inconsistent_count) || 0;

    const duplicatePercentage = totalEntities > 0
      ? (totalDuplicates / totalEntities) * 100
      : 0;

    return {
      totalEntities,
      duplicateCount: totalDuplicates,
      duplicatePercentage,
      inconsistentFieldCount
    };

  } catch (error: any) {
    logger.error('Failed to calculate consistency', { error: error.message });
    throw error;
  }
}

/**
 * Calculate timeliness score (data freshness)
 */
async function calculateTimeliness(entityType: 'deal' | 'vendor' | 'contact' = 'deal'): Promise<TimelinessDetails> {
  try {
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;

    // Get update statistics
    const result = await query(
      `SELECT
        AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - updated_at)) / 86400) as avg_days_since_update,
        COUNT(*) FILTER (WHERE updated_at < CURRENT_TIMESTAMP - INTERVAL '30 days') as stale_count,
        COUNT(*) FILTER (WHERE updated_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') as recent_count,
        COUNT(*) as total_count
      FROM ${tableName}
      WHERE status != 'rejected'`
    );

    const stats = result.rows[0];
    const avgDaysSinceUpdate = parseFloat(stats.avg_days_since_update) || 0;
    const staleRecordsCount = parseInt(stats.stale_count) || 0;
    const recentRecordsCount = parseInt(stats.recent_count) || 0;
    const totalCount = parseInt(stats.total_count) || 0;

    const staleRecordsPercentage = totalCount > 0
      ? (staleRecordsCount / totalCount) * 100
      : 0;

    return {
      avgDaysSinceUpdate,
      staleRecordsCount,
      staleRecordsPercentage,
      recentRecordsCount
    };

  } catch (error: any) {
    logger.error('Failed to calculate timeliness', { error: error.message });
    throw error;
  }
}

/**
 * Calculate overall data quality score
 */
export async function calculateDataQualityScore(
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<QualityScore> {
  try {
    // Calculate individual components
    const completenessDetails = await calculateCompleteness(entityType);
    const accuracyDetails = await calculateAccuracy(entityType);
    const consistencyDetails = await calculateConsistency(entityType);
    const timelinessDetails = await calculateTimeliness(entityType);

    // Calculate scores (0-100)
    const completeness = completenessDetails.totalFields > 0
      ? (completenessDetails.populatedFields / completenessDetails.totalFields) * 100
      : 100;

    const accuracy = accuracyDetails.validationPassRate;

    const consistency = 100 - consistencyDetails.duplicatePercentage;

    const timeliness = Math.max(0, 100 - (timelinessDetails.avgDaysSinceUpdate * 2)); // Decreases 2% per day

    const uniqueness = consistency; // Same as consistency for now

    // Calculate weighted overall score
    const overall = (
      completeness * 0.25 +
      accuracy * 0.30 +
      consistency * 0.25 +
      timeliness * 0.15 +
      uniqueness * 0.05
    );

    logger.info('Data quality score calculated', {
      entityType,
      overall: overall.toFixed(2),
      completeness: completeness.toFixed(2),
      accuracy: accuracy.toFixed(2),
      consistency: consistency.toFixed(2)
    });

    return {
      overall: parseFloat(overall.toFixed(2)),
      completeness: parseFloat(completeness.toFixed(2)),
      accuracy: parseFloat(accuracy.toFixed(2)),
      consistency: parseFloat(consistency.toFixed(2)),
      timeliness: parseFloat(timeliness.toFixed(2)),
      uniqueness: parseFloat(uniqueness.toFixed(2)),
      breakdown: {
        completenessDetails,
        accuracyDetails,
        consistencyDetails,
        timelinessDetails
      }
    };

  } catch (error: any) {
    logger.error('Failed to calculate quality score', { error: error.message });
    throw error;
  }
}

/**
 * Get duplicate statistics
 */
export async function getDuplicateStatistics(
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<DuplicateStats> {
  try {
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;

    // Get total entities
    const totalResult = await query(
      `SELECT COUNT(*) as total FROM ${tableName} WHERE status != 'rejected'`
    );
    const totalEntities = parseInt(totalResult.rows[0].total) || 0;

    // Get cluster statistics
    const clusterResult = await query(
      `SELECT
        COUNT(*) as cluster_count,
        SUM(cluster_size) as total_duplicates,
        AVG(cluster_size) as avg_cluster_size
      FROM duplicate_clusters
      WHERE entity_type = $1 AND status = 'active'`,
      [entityType]
    );

    const clusterStats = clusterResult.rows[0];
    const clusterCount = parseInt(clusterStats.cluster_count) || 0;
    const duplicateCount = parseInt(clusterStats.total_duplicates) || 0;
    const averageClusterSize = parseFloat(clusterStats.avg_cluster_size) || 0;

    // Get high confidence duplicates
    const highConfResult = await query(
      `SELECT COUNT(*) as high_conf_count
       FROM duplicate_detections
       WHERE entity_type = $1 AND status = 'pending' AND confidence_level >= 0.95`,
      [entityType]
    );
    const highConfidenceDuplicates = parseInt(highConfResult.rows[0].high_conf_count) || 0;

    // Get pending reviews
    const pendingResult = await query(
      `SELECT COUNT(*) as pending_count
       FROM duplicate_detections
       WHERE entity_type = $1 AND status = 'pending'`,
      [entityType]
    );
    const pendingReviews = parseInt(pendingResult.rows[0].pending_count) || 0;

    // Get resolved duplicates
    const resolvedResult = await query(
      `SELECT COUNT(*) as resolved_count
       FROM duplicate_detections
       WHERE entity_type = $1 AND status IN ('confirmed', 'auto_merged', 'rejected')`,
      [entityType]
    );
    const resolvedDuplicates = parseInt(resolvedResult.rows[0].resolved_count) || 0;

    const duplicatePercentage = totalEntities > 0
      ? (duplicateCount / totalEntities) * 100
      : 0;

    return {
      totalEntities,
      duplicateCount,
      duplicatePercentage: parseFloat(duplicatePercentage.toFixed(2)),
      clusterCount,
      averageClusterSize: parseFloat(averageClusterSize.toFixed(2)),
      highConfidenceDuplicates,
      pendingReviews,
      resolvedDuplicates
    };

  } catch (error: any) {
    logger.error('Failed to get duplicate statistics', { error: error.message });
    throw error;
  }
}

/**
 * Identify data quality issues
 */
export async function identifyQualityIssues(
  entityType: 'deal' | 'vendor' | 'contact' = 'deal',
  limit: number = 50
): Promise<QualityIssue[]> {
  try {
    const issues: QualityIssue[] = [];
    const tableName = entityType === 'deal' ? 'deal_registrations' : `${entityType}s`;

    // 1. High confidence duplicates (CRITICAL)
    const duplicatesResult = await query(
      `SELECT dd.*, d.deal_name, d.customer_name
       FROM duplicate_detections dd
       JOIN ${tableName} d ON dd.entity_id_1 = d.id
       WHERE dd.entity_type = $1
         AND dd.status = 'pending'
         AND dd.confidence_level >= 0.95
       LIMIT $2`,
      [entityType, Math.floor(limit / 5)]
    );

    duplicatesResult.rows.forEach(row => {
      issues.push({
        id: row.id,
        issueType: 'duplicate',
        severity: 'critical',
        entityId: row.entity_id_1,
        entityType,
        description: `High confidence duplicate detected (${(row.confidence_level * 100).toFixed(0)}%)`,
        suggestedFix: `Review and merge with entity ${row.entity_id_2}`,
        detectedAt: row.detected_at,
        priority: 1
      });
    });

    // 2. Missing critical fields (HIGH)
    const missingFieldsResult = await query(
      `SELECT id, deal_name
       FROM ${tableName}
       WHERE status != 'rejected'
         AND (${entityType === 'deal' ? 'deal_value IS NULL OR vendor_id IS NULL' : 'vendor_name IS NULL'})
       LIMIT $1`,
      [Math.floor(limit / 5)]
    );

    missingFieldsResult.rows.forEach(row => {
      issues.push({
        id: row.id,
        issueType: 'missing_field',
        severity: 'high',
        entityId: row.id,
        entityType,
        description: 'Missing critical field(s)',
        affectedField: entityType === 'deal' ? 'deal_value or vendor_id' : 'vendor_name',
        suggestedFix: 'Review and complete missing data',
        detectedAt: new Date(),
        priority: 2
      });
    });

    // 3. Validation failures (MEDIUM)
    const validationResult = await query(
      `SELECT DISTINCT
         id as entity_id,
         raw_text as raw_value,
         validation_failures
       FROM extracted_entities
       WHERE entity_type = $1
         AND validation_status = 'failed'
         AND jsonb_array_length(validation_failures) > 0
       LIMIT $2`,
      [entityType, Math.floor(limit / 5)]
    );

    validationResult.rows.forEach(row => {
      // Parse validation failures from JSONB
      const failures = row.validation_failures || [];
      failures.forEach((failure: any) => {
        issues.push({
          id: row.entity_id,
          issueType: 'validation_failure',
          severity: 'medium',
          entityId: row.entity_id,
          entityType,
          description: `Validation rule failed: ${failure.rule || 'unknown'}`,
          affectedField: failure.field || failure.rule || 'unknown',
          suggestedFix: failure.message || 'Review validation rules',
          detectedAt: new Date(),
          priority: 3
        });
      });
    });

    // 4. Stale data (LOW)
    const staleResult = await query(
      `SELECT id, deal_name, updated_at
       FROM ${tableName}
       WHERE status != 'rejected'
         AND updated_at < CURRENT_TIMESTAMP - INTERVAL '60 days'
       LIMIT $1`,
      [Math.floor(limit / 5)]
    );

    staleResult.rows.forEach(row => {
      const daysSinceUpdate = Math.floor(
        (Date.now() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      issues.push({
        id: row.id,
        issueType: 'stale_data',
        severity: 'low',
        entityId: row.id,
        entityType,
        description: `Data not updated for ${daysSinceUpdate} days`,
        suggestedFix: 'Review and update if necessary',
        detectedAt: new Date(),
        priority: 4
      });
    });

    // 5. Inconsistent data (MEDIUM)
    const inconsistentResult = await query(
      `SELECT DISTINCT mh.target_entity_id, COUNT(*) as conflict_count
       FROM merge_history mh
       JOIN field_conflicts fc ON mh.id = fc.merge_history_id
       WHERE mh.entity_type = $1
         AND fc.manual_override = false
       GROUP BY mh.target_entity_id
       HAVING COUNT(*) > 2
       LIMIT $2`,
      [entityType, Math.floor(limit / 5)]
    );

    inconsistentResult.rows.forEach(row => {
      issues.push({
        id: row.target_entity_id,
        issueType: 'inconsistent_data',
        severity: 'medium',
        entityId: row.target_entity_id,
        entityType,
        description: `${row.conflict_count} unresolved field conflicts`,
        suggestedFix: 'Review and resolve field conflicts',
        detectedAt: new Date(),
        priority: 3
      });
    });

    // Sort by priority and limit
    issues.sort((a, b) => a.priority - b.priority);

    logger.info('Quality issues identified', {
      entityType,
      totalIssues: issues.length,
      critical: issues.filter(i => i.severity === 'critical').length,
      high: issues.filter(i => i.severity === 'high').length
    });

    return issues.slice(0, limit);

  } catch (error: any) {
    logger.error('Failed to identify quality issues', { error: error.message });
    throw error;
  }
}

/**
 * Generate comprehensive quality report
 */
export async function generateQualityReport(
  dateRange?: { startDate?: string; endDate?: string },
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<QualityReport> {
  try {
    const startDate = dateRange?.startDate ? new Date(dateRange.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate ? new Date(dateRange.endDate) : new Date();

    // Calculate overall score
    const overallScore = await calculateDataQualityScore(entityType);

    // Get quality issues
    const allIssues = await identifyQualityIssues(entityType, 100);
    const issuesSummary = {
      critical: allIssues.filter(i => i.severity === 'critical').length,
      high: allIssues.filter(i => i.severity === 'high').length,
      medium: allIssues.filter(i => i.severity === 'medium').length,
      low: allIssues.filter(i => i.severity === 'low').length,
      total: allIssues.length
    };

    // Get top issues (first 10)
    const topIssues = allIssues.slice(0, 10);

    // Generate recommendations
    const recommendations: string[] = [];

    if (overallScore.completeness < 80) {
      recommendations.push('Improve data completeness by filling in missing critical fields');
    }
    if (overallScore.accuracy < 80) {
      recommendations.push('Address validation failures to improve data accuracy');
    }
    if (overallScore.consistency < 90) {
      recommendations.push('Resolve duplicate entities to improve consistency');
    }
    if (overallScore.timeliness < 70) {
      recommendations.push('Update stale records (30+ days old) to maintain freshness');
    }
    if (issuesSummary.critical > 0) {
      recommendations.push(`Address ${issuesSummary.critical} critical issues immediately`);
    }
    if (issuesSummary.high > 5) {
      recommendations.push(`Review and resolve high-priority issues (${issuesSummary.high} found)`);
    }

    logger.info('Quality report generated', {
      entityType,
      overallScore: overallScore.overall,
      totalIssues: issuesSummary.total,
      period: { startDate, endDate }
    });

    return {
      generatedAt: new Date(),
      period: { startDate, endDate },
      overallScore,
      issuesSummary,
      topIssues,
      trends: {
        scoreTrend: [], // Would need historical data
        issuesTrend: []  // Would need historical data
      },
      recommendations
    };

  } catch (error: any) {
    logger.error('Failed to generate quality report', { error: error.message });
    throw error;
  }
}

/**
 * Get quality trends over time
 */
export async function getQualityTrends(
  days: number = 30,
  entityType: 'deal' | 'vendor' | 'contact' = 'deal'
): Promise<QualityTrend[]> {
  try {
    // This would require historical snapshots - placeholder for now
    // In production, you'd store daily snapshots in a quality_metrics_history table

    const currentScore = await calculateDataQualityScore(entityType);

    // Return single data point (current)
    return [{
      date: new Date(),
      overallScore: currentScore.overall,
      completeness: currentScore.completeness,
      accuracy: currentScore.accuracy,
      consistency: currentScore.consistency,
      timeliness: currentScore.timeliness,
      uniqueness: currentScore.uniqueness
    }];

  } catch (error: any) {
    logger.error('Failed to get quality trends', { error: error.message });
    throw error;
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  calculateDataQualityScore,
  getDuplicateStatistics,
  identifyQualityIssues,
  generateQualityReport,
  getQualityTrends
};
