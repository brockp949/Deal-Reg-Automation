# Claude Skills Integration - Testing Guide

**Last Updated**: December 17, 2025

---

## Overview

This guide provides comprehensive testing procedures for validating the Claude Skills integrations and measuring accuracy improvements against the regex baseline.

**Testing Objectives**:
- ✅ Validate 85-95% accuracy targets for each skill
- ✅ Measure cost per operation and total monthly costs
- ✅ Monitor cache hit rates (target: 50-80%)
- ✅ Identify edge cases and failure modes
- ✅ Compare AI-powered extraction vs regex baseline
- ✅ Verify fallback mechanisms work correctly

---

## Prerequisites

### Environment Setup

1. **Configure Backend Environment Variables**

Create or update `backend/.env` with the following:

```bash
# Required: Claude API Key
ANTHROPIC_API_KEY=sk-ant-your-actual-api-key-here
CLAUDE_API_KEY=sk-ant-your-actual-api-key-here

# Enable Claude Skills (Master Switch)
CLAUDE_SKILLS_ENABLED=true

# Enable Individual Skills
FEATURE_INTELLIGENT_COLUMN_MAPPING=true
FEATURE_SEMANTIC_ENTITY_EXTRACTION=true
FEATURE_SEMANTIC_DUPLICATE_DETECTION=true
FEATURE_BUYING_SIGNAL_ANALYZER=true

# AI Configuration
AI_MODEL=claude-3-5-sonnet-20240620
AI_MAX_TOKENS=4000
AI_TEMPERATURE=0.0

# Caching Configuration
AI_CACHE_ENABLED=true
AI_CACHE_TTL_DAYS=1

# Logging (set to debug for testing)
LOG_LEVEL=debug
```

2. **Verify Redis is Running**

```bash
# Check Redis connection
redis-cli ping
# Should return: PONG
```

3. **Start Backend Services**

```bash
cd backend
npm install
npm run build
npm start
```

4. **Verify Skills are Enabled**

Check the logs for:
```
[INFO] IntelligentColumnMapper skill initialized
[INFO] SemanticEntityExtractor skill initialized
[INFO] SemanticDuplicateDetector skill initialized
[INFO] BuyingSignalAnalyzer skill initialized
```

---

## Test Plan

### Phase 1: Feature Flag Testing (30 minutes)

**Objective**: Verify that feature flags correctly enable/disable skills

#### Test 1.1: Skills Enabled
1. Set `CLAUDE_SKILLS_ENABLED=true`
2. Upload a test vendor spreadsheet
3. Check logs for: `"Using IntelligentColumnMapper skill for dynamic column mapping"`
4. ✅ **Expected**: Skills are used for processing

#### Test 1.2: Skills Disabled
1. Set `CLAUDE_SKILLS_ENABLED=false`
2. Upload the same vendor spreadsheet
3. Check logs for: `"IntelligentColumnMapper skill disabled, using fallback"`
4. ✅ **Expected**: Regex patterns are used, processing still succeeds

#### Test 1.3: Individual Skill Toggle
1. Set `CLAUDE_SKILLS_ENABLED=true`
2. Set `FEATURE_INTELLIGENT_COLUMN_MAPPING=false`
3. Upload a vendor spreadsheet
4. ✅ **Expected**: IntelligentColumnMapper disabled, other skills enabled

**Success Criteria**: All feature flags work as expected, graceful fallback to regex

---

### Phase 2: IntelligentColumnMapper Testing (2-3 hours)

**Objective**: Test dynamic column mapping with various spreadsheet formats

#### Test Data Preparation

Create test spreadsheets with varying column formats:

**Test File 1: Standard Format** (`test-standard.xlsx`)
```
Opportunity | Stage | Next Steps | Last Update | Units | Revenue
Deal A      | Qualified | Follow up | 2025-12-01 | 1000 | $500K
```

**Test File 2: Custom Column Names** (`test-custom.xlsx`)
```
Deal Name | Sales Stage | Action Items | Updated | Volume | Budget
Deal B    | Proposal    | Send quote   | 12/1/25 | 500  | $250,000
```

**Test File 3: Unusual Format** (`test-unusual.xlsx`)
```
Project Title | Current Phase | TODO | Modified Date | Qty | $ Value
Deal C        | Negotiation   | Demo | 01-Dec-2025  | 250 | 150K USD
```

