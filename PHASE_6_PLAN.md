# Phase 6: Advanced Duplicate Detection & Cross-Source Correlation

**Status**: 📋 **PLANNING**
**Date Started**: November 12, 2025
**Dependencies**: Phase 4 (AI Extraction & Validation) ✅, Phase 5 (Vendor Matching) ✅
**Estimated Duration**: 3-4 days

---

## Overview

Phase 6 builds on the AI extraction, validation, and vendor matching capabilities to implement intelligent duplicate detection and cross-source correlation. This phase will enable the system to identify and merge duplicate deals, vendors, and contacts across multiple data sources while maintaining complete audit trails.

---

## Phase 6 Objectives

### Primary Goals
1. **Advanced Duplicate Detection**: Identify duplicate deals using ML-based similarity
2. **Cross-Source Correlation**: Link entities across different files and data sources
3. **Merge Workflows**: Automated and manual merge capabilities with conflict resolution
4. **Data Quality Enhancement**: Improve accuracy through deduplication and consolidation
5. **Audit Trail**: Complete provenance tracking for merged entities

### Success Metrics
- **Duplicate Detection Accuracy**: >85% true positives, <10% false positives
- **Merge Confidence**: Clear scoring for automatic vs manual review
- **Data Quality**: Reduce duplicate count by >70%
- **Performance**: Duplicate detection <500ms per entity
- **User Experience**: Clear merge preview and conflict resolution UI

---

## Phase 6.1: Advanced Duplicate Detection Engine

### Objectives
- Implement multi-factor duplicate detection for deals, vendors, and contacts
- Support fuzzy matching with configurable thresholds
- Provide similarity scoring and confidence metrics
- Enable batch duplicate detection across large datasets

### Deliverables

#### 1. Duplicate Detection Service (`duplicateDetector.ts`)
**Estimated Lines**: 900+

**Core Functions**:
```typescript
// Deal duplicate detection with multi-factor analysis
export async function detectDuplicateDeals(
  deal: DealData,
  context?: {
    existingDeals?: DealData[];
    threshold?: number;
    strategies?: DuplicateStrategy[];
  }
): Promise<DuplicateDetectionResult>

// Batch duplicate detection
export async function detectDuplicatesInBatch(
  entities: EntityData[],
  entityType: 'deal' | 'vendor' | 'contact'
): Promise<Map<string, DuplicateMatch[]>>

// Cross-source duplicate detection
export async function findCrossSourceDuplicates(
  sourceFileIds: string[],
  entityType: 'deal' | 'vendor' | 'contact'
): Promise<DuplicateCluster[]>

// Similarity scoring
export function calculateSimilarityScore(
  entity1: EntityData,
  entity2: EntityData,
  weights?: FieldWeights
): SimilarityScore

// Duplicate clustering (group all duplicates together)
export async function clusterDuplicates(
  entities: EntityData[]
): Promise<DuplicateCluster[]>
```

**Detection Strategies for Deals**:
1. **Exact Match**: Same deal name, customer, value, close date
2. **Fuzzy Name Match**: Similar deal names (Levenshtein distance)
3. **Customer + Value Match**: Same customer with similar deal value (±10%)
4. **Customer + Date Match**: Same customer with similar close date (±7 days)
5. **Vendor + Customer Match**: Same vendor and customer combination
6. **Multi-Factor Weighted**: Combination of all factors with configurable weights

**Similarity Factors**:
```typescript
interface SimilarityFactors {
  dealName: number;        // 0.0-1.0
  customerName: number;    // 0.0-1.0
  vendorMatch: number;     // 0.0-1.0
  dealValue: number;       // 0.0-1.0
  closeDate: number;       // 0.0-1.0
  products: number;        // 0.0-1.0
  contacts: number;        // 0.0-1.0
  description: number;     // 0.0-1.0 (optional NLP)
}

interface FieldWeights {
  dealName: number;        // Default: 0.25
  customerName: number;    // Default: 0.25
  vendorMatch: number;     // Default: 0.15
  dealValue: number;       // Default: 0.15
  closeDate: number;       // Default: 0.10
  products: number;        // Default: 0.05
  contacts: number;        // Default: 0.05
  // Total: 1.00
}
```

