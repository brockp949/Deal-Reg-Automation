# Deal Registration Automation - Deployment Checklist

## Overview

This checklist covers the complete deployment process for the Deal Registration Automation system, including all implemented phases (1-6) and preparation for Phase 7.

**Current Implementation Status**:
- ✅ Phase 1-3: Core functionality (file upload, parsing, basic extraction)
- ✅ Phase 4: AI Extraction & Validation
- ✅ Phase 5: Vendor Matching & Aliases
- ✅ Phase 6: Duplicate Detection, Merge, Correlation, Quality Metrics
- 📋 Phase 7: Automated Workflows & Approval Systems (planned)

## Pre-Deployment Checklist

### Infrastructure Requirements

#### Database
- [ ] PostgreSQL 14+ installed and running
- [ ] Database created: `dealreg`
- [ ] Database user created with appropriate permissions
- [ ] Connection pooling configured (recommended: max 20 connections)
- [ ] Database backup strategy in place
- [ ] Point-in-time recovery enabled

#### Redis
- [ ] Redis 6+ installed and running
- [ ] Redis persistence enabled (AOF + RDB)
- [ ] Redis maxmemory policy configured
- [ ] Redis backup strategy in place

#### Node.js Environment
- [ ] Node.js 18+ installed
- [ ] npm or yarn package manager
- [ ] Process manager installed (PM2 recommended)
- [ ] Environment supports long-running processes

#### Storage
- [ ] Sufficient disk space for file uploads (minimum 100GB recommended)
- [ ] File system supports large files (5GB+ per file)
- [ ] Backup storage configured for uploaded files
- [ ] Virus scanning solution available (ClamAV or stub)

#### Network
- [ ] Firewall rules configured
  - PostgreSQL port (5432) accessible from backend
  - Redis port (6379) accessible from backend
  - Backend API port (4000) accessible from frontend
  - Frontend port (3000) accessible from users
- [ ] SSL/TLS certificates obtained (for production)
- [ ] Domain names configured (if applicable)

### Environment Configuration

#### Backend Environment Variables

Create `/backend/.env` file:

```bash
# Server Configuration
NODE_ENV=production
PORT=4000
API_PREFIX=/api

# Database
DATABASE_URL=postgresql://dealreg_user:SECURE_PASSWORD@localhost:5432/dealreg

# Redis
REDIS_URL=redis://localhost:6379

# JWT Authentication
JWT_SECRET=GENERATE_SECURE_RANDOM_STRING_HERE  # Use: openssl rand -base64 64
JWT_EXPIRES_IN=7d

# File Upload
UPLOAD_DIR=/var/dealreg/uploads
MAX_FILE_SIZE=5368709120  # 5GB
ALLOWED_FILE_TYPES=.mbox,.csv,.txt,.pdf,.docx,.json
CONFIG_STORAGE_DIR=/var/dealreg/config-uploads

# Virus Scanning
VIRUS_SCAN_PROVIDER=clamav  # or 'stub' for development
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
VIRUS_SCAN_FAIL_OPEN=false  # Set to 'true' in development only

# AI Services - CRITICAL FOR PHASE 4+
ANTHROPIC_API_KEY=sk-ant-...  # Required for Claude AI extraction
OPENAI_API_KEY=sk-...  # Optional, for future use

# Email Service - REQUIRED FOR NOTIFICATIONS
SMTP_HOST=smtp.gmail.com  # Or your SMTP provider
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM=Deal Reg System <noreply@dealreg.com>

# CORS
CORS_ORIGIN=https://your-frontend-domain.com  # Or http://localhost:3000 for dev

# Logging
LOG_LEVEL=info  # 'debug' for development, 'info' for production

# Phase 7 - Workflows & Notifications (Future)
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
# TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
```

**Security Notes**:
- [ ] All secrets are generated securely (use `openssl rand -base64 32`)
- [ ] `.env` file has restrictive permissions (600)
- [ ] `.env` is in `.gitignore` (NEVER commit to git)
- [ ] Secrets are rotated regularly (recommended: quarterly)

#### Frontend Environment Variables

Create `/frontend/.env.production`:

```bash
REACT_APP_API_URL=https://api.your-domain.com
REACT_APP_ENVIRONMENT=production
```

### Directory Structure Setup

```bash
# Create necessary directories
sudo mkdir -p /var/dealreg/uploads
sudo mkdir -p /var/dealreg/config-uploads
sudo mkdir -p /var/dealreg/logs
sudo mkdir -p /var/dealreg/backups

# Set ownership (replace 'appuser' with your application user)
sudo chown -R appuser:appuser /var/dealreg

# Set permissions
sudo chmod 755 /var/dealreg
sudo chmod 700 /var/dealreg/uploads
sudo chmod 700 /var/dealreg/config-uploads
sudo chmod 755 /var/dealreg/logs
sudo chmod 700 /var/dealreg/backups
```

## Database Setup

### Step 1: Create Database and User

```sql
-- Connect as PostgreSQL superuser
sudo -u postgres psql

-- Create database
CREATE DATABASE dealreg;

-- Create user
CREATE USER dealreg_user WITH PASSWORD 'SECURE_PASSWORD_HERE';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE dealreg TO dealreg_user;

-- Connect to database
\c dealreg

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO dealreg_user;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Exit
\q
```

### Step 2: Run Migrations

```bash
cd backend

# Install dependencies first
npm install

# Run migrations
npm run db:migrate

# Expected output:
# Running database migrations...
# Running base schema...
# ✓ Base schema applied
# Running migration: 001_initial_schema.sql...
# ✓ 001_initial_schema.sql completed
# ...
# Running migration: 014_duplicate_detection.sql...
# ✓ 014_duplicate_detection.sql completed
# ✓ All migrations completed successfully
```

### Step 3: Verify Database Schema

```bash
# Connect to database
psql $DATABASE_URL

# List all tables
\dt

# Expected tables (partial list):
# - users
# - files
# - deals
# - vendors
# - contacts
# - validation_rules
# - validation_results
# - vendor_aliases
# - vendor_approvals
# - duplicate_detections
# - duplicate_clusters
# - merge_history
# - field_conflicts

# Check specific Phase 6 tables
SELECT COUNT(*) FROM duplicate_detections;
SELECT COUNT(*) FROM duplicate_clusters;
SELECT COUNT(*) FROM merge_history;

# Exit
\q
```

### Step 4: Seed Database (Optional)

```bash
# Seed with initial data (users, roles, etc.)
npm run db:seed
```

## Application Deployment

### Backend Deployment

#### Step 1: Build Application

```bash
cd backend

# Install dependencies
npm install --production

# Run TypeScript compilation
npm run build

# Verify build succeeded
ls -la dist/
# Should see compiled .js files
```

#### Step 2: Start Backend Server

**Option A: Using PM2 (Recommended)**

```bash
# Install PM2 globally
npm install -g pm2

# Start backend
pm2 start dist/index.js --name dealreg-backend

# Start worker (for background jobs)
pm2 start dist/workers/index.js --name dealreg-worker

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
# Follow the instructions to enable PM2 on system boot

# Check status
pm2 status
pm2 logs dealreg-backend
```

**Option B: Using systemd**

Create `/etc/systemd/system/dealreg-backend.service`:

```ini
[Unit]
Description=Deal Registration Backend API
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=appuser
WorkingDirectory=/path/to/Deal-Reg-Automation/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:/var/dealreg/logs/backend.log
StandardError=append:/var/dealreg/logs/backend-error.log

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable dealreg-backend
sudo systemctl start dealreg-backend

# Check status
sudo systemctl status dealreg-backend

# View logs
sudo journalctl -u dealreg-backend -f
```

#### Step 3: Verify Backend is Running

```bash
# Test health endpoint
curl http://localhost:4000/health

# Expected response:
# {"status":"ok","timestamp":"2024-01-15T10:00:00.000Z"}

# Test database connection
curl http://localhost:4000/api/health/db

# Test Redis connection
curl http://localhost:4000/api/health/redis
```

### Frontend Deployment

#### Step 1: Build Frontend

```bash
cd frontend

# Install dependencies
npm install

# Build production bundle
npm run build

# Verify build
ls -la build/
# Should see static assets
```

