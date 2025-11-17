# Connector Readiness Guide

## Overview

This document provides operational runbooks and troubleshooting guides for all data connectors in the Opportunity Tracker system.

**Last Updated:** Phase 7.1
**Status:** CRM CSV Connector - Production Ready

## Connectors

### 1. Gmail Connector
**Status:** ✅ Production (Phase 1)
**Type:** Email ingestion from Gmail accounts

#### Configuration
- **Environment Variable:** `GMAIL_SYNC_ENABLED=true`
- **Required Credentials:** Google Service Account with Gmail API access
- **Config Location:** `backend/config/index.ts`

#### Runbook
```bash
# Enable Gmail sync
export GMAIL_SYNC_ENABLED=true

# Run sync
npm run source:sync

# Verify results
ls uploads/source-sync/gmail/
cat uploads/source-sync/source-sync-manifest.json | jq '.[] | select(.connector == "gmail")'
```

#### Troubleshooting
**Issue:** No messages found
- Check Gmail API quota (Google Cloud Console → APIs & Services → Gmail API → Quotas)
- Verify service account has domain-wide delegation enabled
- Confirm query syntax is valid Gmail search syntax
- Check `windowDays` setting isn't too restrictive

**Issue:** Authentication errors
- Verify service account JSON credentials are valid
- Check `impersonatedUser` has Gmail access
- Ensure Gmail API is enabled in Google Cloud project

---

### 2. Google Drive Connector
**Status:** ✅ Production (Phase 1)
**Type:** Document/transcript ingestion from Google Drive

#### Configuration
- **Environment Variable:** `DRIVE_SYNC_ENABLED=true`
- **Required Credentials:** Google Service Account with Drive API access
- **Config Location:** `backend/config/index.ts`

#### Runbook
```bash
# Enable Drive sync
export DRIVE_SYNC_ENABLED=true

# Run sync
npm run source:sync

# Verify results
ls uploads/source-sync/drive/
cat uploads/source-sync/source-sync-manifest.json | jq '.[] | select(.connector == "drive")'
```

#### Troubleshooting
**Issue:** Files not found
- Check Drive API quota
- Verify service account has access to target folders
- Confirm `mimeTypes` filter isn't excluding desired files
- Check folder IDs in query configuration

**Issue:** Download failures
- Check file size limits (very large files may timeout)
- Verify network connectivity
- Ensure sufficient disk space in `uploads/source-sync/drive/`

---

### 3. CRM CSV Connector
**Status:** ✅ Production (Phase 7.1)
**Type:** Nightly CRM export file ingestion

#### Configuration
- **Environment Variable:** `CRM_CSV_ENABLED=true`
- **Source Directory:** `CRM_CSV_DIRECTORY` (default: `uploads/crm`)
- **Max Files:** `CRM_CSV_MAX_FILES` (default: 100)

#### Runbook

##### Initial Setup
```bash
# 1. Create CRM drop directory
mkdir -p uploads/crm

# 2. Configure CRM export automation
# Set up your CRM to export deals to uploads/crm/ nightly
# Supported formats: Salesforce, HubSpot, Zoho, Pipedrive, vTiger, generic CSV

# 3. Enable CRM CSV connector
export CRM_CSV_ENABLED=true
export CRM_CSV_DIRECTORY=uploads/crm
export CRM_CSV_MAX_FILES=100

# 4. Test manually
npm run source:sync
```

##### Daily Operations
```bash
# Check for new CRM files
ls -lh uploads/crm/

# Run sync (usually via cron/scheduled job)
npm run source:sync

# Verify CRM files were processed
cat uploads/source-sync/source-sync-manifest.json | jq '.[] | select(.connector == "crm_csv")'

# Check spooled copies
ls uploads/source-sync/crm/

# View parsed opportunities
npm run source:show -- --filter "crm"
```

##### Supported CRM Formats

**Salesforce**
- Auto-detected via headers: `Opportunity ID`, `Account Name`, `Amount`, `Stage`, `Close Date`
- Required fields: Deal name, Account name, Stage
- Optional: Amount, Probability, Deal Owner, Contact info

**HubSpot**
- Auto-detected via headers: `Deal Name`, `Deal Stage`, `Pipeline`, `Close Date`, `Company Name`
- Required fields: Deal Name, Deal Stage, Company Name
- Optional: Amount, Deal Owner, Contact info