**Confidence Thresholds**:
- **0.95-1.0**: Very High - Likely duplicate (auto-merge candidate)
- **0.85-0.94**: High - Probable duplicate (suggest merge)
- **0.70-0.84**: Medium - Possible duplicate (manual review)
- **0.50-0.69**: Low - Unlikely duplicate (flag for investigation)
- **<0.50**: No match

#### 2. Database Migration (`014_duplicate_detection.sql`)
**Estimated Lines**: 500+

**Tables Created**:

1. **`duplicate_detections`**: Detection results
   ```sql
   id, entity_type, entity_id_1, entity_id_2,
   similarity_score, confidence_level,
   detection_strategy, similarity_factors (JSONB),
   detected_at, detected_by, status (pending/confirmed/rejected),
   resolution_notes
   ```

2. **`duplicate_clusters`**: Groups of duplicate entities
   ```sql
   id, cluster_key, entity_type, entity_ids (array),
   master_entity_id, cluster_size, confidence_score,
   created_at, updated_at, status (active/merged/split)
   ```

3. **`merge_history`**: Audit trail of merges
   ```sql
   id, merge_type (manual/automatic), entity_type,
   source_entity_ids (array), target_entity_id,
   merged_data (JSONB), conflict_resolution (JSONB),
   merged_by, merged_at, can_unmerge (boolean)
   ```

4. **`field_conflicts`**: Track conflicting field values
   ```sql
   id, merge_history_id, field_name,
   source_values (JSONB), chosen_value, resolution_strategy,
   confidence, manual_override (boolean), notes
   ```

**Views Created**:
1. `high_confidence_duplicates`: Duplicates ready for auto-merge
2. `duplicate_clusters_summary`: Cluster statistics
3. `merge_statistics`: Merge activity metrics
4. `unresolved_duplicates`: Pending duplicate reviews

**Functions Created**:
```sql
-- Log duplicate detection
log_duplicate_detection(...)

-- Create or update duplicate cluster
manage_duplicate_cluster(...)

-- Get duplicate candidates for an entity
get_duplicate_candidates(entity_id UUID, threshold DECIMAL)

-- Get merge statistics
get_merge_statistics(days INTEGER)
```

#### 3. API Routes (`duplicateDetection.ts`)
**Estimated Lines**: 700+
**Endpoints**: 15+

**Detection Endpoints**:
```
POST   /api/duplicates/detect/deal
       Detect duplicates for a specific deal
       Body: { dealId, threshold?, strategies? }

POST   /api/duplicates/detect/batch
       Batch duplicate detection
       Body: { entityIds: string[], entityType, threshold? }

POST   /api/duplicates/detect/cross-source
       Detect duplicates across multiple files
       Body: { sourceFileIds: string[], entityType }

GET    /api/duplicates/candidates/:entityId
       Get duplicate candidates for an entity
       Query: ?threshold=0.7&limit=10
```

**Cluster Management Endpoints**:
```
GET    /api/duplicates/clusters
       List all duplicate clusters
       Query: ?entityType=deal&status=active&minSize=2

GET    /api/duplicates/clusters/:clusterId
       Get cluster details

POST   /api/duplicates/clusters/:clusterId/split
       Split a cluster (mark as non-duplicates)

DELETE /api/duplicates/clusters/:clusterId
       Delete a cluster
```

**Statistics Endpoints**:
```
GET    /api/duplicates/statistics
       Get duplicate detection statistics
       Query: ?days=30&entityType=deal

GET    /api/duplicates/high-confidence
       Get high-confidence duplicates
       Query: ?threshold=0.95&limit=50
```

---

## Phase 6.2: Intelligent Merge Engine

### Objectives
- Automated merging for high-confidence duplicates
- Manual merge workflow with conflict resolution
- Field-level merge strategies (newest, highest quality, manual selection)
- Complete audit trail for all merges
- Unmerge capability for error correction

### Deliverables

#### 1. Merge Service (`mergeEngine.ts`)
**Estimated Lines**: 800+

