# Quick Start Guide - Claude Skills Testing

**Last Updated**: December 17, 2025

---

## 🚀 Get Started in 15 Minutes

This guide helps you quickly deploy and test Claude Skills in staging environment.

---

## Prerequisites

✅ **Required**:
- Claude API key from https://console.anthropic.com/
- PostgreSQL database running
- Redis cache running
- Node.js 18+ installed

---

## Step 1: Configure Environment (5 minutes)

Create `backend/.env`:

```bash
# Copy example configuration
cp backend/.env.example backend/.env

# Edit the following critical variables:
ANTHROPIC_API_KEY=sk-ant-YOUR-API-KEY-HERE
CLAUDE_API_KEY=sk-ant-YOUR-API-KEY-HERE
CLAUDE_SKILLS_ENABLED=true
FEATURE_INTELLIGENT_COLUMN_MAPPING=true
FEATURE_SEMANTIC_ENTITY_EXTRACTION=true
FEATURE_SEMANTIC_DUPLICATE_DETECTION=true
LOG_LEVEL=debug
```

**Verify API Key**:
```bash
# Test your API key works
export ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "claude-3-5-sonnet-20240620", "max_tokens": 1, "messages": [{"role": "user", "content": "test"}]}'
```

---

## Step 2: Start Services (5 minutes)

```bash
# Install dependencies
cd backend
npm install

# Start Redis (if not already running)
redis-server &

# Start backend
npm start

# In new terminal: Start frontend
cd frontend
npm install
npm start
```

**Verify Services**:
```bash
# Check backend
curl http://localhost:4000/api/health
# Expected: {"status":"ok"}

# Check Redis
redis-cli ping
# Expected: PONG

# Check logs show skills initialized
tail -f backend/logs/app.log | grep "skill initialized"
# Expected: See 4 skills initialize
```

---

## Step 3: Quick Smoke Test (5 minutes)

### Test 1: Upload Test Spreadsheet

Create `test-vendor.csv`:
```csv
Opportunity,Stage,Revenue
Test Deal Alpha,Qualified,$500K
Test Deal Beta,Proposal,€250000
```

Upload via UI or API:
```bash
# Via API
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-vendor.csv" \
  -F "intent=vendor_deals"
```

**Check Logs**:
```bash
tail -100 backend/logs/app.log | grep -A5 "IntelligentColumnMapper"
```

**Expected Output**:
```
[INFO] Using IntelligentColumnMapper skill for dynamic column mapping
[INFO] IntelligentColumnMapper result { mappingCount: 3, averageConfidence: 0.95 }
[INFO] Column mapping complete
```

### Test 2: Verify Cache Works

Upload the same file again:
```bash
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-vendor.csv" \
  -F "intent=vendor_deals"
```

**Check for Cache Hit**:
```bash
tail -50 backend/logs/app.log | grep "retrieved from cache"
```

**Expected**: Should see cache hit message on second upload.

---

## ✅ Success Checklist

- [ ] Backend started without errors
- [ ] Skills initialized (4 messages in logs)
- [ ] Test file uploaded successfully
- [ ] IntelligentColumnMapper invoked (check logs)
- [ ] Second upload showed cache hit
- [ ] No authentication errors
- [ ] Frontend displays uploaded data

---

## 🎯 Next Steps

### 1. Run Comprehensive Tests

Follow [TESTING_GUIDE.md](./TESTING_GUIDE.md) for full test suite:
- Phase 1: Feature Flag Testing
- Phase 2: IntelligentColumnMapper Testing (custom formats)
- Phase 3: SemanticEntityExtractor Testing (emails, transcripts)
- Phase 4: SemanticDuplicateDetector Testing (fuzzy matching)
- Phase 5: End-to-End Integration Testing

**Time Required**: 8-10 hours for complete testing

### 2. Monitor Costs & Performance

Track daily:
- Claude API usage: https://console.anthropic.com/settings/usage
- Expected first day: $3-5 for testing
- Expected monthly: $65-80 with caching

Monitor cache hit rate:
```bash
# Cache hits
grep "retrieved from cache" backend/logs/app.log | wc -l

# Cache misses
grep "with Claude" backend/logs/app.log | wc -l

# Calculate hit rate
# Hit Rate = Hits / (Hits + Misses) * 100%
# Target: 50-80% after initial uploads
```

### 3. Production Deployment

After successful staging validation:
1. Deploy to production with `CLAUDE_SKILLS_ENABLED=false` first
2. Enable skills for 10% of traffic
3. Monitor for 1 week
4. Gradually increase to 50%, then 100%