#### Step 2: Deploy Frontend

**Option A: Nginx (Recommended)**

Create `/etc/nginx/sites-available/dealreg`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS (if SSL configured)
    # return 301 https://$server_name$request_uri;

    root /path/to/Deal-Reg-Automation/frontend/build;
    index index.html;

    # Frontend routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to backend
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Increase timeouts for large file uploads
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    # File upload size limit
    client_max_body_size 5G;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

**For HTTPS (Production)**:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # ... rest of configuration same as above
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/dealreg /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

**Option B: Serve with Node.js**

```bash
# Install serve globally
npm install -g serve

# Serve build directory
serve -s build -l 3000

# Or with PM2
pm2 serve build 3000 --name dealreg-frontend --spa
```

## Post-Deployment Verification

### Functional Testing

#### 1. User Authentication
```bash
# Register new user
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "SecurePassword123!",
    "name": "Admin User"
  }'

# Login
TOKEN=$(curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "SecurePassword123!"
  }' | jq -r '.token')

echo "Token: $TOKEN"
```

#### 2. File Upload
```bash
# Create test CSV file
cat > test-deals.csv <<EOF
Deal Name,Customer Name,Vendor,Deal Value,Currency
Test Deal 1,Acme Corp,Microsoft,50000,USD
Test Deal 2,TechStart Inc,Oracle,75000,USD
EOF

# Upload file
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test-deals.csv"

# Expected: File uploaded successfully with file ID
```

#### 3. AI Extraction (Phase 4)
```bash
# Check if file was processed
FILE_ID="<file-id-from-upload>"

curl "http://localhost:4000/api/files/$FILE_ID" \
  -H "Authorization: Bearer $TOKEN"

# Verify extraction_status is 'completed'
```

#### 4. Vendor Matching (Phase 5)
```bash
# Check vendors were extracted and matched
curl "http://localhost:4000/api/vendors?limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Check vendor aliases
curl "http://localhost:4000/api/vendors/aliases" \
  -H "Authorization: Bearer $TOKEN"
```

#### 5. Duplicate Detection (Phase 6)
```bash
# Get duplicate statistics
curl "http://localhost:4000/api/duplicates/statistics?entityType=deal" \
  -H "Authorization: Bearer $TOKEN"

# Get quality score
curl "http://localhost:4000/api/quality/score?entityType=deal" \
  -H "Authorization: Bearer $TOKEN"
```

### Performance Testing

```bash
# Test API response time
for i in {1..100}; do
  curl -w "Time: %{time_total}s\n" -o /dev/null -s \
    "http://localhost:4000/api/deals" \
    -H "Authorization: Bearer $TOKEN"
done | grep "Time:" | awk '{sum+=$2; count++} END {print "Average:", sum/count, "seconds"}'

# Should be < 0.5 seconds average
```

### Database Health Check

```bash
# Check table sizes
psql $DATABASE_URL -c "
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 20;
"

# Check active connections
psql $DATABASE_URL -c "
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE state = 'active';
"

# Should be < max_connections
```

### Redis Health Check

```bash
# Check Redis connection
redis-cli ping
# Expected: PONG

# Check memory usage
redis-cli INFO memory | grep used_memory_human

# Check connected clients
redis-cli INFO clients | grep connected_clients
```

## Monitoring Setup

### Application Logging

**Backend Logging Configuration** (already in code via Winston):

```typescript
// backend/src/utils/logger.ts
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: '/var/dealreg/logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: '/var/dealreg/logs/combined.log'
    })
  ]
});
```

**Log Rotation** (using logrotate):

Create `/etc/logrotate.d/dealreg`:

```
/var/dealreg/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 appuser appuser
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Health Monitoring Endpoints

Already implemented:
- `GET /health` - Basic health check
- `GET /api/health/db` - Database connectivity
- `GET /api/health/redis` - Redis connectivity

Add to monitoring system:
```bash
# Example with uptime monitoring
# Check every 1 minute
*/1 * * * * curl -f http://localhost:4000/health || echo "Backend is down!" | mail -s "Alert: Backend Down" admin@example.com
```

### Database Monitoring

```sql
-- Create monitoring view
CREATE VIEW system_health AS
SELECT
  (SELECT count(*) FROM workflow_instances WHERE completed_at IS NULL) as active_workflows,
  (SELECT count(*) FROM approval_requests WHERE status = 'pending') as pending_approvals,
  (SELECT count(*) FROM files WHERE processing_status = 'processing') as processing_files,
  (SELECT count(*) FROM duplicate_detections WHERE status = 'pending') as pending_duplicates,
  (SELECT pg_size_pretty(pg_database_size(current_database()))) as database_size;

-- Check health
SELECT * FROM system_health;
```

### Metrics to Monitor

#### Application Metrics
- [ ] API response times (p50, p95, p99)
- [ ] Error rate (< 1%)
- [ ] Request throughput (requests/second)
- [ ] Active users
- [ ] File upload success rate

#### Infrastructure Metrics
- [ ] CPU usage (< 80%)
- [ ] Memory usage (< 85%)
- [ ] Disk usage (< 80%)
- [ ] Network I/O
- [ ] Database connections (< 80% of max)

#### Business Metrics
- [ ] Files processed per day
- [ ] Deals extracted per day
- [ ] Duplicate detection accuracy
- [ ] Data quality score trends
- [ ] Approval cycle time

## Backup & Disaster Recovery

### Database Backups

**Automated Daily Backups**:

Create `/usr/local/bin/backup-dealreg-db.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/var/dealreg/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/dealreg_$TIMESTAMP.sql.gz"

# Create backup
pg_dump $DATABASE_URL | gzip > $BACKUP_FILE

# Remove backups older than 30 days
find $BACKUP_DIR -name "dealreg_*.sql.gz" -mtime +30 -delete

# Upload to S3 (optional)
# aws s3 cp $BACKUP_FILE s3://your-bucket/backups/

echo "Backup completed: $BACKUP_FILE"
```

```bash
# Make executable
chmod +x /usr/local/bin/backup-dealreg-db.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add line:
0 2 * * * /usr/local/bin/backup-dealreg-db.sh >> /var/dealreg/logs/backup.log 2>&1
```

### File Backups

```bash
# Daily backup of uploaded files
rsync -avz --delete /var/dealreg/uploads/ /backup/dealreg-uploads/

# Or to remote server
rsync -avz --delete /var/dealreg/uploads/ user@backup-server:/backup/dealreg-uploads/

# Or to S3
aws s3 sync /var/dealreg/uploads/ s3://your-bucket/uploads/
```

### Restore Procedure

**Database Restore**:
```bash
# Restore from backup
gunzip < /var/dealreg/backups/dealreg_20240115_020000.sql.gz | psql $DATABASE_URL
```

**File Restore**:
```bash
# Restore files
rsync -avz /backup/dealreg-uploads/ /var/dealreg/uploads/
```

## Security Hardening

### Application Security

- [ ] **Authentication**: JWT tokens with secure secrets
- [ ] **Authorization**: Role-based access control (RBAC)
- [ ] **Input Validation**: All user inputs validated
- [ ] **SQL Injection**: Using parameterized queries
- [ ] **XSS Protection**: React's built-in escaping + Content Security Policy
- [ ] **CSRF Protection**: CSRF tokens for state-changing operations
- [ ] **Rate Limiting**: API rate limits configured
- [ ] **File Upload Security**: File type validation, size limits, virus scanning

### Infrastructure Security

- [ ] **Firewall**: Only necessary ports open
- [ ] **SSL/TLS**: HTTPS enabled for production
- [ ] **Database**: Not exposed to internet
- [ ] **Redis**: Password authentication enabled
- [ ] **OS Updates**: Regular security patches
- [ ] **User Permissions**: Principle of least privilege
- [ ] **Secrets Management**: Environment variables, not in code

### Security Checklist

```bash
# Check file permissions
ls -la /var/dealreg/uploads  # Should be 700
ls -la backend/.env          # Should be 600

# Check PostgreSQL access
psql $DATABASE_URL -c "SHOW hba_file;"
cat $(psql $DATABASE_URL -t -c "SHOW hba_file;") | grep -v "^#"
# Verify no external access without password

