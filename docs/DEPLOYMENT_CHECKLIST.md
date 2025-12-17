# Staging Deployment Checklist - Claude Skills Integration

**Last Updated**: December 17, 2025

---

## Overview

This checklist ensures proper deployment of Claude Skills to staging environment for production testing and validation.

**Deployment Goal**: Enable Claude Skills in staging with all safety mechanisms in place for comprehensive testing before production rollout.

---

## Pre-Deployment Checklist

### 1. Code & Dependencies ✅

- [ ] All Phase 5 integrations committed to repository
- [ ] Backend compiles without errors: `npm run build`
- [ ] Frontend compiles without errors: `npm run build`
- [ ] All TypeScript type errors resolved
- [ ] Dependencies up to date: `npm audit`
- [ ] Git branch synced with main: `git pull origin main`

**Verification**:
```bash
cd backend
npm run build
# Should complete without errors

cd ../frontend
npm run build
# Should complete without errors
```

---

### 2. Environment Configuration ✅

#### Backend Environment Variables

Create `backend/.env` (staging) with the following:

```bash
# ===================================
# STAGING ENVIRONMENT CONFIGURATION
# ===================================

# Server Configuration
NODE_ENV=staging
PORT=4000
API_PREFIX=/api

# Database (Staging)
DATABASE_URL=postgresql://dealreg_user:dealreg_password@staging-db:5432/dealreg_staging

# Redis (Staging)
REDIS_URL=redis://staging-redis:6379

# JWT Authentication
JWT_SECRET=staging-jwt-secret-change-in-production
JWT_EXPIRES_IN=7d

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5368709120
ALLOWED_FILE_TYPES=.mbox,.csv,.txt,.pdf,.docx,.json
CONFIG_STORAGE_DIR=./config-uploads
VIRUS_SCAN_PROVIDER=stub
VIRUS_SCAN_FAIL_OPEN=true

# ===================================
# CLAUDE AI CONFIGURATION (CRITICAL)
# ===================================

# Claude API Key (REQUIRED)
# Get from: https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-YOUR-ACTUAL-STAGING-API-KEY-HERE
CLAUDE_API_KEY=sk-ant-YOUR-ACTUAL-STAGING-API-KEY-HERE

# AI Model Configuration
AI_MODEL=claude-3-5-sonnet-20240620
AI_MAX_TOKENS=4000
AI_TEMPERATURE=0.0

# Caching Configuration
AI_CACHE_ENABLED=true
AI_CACHE_TTL_DAYS=1

# ===================================
# CLAUDE SKILLS FEATURE FLAGS
# ===================================

# Master Switch - Enable all Claude Skills for staging testing
CLAUDE_SKILLS_ENABLED=true

# Individual Skill Toggles
# Set to true for full testing, can disable individually if issues arise
FEATURE_INTELLIGENT_COLUMN_MAPPING=true
FEATURE_SEMANTIC_ENTITY_EXTRACTION=true
FEATURE_SEMANTIC_DUPLICATE_DETECTION=true
FEATURE_BUYING_SIGNAL_ANALYZER=true

# Claude Agents (Future phases - keep disabled for now)
CLAUDE_AGENT_VALIDATION_ENABLED=false
CLAUDE_AGENT_ORCHESTRATOR_ENABLED=false
CLAUDE_AGENT_LEARNING_ENABLED=false

# ===================================
# CORS & LOGGING
# ===================================

CORS_ORIGIN=http://localhost:3000,http://staging.example.com:3200
LOG_LEVEL=debug

# ===================================
# PERFORMANCE TUNING (Phase 3)
# ===================================

# Parallel Processing
PARALLEL_CHUNK_SIZE=1000
MAX_CONCURRENT_CHUNKS=5
CHUNKED_UPLOAD_SIZE_MB=5

# ===================================
# COST MONITORING
# ===================================

# Daily cost alert threshold (optional, for monitoring)
DAILY_COST_ALERT_THRESHOLD=50
```

**Configuration Checklist**:
- [ ] `.env` file created in `backend/` directory
- [ ] `ANTHROPIC_API_KEY` set with valid API key (starts with `sk-ant-`)
- [ ] `CLAUDE_SKILLS_ENABLED=true`
- [ ] All 4 feature flags enabled (`FEATURE_*=true`)
- [ ] `LOG_LEVEL=debug` for comprehensive logging
- [ ] Database URL points to staging database
- [ ] Redis URL points to staging Redis instance

