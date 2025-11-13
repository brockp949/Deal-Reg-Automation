# Phase 6 Quick Test Setup Guide

## Overview

This guide provides the fastest path to get Phase 6 up and running for testing all 44 API endpoints.

## Prerequisites

- Docker and Docker Compose installed
- Or PostgreSQL 14+ and Redis 6+ installed locally
- Node.js 18+ installed
- Git repository cloned

## Option 1: Docker Compose (Recommended - 5 minutes)

### Step 1: Start All Services

```bash
cd Deal-Reg-Automation

# Start database, Redis, backend, and worker
docker compose up -d

# Check all services are running
docker compose ps

# Expected output:
# dealreg-db       running   0.0.0.0:5432->5432/tcp
# dealreg-redis    running   0.0.0.0:6379->6379/tcp
# dealreg-backend  running   0.0.0.0:4000->4000/tcp
# dealreg-worker   running
```

### Step 2: Wait for Services to Initialize

```bash
# Watch logs for "Database connected" message
docker compose logs -f backend

# Press Ctrl+C when you see:
# ✓ Database connected
# ✓ Redis connected
# Server listening on port 4000
```

### Step 3: Verify Backend is Running

```bash
# Test health endpoint
curl http://localhost:4000/health

# Expected: {"status":"ok","timestamp":"..."}
```

### Step 4: Create Test User

```bash
# Register a test user
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!",
    "name": "Test User"
  }'

# Login and get token
export TOKEN=$(curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!"
  }' | jq -r '.token')

echo "Token: $TOKEN"
```

### Step 5: Upload Test Data

```bash
# Create test CSV file
cat > test-deals.csv <<EOF
Deal Name,Customer Name,Vendor,Deal Value,Currency,Expected Close Date
Enterprise License - Acme Corp,Acme Corporation,Microsoft,50000,USD,2024-03-15
Cloud Services - Acme,Acme Corp,Microsoft,52000,USD,2024-03-20
Software Package - TechStart,TechStart Inc,Oracle,75000,USD,2024-04-01
Consulting Services - TechStart,TechStart Incorporated,Oracle,73000,USD,2024-04-05
Database License - Global Solutions,Global Solutions,Oracle,100000,USD,2024-05-01
Infrastructure - Enterprise Co,Enterprise Company,Salesforce,25000,USD,2024-03-10
CRM License - Enterprise,Enterprise Co,Salesforce,24500,USD,2024-03-12
Marketing Suite - Acme,Acme Corporation,Salesforce,30000,USD,2024-06-01
EOF

# Upload file
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test-deals.csv"

# Wait 10 seconds for processing
echo "Waiting for AI extraction to complete..."
sleep 10
```

### Step 6: Run Phase 6 Tests

```bash
# Check for duplicates
curl "http://localhost:4000/api/duplicates/statistics?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Get quality score
curl "http://localhost:4000/api/quality/score?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Test duplicate detection
curl -X POST http://localhost:4000/api/duplicates/detect/deal \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deal": {
      "deal_name": "Enterprise License - Acme",
      "customer_name": "Acme Corp",
      "deal_value": 51000,
      "currency": "USD"
    }
  }' | jq '.'

# Expected: Should find duplicates with high confidence
```

### Step 7: Run Complete Test Suite

```bash
# Download and run the complete test script
curl -O https://raw.githubusercontent.com/your-repo/Deal-Reg-Automation/main/test-phase-6.sh
chmod +x test-phase-6.sh
./test-phase-6.sh
```

## Option 2: Local Installation (15 minutes)

### Step 1: Install PostgreSQL

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

### Step 2: Install Redis

**Ubuntu/Debian:**
```bash
sudo apt install redis-server
sudo systemctl start redis
```

**macOS:**
```bash
brew install redis
brew services start redis
```

### Step 3: Create Database

```bash
# Create database and user
sudo -u postgres psql <<EOF
CREATE DATABASE dealreg;
CREATE USER dealreg_user WITH PASSWORD 'dealreg_password';
GRANT ALL PRIVILEGES ON DATABASE dealreg TO dealreg_user;
\c dealreg
GRANT ALL ON SCHEMA public TO dealreg_user;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
\q
EOF
```

### Step 4: Configure Environment

```bash
cd Deal-Reg-Automation/backend

# Create .env file (already exists if you followed earlier steps)
cat > .env <<EOF
NODE_ENV=development
PORT=4000
API_PREFIX=/api
DATABASE_URL=postgresql://dealreg_user:dealreg_password@localhost:5432/dealreg
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5368709120
ALLOWED_FILE_TYPES=.mbox,.csv,.txt,.pdf,.docx,.json
CONFIG_STORAGE_DIR=./config-uploads
VIRUS_SCAN_PROVIDER=stub
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
VIRUS_SCAN_FAIL_OPEN=true
ANTHROPIC_API_KEY=your-anthropic-api-key
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug
EOF
```

### Step 5: Install Dependencies and Migrate

```bash
# Install Node.js dependencies
npm install

# Run database migrations
npm run db:migrate

# Expected output:
# ✓ Base schema applied
# ✓ 001_initial_schema.sql completed
# ...
# ✓ 014_duplicate_detection.sql completed
# ✓ All migrations completed successfully
```

### Step 6: Start Backend