**Zoho CRM**
- Auto-detected via headers: `Deal Name`, `Account Name`, `Closing Date`, `Stage`
- Required fields: Deal Name, Account Name, Stage
- Optional: Amount, Expected Revenue, Probability

**Pipedrive**
- Auto-detected via headers: `Deal Title`, `Organization Name`, `Status`, `Value`
- Required fields: Deal Title, Organization Name
- Optional: Value, Status, Expected Close Date

**vTiger**
- Auto-detected via headers: `account_no`, `accountname`, `potentialname`
- Required fields: Account name, Potential name
- Optional: Amount, Stage, Close date

**Generic CSV**
- Fallback parser for unrecognized formats
- Maps common column names (name, customer, value, stage, etc.)
- May require manual field mapping for best results

#### Field Mapping

CRM fields are automatically mapped to OpportunityRecords:

| CRM Field | Opportunity Field | Notes |
|-----------|------------------|-------|
| Deal/Opportunity Name | `name` | Required |
| Account/Company Name | `metadata.customer` | Required |
| Stage | `stage` | Mapped to standard stages (rfq, quote, po_in_progress, etc.) |
| Amount/Value | `priceBand` | Normalized to currency format |
| Close Date | `metadata.lastTouched` | ISO 8601 format |
| Deal Owner | `actors` | Added to actors list |
| Contact Name | `actors` | Added to actors list |
| Probability | Used for priority derivation | Higher probability → higher priority |

#### CRM CSV Metadata

Each CRM CSV file generates metadata sidecars:
```json
{
  "connector": "crm_csv",
  "file": {
    "fileName": "salesforce-deals.csv",
    "filePath": "uploads/source-sync/crm/salesforce-deals.csv",
    "fileSize": 2048,
    "modifiedTime": "2025-11-17T10:30:00.000Z",
    "createdTime": "2025-11-17T10:00:00.000Z",
    "checksum": "d41d8cd98f00b204e9800998ecf8427e"
  }
}
```

The checksum is used for:
- Duplicate detection (same file uploaded multiple times)
- Reference tracking in OpportunityRecords
- Data lineage and traceability

#### Troubleshooting

**Issue:** No CSV files found
```bash
# Check directory exists
ls -la uploads/crm/

# Check environment variable
echo $CRM_CSV_DIRECTORY
echo $CRM_CSV_ENABLED

# Manually scan for files
find uploads/crm -name "*.csv"

# Check permissions
ls -la uploads/crm/
# Ensure files are readable (at least -rw-r--r--)
```

**Issue:** CSV parsing errors
```bash
# Check CSV file format
head -20 uploads/crm/your-file.csv

# Verify delimiter (comma, semicolon, tab)
cat uploads/crm/your-file.csv | head -1

# Check for byte order marks (BOM)
file uploads/crm/your-file.csv

# Test parsing directly
node -e "const parser = require('./dist/parsers/StandardizedCSVParser'); parser.parse('uploads/crm/your-file.csv').then(console.log)"
```

**Issue:** Incorrect field mapping
```bash
# Check detected format
npm run source:sync 2>&1 | grep "CSV format detected"

# Review parser output
npm run source:process -- --manifest uploads/source-sync/source-sync-manifest.json

# Check mapped opportunities
npm run source:show -- --filter "crm"
```

**Issue:** Missing deals in output
```bash
# Check raw CSV row count
wc -l uploads/crm/your-file.csv

# Check parsed deals count
npm run source:process -- --manifest uploads/source-sync/source-sync-manifest.json
cat uploads/opportunities/opportunities.json | jq '[.[] | select(.sourceSummary[].connector == "crm_csv")] | length'

# Look for parser errors
cat uploads/source-sync/source-sync-manifest.json | jq '.[] | select(.connector == "crm_csv") | .metadataPath' | xargs cat
```

**Issue:** Duplicate opportunities from CRM + Gmail/Drive
```bash
# This is expected! The system is designed to correlate multi-source evidence
# Check consolidation results
npm run source:consolidate

# View composites (merged opportunities)
cat uploads/opportunities/composite-opportunities.json | jq '.[] | select(.conflicts.has_mixed_sources == true)'

# Conflicts are flagged for review
npm run source:quality
cat uploads/opportunities/quality-findings.json | jq '.findings[] | select(.type == "conflict")'
```

