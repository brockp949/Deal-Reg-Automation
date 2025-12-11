# Phase 6 Testing Guide

## Overview

This guide provides comprehensive testing procedures for Phase 6 features including:
- Duplicate Detection Engine
- Intelligent Merge Engine
- Correlation Engine
- Quality Metrics Dashboard

## Prerequisites

### Database Setup

1. **Run migrations**:
```bash
cd backend
npm run db:migrate
```

This will apply migration `014_duplicate_detection.sql` which creates:
- 4 tables: `duplicate_detections`, `duplicate_clusters`, `merge_history`, `field_conflicts`
- 7 views for statistics and reporting
- 5 database functions for duplicate management

2. **Verify migration**:
```bash
psql $DATABASE_URL -c "\dt duplicate_*"
psql $DATABASE_URL -c "\dv *duplicate*"
```

### Backend Server

```bash
cd backend
npm run dev
# Server runs on http://localhost:4000
```

### Sample Data

You'll need existing deals in the database. If starting fresh, upload some test files first:
```bash
curl -X POST http://localhost:4000/api/files/upload \
  -F "file=@test-deals.csv" \
  -H "Authorization: Bearer $TOKEN"
```

## API Testing

### 1. Duplicate Detection Endpoints (15 endpoints)

#### 1.1 Detect Duplicates for Single Deal

**Endpoint**: `POST /api/duplicates/detect/deal`

**Test Case 1: Basic duplicate detection**
```bash
curl -X POST http://localhost:4000/api/duplicates/detect/deal \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "deal": {
      "deal_name": "Enterprise License - Acme Corp",
      "customer_name": "Acme Corporation",
      "deal_value": 50000,
      "currency": "USD",
      "expected_close_date": "2024-03-15"
    },
    "options": {
      "threshold": 0.85,
      "strategies": ["exact", "fuzzy", "customer_value"]
    }
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "isDuplicate": true,
    "matches": [
      {
        "entityId": "uuid-of-matching-deal",
        "similarityScore": 0.92,
        "strategy": "fuzzy",
        "factors": {
          "dealName": 0.95,
          "customer": 0.98,
          "value": 1.0
        },
        "confidence": 0.94
      }
    ],
    "suggestedAction": "manual_review",
    "confidence": 0.92
  }
}
```

**Test Case 2: No duplicates found**
```bash
curl -X POST http://localhost:4000/api/duplicates/detect/deal \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "deal": {
      "deal_name": "Completely Unique Deal XYZ123",
      "customer_name": "Unique Customer Inc",
      "deal_value": 99999,
      "currency": "USD"
    }
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "isDuplicate": false,
    "matches": [],
    "suggestedAction": "no_action",
    "confidence": 0.0
  }
}
```

#### 1.2 Batch Duplicate Detection

**Endpoint**: `POST /api/duplicates/detect/batch`

```bash
curl -X POST http://localhost:4000/api/duplicates/detect/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "entities": [
      {
        "id": "temp-1",
        "deal_name": "Deal A",
        "customer_name": "Customer 1",
        "deal_value": 10000
      },
      {
        "id": "temp-2",
        "deal_name": "Deal B",
        "customer_name": "Customer 2",
        "deal_value": 20000
      }
    ],
    "options": {
      "threshold": 0.8
    }
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "results": {
      "temp-1": {
        "isDuplicate": false,
        "matches": [],
        "suggestedAction": "no_action"
      },
      "temp-2": {
        "isDuplicate": true,
        "matches": [
          {
            "entityId": "existing-deal-uuid",
            "similarityScore": 0.89
          }
        ],
        "suggestedAction": "manual_review"
      }
    },
    "summary": {
      "total": 2,
      "duplicates": 1,
      "unique": 1
    }
  }
}
```

#### 1.3 Cross-Source Duplicate Detection

**Endpoint**: `POST /api/duplicates/detect/cross-source`

```bash
curl -X POST http://localhost:4000/api/duplicates/detect/cross-source \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sourceFileIds": [
      "file-uuid-1",
      "file-uuid-2",
      "file-uuid-3"
    ],
    "entityType": "deal",
    "threshold": 0.85
  }'
```

#### 1.4 Get Duplicate Candidates

**Endpoint**: `GET /api/duplicates/candidates/:entityId`

```bash
curl http://localhost:4000/api/duplicates/candidates/deal-uuid-123 \
  -H "Authorization: Bearer $TOKEN"
```

#### 1.5 Create Duplicate Cluster

**Endpoint**: `POST /api/duplicates/clusters/create`

```bash
curl -X POST http://localhost:4000/api/duplicates/clusters/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "entityIds": [
      "deal-uuid-1",
      "deal-uuid-2",
      "deal-uuid-3"
    ],
    "entityType": "deal",
    "masterEntityId": "deal-uuid-1"
  }'
```

#### 1.6 Get All Clusters