**Core Functions**:
```typescript
// Merge two entities
export async function mergeEntities(
  sourceEntityId: string,
  targetEntityId: string,
  options?: {
    mergeStrategy?: MergeStrategy;
    conflictResolution?: ConflictResolution;
    preserveSource?: boolean;
  }
): Promise<MergeResult>

// Merge cluster (multiple entities)
export async function mergeCluster(
  clusterId: string,
  masterEntityId?: string,
  options?: MergeOptions
): Promise<MergeResult>

// Preview merge (show conflicts without executing)
export async function previewMerge(
  entityIds: string[]
): Promise<MergePreview>

// Resolve field conflicts
export function resolveFieldConflicts(
  conflicts: FieldConflict[],
  strategy: ConflictResolutionStrategy
): ResolvedData

// Unmerge entities
export async function unmergeEntities(
  mergeHistoryId: string,
  reason?: string
): Promise<UnmergeResult>

// Batch auto-merge
export async function autoMergeHighConfidenceDuplicates(
  threshold: number = 0.95,
  dryRun?: boolean
): Promise<BatchMergeResult>
```

**Merge Strategies**:
```typescript
enum MergeStrategy {
  KEEP_NEWEST = 'newest',           // Keep most recent data
  KEEP_HIGHEST_QUALITY = 'quality', // Keep highest confidence/completeness
  KEEP_FIRST = 'first',             // Keep first encountered
  MANUAL = 'manual',                // User selects each field
  WEIGHTED = 'weighted'             // Weighted by confidence scores
}

enum ConflictResolutionStrategy {
  PREFER_SOURCE = 'source',         // Prefer source entity
  PREFER_TARGET = 'target',         // Prefer target entity
  PREFER_COMPLETE = 'complete',     // Prefer non-null values
  PREFER_VALIDATED = 'validated',   // Prefer validated data
  MERGE_ARRAYS = 'merge_arrays',    // Combine array values
  MANUAL = 'manual'                 // User decides
}
```

**Merge Preview**:
```typescript
interface MergePreview {
  conflicts: FieldConflict[];
  resolvedFields: Record<string, any>;
  sourceData: EntityData[];
  suggestedMaster: string;
  confidence: number;
  warnings: string[];
}

interface FieldConflict {
  fieldName: string;
  values: Array<{
    entityId: string;
    value: any;
    confidence?: number;
    source?: string;
    lastUpdated?: Date;
  }>;
  suggestedValue: any;
  suggestedReason: string;
  requiresManualReview: boolean;
}
```

**Data Quality Scoring**:
```typescript
function calculateDataQualityScore(entity: EntityData): number {
  const factors = {
    completeness: calculateCompleteness(entity),      // 40%
    aiConfidence: entity.aiConfidence || 0.5,        // 30%
    validationStatus: getValidationScore(entity),    // 20%
    recency: calculateRecencyScore(entity),          // 10%
  };

  return (
    factors.completeness * 0.4 +
    factors.aiConfidence * 0.3 +
    factors.validationStatus * 0.2 +
    factors.recency * 0.1
  );
}
```

#### 2. API Routes (`mergeManagement.ts`)
**Estimated Lines**: 600+
**Endpoints**: 12+

**Merge Endpoints**:
```
POST   /api/merge/preview
       Preview merge without executing
       Body: { entityIds: string[], mergeStrategy? }

POST   /api/merge/execute
       Execute merge
       Body: { entityIds, targetId?, strategy, conflictResolution }

POST   /api/merge/cluster/:clusterId
       Merge entire cluster
       Body: { masterId?, strategy }

POST   /api/merge/auto
       Auto-merge high confidence duplicates
       Body: { threshold: 0.95, entityType, dryRun: true }
```

**Unmerge Endpoints**:
```
POST   /api/merge/unmerge/:mergeHistoryId
       Unmerge previously merged entities
       Body: { reason }

GET    /api/merge/history/:entityId
       Get merge history for entity
```

**Conflict Resolution Endpoints**:
```
GET    /api/merge/conflicts/:mergeHistoryId
       Get unresolved conflicts for a merge

POST   /api/merge/conflicts/:conflictId/resolve
       Resolve a field conflict
       Body: { chosenValue, strategy, notes }
```

**Statistics Endpoints**:
```
GET    /api/merge/statistics
       Get merge statistics
       Query: ?days=30

GET    /api/merge/history
       List merge history
       Query: ?entityType=deal&limit=50
```