**Test File 4: Multi-Column Composition** (`test-multicolumn.xlsx`)
```
First Name | Last Name | Deal | Phase | Revenue Potential
John       | Smith     | Deal D | Won  | $1.2M-$2.5M
```

#### Test 2.1: Standard Format
1. Upload `test-standard.xlsx`
2. Check extraction results
3. ✅ **Expected**: 100% accuracy, high confidence (>0.9)

#### Test 2.2: Custom Column Names
1. Upload `test-custom.xlsx`
2. Check mapping logs for confidence scores
3. ✅ **Expected**: Correctly maps "Deal Name" → "opportunity", "Budget" → "costUpside"
4. ✅ **Expected**: 90%+ confidence scores

#### Test 2.3: Unusual Format
1. Upload `test-unusual.xlsx`
2. Verify complex formats parsed correctly:
   - "Modified Date" → "lastUpdate"
   - "$ Value" → "costUpside"
   - "150K USD" → {value: 150000, currency: 'USD'}
3. ✅ **Expected**: 85%+ accuracy, handles abbreviations

#### Test 2.4: Multi-Column Composition
1. Upload `test-multicolumn.xlsx`
2. Check if "First Name" + "Last Name" are handled
3. ✅ **Expected**: Skill suggests composition or extracts separately

#### Test 2.5: Missing Columns
1. Upload spreadsheet with only: `Opportunity | Revenue`
2. ✅ **Expected**: Maps available columns, warnings for missing fields

#### Test 2.6: Completely Unknown Format
1. Upload spreadsheet with columns like: `Col A | Col B | Col C`
2. ✅ **Expected**: Low confidence warnings, uses fallback patterns

**Baseline Comparison**:
- Disable skill: `FEATURE_INTELLIGENT_COLUMN_MAPPING=false`
- Upload same test files
- Count mapping failures with regex vs AI
- **Target**: 95%+ AI accuracy vs 60% regex

**Cost Measurement**:
- Check logs for cache hits: `"Column mapping retrieved from cache"`
- Expected cost: $0.15 per file (first upload), $0.00 (cached)
- Monitor total API costs in Claude dashboard

---

### Phase 3: SemanticEntityExtractor Testing (3-4 hours)

**Objective**: Test entity extraction from MBOX emails and transcripts

#### Test Data: MBOX Emails

**Test Email 1: Standard Format** (`test-email-1.mbox`)
```
From: john.smith@acme.com
Subject: RE: Project Phoenix - $500K Opportunity

Hi team,

We're moving forward with Acme Corporation on the Project Phoenix deal.
Deal value is approximately $500K USD.

Best regards,
John Smith
Senior Account Manager
john.smith@acme.com
+1-555-0123
```

**Test Email 2: Complex Format** (`test-email-2.mbox`)
```
From: contact@techcorp.de
Subject: Q2 Budget Discussion

Hallo,

TechCorp GmbH is interested in your solution. We have a budget of €750K for Q2.
Please contact our CTO, Klaus Müller (klaus@techcorp.de, +49-30-12345678).

Regards,
TechCorp Team
```

**Test Email 3: Multi-Language** (`test-email-3.mbox`)
```
From: maria@empresasa.es
Subject: Propuesta para Empresa SA

Estimados,

Empresa SA (Madrid) está evaluando soluciones por un valor de $1.2M-$2.5M USD.

Contacto: María García (maria@empresasa.es)
```

#### Test 3.1: Standard Email Extraction
1. Upload `test-email-1.mbox`
2. Verify extracted entities:
   - Organization: "Acme Corporation" (confidence >0.8)
   - Deal: "Project Phoenix" (confidence >0.8)
   - Value: 500000, Currency: USD
   - Contact: "John Smith"
   - Email: "john.smith@acme.com"
   - Phone: "+1-555-0123"
3. Check relationships:
   - "John Smith" works_for "Acme Corporation"
   - "Project Phoenix" has_value "$500K"
4. ✅ **Expected**: All entities extracted with high confidence

#### Test 3.2: Complex Format (German)
1. Upload `test-email-2.mbox`
2. Verify multi-language support:
   - Organization: "TechCorp GmbH" (recognizes German legal entity)
   - Value: 750000, Currency: EUR
   - Contact: "Klaus Müller"
   - Email: "klaus@techcorp.de"
   - Phone: "+49-30-12345678" (international format)