**Terminal 1 - Backend Server:**
```bash
npm run dev

# Wait for:
# ✓ Database connected
# ✓ Redis connected
# Server listening on port 4000
```

**Terminal 2 - Worker (for background jobs):**
```bash
npm run worker

# Wait for:
# Worker started
# ✓ Database connected
# ✓ Redis connected
```

### Step 7: Follow Steps 3-7 from Option 1

Continue with "Create Test User" and subsequent steps.

## Quick Verification Checklist

After setup, verify everything works:

- [ ] Backend responds at `http://localhost:4000/health`
- [ ] Can register and login user
- [ ] Can upload CSV file
- [ ] File processing completes (check `GET /api/files/:id`)
- [ ] Deals are extracted (check `GET /api/deals`)
- [ ] Duplicate detection works (check `GET /api/duplicates/statistics`)
- [ ] Quality metrics calculate (check `GET /api/quality/score`)

## Troubleshooting

### Database Connection Failed

```bash
# Check PostgreSQL is running
psql postgresql://dealreg_user:dealreg_password@localhost:5432/dealreg -c "SELECT 1;"

# If fails, check service status
sudo systemctl status postgresql  # Linux
brew services list | grep postgresql  # macOS
```

### Redis Connection Failed

```bash
# Check Redis is running
redis-cli ping
# Expected: PONG

# If fails, check service status
sudo systemctl status redis  # Linux
brew services list | grep redis  # macOS
```

### Backend Won't Start

```bash
# Check if port 4000 is in use
lsof -i :4000

# If in use, kill the process or change PORT in .env
kill -9 <PID>
```

### Migrations Fail

```bash
# Drop and recreate database (WARNING: deletes all data)
sudo -u postgres psql <<EOF
DROP DATABASE IF EXISTS dealreg;
CREATE DATABASE dealreg;
\c dealreg
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
\q
EOF

# Rerun migrations
npm run db:migrate
```

### AI Extraction Not Working

```bash
# Check ANTHROPIC_API_KEY is set
grep ANTHROPIC_API_KEY backend/.env

# Test API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":100,"messages":[{"role":"user","content":"test"}]}'

# If fails, get a new API key from https://console.anthropic.com/
```

## Testing All 44 Phase 6 Endpoints

Once setup is complete, see `PHASE_6_TESTING_GUIDE.md` for comprehensive endpoint testing.

### Quick smoke test (15 endpoints):

```bash
#!/bin/bash

# Set your token
export TOKEN="your-jwt-token"

echo "Testing Phase 6 Endpoints..."

# 1. Duplicate Detection
echo "1. Get duplicate statistics"
curl -s "http://localhost:4000/api/duplicates/statistics?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 2. Get duplicate config
echo "2. Get duplicate detection config"
curl -s "http://localhost:4000/api/duplicates/config" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 3. Get clusters
echo "3. Get duplicate clusters"
curl -s "http://localhost:4000/api/duplicates/clusters?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 4. Get high confidence duplicates
echo "4. Get high confidence duplicates"
curl -s "http://localhost:4000/api/duplicates/high-confidence?threshold=0.85" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 5. Merge strategies
echo "5. Get merge strategies"
curl -s "http://localhost:4000/api/merge/strategies" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 6. Merge statistics
echo "6. Get merge statistics"
curl -s "http://localhost:4000/api/merge/statistics?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 7. Merge history
echo "7. Get merge history"
curl -s "http://localhost:4000/api/merge/history?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 8. Quality score
echo "8. Get quality score"
curl -s "http://localhost:4000/api/quality/score?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 9. Quality trends
echo "9. Get quality trends"
curl -s "http://localhost:4000/api/quality/trends?entityType=deal&days=30" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 10. Quality issues
echo "10. Get quality issues"
curl -s "http://localhost:4000/api/quality/issues?entityType=deal&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 11. Quality report
echo "11. Get quality report"
curl -s "http://localhost:4000/api/quality/report?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 12. Quality dashboard
echo "12. Get quality dashboard"
curl -s "http://localhost:4000/api/quality/dashboard?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 13. Correlation statistics
echo "13. Get correlation statistics"
curl -s "http://localhost:4000/api/correlation/statistics?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 14. Multi-source entities
echo "14. Get multi-source entities"
curl -s "http://localhost:4000/api/correlation/multi-source?entityType=deal&minSources=1" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

# 15. Duplicate summary
echo "15. Get duplicate summary"
curl -s "http://localhost:4000/api/quality/duplicates-summary?entityType=deal" \
  -H "Authorization: Bearer $TOKEN" | jq '.success'

echo "✓ Smoke test complete!"
```

Save as `smoke-test.sh`, chmod +x, and run.

## Next Steps

1. **Complete Testing**: Follow `PHASE_6_TESTING_GUIDE.md` for comprehensive testing
2. **Load Testing**: Use Apache Bench or similar tools for performance testing
3. **Integration Testing**: Test end-to-end workflows
4. **Phase 7**: Review `PHASE_7_PLAN.md` for next features

## Support

- **Documentation**: See `PHASE_6_COMPLETE_SUMMARY.md`
- **API Reference**: See `PHASE_6_TESTING_GUIDE.md`
- **Deployment**: See `DEPLOYMENT_CHECKLIST.md`

---

**Setup Time**: 5-15 minutes
**Test Time**: 15-30 minutes for smoke test, 2-4 hours for comprehensive testing