---

## Phase 6.3: Cross-Source Correlation

### Objectives
- Track entity sources across multiple files
- Link related entities from different sources
- Build entity relationship graphs
- Enable "single source of truth" with multi-source provenance

### Deliverables

#### 1. Correlation Service (`correlationEngine.ts`)
**Estimated Lines**: 600+

**Core Functions**:
```typescript
// Find related entities across sources
export async function findRelatedEntities(
  entityId: string,
  entityType: 'deal' | 'vendor' | 'contact'
): Promise<EntityRelationshipGraph>

// Build correlation map for a deal
export async function buildDealCorrelationMap(
  dealId: string
): Promise<CorrelationMap>

// Identify entity across sources
export async function reconcileEntityAcrossSources(
  entityKey: EntityKey,
  sourceFileIds: string[]
): Promise<ReconciledEntity>

// Track data lineage
export async function getDataLineage(
  entityId: string,
  fieldName?: string
): Promise<DataLineage>
```

**Entity Relationship Graph**:
```typescript
interface EntityRelationshipGraph {
  primaryEntity: Entity;
  relatedVendors: Vendor[];
  relatedContacts: Contact[];
  relatedDeals: Deal[];
  sourceFiles: SourceFile[];
  relationshipStrength: Map<string, number>;
}

interface CorrelationMap {
  dealId: string;
  sources: Array<{
    fileId: string;
    fileName: string;
    extractedAt: Date;
    confidence: number;
  }>;
  vendorCorrelations: VendorCorrelation[];
  contactCorrelations: ContactCorrelation[];
  fieldProvenance: Map<string, FieldProvenance[]>;
}
```

#### 2. Database Enhancements
**Migration**: Updates to existing tables

**Enhanced Tables**:
```sql
-- Add correlation tracking to deals
ALTER TABLE deal_registrations
  ADD COLUMN source_file_ids TEXT[],
  ADD COLUMN correlation_key VARCHAR(255),
  ADD COLUMN correlation_confidence DECIMAL(3,2),
  ADD COLUMN is_primary_record BOOLEAN DEFAULT true;

-- Similar for vendors and contacts
ALTER TABLE vendors
  ADD COLUMN source_file_ids TEXT[],
  ADD COLUMN correlation_key VARCHAR(255);

ALTER TABLE contacts
  ADD COLUMN source_file_ids TEXT[],
  ADD COLUMN correlation_key VARCHAR(255);
```

**New Views**:
```sql
-- Multi-source entities
CREATE VIEW multi_source_entities AS
  SELECT entity_type, entity_id, array_length(source_file_ids, 1) as source_count
  FROM (
    SELECT 'deal' as entity_type, id as entity_id, source_file_ids FROM deal_registrations
    UNION ALL
    SELECT 'vendor', id, source_file_ids FROM vendors
    UNION ALL
    SELECT 'contact', id, source_file_ids FROM contacts
  ) entities
  WHERE array_length(source_file_ids, 1) > 1;

-- Correlation statistics
CREATE VIEW correlation_statistics AS ...
```

#### 3. API Routes (added to existing routes)
**New Endpoints**: 8+

```
GET    /api/correlation/entity/:entityId
       Get complete correlation map

GET    /api/correlation/lineage/:entityId
       Get data lineage

GET    /api/correlation/multi-source
       List entities from multiple sources
       Query: ?entityType=deal&minSources=2

POST   /api/correlation/reconcile
       Reconcile entity across sources
       Body: { entityType, sourceFileIds, reconciliationKey }
```

---

## Phase 6.4: Data Quality Dashboard

### Objectives
- Visualize duplicate detection results
- Provide merge workflow interface
- Display data quality metrics
- Enable bulk duplicate management

### Deliverables

#### 1. Quality Metrics Service (`qualityMetrics.ts`)
**Estimated Lines**: 400+

**Core Functions**:
```typescript
// Calculate overall data quality score
export async function calculateDataQualityScore(): Promise<QualityScore>

// Get duplicate statistics
export async function getDuplicateStatistics(): Promise<DuplicateStats>

// Identify data quality issues
export async function identifyQualityIssues(): Promise<QualityIssue[]>

// Generate data quality report
export async function generateQualityReport(
  dateRange?: DateRange
): Promise<QualityReport>
```

