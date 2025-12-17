# What You Need to Do - Claude Skills Testing

**Created**: December 17, 2025

---

## ✅ What's Been Done (By AI)

I've completed all the development and documentation work:

### Code Integration ✅
- ✅ Integrated IntelligentColumnMapper into [vendorSpreadsheetParser.ts](backend/src/parsers/vendorSpreadsheetParser.ts)
- ✅ Integrated SemanticEntityExtractor into [enhancedMboxParserLayers.ts](backend/src/parsers/enhancedMboxParserLayers.ts)
- ✅ Integrated SemanticEntityExtractor into [enhancedTranscriptParser.ts](backend/src/parsers/enhancedTranscriptParser.ts)
- ✅ Integrated SemanticDuplicateDetector into [unifiedProcessingQueue.ts](backend/src/queues/unifiedProcessingQueue.ts)
- ✅ All integrations have layered fallback (AI → Regex)
- ✅ Feature flags configured
- ✅ No compilation errors

### Documentation ✅
- ✅ [QUICK_START.md](docs/QUICK_START.md) - 15-minute setup guide
- ✅ [DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) - Complete deployment steps
- ✅ [TESTING_GUIDE.md](docs/TESTING_GUIDE.md) - Comprehensive test procedures
- ✅ [CLAUDE_SKILLS_INTEGRATION.md](docs/CLAUDE_SKILLS_INTEGRATION.md) - Technical deep-dive
- ✅ [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) - Project status

### Automation ✅
- ✅ [scripts/verify-setup.js](scripts/verify-setup.js) - Verifies environment is ready
- ✅ [scripts/generate-test-data.js](scripts/generate-test-data.js) - Generates test files

### Configuration ✅
- ✅ [backend/.env.example](backend/.env.example) - Complete with all Claude Skills variables

---

## 🎯 What YOU Need to Do

Everything below requires YOUR action. I cannot do these because they require:
- Your Claude API key
- Running services on your machine
- Uploading files
- Monitoring costs

### Step 1: Get Claude API Key (5 minutes)

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to Settings → API Keys
4. Create a new API key
5. Copy the key (starts with `sk-ant-`)

**Cost**: Free tier available, or $20 minimum for paid tier

---

### Step 2: Configure Environment (5 minutes)

```bash
# 1. Copy example configuration
cp backend/.env.example backend/.env

# 2. Edit backend/.env and set these variables:
ANTHROPIC_API_KEY=sk-ant-YOUR-ACTUAL-KEY-HERE
CLAUDE_API_KEY=sk-ant-YOUR-ACTUAL-KEY-HERE
CLAUDE_SKILLS_ENABLED=true
FEATURE_INTELLIGENT_COLUMN_MAPPING=true
FEATURE_SEMANTIC_ENTITY_EXTRACTION=true
FEATURE_SEMANTIC_DUPLICATE_DETECTION=true
LOG_LEVEL=debug
```

---

### Step 3: Verify Setup (2 minutes)

```bash
# Run automated verification script
node scripts/verify-setup.js
```

This checks:
- ✅ .env configured correctly
- ✅ Redis running
- ✅ Node.js version correct
- ✅ Dependencies installed
- ✅ API key valid

**Expected Output**: All checks pass ✅

---

### Step 4: Start Services (3 minutes)

```bash
# Terminal 1: Start Redis (if not already running)
redis-server

# Terminal 2: Start backend
cd backend
npm start

# Check logs for skill initialization:
# "IntelligentColumnMapper skill initialized"
# "SemanticEntityExtractor skill initialized"
# "SemanticDuplicateDetector skill initialized"
```

---

### Step 5: Generate Test Data (1 minute)

```bash
# Generate test files
node scripts/generate-test-data.js

# Output: test-data/ directory with 8 test files
```

---

### Step 6: Run Smoke Test (5 minutes)

```bash
# Upload test file via API
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-data/test-standard.xlsx" \
  -F "intent=vendor_deals"

# Check logs:
tail -f backend/logs/app.log | grep "IntelligentColumnMapper"

# Expected: "Using IntelligentColumnMapper skill for dynamic column mapping"
```

---

### Step 7: Verify Cache Works (3 minutes)

```bash
# Upload same file again
curl -X POST http://localhost:4000/api/files/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-data/test-standard.xlsx" \
  -F "intent=vendor_deals"

# Check logs for cache hit:
tail -100 backend/logs/app.log | grep "retrieved from cache"

# Expected: Second upload uses cache (no API cost)
```

---

### Step 8: Run Full Test Suite (8-10 hours)

Follow [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md):
- Phase 1: Feature Flag Testing (30 min)
- Phase 2: IntelligentColumnMapper Testing (2-3 hours)
- Phase 3: SemanticEntityExtractor Testing (3-4 hours)
- Phase 4: SemanticDuplicateDetector Testing (2 hours)
- Phase 5: End-to-End Integration Testing (4-5 hours)
- Phase 6: Performance & Cost Monitoring (continuous)
- Phase 7: Error Handling & Fallback Testing (2 hours)

**Document Results**: Use test results template in TESTING_GUIDE.md

---

### Step 9: Monitor Costs (Daily)

1. Visit https://console.anthropic.com/settings/usage
2. Track API costs:
   - Day 1 (testing): ~$3-5
   - Expected monthly: $65-80 (with 50-80% cache hit rate)