**Endpoint**: `GET /api/duplicates/clusters`

```bash
# Get all clusters
curl "http://localhost:4000/api/duplicates/clusters" \
  -H "Authorization: Bearer $TOKEN"

# Filter by entity type
curl "http://localhost:4000/api/duplicates/clusters?entityType=deal" \
  -H "Authorization: Bearer $TOKEN"

# Filter by minimum confidence
curl "http://localhost:4000/api/duplicates/clusters?minConfidence=0.9" \
  -H "Authorization: Bearer $TOKEN"

# Pagination
curl "http://localhost:4000/api/duplicates/clusters?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

#### 1.7 Get Cluster Details

**Endpoint**: `GET /api/duplicates/clusters/:clusterId`

```bash
curl http://localhost:4000/api/duplicates/clusters/cluster-uuid-123 \
  -H "Authorization: Bearer $TOKEN"
```

#### 1.8 Split Cluster

**Endpoint**: `POST /api/duplicates/clusters/:clusterId/split`

```bash
curl -X POST http://localhost:4000/api/duplicates/clusters/cluster-uuid-123/split \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "removeEntityIds": ["deal-uuid-2", "deal-uuid-3"]
  }'
```

#### 1.9 Delete Cluster

**Endpoint**: `DELETE /api/duplicates/clusters/:clusterId`

```bash
curl -X DELETE http://localhost:4000/api/duplicates/clusters/cluster-uuid-123 \
  -H "Authorization: Bearer $TOKEN"
```

#### 1.10 Get Duplicate Statistics

**Endpoint**: `GET /api/duplicates/statistics`

```bash
curl "http://localhost:4000/api/duplicates/statistics?entityType=deal&days=30" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "totalDetections": 150,
    "highConfidence": 45,
    "mediumConfidence": 70,
    "lowConfidence": 35,
    "totalClusters": 25,
    "resolvedDuplicates": 30,
    "pendingReview": 20,
    "byStrategy": {
      "exact": 10,
      "fuzzy": 80,
      "customer_value": 35,
      "customer_date": 15,
      "vendor_customer": 5,
      "multi_factor": 5
    }
  }
}
```

#### 1.11 Get High Confidence Duplicates

**Endpoint**: `GET /api/duplicates/high-confidence`

```bash
curl "http://localhost:4000/api/duplicates/high-confidence?threshold=0.9&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

#### 1.12 Calculate Similarity Score

**Endpoint**: `POST /api/duplicates/similarity`

```bash
curl -X POST http://localhost:4000/api/duplicates/similarity \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "entity1Id": "deal-uuid-1",
    "entity2Id": "deal-uuid-2",
    "entityType": "deal"
  }'
```

#### 1.13 Get Detection Configuration

**Endpoint**: `GET /api/duplicates/config`

```bash
curl http://localhost:4000/api/duplicates/config \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "strategies": [
      "exact",
      "fuzzy",
      "customer_value",
      "customer_date",
      "vendor_customer",
      "multi_factor"
    ],
    "defaultThreshold": 0.85,
    "fieldWeights": {
      "dealName": 0.3,
      "customerName": 0.25,
      "dealValue": 0.2,
      "vendorName": 0.15,
      "expectedCloseDate": 0.1
    },
    "autoMergeThreshold": 0.95
  }
}
```

### 2. Merge Management Endpoints (14 endpoints)

#### 2.1 Preview Merge

**Endpoint**: `POST /api/merge/preview`

**Test Case: Preview merging 2 deals**
```bash
curl -X POST http://localhost:4000/api/merge/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sourceEntityIds": ["deal-uuid-1", "deal-uuid-2"],
    "targetEntityId": "deal-uuid-1",
    "entityType": "deal",
    "options": {
      "mergeStrategy": "quality",
      "conflictResolution": "complete"
    }
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "mergedEntity": {
      "deal_name": "Enterprise License - Acme Corp",
      "customer_name": "Acme Corporation",
      "deal_value": 50000,
      "currency": "USD",
      "expected_close_date": "2024-03-15",
      "vendor_name": "Microsoft",
      "status": "Pending"
    },
    "conflicts": [
      {
        "field": "deal_value",
        "values": [
          {
            "entityId": "deal-uuid-1",
            "value": 50000,
            "source": "file-1.csv",
            "qualityScore": 0.85
          },
          {
            "entityId": "deal-uuid-2",
            "value": 48000,
            "source": "file-2.mbox",
            "qualityScore": 0.72
          }
        ],
        "chosen": {
          "entityId": "deal-uuid-1",
          "value": 50000,
          "reason": "Higher quality score"
        }
      }
    ],
    "sourceEntities": [...],
    "qualityScores": {
      "deal-uuid-1": 0.85,
      "deal-uuid-2": 0.72
    }
  }
}
```

#### 2.2 Execute Merge