**Quality Metrics**:
```typescript
interface QualityScore {
  overall: number;              // 0-100
  completeness: number;         // % of fields populated
  accuracy: number;             // Based on validation pass rate
  consistency: number;          // Duplicate rate
  timeliness: number;           // Data freshness
  uniqueness: number;           // 100% - duplicate percentage
}

interface DuplicateStats {
  totalEntities: number;
  duplicateCount: number;
  duplicatePercentage: number;
  clusterCount: number;
  averageClusterSize: number;
  highConfidenceDuplicates: number;
  pendingReviews: number;
}
```

#### 2. API Routes (`qualityMetrics.ts`)
**Estimated Lines**: 300+
**Endpoints**: 6+

```
GET    /api/quality/score
       Get overall quality score

GET    /api/quality/duplicates-summary
       Duplicate statistics

GET    /api/quality/issues
       List data quality issues
       Query: ?severity=high&limit=50

GET    /api/quality/report
       Generate quality report
       Query: ?startDate=2025-01-01&endDate=2025-11-12

GET    /api/quality/trends
       Quality metrics over time
       Query: ?days=30&metric=duplicates
```

---

## Integration with Existing System

### 1. File Processor Integration
Update `fileProcessor.ts`:
```typescript
// After extraction and validation
const duplicates = await detectDuplicateDeals(extractedDeal, {
  threshold: 0.85,
  existingDeals: await getDealsByCustomer(extractedDeal.customerName)
});

if (duplicates.length > 0 && duplicates[0].confidence >= 0.95) {
  // High confidence duplicate - suggest merge
  await logDuplicateDetection(extractedDeal.id, duplicates[0].matchId, duplicates[0]);
}
```

### 2. AI Extraction Integration
Enhance `aiExtraction.ts`:
```typescript
// Add duplicate detection to extraction pipeline
export async function extractAndValidateWithDuplicateCheck(...) {
  const extraction = await extractAndValidateEntities(...);

  // Check for duplicates
  for (const entity of extraction.entities) {
    if (entity.type === 'deal') {
      entity.duplicates = await detectDuplicateDeals(entity.data);
    }
  }

  return extraction;
}
```

### 3. Vendor Matching Integration
Use vendor matching for duplicate detection:
```typescript
// In duplicateDetector.ts
import { matchVendor } from './vendorMatcher';

async function detectDealDuplicates(deal: DealData) {
  // Use vendor matching for vendor normalization
  const vendorMatch = await matchVendor({
    extractedName: deal.vendorName
  });

  // Find deals with same matched vendor
  if (vendorMatch.matched) {
    // Search for duplicates with normalized vendor
  }
}
```

---

## Testing Strategy

### Unit Tests

#### 1. Duplicate Detection Tests (`duplicateDetector.test.ts`)
```typescript
describe('Duplicate Detection', () => {
  test('exact match detection', ...)
  test('fuzzy name matching', ...)
  test('customer + value matching', ...)
  test('multi-factor weighted scoring', ...)
  test('confidence threshold filtering', ...)
  test('batch duplicate detection', ...)
  test('cross-source detection', ...)
  test('clustering algorithm', ...)
})
```

#### 2. Merge Engine Tests (`mergeEngine.test.ts`)
```typescript
describe('Merge Engine', () => {
  test('merge preview generation', ...)
  test('conflict detection', ...)
  test('merge strategy: newest', ...)
  test('merge strategy: highest quality', ...)
  test('merge strategy: weighted', ...)
  test('field conflict resolution', ...)
  test('unmerge operation', ...)
  test('batch auto-merge', ...)
})
```

#### 3. Correlation Tests (`correlationEngine.test.ts`)
```typescript
describe('Cross-Source Correlation', () => {
  test('entity relationship graph building', ...)
  test('data lineage tracking', ...)
  test('multi-source reconciliation', ...)
  test('correlation key generation', ...)
})
```

### Integration Tests

#### 1. End-to-End Duplicate Detection
```typescript
test('upload file -> extract -> detect duplicates -> merge', async () => {
  // Upload file with duplicate data
  // Extract entities
  // Detect duplicates
  // Verify duplicate cluster created
  // Execute merge
  // Verify merged entity
})
```