**Verification**:
```bash
# Check environment variables loaded
cd backend
source .env
echo $ANTHROPIC_API_KEY  # Should print sk-ant-...
echo $CLAUDE_SKILLS_ENABLED  # Should print true

# Verify API key works
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20240620",
    "max_tokens": 1,
    "messages": [{"role": "user", "content": "test"}]
  }'
# Should return HTTP 200 with response
```

---

### 3. Infrastructure Prerequisites ✅

#### PostgreSQL Database
- [ ] Staging database created and accessible
- [ ] Schema migrations applied: `npm run db:migrate`
- [ ] Test data loaded (optional): `npm run db:seed`

**Verification**:
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT version();"
# Should connect and show PostgreSQL version

# Check deal_registrations table exists
psql $DATABASE_URL -c "\d deal_registrations"
# Should show table schema
```

#### Redis Cache
- [ ] Redis instance running and accessible
- [ ] Redis version 5.0+ (for streams support)
- [ ] Memory configured appropriately (recommend 512MB+)

**Verification**:
```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping
# Should return: PONG

# Check Redis memory
redis-cli -u $REDIS_URL INFO memory | grep used_memory_human
# Should show current memory usage
```

#### File Storage
- [ ] Upload directory exists: `mkdir -p backend/uploads`
- [ ] Sufficient disk space (50GB+ recommended for MBOX files)
- [ ] Permissions configured: `chmod 755 backend/uploads`

**Verification**:
```bash
# Check upload directory
ls -la backend/uploads
# Should exist and be writable

# Check disk space
df -h backend/uploads
# Should show sufficient space
```

---

### 4. Dependency Installation ✅

```bash
# Backend dependencies
cd backend
npm install
npm audit fix  # Fix any vulnerabilities

# Frontend dependencies
cd ../frontend
npm install
npm audit fix
```

**Verification**:
- [ ] No critical vulnerabilities: `npm audit`
- [ ] All packages installed successfully
- [ ] `node_modules/` directories created

---

## Deployment Steps

### Step 1: Stop Existing Services

```bash
# If using Docker
docker-compose down

# If using PM2
pm2 stop all

# If using systemd
sudo systemctl stop dealreg-backend
sudo systemctl stop dealreg-frontend
```

---

### Step 2: Pull Latest Code

```bash
# Fetch latest changes
git fetch origin

# Checkout staging branch (or main)
git checkout staging  # or main
git pull origin staging

# Verify correct commit
git log -1
# Should show latest commit with Phase 5 integrations
```

---

### Step 3: Build Application

```bash
# Build backend
cd backend
npm run build

# Verify build output
ls -la dist/
# Should contain compiled JavaScript files

# Build frontend
cd ../frontend
npm run build

# Verify build output
ls -la build/
# Should contain static assets
```

---

### Step 4: Run Database Migrations

```bash
cd backend

# Check migration status
npm run db:migrate:status

# Run pending migrations
npm run db:migrate

# Verify migrations applied
npm run db:migrate:status
# Should show all migrations as "up"
```

**Note**: Claude Skills integration does not require new database migrations. Existing schema is sufficient.

---

### Step 5: Start Services

#### Option A: Docker Compose

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f backend
# Should show: "IntelligentColumnMapper skill initialized"
# Should show: "SemanticEntityExtractor skill initialized"
# Should show: "SemanticDuplicateDetector skill initialized"
# Should show: "BuyingSignalAnalyzer skill initialized"
```

#### Option B: PM2

```bash
# Start backend
cd backend
pm2 start npm --name "dealreg-backend" -- start

# Start frontend
cd ../frontend
pm2 start npm --name "dealreg-frontend" -- start

# Check status
pm2 status
# Both processes should show "online"

# View logs
pm2 logs dealreg-backend
# Should show skill initialization messages
```

#### Option C: Direct Node

```bash
# Terminal 1: Backend
cd backend
npm start

# Terminal 2: Frontend
cd frontend
npm start
```

---

### Step 6: Health Checks ✅

#### Backend Health Check

```bash
# Check backend is running
curl http://localhost:4000/api/health
# Should return: {"status":"ok"}

# Check skills are enabled
curl http://localhost:4000/api/health/skills
# Should return: {
#   "claudeSkillsEnabled": true,
#   "skills": {
#     "intelligentColumnMapper": true,
#     "semanticEntityExtractor": true,
#     "semanticDuplicateDetector": true,
#     "buyingSignalAnalyzer": true
#   }
# }
```