3. ✅ **Expected**: Handles multi-language and international formats

#### Test 3.3: Range Values & Multi-Language
1. Upload `test-email-3.mbox`
2. Verify range parsing:
   - Value: 1200000-2500000, Currency: USD (range extracted)
   - Organization: "Empresa SA" (Spanish)
   - Contact: "María García" (special characters)
3. ✅ **Expected**: Handles ranges, accents, Spanish content

#### Test 3.4: Edge Cases
Upload emails with:
- Signature blocks (should extract contact info)
- Multiple organizations (should identify customer vs vendor)
- Ambiguous amounts ("about $500K", "~€1M")
- Email threads (should handle reply chains)
- HTML formatting (should parse cleanly)

**Test Data: Transcripts**

**Test Transcript 1: Sales Call** (`test-transcript-1.txt`)
```
TRANSCRIPT: Sales Call with Acme Corp

John (Acme): Hi, I'm John Smith from Acme Corporation. We're looking at your solution for our Q1 project.

Sales Rep: Great! What's your budget range for this project?

John: We're thinking around $750K to $1M for the initial phase. This would cover about 1,000 licenses.

Sales Rep: Perfect. Can you share your email so I can send over a proposal?

John: Sure, it's john.smith@acme.com. My direct line is 555-0123.
```

#### Test 3.5: Transcript Entity Extraction
1. Upload `test-transcript-1.txt`
2. Verify extraction:
   - Organization: "Acme Corporation"
   - Contact: "John Smith"
   - Email: "john.smith@acme.com"
   - Phone: "555-0123"
   - Value: 750000-1000000, Currency: USD
   - Product: "1,000 licenses"
3. Check conversational context:
   - Buying signal: Budget discussion
   - Intent: "looking at your solution"
4. ✅ **Expected**: 85%+ entity extraction accuracy

**Baseline Comparison**:
- Disable skill: `FEATURE_SEMANTIC_ENTITY_EXTRACTION=false`
- Upload same MBOX/transcript files
- Compare regex extraction results
- **Target**: 85%+ AI accuracy vs 60% regex

**Cost Measurement**:
- Expected: $0.30 per MBOX file, $0.25 per transcript
- Cache hits on duplicate uploads: $0.00
- Monitor Claude API usage

---

### Phase 4: SemanticDuplicateDetector Testing (2 hours)

**Objective**: Test fuzzy duplicate detection with semantic similarity

#### Test Data: Vendor/Deal Variations

Create deals with similar names:

**Test Batch 1: Company Name Variations**
```
1. Acme Inc
2. ACME Corporation
3. Acme, Incorporated
4. Acme Corp.
5. Acme International Ltd
```

**Test Batch 2: Deal Name Variations**
```
1. Project Phoenix
2. Phoenix Project
3. PROJECT PHOENIX
4. Phoenix Initiative
5. The Phoenix Project
```

**Test Batch 3: Contact Email Variations**
```
1. john.smith@acme.com
2. john.smyth@acme.com (typo)
3. j.smith@acme.com
4. johnsmith@acme.com
5. john_smith@acme.com
```

#### Test 4.1: Exact Duplicates
1. Import "Acme Inc" deal
2. Import "Acme Inc" again
3. ✅ **Expected**: 100% similarity, flagged as duplicate

#### Test 4.2: Semantic Duplicates (High Similarity)
1. Import "Acme Inc" deal
2. Import "ACME Corporation" deal
3. Check similarity score
4. ✅ **Expected**: 90%+ similarity, flagged as duplicate

#### Test 4.3: Similar but Different (Medium Similarity)
1. Import "Acme Inc" deal
2. Import "Acme International Ltd" deal
3. ✅ **Expected**: 70-85% similarity, flagged for review

#### Test 4.4: Different Entities (Low Similarity)
1. Import "Acme Inc" deal
2. Import "TechCorp GmbH" deal
3. ✅ **Expected**: <50% similarity, not flagged

#### Test 4.5: Threshold Tuning
1. Set threshold to 95%: Only exact matches flagged
2. Set threshold to 70%: More false positives
3. Set threshold to 85%: Balanced (recommended)
4. ✅ **Expected**: 85% threshold provides best balance

#### Test 4.6: Multi-Field Comparison
1. Import deal: "Acme Inc" + "$500K" + "john@acme.com"
2. Import deal: "ACME Corp" + "$500K" + "john.smith@acme.com"
3. ✅ **Expected**: High similarity due to multiple matching fields