# Check Redis authentication
redis-cli CONFIG GET requirepass
# Should return a password if configured

# Check for exposed secrets
grep -r "sk-ant-" backend/src/  # Should return nothing
grep -r "password" backend/src/  # Should return nothing
```

## Troubleshooting Guide

### Common Issues

#### Backend Won't Start

```bash
# Check logs
pm2 logs dealreg-backend

# Common causes:
# 1. Database connection failed
psql $DATABASE_URL -c "SELECT 1;"

# 2. Redis connection failed
redis-cli ping

# 3. Port already in use
lsof -i :4000

# 4. Missing environment variables
cat backend/.env | grep -E "DATABASE_URL|REDIS_URL|JWT_SECRET"
```

#### File Upload Fails

```bash
# Check disk space
df -h /var/dealreg/uploads

# Check permissions
ls -la /var/dealreg/uploads

# Check file size limit
grep MAX_FILE_SIZE backend/.env

# Check virus scanner (if enabled)
systemctl status clamav-daemon
```

#### AI Extraction Not Working

```bash
# Check API key
grep ANTHROPIC_API_KEY backend/.env

# Test API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":100,"messages":[{"role":"user","content":"test"}]}'

# Check extraction logs
grep "AI extraction" /var/dealreg/logs/combined.log
```

#### Duplicates Not Detected

```bash
# Check correlation keys are populated
psql $DATABASE_URL -c "SELECT COUNT(*) FROM deals WHERE correlation_key IS NULL;"

# If many are null, update correlation keys
curl -X POST http://localhost:4000/api/correlation/update-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entityType": "deal"}'
```

#### High Memory Usage

```bash
# Check Node.js memory
pm2 monit

# Check PostgreSQL memory
psql $DATABASE_URL -c "
SELECT
  pid,
  usename,
  application_name,
  pg_size_pretty(pg_total_relation_size('deals')) as deals_size,
  state
FROM pg_stat_activity;
"

# Check Redis memory
redis-cli INFO memory
```

### Performance Optimization

#### Database Optimization

```sql
-- Analyze database
VACUUM ANALYZE;

-- Check slow queries
SELECT
  query,
  calls,
  total_time / 1000 as total_seconds,
  mean_time / 1000 as mean_seconds
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;

-- Check missing indexes
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND n_distinct > 100
  AND correlation < 0.1;
```

#### Application Optimization

```bash
# Enable Node.js production mode
export NODE_ENV=production

# Increase Node.js memory (if needed)
pm2 start dist/index.js --name dealreg-backend --node-args="--max-old-space-size=4096"

# Enable cluster mode (use all CPU cores)
pm2 start dist/index.js --name dealreg-backend -i max
```

## Rollback Procedure

### Application Rollback

```bash
# Stop current version
pm2 stop dealreg-backend dealreg-worker

# Checkout previous version
cd /path/to/Deal-Reg-Automation
git checkout <previous-commit-hash>

# Rebuild
cd backend
npm install
npm run build

# Restart
pm2 restart dealreg-backend dealreg-worker
```

### Database Rollback

```bash
# Restore from backup
gunzip < /var/dealreg/backups/dealreg_YYYYMMDD_HHMMSS.sql.gz | psql $DATABASE_URL