3. Monitor cache hit rate:
   ```bash
   # Cache hits
   grep "retrieved from cache" backend/logs/app.log | wc -l

   # Total API calls
   grep "with Claude" backend/logs/app.log | wc -l
   ```

---

### Step 10: Validate Accuracy (1 week)

Measure improvements vs baseline:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Column Mapping Accuracy | 95%+ | Manual verification of extracted fields |
| Entity Extraction Accuracy | 85%+ | Compare AI vs manual extraction |
| Duplicate Detection Accuracy | 95%+ | Check false positives/negatives |
| Cache Hit Rate | 50-80% | Log analysis |
| Daily API Cost | <$5 | Claude dashboard |

---

## 🚦 Decision Points

### After Step 6 (Smoke Test)

**If Smoke Test Fails**:
- Check logs for errors
- Verify API key is valid
- Review [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) troubleshooting section
- Confirm Redis is running

**If Smoke Test Passes**:
- Proceed to Step 7 (verify cache)

---

### After Step 8 (Full Testing)

**If Accuracy < 85%**:
- Review test failures
- Tune confidence thresholds
- Check prompts in skill files
- Consider hybrid approach (AI + regex)
- Document edge cases

**If Accuracy >= 85%**:
- Proceed to production rollout plan
- Document test results
- Share findings with team

---

### Production Rollout Plan

**Week 1**: 10% of traffic
- Enable skills for 10% of uploads
- Monitor closely for errors
- Track costs daily

**Week 2**: 50% of traffic
- Increase to 50% if no issues
- Compare accuracy between AI and regex
- Optimize cache settings

**Week 3**: 100% of traffic
- Full rollout if metrics look good
- Set up monitoring dashboards
- Document lessons learned

---

## 📊 Success Checklist

Mark when completed:

- [ ] Step 1: Claude API key obtained
- [ ] Step 2: Environment configured (backend/.env)
- [ ] Step 3: Setup verified (verify-setup.js passes)
- [ ] Step 4: Services started (backend running, skills initialized)
- [ ] Step 5: Test data generated (test-data/ exists)
- [ ] Step 6: Smoke test passed (skills invoked successfully)
- [ ] Step 7: Cache verified (second upload uses cache)
- [ ] Step 8: Full test suite completed (8-10 hours)
- [ ] Step 9: Costs monitored (daily checks)
- [ ] Step 10: Accuracy validated (85-95% achieved)

**Overall Status**: ☐ Ready for Production

---

## 📞 Where to Get Help

### Quick Issues
- Check logs: `tail -f backend/logs/app.log`
- Run: `node scripts/verify-setup.js`
- Review: [docs/QUICK_START.md](docs/QUICK_START.md) troubleshooting section

### Deployment Issues
- Review: [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) troubleshooting
- Check environment variables in `.env`
- Verify Redis connection: `redis-cli ping`

### Testing Issues
- Follow: [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md)
- Use provided test data in `test-data/`
- Check Claude console for API errors

### Technical Questions
- Read: [docs/CLAUDE_SKILLS_INTEGRATION.md](docs/CLAUDE_SKILLS_INTEGRATION.md)
- Review skill code:
  - [IntelligentColumnMapper.ts](backend/src/skills/IntelligentColumnMapper.ts)
  - [SemanticEntityExtractor.ts](backend/src/skills/SemanticEntityExtractor.ts)
  - [SemanticDuplicateDetector.ts](backend/src/skills/SemanticDuplicateDetector.ts)

---

## 🎯 Expected Timeline

| Task | Time | Status |
|------|------|--------|
| Get API key | 5 min | ☐ |
| Configure environment | 5 min | ☐ |
| Verify setup | 2 min | ☐ |
| Start services | 3 min | ☐ |
| Generate test data | 1 min | ☐ |
| Smoke test | 5 min | ☐ |
| Verify cache | 3 min | ☐ |
| **Quick Start Total** | **~25 min** | **☐** |
| Full test suite | 8-10 hours | ☐ |
| Monitor & optimize | 1 week | ☐ |
| Production rollout | 2-3 weeks | ☐ |

---

## 💡 Pro Tips

1. **Start Small**: Test with 10-20 files before scaling up
2. **Monitor Costs**: Check Claude dashboard daily during testing
3. **Use Cache**: Re-upload same files to test cache effectiveness
4. **Debug Mode**: Keep `LOG_LEVEL=debug` during testing
5. **Test Fallback**: Disable skills to verify regex fallback still works

---

## ✅ What to Expect

### First Upload (No Cache)
- Skills invoked: IntelligentColumnMapper
- Claude API call made
- Processing time: ~3-5 seconds
- Cost: ~$0.15

### Second Upload (With Cache)
- Skills invoked: IntelligentColumnMapper
- Retrieved from cache
- Processing time: <1 second
- Cost: $0.00

### After 1 Week
- Cache hit rate: 50-80%
- Daily cost: <$5 (testing)
- Monthly projected: $65-80 (with caching)
- Accuracy: 85-95% (validated)

---

**Ready to begin?** Start with **Step 1** above ⬆️

**Questions?** Refer to [docs/README.md](docs/README.md) for complete documentation index.

**Good luck!** 🚀