**Baseline Comparison**:
- Disable skill: `FEATURE_SEMANTIC_DUPLICATE_DETECTION=false`
- Upload same test batches
- Count false positives/negatives with string matching vs AI
- **Target**: 95%+ AI accuracy vs 60% string matching

**Cost Measurement**:
- Expected: $0.09 per duplicate check
- Batch duplicate checks (50 candidates): $0.15
- Monitor API usage for high-volume imports

---

### Phase 5: End-to-End Integration Testing (4-5 hours)

**Objective**: Test complete workflow with all skills enabled

#### Test Scenario 1: Vendor Spreadsheet Import

**Test File**: `Real-Vendor-Deals.xlsx` (use actual production file if available)

1. Enable all skills
2. Upload vendor spreadsheet
3. Monitor processing stages:
   - ✅ IntelligentColumnMapper: Column mapping with confidence scores
   - ✅ SemanticEntityExtractor: Not used for spreadsheets (expected)
   - ✅ SemanticDuplicateDetector: Check for existing deals
4. Verify results:
   - All columns mapped correctly
   - Deal values parsed accurately
   - Dates formatted correctly
   - No false duplicate flags
5. Check logs for:
   - Cache hits on re-upload
   - Error handling
   - Fallback behavior

**Success Metrics**:
- 95%+ column mapping accuracy
- <2% false duplicate rate
- Processing time: <30 seconds for 100 rows

#### Test Scenario 2: MBOX Email Import

**Test File**: `Real-Emails.mbox` (use actual email archive)

1. Enable all skills
2. Upload MBOX file
3. Monitor processing:
   - ✅ SemanticEntityExtractor: Extract entities from email bodies
   - ✅ SemanticDuplicateDetector: Check for existing contacts/deals
4. Verify results:
   - Vendors identified correctly
   - Contacts extracted with emails/phones
   - Deal values parsed from email body
   - Relationships detected
5. Check edge cases:
   - Email threads (multiple messages)
   - Attachments (ignored or parsed?)
   - HTML emails (cleaned properly?)

**Success Metrics**:
- 85%+ entity extraction accuracy
- 90%+ duplicate detection accuracy
- Processing time: <2 minutes for 100 emails

#### Test Scenario 3: Transcript Import

**Test File**: `Real-Sales-Call.txt` (use actual transcript)

1. Enable all skills
2. Upload transcript
3. Monitor processing:
   - ✅ SemanticEntityExtractor: Extract entities from conversation
   - ✅ BuyingSignalAnalyzer: Detect buying intent (if enabled)
4. Verify results:
   - Customer organization identified
   - Contact names extracted
   - Deal values parsed from conversation
   - Buying signals detected

**Success Metrics**:
- 85%+ entity extraction accuracy
- 90%+ buying signal detection accuracy
- Processing time: <1 minute for 5000 words

---

### Phase 6: Performance & Cost Monitoring (Continuous)

**Objective**: Monitor API costs, latency, and cache effectiveness

#### Metric 1: Cost Per Operation

Track costs for each skill:

| Skill | Operation | Expected Cost | Measured Cost |
|-------|-----------|---------------|---------------|
| IntelligentColumnMapper | Map 10 columns | $0.15 | _____ |
| SemanticEntityExtractor | Extract from email | $0.30 | _____ |
| SemanticEntityExtractor | Extract from transcript | $0.25 | _____ |
| SemanticDuplicateDetector | Check 50 candidates | $0.15 | _____ |

**Total Monthly Cost Estimate** (500 files):
- Column Mapping: 200 files × $0.15 = $30
- Entity Extraction (MBOX): 200 files × $0.30 = $60
- Entity Extraction (Transcript): 100 files × $0.25 = $25
- Duplicate Detection: 500 checks × $0.09 = $45
- **Total**: ~$160/month

With caching (50-80% hit rate):
- **Adjusted Total**: ~$65-80/month

#### Metric 2: Cache Hit Rates

Monitor Redis cache effectiveness:

```bash
# Check cache stats in logs
grep "retrieved from cache" backend/logs/*.log | wc -l  # Cache hits
grep "Extracting.*with Claude" backend/logs/*.log | wc -l  # Cache misses
```