**Endpoint**: `POST /api/merge/execute`

```bash
curl -X POST http://localhost:4000/api/merge/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sourceEntityIds": ["deal-uuid-1", "deal-uuid-2"],
    "targetEntityId": "deal-uuid-1",
    "entityType": "deal",
    "options": {
      "mergeStrategy": "newest",
      "conflictResolution": "complete",
      "deleteSource": false
    }
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "mergeHistoryId": "merge-uuid-123",
    "mergedEntity": {...},
    "mergedEntityId": "deal-uuid-1",
    "conflicts": [...],
    "sourceEntityIds": ["deal-uuid-1", "deal-uuid-2"],
    "deletedSourceIds": [],
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### 2.3 Merge Cluster

**Endpoint**: `POST /api/merge/cluster/:clusterId`

```bash
curl -X POST http://localhost:4000/api/merge/cluster/cluster-uuid-123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "masterEntityId": "deal-uuid-1",
    "options": {
      "mergeStrategy": "quality",
      "conflictResolution": "complete"
    }
  }'
```

#### 2.4 Auto-Merge High Confidence Duplicates

**Endpoint**: `POST /api/merge/auto`

**Test Case: Dry run first**
```bash
curl -X POST http://localhost:4000/api/merge/auto \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "threshold": 0.95,
    "dryRun": true,
    "entityType": "deal",
    "options": {
      "mergeStrategy": "quality"
    }
  }'
```

**Expected Response (Dry Run)**:
```json
{
  "success": true,
  "data": {
    "totalProcessed": 100,
    "duplicatesFound": 15,
    "wouldMerge": 8,
    "estimatedMerges": 8,
    "results": [
      {
        "clusterId": "cluster-1",
        "entityIds": ["deal-1", "deal-2"],
        "confidence": 0.97,
        "action": "would_merge"
      }
    ]
  }
}
```

**Test Case: Execute auto-merge**
```bash
curl -X POST http://localhost:4000/api/merge/auto \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "threshold": 0.95,
    "dryRun": false,
    "entityType": "deal"
  }'
```

#### 2.5 Unmerge Entities

**Endpoint**: `POST /api/merge/unmerge/:mergeHistoryId`

```bash
curl -X POST http://localhost:4000/api/merge/unmerge/merge-uuid-123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "reason": "Incorrect merge - deals were not duplicates"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "restoredEntities": [
      {
        "id": "deal-uuid-1",
        "data": {...}
      },
      {
        "id": "deal-uuid-2",
        "data": {...}
      }
    ],
    "mergeHistoryId": "merge-uuid-123",
    "unmergedAt": "2024-01-15T11:00:00Z",
    "reason": "Incorrect merge - deals were not duplicates"
  }
}
```

#### 2.6 Get Merge History

**Endpoint**: `GET /api/merge/history/:entityId`

```bash
curl http://localhost:4000/api/merge/history/deal-uuid-123 \
  -H "Authorization: Bearer $TOKEN"
```

#### 2.7 Get Conflicts

**Endpoint**: `GET /api/merge/conflicts/:mergeHistoryId`

```bash
curl http://localhost:4000/api/merge/conflicts/merge-uuid-123 \
  -H "Authorization: Bearer $TOKEN"
```

#### 2.8 Resolve Conflict

**Endpoint**: `POST /api/merge/conflicts/:conflictId/resolve`

```bash
curl -X POST http://localhost:4000/api/merge/conflicts/conflict-uuid-123/resolve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "chosenValue": "50000",
    "reason": "More recent data source"
  }'
```

#### 2.9 Get Merge Statistics

**Endpoint**: `GET /api/merge/statistics`

```bash
curl "http://localhost:4000/api/merge/statistics?entityType=deal&days=30" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "totalMerges": 45,
    "successfulMerges": 42,
    "failedMerges": 3,
    "unmergedCount": 5,
    "averageConflicts": 2.3,
    "byStrategy": {
      "newest": 15,
      "quality": 20,
      "first": 5,
      "manual": 3,
      "weighted": 2
    },
    "entitiesMerged": 90,
    "averageMergeTime": "1.2s"
  }
}
```

#### 2.10 Get All Merge History

**Endpoint**: `GET /api/merge/history`

```bash
curl "http://localhost:4000/api/merge/history?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

#### 2.11 Get Merge History Details

**Endpoint**: `GET /api/merge/history/:mergeHistoryId/details`

```bash
curl http://localhost:4000/api/merge/history/merge-uuid-123/details \
  -H "Authorization: Bearer $TOKEN"
```

#### 2.12 Get Quality Score

**Endpoint**: `GET /api/merge/quality-score/:entityId`