---

## 🐛 Quick Troubleshooting

### Issue: Skills Not Initializing

**Symptoms**: No "skill initialized" messages in logs

**Fix**:
```bash
# Check environment variable
cd backend
node -e "console.log(process.env.CLAUDE_SKILLS_ENABLED)"
# Should print: true

# Restart backend after fixing .env
npm start
```

---

### Issue: Authentication Failed

**Symptoms**: 401 errors, "Authentication failed" in logs

**Fix**:
```bash
# Verify API key format
echo $ANTHROPIC_API_KEY | head -c 10
# Should print: sk-ant-api

# Test API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "claude-3-5-sonnet-20240620", "max_tokens": 1, "messages": [{"role": "user", "content": "test"}]}'

# If fails, regenerate key at console.anthropic.com
```

---

### Issue: No Cache Hits

**Symptoms**: Every upload shows "with Claude", never "retrieved from cache"

**Fix**:
```bash
# Check Redis running
redis-cli ping
# Should return: PONG

# Check cache enabled in .env
grep AI_CACHE_ENABLED backend/.env
# Should be: AI_CACHE_ENABLED=true

# Restart backend
npm start
```

---

### Issue: High Costs

**Symptoms**: >$10/day during testing

**Fix**:
```bash
# Verify cache working
grep "retrieved from cache" backend/logs/app.log | wc -l
# Should increase with repeat uploads

# Reduce token limit in .env
AI_MAX_TOKENS=2000  # Down from 4000

# Check for duplicate uploads
grep "Extracting entities with Claude" backend/logs/app.log | wc -l
# Should not grow linearly with all uploads
```

---

## 📚 Documentation Reference

| Document | Purpose | Time to Read |
|----------|---------|--------------|
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | Comprehensive test procedures | 30 min |
| [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) | Full deployment steps | 20 min |
| [CLAUDE_SKILLS_INTEGRATION.md](./CLAUDE_SKILLS_INTEGRATION.md) | Technical integration details | 45 min |
| [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) | Overall project status | 15 min |

---

## 💡 Key Tips

1. **Start Small**: Test with 10-20 files first, then scale up
2. **Monitor Costs**: Check Claude dashboard daily during testing
3. **Use Cache**: Re-upload same files to test cache effectiveness
4. **Debug Mode**: Keep `LOG_LEVEL=debug` during testing
5. **Fallback Works**: Disable skills to verify regex fallback still works

---

## 🎉 Success Metrics

After 1 week of testing, you should see:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Column Mapping Accuracy | 95%+ | Manual verification of extracted fields |
| Entity Extraction Accuracy | 85%+ | Compare AI vs manual extraction |
| Duplicate Detection Accuracy | 95%+ | Check false positives/negatives |
| Cache Hit Rate | 50-80% | `grep "cache" logs \| analysis` |
| Daily API Cost | <$5 | Claude dashboard |
| Processing Speed | <30 sec/100 rows | Log timestamps |

---

## 🔗 Support & Resources

- **Claude API Docs**: https://docs.anthropic.com/
- **Claude Console**: https://console.anthropic.com/
- **API Status**: https://status.anthropic.com/
- **Pricing**: https://www.anthropic.com/pricing

**For Issues**:
1. Check [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) troubleshooting section
2. Review [CLAUDE_SKILLS_INTEGRATION.md](./CLAUDE_SKILLS_INTEGRATION.md) integration details
3. Check backend logs: `tail -100 backend/logs/app.log`

---

## 🚦 What's Next?

### If Everything Works ✅

**Immediate**:
- Run full test suite ([TESTING_GUIDE.md](./TESTING_GUIDE.md))
- Document test results
- Share findings with team

**This Week**:
- Test with real production files
- Measure actual accuracy improvements
- Calculate real monthly costs

**This Month**:
- Plan production rollout (gradual: 10% → 50% → 100%)
- Set up monitoring dashboards
- Train team on new capabilities

### If Issues Occur ⚠️

**Rollback Options**:
1. Disable all skills: `CLAUDE_SKILLS_ENABLED=false`
2. Disable specific skill: `FEATURE_INTELLIGENT_COLUMN_MAPPING=false`
3. Revert to previous version: `git checkout <previous-commit>`

**Investigation**:
- Check logs: `backend/logs/app.log`
- Test API key manually
- Verify Redis connection
- Check disk space for uploads

---

**Ready to Begin?** Start with Step 1 above ⬆️

**Questions?** Refer to comprehensive guides in [docs/](.)

**Good luck with your testing!** 🚀