**Target**: 50-80% cache hit rate after initial uploads

#### Metric 3: Processing Latency

Measure end-to-end processing time:

| File Type | Size | With Skills | Without Skills | Speedup |
|-----------|------|-------------|----------------|---------|
| Vendor Spreadsheet | 100 rows | _____ sec | _____ sec | _____ |
| MBOX | 50 emails | _____ sec | _____ sec | _____ |
| Transcript | 5000 words | _____ sec | _____ sec | _____ |

**Expected**: Skills add 2-5 seconds per file (due to API calls)

#### Metric 4: API Rate Limits

Monitor for rate limit errors:

```bash
grep "rate limit" backend/logs/*.log
```

**Claude API Limits**:
- Tier 1: 50 requests/min
- Tier 2: 100 requests/min

**Mitigation**: Implement retry with exponential backoff (already in ClaudeClientService)

---

### Phase 7: Error Handling & Fallback Testing (2 hours)

**Objective**: Verify graceful degradation when Claude API fails

#### Test 7.1: API Key Invalid
1. Set `ANTHROPIC_API_KEY=invalid-key`
2. Upload a file
3. ✅ **Expected**: Falls back to regex, processing succeeds
4. Check logs for: `"IntelligentColumnMapper failed, falling back to hardcoded mappings"`

#### Test 7.2: API Rate Limit Hit
1. Upload 60 files in 1 minute (exceeds Tier 1 limit)
2. ✅ **Expected**: Retry with exponential backoff, processing continues
3. Check logs for: `"Rate limit exceeded, retrying after 2s"`

#### Test 7.3: API Timeout
1. Simulate network latency (use network throttling tool)
2. Upload a file
3. ✅ **Expected**: Timeout after 30s, fallback to regex

#### Test 7.4: Malformed API Response
1. (Hard to simulate, but check error handling in code)
2. ✅ **Expected**: Parse error caught, fallback to regex

#### Test 7.5: Redis Cache Unavailable
1. Stop Redis: `redis-cli shutdown`
2. Upload a file
3. ✅ **Expected**: Skills work without cache, slower but functional
4. Check logs for: `"Cache unavailable, proceeding without cache"`

---

## Accuracy Measurement Methodology

### Baseline vs AI Comparison

For each test file:

1. **Disable Skills** (Baseline)
   - Set `CLAUDE_SKILLS_ENABLED=false`
   - Upload test file
   - Record extraction results
   - Count errors/missing fields

2. **Enable Skills** (AI-Powered)
   - Set `CLAUDE_SKILLS_ENABLED=true`
   - Upload same test file
   - Record extraction results
   - Count errors/missing fields

3. **Calculate Accuracy**
   ```
   Accuracy = (Correct Extractions / Total Fields) × 100%

   Baseline Accuracy = _____ %
   AI Accuracy = _____ %
   Improvement = AI Accuracy - Baseline Accuracy
   ```

### Expected Results

| Skill | Baseline Accuracy | AI Accuracy | Improvement |
|-------|-------------------|-------------|-------------|
| IntelligentColumnMapper | 60% | 95%+ | +35% |
| SemanticEntityExtractor | 60% | 85%+ | +25% |
| SemanticDuplicateDetector | 60% | 95%+ | +35% |
| BuyingSignalAnalyzer | 65% | 90%+ | +25% |

---

## Test Results Template

### Test Session Information

**Date**: ____________
**Tester**: ____________
**Environment**: Staging / Production
**Backend Version**: ____________
**Claude API Tier**: ____________

### Test Results Summary

| Test Phase | Status | Pass Rate | Notes |
|------------|--------|-----------|-------|
| Phase 1: Feature Flags | ☐ Pass ☐ Fail | ___/3 | |
| Phase 2: IntelligentColumnMapper | ☐ Pass ☐ Fail | ___/6 | |
| Phase 3: SemanticEntityExtractor | ☐ Pass ☐ Fail | ___/5 | |
| Phase 4: SemanticDuplicateDetector | ☐ Pass ☐ Fail | ___/6 | |
| Phase 5: End-to-End Integration | ☐ Pass ☐ Fail | ___/3 | |
| Phase 6: Performance & Cost | ☐ Pass ☐ Fail | N/A | |
| Phase 7: Error Handling | ☐ Pass ☐ Fail | ___/5 | |

**Overall Status**: ☐ Pass ☐ Fail