```bash
curl http://localhost:4000/api/merge/quality-score/deal-uuid-123 \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "entityId": "deal-uuid-123",
    "qualityScore": 0.85,
    "breakdown": {
      "completeness": 0.90,
      "aiConfidence": 0.88,
      "validationStatus": 0.75,
      "recency": 0.85
    },
    "weights": {
      "completeness": 0.4,
      "aiConfidence": 0.3,
      "validationStatus": 0.2,
      "recency": 0.1
    }
  }
}
```

#### 2.13 Get Merge Strategies

**Endpoint**: `GET /api/merge/strategies`

```bash
curl http://localhost:4000/api/merge/strategies \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "mergeStrategies": [
      {
        "name": "newest",
        "description": "Keep the most recently created/modified entity"
      },
      {
        "name": "quality",
        "description": "Keep the entity with the highest quality score"
      },
      {
        "name": "first",
        "description": "Keep the first entity (oldest)"
      },
      {
        "name": "manual",
        "description": "Require manual selection"
      },
      {
        "name": "weighted",
        "description": "Weighted merge based on field-level quality"
      }
    ],
    "conflictResolutionStrategies": [
      {
        "name": "source",
        "description": "Prefer source entity values"
      },
      {
        "name": "target",
        "description": "Prefer target entity values"
      },
      {
        "name": "complete",
        "description": "Prefer the most complete value"
      },
      {
        "name": "validated",
        "description": "Prefer validated values"
      },
      {
        "name": "merge_arrays",
        "description": "Merge array values together"
      },
      {
        "name": "manual",
        "description": "Require manual resolution"
      }
    ]
  }
}
```

### 3. Correlation & Quality Endpoints (14 endpoints)

#### 3.1 Get Entity Relationships

**Endpoint**: `GET /api/correlation/entity/:entityId`

```bash
curl http://localhost:4000/api/correlation/entity/deal-uuid-123?entityType=deal \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "primaryEntity": {
      "id": "deal-uuid-123",
      "deal_name": "Enterprise License",
      "customer_name": "Acme Corp"
    },
    "relatedVendors": [
      {
        "id": "vendor-uuid-1",
        "vendor_name": "Microsoft",
        "relationshipStrength": 0.95
      }
    ],
    "relatedContacts": [
      {
        "id": "contact-uuid-1",
        "contact_name": "John Doe",
        "email": "john@acme.com",
        "relationshipStrength": 0.88
      }
    ],
    "relatedDeals": [],
    "sourceFiles": [
      {
        "id": "file-uuid-1",
        "fileName": "deals_q1.csv",
        "uploadedAt": "2024-01-10T08:00:00Z"
      },
      {
        "id": "file-uuid-2",
        "fileName": "email_thread.mbox",
        "uploadedAt": "2024-01-12T14:30:00Z"
      }
    ]
  }
}
```

#### 3.2 Get Deal Correlation Map

**Endpoint**: `GET /api/correlation/deal/:dealId/map`

```bash
curl http://localhost:4000/api/correlation/deal/deal-uuid-123/map \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "dealId": "deal-uuid-123",
    "dealName": "Enterprise License - Acme Corp",
    "sources": [
      {
        "fileId": "file-uuid-1",
        "fileName": "deals_q1.csv",
        "extractedAt": "2024-01-10T08:15:00Z",
        "confidence": 0.92
      },
      {
        "fileId": "file-uuid-2",
        "fileName": "email_thread.mbox",
        "extractedAt": "2024-01-12T14:35:00Z",
        "confidence": 0.87
      }
    ],
    "vendorCorrelations": [
      {
        "vendorId": "vendor-uuid-1",
        "vendorName": "Microsoft",
        "sourceFileIds": ["file-uuid-1", "file-uuid-2"],
        "confidence": 0.95
      }
    ],
    "contactCorrelations": [
      {
        "contactId": "contact-uuid-1",
        "contactName": "John Doe",
        "sourceFileIds": ["file-uuid-2"],
        "confidence": 0.88
      }
    ],
    "fieldProvenance": {
      "deal_value": [
        {
          "fileId": "file-uuid-1",
          "value": "50000",
          "extractedAt": "2024-01-10T08:15:00Z",
          "confidence": 0.95
        }
      ],
      "customer_name": [
        {
          "fileId": "file-uuid-1",
          "value": "Acme Corp",
          "confidence": 0.98
        },
        {
          "fileId": "file-uuid-2",
          "value": "Acme Corporation",
          "confidence": 0.92
        }
      ]
    }
  }
}
```

#### 3.3 Get Data Lineage

**Endpoint**: `GET /api/correlation/lineage/:entityId`

```bash
# Get all field lineage
curl http://localhost:4000/api/correlation/lineage/deal-uuid-123?entityType=deal \
  -H "Authorization: Bearer $TOKEN"

# Get specific field lineage
curl "http://localhost:4000/api/correlation/lineage/deal-uuid-123?entityType=deal&fieldName=deal_value" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": [
    {
      "field": "deal_value",
      "currentValue": "50000",
      "sourceFileId": "file-uuid-1",
      "sourceFileName": "deals_q1.csv",
      "extractedAt": "2024-01-10T08:15:00Z",
      "confidence": 0.95,
      "transformations": [],
      "history": [
        {
          "value": "50000",
          "sourceFileId": "file-uuid-1",
          "timestamp": "2024-01-10T08:15:00Z"
        }
      ]
    }
  ]
}
```