#### 2. Cross-Source Workflow
```typescript
test('multiple files with overlapping entities', async () => {
  // Upload file 1 with deal
  // Upload file 2 with same deal (slight variations)
  // Verify cross-source correlation
  // Verify single master record with multi-source provenance
})
```

### Performance Tests

#### 1. Duplicate Detection Performance
```typescript
test('detect duplicates in 10,000 deals', async () => {
  // Should complete in <30 seconds
  // Should find all duplicates with >85% accuracy
})
```

#### 2. Merge Performance
```typescript
test('merge 100 entity clusters', async () => {
  // Should complete in <10 seconds
  // Should handle all conflicts correctly
})
```

---

## Code Statistics Estimate

### Total Lines of Code
- **Duplicate Detection Service**: ~900 lines
- **Merge Engine Service**: ~800 lines
- **Correlation Engine Service**: ~600 lines
- **Quality Metrics Service**: ~400 lines
- **API Routes**: ~1,600 lines (3 route files)
- **Database Migration**: ~500 lines
- **Total Production Code**: **~4,800 lines**

### Tests
- **Unit Tests**: ~1,200 lines
- **Integration Tests**: ~600 lines
- **Total Test Code**: **~1,800 lines**

### Documentation
- **Phase 6 Plan**: ~1,200 lines (this document)
- **API Documentation**: ~400 lines
- **Total Documentation**: **~1,600 lines**

### Grand Total: **~8,200 lines**

---

## Database Schema Changes

### New Tables: 4
1. `duplicate_detections`
2. `duplicate_clusters`
3. `merge_history`
4. `field_conflicts`

### Enhanced Tables: 3
1. `deal_registrations` (add correlation tracking)
2. `vendors` (add source tracking)
3. `contacts` (add source tracking)

### New Views: 7
1. `high_confidence_duplicates`
2. `duplicate_clusters_summary`
3. `merge_statistics`
4. `unresolved_duplicates`
5. `multi_source_entities`
6. `correlation_statistics`
7. `quality_metrics_summary`

### New Functions: 5
1. `log_duplicate_detection()`
2. `manage_duplicate_cluster()`
3. `get_duplicate_candidates()`
4. `get_merge_statistics()`
5. `calculate_quality_score()`

---

## API Endpoints Summary

### Total New Endpoints: ~41

**Duplicate Detection**: 15 endpoints
- Detection: 4
- Clusters: 4
- Statistics: 2
- High Confidence: 1
- Candidates: 1
- Batch: 2
- Cross-source: 1

**Merge Management**: 12 endpoints
- Merge: 4
- Unmerge: 2
- Conflicts: 2
- History: 2
- Statistics: 2

**Correlation**: 8 endpoints
- Entity correlation: 2
- Lineage: 2
- Multi-source: 2
- Reconciliation: 2

**Quality Metrics**: 6 endpoints
- Score: 1
- Duplicates: 1
- Issues: 1
- Report: 1
- Trends: 2

---

## Dependencies

### Required Packages
```json
{
  "dependencies": {
    "fuzzball": "^2.1.2",           // Already installed (Phase 5)
    "string-similarity": "^4.0.4",   // Already installed (Phase 5)
    "lodash": "^4.17.21",           // Utility functions
    "date-fns": "^2.30.0"           // Date comparison
  },
  "devDependencies": {
    "@types/lodash": "^4.14.200"
  }
}
```

All other dependencies already installed in previous phases.

---

## Configuration

### New Environment Variables
```env
# Duplicate Detection
DUPLICATE_DETECTION_THRESHOLD=0.85        # Default threshold
DUPLICATE_AUTO_MERGE_THRESHOLD=0.95      # Auto-merge threshold
DUPLICATE_BATCH_SIZE=100                 # Batch processing size

# Merge Settings
MERGE_PRESERVE_SOURCE=false              # Keep source entities after merge
MERGE_ALLOW_UNMERGE=true                 # Enable unmerge capability
MERGE_DEFAULT_STRATEGY=quality           # newest|quality|weighted

# Quality Metrics
QUALITY_REPORT_RETENTION_DAYS=90         # Keep reports for 90 days
```