### Accuracy Measurements

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| Column Mapping Accuracy | 95%+ | _____ % | ☐ Pass ☐ Fail |
| Entity Extraction Accuracy | 85%+ | _____ % | ☐ Pass ☐ Fail |
| Duplicate Detection Accuracy | 95%+ | _____ % | ☐ Pass ☐ Fail |
| Cache Hit Rate | 50-80% | _____ % | ☐ Pass ☐ Fail |

### Cost Measurements

| Metric | Expected | Measured |
|--------|----------|----------|
| Cost per Spreadsheet | $0.15 | $_____ |
| Cost per MBOX | $0.30 | $_____ |
| Cost per Transcript | $0.25 | $_____ |
| Cost per Duplicate Check | $0.09 | $_____ |
| **Estimated Monthly Cost** | **$65-80** | **$_____** |

### Issues Identified

1. Issue: _______________________
   Severity: ☐ Critical ☐ Major ☐ Minor
   Resolution: _______________________

2. Issue: _______________________
   Severity: ☐ Critical ☐ Major ☐ Minor
   Resolution: _______________________

---

## Troubleshooting Common Issues

### Issue: "Skill disabled" messages in logs

**Cause**: Feature flags not set correctly
**Fix**:
```bash
# Check .env file
cat backend/.env | grep CLAUDE_SKILLS_ENABLED

# Should be:
CLAUDE_SKILLS_ENABLED=true
```

### Issue: "Authentication failed" errors

**Cause**: Invalid or missing Claude API key
**Fix**:
```bash
# Verify API key format
echo $ANTHROPIC_API_KEY
# Should start with: sk-ant-

# Test API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20240620",
    "max_tokens": 1,
    "messages": [{"role": "user", "content": "test"}]
  }'
```

### Issue: All API calls missing cache

**Cause**: Redis not running or cache disabled
**Fix**:
```bash
# Check Redis
redis-cli ping
# Should return: PONG

# Check cache enabled
grep AI_CACHE_ENABLED backend/.env
# Should be: AI_CACHE_ENABLED=true
```

### Issue: High API costs

**Cause**: Cache hit rate too low, or batch sizes too small
**Fix**:
- Increase cache TTL: `AI_CACHE_TTL_DAYS=7`
- Optimize prompt sizes (reduce `max_tokens`)
- Batch similar operations together

### Issue: Slow processing times

**Cause**: API latency, no caching
**Fix**:
- Enable parallel processing for large files
- Increase cache TTL for better hit rates
- Use chunked processing for large MBOX files

---

## Next Steps After Testing

### If Tests Pass (95%+ accuracy achieved)

1. **Document Results**
   - Update IMPLEMENTATION_STATUS.md with test results
   - Add measured costs to documentation
   - Document any edge cases found

2. **Gradual Production Rollout**
   - Week 1: Enable for 10% of traffic
   - Week 2: Enable for 50% of traffic
   - Week 3: Enable for 100% of traffic
   - Monitor costs and accuracy at each stage

3. **Set Up Monitoring**
   - Daily cost alerts ($50 threshold)
   - Accuracy metrics dashboard
   - Cache hit rate monitoring
   - Error rate tracking

### If Tests Fail (<85% accuracy)

1. **Analyze Failures**
   - Which test cases failed?
   - Which skill is underperforming?
   - Are failures systematic or random?

2. **Tune Prompts/Thresholds**
   - Adjust confidence thresholds
   - Refine skill prompts
   - Add more examples to prompts

3. **Consider Hybrid Approach**
   - Use AI for specific cases, regex for others
   - Combine AI + regex results
   - Add manual review step

---

## Conclusion

This testing guide provides a comprehensive framework for validating the Claude Skills integrations. Follow each phase systematically, document results, and adjust thresholds based on findings.

**Key Success Metrics**:
- ✅ 95%+ column mapping accuracy
- ✅ 85%+ entity extraction accuracy
- ✅ 95%+ duplicate detection accuracy
- ✅ 50-80% cache hit rate
- ✅ <$100/month API costs
- ✅ <5 second latency per file

For questions or issues during testing, refer to:
- [CLAUDE_SKILLS_INTEGRATION.md](./CLAUDE_SKILLS_INTEGRATION.md) - Integration details
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - Overall project status
- Backend logs: `backend/logs/`

**Good luck with testing!** 🚀