**Create health endpoint if not exists**: `backend/src/routes/health.ts`
```typescript
import { Router } from 'express';
import { isSkillEnabled } from '../config/claude';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/health/skills', (req, res) => {
  res.json({
    claudeSkillsEnabled: process.env.CLAUDE_SKILLS_ENABLED === 'true',
    skills: {
      intelligentColumnMapper: isSkillEnabled('intelligentColumnMapper'),
      semanticEntityExtractor: isSkillEnabled('semanticEntityExtractor'),
      semanticDuplicateDetector: isSkillEnabled('semanticDuplicateDetector'),
      buyingSignalAnalyzer: isSkillEnabled('buyingSignalAnalyzer'),
    },
  });
});

export default router;
```

#### Frontend Health Check

```bash
# Check frontend is accessible
curl http://localhost:3000
# Should return HTML page
```

#### Redis Health Check

```bash
# Check Redis connection from backend
redis-cli -u $REDIS_URL ping
# Should return: PONG

# Check cache keys
redis-cli -u $REDIS_URL KEYS "*"
# Should return empty array initially
```

---

### Step 7: Smoke Tests ✅

#### Test 1: Upload Simple File

```bash
# Create test spreadsheet
cat > test-vendor.csv << EOF
Opportunity,Stage,Next Steps
Test Deal 1,Qualified,Follow up
Test Deal 2,Proposal,Send quote
EOF

# Upload via API
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer YOUR_TEST_TOKEN" \
  -F "file=@test-vendor.csv" \
  -F "intent=vendor_deals"

# Should return: {"success": true, "jobId": "..."}
```

**Check Logs**:
```bash
# View backend logs
tail -f backend/logs/app.log

# Look for:
# "Using IntelligentColumnMapper skill for dynamic column mapping"
# "IntelligentColumnMapper result"
# "Column mapping complete"
```

#### Test 2: Verify Skills Used

```bash
# Check logs for skill usage
grep "IntelligentColumnMapper" backend/logs/app.log
# Should show skill was invoked

grep "retrieved from cache" backend/logs/app.log
# Should be empty on first upload

# Upload same file again
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer YOUR_TEST_TOKEN" \
  -F "file=@test-vendor.csv" \
  -F "intent=vendor_deals"

# Check cache hit
grep "retrieved from cache" backend/logs/app.log
# Should show cache hit on second upload
```

---

### Step 8: Monitoring Setup ✅

#### Log Aggregation

```bash
# Tail logs in real-time
tail -f backend/logs/*.log

# Monitor errors
tail -f backend/logs/*.log | grep -i error

# Monitor skill usage
tail -f backend/logs/*.log | grep -E "IntelligentColumnMapper|SemanticEntityExtractor|SemanticDuplicateDetector"
```

#### Cost Monitoring

```bash
# Check Claude API usage dashboard
# Visit: https://console.anthropic.com/settings/usage

# Expected first day:
# - 10-20 test files uploaded
# - ~$3-5 in API costs
# - 50-80% cache hit rate after initial uploads
```

#### Error Tracking

- [ ] Set up error alerting (email/Slack)
- [ ] Monitor error rates: `grep -c ERROR backend/logs/*.log`
- [ ] Set up daily cost alerts (Claude dashboard)

---

## Post-Deployment Validation

### Validation Checklist

- [ ] All 4 skills initialized in logs
- [ ] Test file upload succeeds
- [ ] Skills are invoked (check logs for "Using IntelligentColumnMapper...")
- [ ] Cache is working (second upload shows "retrieved from cache")
- [ ] No authentication errors
- [ ] No rate limit errors
- [ ] Processing completes successfully
- [ ] Extracted data is accurate
- [ ] Frontend displays results correctly

### Next Steps

1. **Run Full Test Suite**
   - Follow [TESTING_GUIDE.md](./TESTING_GUIDE.md)
   - Complete all 7 test phases
   - Document results in test results template

2. **Monitor Performance**
   - Track API costs daily
   - Monitor cache hit rates
   - Measure processing latency
   - Track accuracy metrics

3. **Iterate & Optimize**
   - Adjust confidence thresholds if needed
   - Tune cache TTL based on hit rates
   - Optimize prompts if accuracy is low
   - Document any issues or edge cases

---

## Rollback Procedure

If critical issues arise during staging testing:

### Option 1: Disable Skills (Gradual Rollback)

```bash
# Edit backend/.env
CLAUDE_SKILLS_ENABLED=false

# Restart backend
pm2 restart dealreg-backend  # or docker-compose restart backend

# Verify fallback to regex
tail -f backend/logs/app.log | grep "skill disabled"
# Should show: "IntelligentColumnMapper skill disabled, using fallback"
```

### Option 2: Disable Individual Skill

```bash
# If one skill is problematic, disable it individually
# Edit backend/.env
FEATURE_INTELLIGENT_COLUMN_MAPPING=false  # Example

# Restart backend
pm2 restart dealreg-backend
```

### Option 3: Full Rollback to Previous Version

```bash
# Stop services
docker-compose down  # or pm2 stop all

# Revert to previous commit
git log --oneline -10  # Find previous commit
git checkout <previous-commit-hash>

# Rebuild and restart
npm run build
docker-compose up -d  # or pm2 restart all
```

---

## Troubleshooting

### Issue: Skills not initializing

**Symptoms**: Logs don't show "skill initialized" messages

**Causes**:
- `CLAUDE_SKILLS_ENABLED` not set to `true`
- Feature flags disabled
- Missing `ANTHROPIC_API_KEY`

**Fix**:
```bash
# Verify environment variables
cd backend
node -e "console.log(process.env.CLAUDE_SKILLS_ENABLED)"
# Should print: true

node -e "console.log(process.env.ANTHROPIC_API_KEY?.substring(0, 10))"
# Should print: sk-ant-api

# If not set, check .env file loaded
# Restart backend after fixing .env
```

---

### Issue: Authentication errors

**Symptoms**: Logs show "Authentication failed" or 401 errors

**Causes**:
- Invalid API key
- API key expired
- API key not set

**Fix**:
```bash
# Test API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "claude-3-5-sonnet-20240620", "max_tokens": 1, "messages": [{"role": "user", "content": "test"}]}'

# If fails, regenerate API key at:
# https://console.anthropic.com/settings/keys
```

---

### Issue: Cache not working

**Symptoms**: Every upload shows cache miss, no "retrieved from cache" messages

**Causes**:
- Redis not running
- `AI_CACHE_ENABLED=false`
- Cache keys not matching

**Fix**:
```bash
# Check Redis connection
redis-cli -u $REDIS_URL ping
# Should return: PONG

# Check cache enabled
grep AI_CACHE_ENABLED backend/.env
# Should be: AI_CACHE_ENABLED=true

# Check cache keys exist
redis-cli -u $REDIS_URL KEYS "*column_mapping*"
# Should show keys after first upload
```

---

### Issue: High API costs

**Symptoms**: Costs exceed $5/day during testing

**Causes**:
- Cache not working (every upload hits API)
- Test files too large
- Too many concurrent uploads

**Fix**:
```bash
# Verify cache is working
grep "retrieved from cache" backend/logs/app.log | wc -l
# Should show increasing count

# Reduce max tokens if needed
# Edit backend/.env
AI_MAX_TOKENS=2000  # Reduced from 4000

# Monitor usage
# https://console.anthropic.com/settings/usage
```

---

## Deployment Completion Checklist

- [ ] All services running and healthy
- [ ] Skills initialized successfully
- [ ] Test file upload completed
- [ ] Skills invoked (verified in logs)
- [ ] Cache working (second upload cached)
- [ ] No errors in logs
- [ ] Frontend accessible and functional
- [ ] Monitoring configured
- [ ] Team notified of staging deployment
- [ ] [TESTING_GUIDE.md](./TESTING_GUIDE.md) ready for execution

**Deployment Status**: ☐ Complete ☐ Partial ☐ Failed

**Deployed By**: ______________
**Deployment Date**: ______________
**Deployment Notes**:
_________________________________________
_________________________________________

---

## Next Actions

✅ **Deployment Complete** → Proceed to [TESTING_GUIDE.md](./TESTING_GUIDE.md)

⚠️ **Issues Encountered** → Review troubleshooting section, rollback if critical

📊 **Monitoring** → Track costs, cache hit rates, and accuracy metrics daily

For support, refer to:
- [CLAUDE_SKILLS_INTEGRATION.md](./CLAUDE_SKILLS_INTEGRATION.md) - Integration details
- [TESTING_GUIDE.md](./TESTING_GUIDE.md) - Comprehensive testing procedures
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - Overall project status