---

## Implementation Timeline

### Day 1: Duplicate Detection Foundation
- ✅ Create Phase 6 plan
- ⏳ Implement `duplicateDetector.ts` core functions
- ⏳ Create migration `014_duplicate_detection.sql`
- ⏳ Implement similarity scoring algorithms
- ⏳ Write unit tests for duplicate detection

### Day 2: Merge Engine
- ⏳ Implement `mergeEngine.ts` core functions
- ⏳ Add merge preview functionality
- ⏳ Implement conflict resolution strategies
- ⏳ Add unmerge capability
- ⏳ Write unit tests for merge engine

### Day 3: Correlation & Quality
- ⏳ Implement `correlationEngine.ts`
- ⏳ Implement `qualityMetrics.ts`
- ⏳ Build API routes for all services
- ⏳ Integration testing
- ⏳ Performance optimization

### Day 4: Integration & Testing
- ⏳ Integrate with file processors
- ⏳ Add to AI extraction pipeline
- ⏳ End-to-end testing
- ⏳ Documentation updates
- ⏳ Prepare for production deployment

---

## Success Criteria

### Phase 6.1: Duplicate Detection ✅
- [ ] Detect duplicates with >85% accuracy
- [ ] False positive rate <10%
- [ ] Performance <500ms per entity
- [ ] Support batch processing
- [ ] All unit tests passing

### Phase 6.2: Merge Engine ✅
- [ ] Merge preview shows all conflicts
- [ ] Multiple merge strategies working
- [ ] Unmerge capability functional
- [ ] Complete audit trail
- [ ] All unit tests passing

### Phase 6.3: Cross-Source Correlation ✅
- [ ] Track entities across sources
- [ ] Build relationship graphs
- [ ] Data lineage complete
- [ ] Multi-source reconciliation working

### Phase 6.4: Quality Dashboard ✅
- [ ] Quality score calculation accurate
- [ ] Duplicate statistics real-time
- [ ] Quality report generation working
- [ ] API endpoints performant

---

## Risks & Mitigation

### Risk 1: Performance with Large Datasets
**Risk**: Duplicate detection may be slow with 10,000+ entities
**Mitigation**:
- Implement batch processing with pagination
- Use database indexing on correlation keys
- Cache similarity calculations
- Consider background job processing for large batches

### Risk 2: Merge Conflicts Too Complex
**Risk**: Too many conflicts requiring manual resolution
**Mitigation**:
- Implement smart default strategies
- Provide clear merge preview
- Enable field-by-field conflict resolution
- Allow saving partial merges

### Risk 3: False Positive Duplicates
**Risk**: System incorrectly identifies non-duplicates as duplicates
**Mitigation**:
- Configurable thresholds
- Require manual approval for auto-merge
- Easy unmerge capability
- Learn from user corrections

### Risk 4: Data Loss During Merge
**Risk**: Important data lost in merge process
**Mitigation**:
- Complete audit trail
- Preserve source entities (optional)
- Unmerge capability
- Merge preview before execution

---

## Post-Phase 6 Capabilities

### What Will Be Possible
1. **Intelligent Deduplication**: Automatic detection and merging of duplicates
2. **Multi-Source Truth**: Single records with complete provenance
3. **Data Quality Visibility**: Real-time quality metrics and reports
4. **Conflict Resolution**: Smart merge strategies with manual override
5. **Audit Trail**: Complete history of all merges and correlations
6. **Relationship Mapping**: Understand entity relationships across sources

### Integration Ready For
- **Phase 7**: Automated workflows and approvals
- **Phase 8**: Advanced analytics and reporting
- **Phase 9**: ML-based predictions and recommendations
- **Phase 10**: Production deployment and scaling

---

## Next Phase Preview: Phase 7

**Tentative Focus**: Automated Workflows & Approval Systems
- Deal registration approval workflows
- Automated vendor onboarding
- Notification system
- Email integration for status updates
- User role management
- Approval delegation

---

**Document Status**: ✅ Complete - Ready for Implementation
**Last Updated**: November 12, 2025
**Next Action**: Begin Phase 6.1 implementation

---