#### 3.4 Get Multi-Source Entities

**Endpoint**: `GET /api/correlation/multi-source`

```bash
curl "http://localhost:4000/api/correlation/multi-source?entityType=deal&minSources=2" \
  -H "Authorization: Bearer $TOKEN"
```

#### 3.5 Reconcile Entity Across Sources

**Endpoint**: `POST /api/correlation/reconcile`

```bash
curl -X POST http://localhost:4000/api/correlation/reconcile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "entityKey": {
      "dealName": "Enterprise License",
      "customerName": "Acme Corp"
    },
    "sourceFileIds": ["file-uuid-1", "file-uuid-2", "file-uuid-3"],
    "entityType": "deal"
  }'
```

#### 3.6 Update Correlation Keys

**Endpoint**: `POST /api/correlation/update-keys`

```bash
curl -X POST http://localhost:4000/api/correlation/update-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "entityType": "deal"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "updated": 150,
    "errors": 2,
    "entityType": "deal"
  }
}
```

#### 3.7 Find Cross-Source Duplicates

**Endpoint**: `POST /api/correlation/cross-source-duplicates`

```bash
curl -X POST http://localhost:4000/api/correlation/cross-source-duplicates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sourceFileIds": ["file-uuid-1", "file-uuid-2"],
    "entityType": "deal"
  }'
```

#### 3.8 Get Correlation Statistics

**Endpoint**: `GET /api/correlation/statistics`

```bash
curl "http://localhost:4000/api/correlation/statistics?entityType=deal" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "totalEntities": 500,
    "multiSourceEntities": 75,
    "singleSourceEntities": 425,
    "averageSourcesPerEntity": 1.2,
    "bySourceCount": {
      "1": 425,
      "2": 50,
      "3": 20,
      "4+": 5
    },
    "correlationCoverage": 0.85
  }
}
```

#### 3.9 Get Quality Score

**Endpoint**: `GET /api/quality/score`

```bash
curl "http://localhost:4000/api/quality/score?entityType=deal" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "overall": 78.5,
    "completeness": 85.2,
    "accuracy": 82.1,
    "consistency": 75.0,
    "timeliness": 72.3,
    "uniqueness": 95.0,
    "breakdown": {
      "completenessDetails": {
        "requiredFields": 0.95,
        "optionalFields": 0.75,
        "criticalFields": 0.92
      },
      "accuracyDetails": {
        "validationPassRate": 0.85,
        "aiConfidenceAverage": 0.88,
        "manualValidationRate": 0.73
      },
      "consistencyDetails": {
        "duplicateRate": 0.05,
        "standardizationScore": 0.88,
        "formatConsistency": 0.92
      },
      "timelinessDetails": {
        "averageAge": "15 days",
        "staleRecords": 0.15,
        "recentUpdates": 0.45
      }
    }
  }
}
```

#### 3.10 Get Duplicate Summary

**Endpoint**: `GET /api/quality/duplicates-summary`

```bash
curl "http://localhost:4000/api/quality/duplicates-summary?entityType=deal" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "totalEntities": 500,
    "totalDuplicates": 25,
    "duplicateRate": 0.05,
    "exactDuplicates": 5,
    "nearDuplicates": 20,
    "byConfidence": {
      "high": 15,
      "medium": 8,
      "low": 2
    },
    "resolved": 10,
    "pending": 15
  }
}
```

#### 3.11 Get Quality Issues

**Endpoint**: `GET /api/quality/issues`

```bash
curl "http://localhost:4000/api/quality/issues?entityType=deal&severity=high&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": [
    {
      "entityId": "deal-uuid-123",
      "entityType": "deal",
      "issueType": "missing_required_field",
      "field": "deal_value",
      "severity": "high",
      "description": "Required field 'deal_value' is missing",
      "detectedAt": "2024-01-15T10:00:00Z",
      "affectedEntities": 1
    },
    {
      "entityId": "deal-uuid-456",
      "entityType": "deal",
      "issueType": "invalid_format",
      "field": "expected_close_date",
      "severity": "medium",
      "description": "Date format is inconsistent",
      "detectedAt": "2024-01-15T10:05:00Z",
      "affectedEntities": 1
    }
  ],
  "total": 2
}
```

#### 3.12 Generate Quality Report

**Endpoint**: `GET /api/quality/report`