# Or use point-in-time recovery (if configured)
# Consult PostgreSQL documentation for PITR
```

## Production Readiness Checklist

### Before Go-Live

- [ ] All migrations applied successfully
- [ ] Test data cleared from production database
- [ ] All environment variables configured correctly
- [ ] SSL/TLS certificates installed and verified
- [ ] Monitoring and alerting configured
- [ ] Backup procedures tested (including restore)
- [ ] Load testing completed successfully
- [ ] Security audit performed
- [ ] Documentation reviewed and updated
- [ ] Disaster recovery plan documented
- [ ] On-call rotation established
- [ ] User training completed
- [ ] Change management approval obtained

### Go-Live Verification

- [ ] All services running (backend, worker, frontend)
- [ ] Health endpoints responding correctly
- [ ] Authentication working
- [ ] File upload working
- [ ] AI extraction working (test with sample file)
- [ ] Duplicate detection working
- [ ] Quality metrics calculating correctly
- [ ] Email notifications sending (if configured)
- [ ] Logs being written correctly
- [ ] Metrics being collected
- [ ] Backups running on schedule

### Post-Go-Live

- [ ] Monitor error logs for 48 hours
- [ ] Verify all automated jobs running
- [ ] Check disk space daily for first week
- [ ] Review performance metrics
- [ ] Collect user feedback
- [ ] Document any issues and resolutions
- [ ] Schedule post-mortem meeting

## Support & Maintenance

### Regular Maintenance Tasks

**Daily**:
- [ ] Check application logs for errors
- [ ] Verify backups completed successfully
- [ ] Monitor disk space

**Weekly**:
- [ ] Review performance metrics
- [ ] Check for security updates
- [ ] Analyze slow queries
- [ ] Review user feedback

**Monthly**:
- [ ] Database vacuum and analyze
- [ ] Review and rotate logs
- [ ] Update dependencies
- [ ] Review and update documentation
- [ ] Backup retention review

**Quarterly**:
- [ ] Security audit
- [ ] Disaster recovery drill
- [ ] Performance tuning
- [ ] Capacity planning review
- [ ] Rotate secrets and API keys

### Escalation Contacts

```
Level 1: Application Support
  - Response Time: 1 hour
  - Contact: support@example.com
  - On-call: +1-XXX-XXX-XXXX

Level 2: Engineering Team
  - Response Time: 30 minutes
  - Contact: engineering@example.com
  - On-call: +1-XXX-XXX-XXXX

Level 3: Infrastructure Team
  - Response Time: 15 minutes
  - Contact: infrastructure@example.com
  - On-call: +1-XXX-XXX-XXXX
```

## Compliance & Auditing

### Audit Trail

The system maintains complete audit trails:
- All user actions logged
- All workflow state changes tracked
- All merge operations recorded
- All approval decisions logged
- All file uploads tracked

### Compliance Requirements

- [ ] Data retention policies configured
- [ ] GDPR compliance (if applicable)
  - User data export functionality
  - User data deletion functionality
  - Privacy policy displayed
  - Cookie consent obtained
- [ ] SOC 2 compliance (if applicable)
  - Access controls documented
  - Change management process
  - Incident response plan
  - Regular security assessments

### Audit Queries

```sql
-- User activity audit
SELECT
  u.email,
  COUNT(*) as actions,
  MAX(created_at) as last_action
FROM audit_log al
JOIN users u ON al.user_id = u.id
WHERE created_at > CURRENT_DATE - INTERVAL '30 days'
GROUP BY u.email
ORDER BY actions DESC;

-- File processing audit
SELECT
  file_name,
  uploaded_by,
  processing_status,
  entities_extracted,
  created_at
FROM files
WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Approval audit
SELECT
  ar.id,
  d.deal_name,
  ad.approver_id,
  ad.decision,
  ad.decided_at
FROM approval_decisions ad
JOIN approval_requests ar ON ad.approval_request_id = ar.id
JOIN deals d ON ar.entity_id = d.id
WHERE ad.decided_at > CURRENT_DATE - INTERVAL '30 days';
```

---

## Summary

This deployment checklist covers:

✅ Infrastructure setup (PostgreSQL, Redis, Node.js)
✅ Environment configuration
✅ Database migrations
✅ Application deployment (backend & frontend)
✅ Post-deployment verification
✅ Monitoring and logging
✅ Backup and disaster recovery
✅ Security hardening
✅ Troubleshooting guide
✅ Production readiness checklist

**Estimated Deployment Time**: 4-8 hours for experienced team

**Required Team Members**:
- 1 DevOps/Infrastructure Engineer
- 1 Backend Developer
- 1 Database Administrator (recommended)

**Next Steps**:
1. Review this checklist with deployment team
2. Set up staging environment first
3. Perform trial deployment on staging
4. Document any environment-specific configurations
5. Schedule production deployment window
6. Execute deployment
7. Monitor closely for 48 hours post-deployment

---

**Document Version**: 1.0
**Last Updated**: 2024-01-15
**Maintained By**: Engineering Team