**Issue:** Large CSV files timing out
```bash
# Check file size
ls -lh uploads/crm/

# Files > 100MB may trigger warnings
# Consider splitting large files or increasing timeout

# Split large CSV (keep header)
head -1 large-file.csv > chunk-header.csv
split -l 10000 large-file.csv chunk-
for file in chunk-*; do
  cat chunk-header.csv $file > $file.csv
  rm $file
done
```

#### Monitoring & Alerts

**Key Metrics to Monitor:**
- Files synced per run
- Parse success rate
- Opportunities created vs CSV rows
- Conflict rate (CRM vs Gmail/Drive)
- File checksums (detect duplicates)

**Suggested Alerts:**
```bash
# Alert if no files synced in 24 hours
if [ $(find uploads/crm -name "*.csv" -mtime -1 | wc -l) -eq 0 ]; then
  echo "ALERT: No CRM files received in 24 hours"
fi

# Alert if parse failures exceed threshold
PARSE_ERRORS=$(npm run source:process 2>&1 | grep -c "CRITICAL")
if [ $PARSE_ERRORS -gt 5 ]; then
  echo "ALERT: High parse error rate: $PARSE_ERRORS"
fi

# Alert if conflict rate > 50%
COMPOSITES=$(cat uploads/opportunities/composite-opportunities.json | jq '. | length')
CONFLICTS=$(cat uploads/opportunities/composite-opportunities.json | jq '[.[] | select(.conflicts.has_mixed_sources == true)] | length')
CONFLICT_PCT=$(echo "scale=2; $CONFLICTS * 100 / $COMPOSITES" | bc)
if (( $(echo "$CONFLICT_PCT > 50" | bc -l) )); then
  echo "ALERT: High conflict rate: $CONFLICT_PCT%"
fi
```

---

## Multi-Connector Integration

### Cross-Source Correlation

The system automatically correlates opportunities from multiple sources:

**Example: CRM CSV + Gmail**
1. CRM exports deal "Acme Corp - Gateway Deployment" (Stage: Proposal)
2. Gmail captures email thread about "Acme Gateway" (Stage: RFQ)
3. Correlator matches via shared vendor/customer tags
4. Consolidator creates composite with conflict flagging

**Example: CRM CSV + Google Drive**
1. CRM exports deal "SmartCity IoT" (Stage: Contract Sent)
2. Drive transcript mentions "SmartCity platform deployment" (Stage: PO in Progress)
3. Correlator matches via customer name + opportunity tags
4. Consolidator merges evidence, flags conflicts, selects most advanced stage

---

## Deployment Checklist

### Phase 7.1 - CRM CSV Connector

- [x] CRMCSVConnector implementation
- [x] SourceSyncService integration
- [x] StandardizedCSVParser multi-format support
- [x] OpportunityMapper CRM field handling
- [x] OpportunityConsolidator conflict detection
- [x] Unit tests (CRMCSVConnector)
- [x] Integration tests (CSV + Gmail/Drive merge)
- [x] Test fixtures (Salesforce, HubSpot, Zoho)
- [x] Documentation (this runbook)
- [ ] Production deployment
- [ ] Monitoring/alerting setup
- [ ] CRM export automation (customer-specific)

### Prerequisites
- Node.js 18+
- Write access to `uploads/crm/` directory
- CRM system with scheduled CSV export capability

### Environment Variables
```bash
# Required
CRM_CSV_ENABLED=true

# Optional (with defaults)
CRM_CSV_DIRECTORY=uploads/crm
CRM_CSV_MAX_FILES=100
```

### Scheduled Job (Cron)
```bash
# Add to crontab for nightly sync (2 AM)
0 2 * * * cd /app && npm run source:sync && npm run source:ci
```

---

## Future Enhancements (Phase 7.2+)

### Teams/Zoom Transcript Connector
- Real-time meeting transcript ingestion
- Speaker diarization
- Action item extraction
- API-based sync (Graph API, Zoom API)

---

## Support

**Tests:** `npm test -- CRMCSVConnector`
**Documentation:** `/docs/OPPORTUNITY_TRACKER_PLAN.md`