```bash
curl "http://localhost:4000/api/quality/report?entityType=deal&startDate=2024-01-01&endDate=2024-01-31" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "reportDate": "2024-01-31",
    "dateRange": {
      "start": "2024-01-01",
      "end": "2024-01-31"
    },
    "overallScore": 78.5,
    "metrics": {
      "completeness": 85.2,
      "accuracy": 82.1,
      "consistency": 75.0,
      "timeliness": 72.3,
      "uniqueness": 95.0
    },
    "entitiesAnalyzed": 500,
    "issuesSummary": {
      "total": 45,
      "critical": 5,
      "high": 15,
      "medium": 20,
      "low": 5
    },
    "recommendations": [
      "Address 5 critical data quality issues immediately",
      "15 high-priority duplicates need review",
      "Improve validation for customer_name field (65% accuracy)",
      "72% of records older than 30 days - consider archiving"
    ]
  }
}
```

#### 3.13 Get Quality Trends

**Endpoint**: `GET /api/quality/trends`

```bash
curl "http://localhost:4000/api/quality/trends?entityType=deal&days=30" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": [
    {
      "date": "2024-01-01",
      "overallScore": 75.2,
      "completeness": 82.0,
      "accuracy": 78.5,
      "consistency": 72.0,
      "timeliness": 70.0,
      "uniqueness": 94.0
    },
    {
      "date": "2024-01-15",
      "overallScore": 77.1,
      "completeness": 84.0,
      "accuracy": 80.0,
      "consistency": 74.0,
      "timeliness": 71.5,
      "uniqueness": 94.5
    },
    {
      "date": "2024-01-31",
      "overallScore": 78.5,
      "completeness": 85.2,
      "accuracy": 82.1,
      "consistency": 75.0,
      "timeliness": 72.3,
      "uniqueness": 95.0
    }
  ]
}
```

#### 3.14 Get Quality Dashboard

**Endpoint**: `GET /api/quality/dashboard`

```bash
curl "http://localhost:4000/api/quality/dashboard?entityType=deal" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "overallScore": 78.5,
    "metrics": {
      "completeness": 85.2,
      "accuracy": 82.1,
      "consistency": 75.0,
      "timeliness": 72.3,
      "uniqueness": 95.0
    },
    "duplicateStats": {
      "totalDuplicates": 25,
      "duplicateRate": 0.05,
      "pending": 15,
      "resolved": 10
    },
    "recentIssues": [
      {
        "issueType": "missing_required_field",
        "count": 12,
        "severity": "high"
      },
      {
        "issueType": "invalid_format",
        "count": 8,
        "severity": "medium"
      }
    ],
    "trends": {
      "last7Days": 1.2,
      "last30Days": 3.5
    },
    "alerts": [
      {
        "type": "quality_drop",
        "message": "Accuracy dropped 2% in last 7 days",
        "severity": "warning"
      }
    ]
  }
}
```

## Integration Testing Scenarios

### Scenario 1: Complete Duplicate Detection & Merge Workflow

```bash
# Step 1: Upload a CSV file with potential duplicates
UPLOAD_RESPONSE=$(curl -X POST http://localhost:4000/api/files/upload \
  -F "file=@test-deals.csv" \
  -H "Authorization: Bearer $TOKEN")

FILE_ID=$(echo $UPLOAD_RESPONSE | jq -r '.data.id')

# Step 2: Wait for processing to complete
sleep 5

# Step 3: Check for duplicates in the uploaded file
DUPLICATES=$(curl "http://localhost:4000/api/duplicates/statistics?entityType=deal" \
  -H "Authorization: Bearer $TOKEN")

echo $DUPLICATES | jq '.data.highConfidence'

# Step 4: Get high confidence duplicates
HIGH_CONF=$(curl "http://localhost:4000/api/duplicates/high-confidence?threshold=0.9" \
  -H "Authorization: Bearer $TOKEN")

# Step 5: Preview merge for first duplicate pair
FIRST_CLUSTER=$(echo $HIGH_CONF | jq -r '.data[0].clusterId')

PREVIEW=$(curl -X POST "http://localhost:4000/api/merge/cluster/$FIRST_CLUSTER" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"preview": true}')

# Step 6: Execute merge if preview looks good
MERGE_RESULT=$(curl -X POST "http://localhost:4000/api/merge/cluster/$FIRST_CLUSTER" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "options": {
      "mergeStrategy": "quality",
      "conflictResolution": "complete"
    }
  }')

MERGE_ID=$(echo $MERGE_RESULT | jq -r '.data.mergeHistoryId')

# Step 7: Verify merge was successful
MERGE_HISTORY=$(curl "http://localhost:4000/api/merge/history/$MERGE_ID/details" \
  -H "Authorization: Bearer $TOKEN")

echo $MERGE_HISTORY | jq '.data'
```

### Scenario 2: Cross-Source Entity Correlation

```bash
# Step 1: Upload multiple files
FILE1=$(curl -X POST http://localhost:4000/api/files/upload \
  -F "file=@deals_q1.csv" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.id')

FILE2=$(curl -X POST http://localhost:4000/api/files/upload \
  -F "file=@email_thread.mbox" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.id')

# Step 2: Find cross-source duplicates
CROSS_SOURCE=$(curl -X POST http://localhost:4000/api/correlation/cross-source-duplicates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"sourceFileIds\": [\"$FILE1\", \"$FILE2\"],
    \"entityType\": \"deal\"
  }")

# Step 3: Get correlation map for a specific deal
DEAL_ID=$(echo $CROSS_SOURCE | jq -r '.data[0].entities[0].id')

CORRELATION_MAP=$(curl "http://localhost:4000/api/correlation/deal/$DEAL_ID/map" \
  -H "Authorization: Bearer $TOKEN")

echo $CORRELATION_MAP | jq '.data'

# Step 4: Check data lineage
LINEAGE=$(curl "http://localhost:4000/api/correlation/lineage/$DEAL_ID?entityType=deal" \
  -H "Authorization: Bearer $TOKEN")

echo $LINEAGE | jq '.data'
```

### Scenario 3: Auto-Merge High Confidence Duplicates

```bash
# Step 1: Dry run to see what would be merged
DRY_RUN=$(curl -X POST http://localhost:4000/api/merge/auto \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "threshold": 0.95,
    "dryRun": true,
    "entityType": "deal",
    "options": {
      "mergeStrategy": "quality"
    }
  }')

echo "Would merge:" $(echo $DRY_RUN | jq '.data.estimatedMerges')

# Step 2: Review dry run results
echo $DRY_RUN | jq '.data.results'

# Step 3: Execute if results look good
AUTO_MERGE=$(curl -X POST http://localhost:4000/api/merge/auto \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "threshold": 0.95,
    "dryRun": false,
    "entityType": "deal"
  }')

# Step 4: Check merge statistics
STATS=$(curl "http://localhost:4000/api/merge/statistics?entityType=deal&days=1" \
  -H "Authorization: Bearer $TOKEN")

echo $STATS | jq '.data'
```

### Scenario 4: Quality Monitoring Dashboard

```bash
# Step 1: Get current quality score
QUALITY=$(curl "http://localhost:4000/api/quality/score?entityType=deal" \
  -H "Authorization: Bearer $TOKEN")

echo "Overall quality:" $(echo $QUALITY | jq '.data.overall')

# Step 2: Identify quality issues
ISSUES=$(curl "http://localhost:4000/api/quality/issues?entityType=deal&limit=50" \
  -H "Authorization: Bearer $TOKEN")

echo "Total issues:" $(echo $ISSUES | jq '.total')

# Step 3: Get quality trends
TRENDS=$(curl "http://localhost:4000/api/quality/trends?entityType=deal&days=30" \
  -H "Authorization: Bearer $TOKEN")

# Step 4: Generate comprehensive report
REPORT=$(curl "http://localhost:4000/api/quality/report?entityType=deal" \
  -H "Authorization: Bearer $TOKEN")

echo $REPORT | jq '.data'

# Step 5: Get dashboard view
DASHBOARD=$(curl "http://localhost:4000/api/quality/dashboard?entityType=deal" \
  -H "Authorization: Bearer $TOKEN")

echo $DASHBOARD | jq '.data'
```

## Performance Testing

### Load Testing with Apache Bench

```bash
# Test duplicate detection endpoint
ab -n 100 -c 10 -p duplicate-payload.json -T application/json \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/duplicates/detect/deal

# Test quality score endpoint
ab -n 1000 -c 50 \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/quality/score?entityType=deal

# Test statistics endpoint
ab -n 500 -c 25 \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/duplicates/statistics
```

### Batch Performance Test

```bash
# Create test payload with 100 entities
cat > batch-payload.json <<EOF
{
  "entities": [
    $(for i in {1..100}; do
      echo "{\"id\": \"temp-$i\", \"deal_name\": \"Deal $i\", \"customer_name\": \"Customer $i\", \"deal_value\": $((RANDOM % 100000))}"
      if [ $i -lt 100 ]; then echo ","; fi
    done)
  ]
}
EOF

# Time the batch detection
time curl -X POST http://localhost:4000/api/duplicates/detect/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @batch-payload.json
```

## Error Handling Tests

### Test Invalid Inputs

```bash
# Test with missing required fields
curl -X POST http://localhost:4000/api/duplicates/detect/deal \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "deal": {}
  }'
# Expected: 400 Bad Request with validation errors

# Test with invalid entity ID
curl http://localhost:4000/api/duplicates/candidates/invalid-uuid \
  -H "Authorization: Bearer $TOKEN"
# Expected: 404 Not Found

# Test with invalid merge strategy
curl -X POST http://localhost:4000/api/merge/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sourceEntityIds": ["deal-1", "deal-2"],
    "targetEntityId": "deal-1",
    "options": {
      "mergeStrategy": "invalid_strategy"
    }
  }'
# Expected: 400 Bad Request with invalid strategy error
```

### Test Edge Cases

```bash
# Test with empty cluster
curl -X POST http://localhost:4000/api/duplicates/clusters/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "entityIds": [],
    "entityType": "deal"
  }'
# Expected: 400 Bad Request - minimum 2 entities required

# Test unmerge on already unmerged entity
curl -X POST http://localhost:4000/api/merge/unmerge/already-unmerged-id \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "reason": "Test"
  }'
# Expected: 400 Bad Request - already unmerged
```

## Database Verification

### Verify Tables and Data

```bash
# Connect to database
psql $DATABASE_URL

# Check duplicate detections
SELECT COUNT(*) FROM duplicate_detections;
SELECT * FROM duplicate_detections LIMIT 5;

# Check clusters
SELECT COUNT(*) FROM duplicate_clusters;
SELECT * FROM duplicate_clusters_summary;

# Check merge history
SELECT COUNT(*) FROM merge_history;
SELECT * FROM merge_history WHERE unmerged = false LIMIT 5;

# Check conflicts
SELECT COUNT(*) FROM field_conflicts;
SELECT * FROM field_conflicts LIMIT 10;

# Check views
SELECT * FROM high_confidence_duplicates LIMIT 10;
SELECT * FROM merge_statistics;
SELECT * FROM recent_merge_activity LIMIT 20;

# Test functions
SELECT * FROM get_duplicate_candidates('deal', 0.85, 10);
SELECT * FROM get_merge_statistics('deal', 30);
```

## Monitoring & Logging

### Watch Logs During Testing

```bash
# Backend logs
tail -f backend/logs/app.log

# Look for duplicate detection events
grep "duplicate detection" backend/logs/app.log

# Look for merge operations
grep "merge" backend/logs/app.log

# Look for errors
grep "ERROR" backend/logs/app.log
```

## Next Steps After Testing

1. **Fix any bugs** found during testing
2. **Optimize performance** based on load test results
3. **Add additional validation** for edge cases discovered
4. **Document API quirks** and known limitations
5. **Create automated tests** based on these manual tests
6. **Build UI components** for duplicate management
7. **Set up monitoring** and alerts for production

## Common Issues & Troubleshooting

### Issue: Duplicate detection returns no matches
- Check if entities exist in database
- Verify threshold is not too high (try 0.7 instead of 0.85)
- Check if correlation keys are populated
- Run `UPDATE correlation keys` endpoint

### Issue: Merge fails with conflicts
- Review conflict resolution strategy
- Use merge preview first to identify conflicts
- Consider using "manual" strategy for complex merges

### Issue: Quality score is unexpectedly low
- Check data completeness
- Verify AI confidence scores are populated
- Review validation status of entities
- Check for duplicates affecting uniqueness score

### Issue: Slow performance
- Add database indexes if missing
- Reduce batch size
- Enable query result caching
- Check database connection pool settings

## Test Data Generation

### Generate Test Deals

```python
import json
import random
from datetime import datetime, timedelta

customers = ["Acme Corp", "TechStart Inc", "Global Solutions", "Enterprise Co"]
vendors = ["Microsoft", "Oracle", "SAP", "Salesforce"]
statuses = ["Pending", "Approved", "Rejected"]

deals = []
for i in range(100):
    deal = {
        "deal_name": f"{random.choice(vendors)} License - {random.choice(customers)}",
        "customer_name": random.choice(customers),
        "vendor_name": random.choice(vendors),
        "deal_value": random.randint(10000, 500000),
        "currency": "USD",
        "expected_close_date": (datetime.now() + timedelta(days=random.randint(1, 90))).isoformat(),
        "status": random.choice(statuses)
    }
    deals.append(deal)

# Add some intentional duplicates
for i in range(10):
    original = random.choice(deals)
    duplicate = original.copy()
    # Slight variations
    duplicate["deal_value"] = original["deal_value"] + random.randint(-1000, 1000)
    deals.append(duplicate)

with open('test-deals.json', 'w') as f:
    json.dump(deals, f, indent=2)

print(f"Generated {len(deals)} test deals with ~10 duplicates")
```

## Success Criteria

Phase 6 testing is complete when:

- ✅ All 44 endpoints return expected responses
- ✅ Duplicate detection accuracy > 90% on test data
- ✅ Merge operations complete without data loss
- ✅ Quality metrics accurately reflect data state
- ✅ Performance meets requirements (< 2s for most operations)
- ✅ All database constraints and triggers work correctly
- ✅ Error handling covers all edge cases
- ✅ Audit trail is complete for all operations

---

**Note**: This testing guide should be executed in a development environment before deploying to production. Adjust thresholds and configurations based on your specific requirements and data characteristics.
