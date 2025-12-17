# Deal Registration Automation - Documentation

This folder contains all project documentation organized by category.

---

## 🚀 **NEW: Claude Skills Integration (Phase 5)** - Start Here!

**Ready to deploy and test Claude AI Skills?** Start with these guides:

### Quick Start (15 minutes)
- **[QUICK_START.md](./QUICK_START.md)** - Get Claude Skills running in 15 minutes
  - Configure environment (5 min)
  - Start services (5 min)
  - Run smoke test (5 min)

### Full Deployment (1-2 hours)
- **[DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)** - Complete staging deployment
  - Pre-deployment verification
  - 8-step deployment process
  - Health checks & smoke tests
  - Rollback procedures

### Comprehensive Testing (8-10 hours)
- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** - Full test suite
  - 7 test phases (feature flags → skills → performance)
  - Test data templates
  - Accuracy measurement methodology
  - Cost tracking procedures

### Technical Deep-Dive (45 minutes)
- **[CLAUDE_SKILLS_INTEGRATION.md](./CLAUDE_SKILLS_INTEGRATION.md)** - Technical details
  - All 4 skills explained (IntelligentColumnMapper, SemanticEntityExtractor, etc.)
  - Architecture & integration patterns
  - Configuration guide
  - Performance & cost analysis

### Project Status (15 minutes)
- **[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)** - Current progress
  - 85% complete overall
  - Phase 5 (Claude Skills) ✅ Complete
  - Next steps prioritization
  - ROI analysis

### Helper Scripts
Located in `../scripts/`:
- `verify-setup.js` - Verify environment is ready (run this first!)
- `generate-test-data.js` - Generate test files for skills testing

---

## Directory Structure

```
docs/
├── planning/          # Project plans, roadmaps, and design documents
├── phases/            # Phase-specific implementation documentation
│   ├── overview/      # Combined phase summaries
│   ├── phase-1/       # Ingestion & Large File Handling
│   ├── phase-2/       # Email Parsing & Thread Reconstruction
│   ├── phase-3/       # Cleaning Pipeline & Production Readiness
│   ├── phase-4/       # Integration & Security
│   ├── phase-5/       # Enhancements
│   ├── phase-6/       # Testing & Validation
│   ├── phase-7/       # Multi-Connector Support
│   └── phase-8/       # Intelligent Insights & Automation
├── api/               # API documentation (OpenAPI specs)
├── guides/            # User guides and getting started docs
├── technical/         # Technical architecture and design docs
├── operations/        # Operational runbooks & readiness guides
├── deployment/        # Deployment checklists and build summaries
├── status/            # Progress reports and project status
├── reports/           # Auto-generated reports & dashboards
└── archive/           # Deprecated/old documentation
```

---

## Quick Links

### Planning & Design
- [Intelligent Automated Deal Registration Plan](planning/INTELLIGENT_AUTOMATED_DEAL_REGISTRATION_PLAN.md) - Main project plan
- [Implementation Plan](planning/IMPLEMENTATION_PLAN.md) - Detailed implementation roadmap
- [Opportunity Tracker Enhancement Plan](planning/OPPORTUNITY_TRACKER_PLAN.md) - Feature roadmap
- [System Design Document (PDF)](planning/Intelligent%20Deal%20Registration%20Automation%20System%20Design%20(1).pdf) - Original design spec

### User Guides
- [User Guide](guides/USER_GUIDE.md) - Complete user documentation
- [Quick Start](guides/QUICK_START.md) - Get up and running fast
- [Getting Started](guides/GETTING_STARTED.md) - Initial setup guide
- [Docker Startup Guide](guides/DOCKER_STARTUP_GUIDE.md) - Docker deployment
- [Migration Guide](guides/MIGRATION_GUIDE.md) - Upgrading from previous versions
- [MBOX Parser Guide](guides/ENHANCED_MBOX_PARSER_GUIDE.md) - Email parsing guide
- [Ready to Use](guides/READY_TO_USE.md) - Production readiness checklist

### Phase Documentation

#### Overview
- [Phases 1-7 Combined Summary](phases/overview/PHASES_1-7_COMBINED.md) - Complete overview
- [Phase 1-3 Improvements](phases/overview/PHASE_1-3_IMPROVEMENTS.md) - Audit and improvements

#### Phase 1: Ingestion & Large File Handling
- [Phase 1 Complete](phases/phase-1/PHASE_1_COMPLETE.md) - MBOX splitting, streaming, Gmail filtering

#### Phase 2: Email Parsing
- [Phase 2 Complete](phases/phase-2/PHASE_2_COMPLETE.md) - Email parsing & thread reconstruction

#### Phase 3: Cleaning Pipeline
- [Phase 3 Summary](phases/phase-3/PHASE_3_SUMMARY.md) - Cleaning pipeline implementation
- [Phase 3 Production Readiness](phases/phase-3/PHASE_3_PRODUCTION_READINESS.md) - Production checklist
- [Phase 3 Deployment Checklist](phases/phase-3/PHASE_3_DEPLOYMENT_CHECKLIST.md) - Deployment steps
- [Phase 3.5 Progress](phases/phase-3/PHASE_3.5_PROGRESS.md) - Sub-phase progress

#### Phase 4: Integration & Security
- [Phase 4 Summary](phases/phase-4/PHASE_4_SUMMARY.md) - Integration overview
- [Phase 4 Progress](phases/phase-4/PHASE_4_PROGRESS.md) - Development progress
- [Phase 4 Integration Summary](phases/phase-4/PHASE_4_INTEGRATION_SUMMARY.md) - Integration details
- [Phase 4 Security Metrics](phases/phase-4/PHASE_4_SECURITY_METRICS.md) - Security audit
- [Phase 4-5 Review Summary](phases/phase-4/PHASE_4_5_REVIEW_SUMMARY.md) - Combined review

#### Phase 5: Claude Skills Integration ✅ COMPLETE
- **[CLAUDE_SKILLS_INTEGRATION.md](./CLAUDE_SKILLS_INTEGRATION.md)** - Complete technical documentation
- **[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)** - Project status with Phase 5 complete
- [Phase 3 Parallel Processing](./PHASE_3_PARALLEL_PROCESSING.md) - 4-5x speedup for large files
- [Phase 4 Enhanced UX](./PHASE_4_ENHANCED_UX.md) - AI-powered error messages & validation
- [Phase 5 Progress](phases/phase-5/PHASE_5_PROGRESS.md) - Original enhancement progress

#### Phase 6: Testing & Validation
- [Phase 6 Plan](phases/phase-6/PHASE_6_PLAN.md) - Testing strategy
- [Phase 6 Complete Summary](phases/phase-6/PHASE_6_COMPLETE_SUMMARY.md) - Completion summary
- [Phase 6 Testing Guide](phases/phase-6/PHASE_6_TESTING_GUIDE.md) - How to run tests
- [Phase 6 Quick Test Setup](phases/phase-6/PHASE_6_QUICK_TEST_SETUP.md) - Fast test setup
- [Phase 6 Test Results](phases/phase-6/PHASE_6_TEST_RESULTS.md) - Test outcomes
- [Phase 6 Live Test Results](phases/phase-6/PHASE_6_LIVE_TEST_RESULTS.md) - Production test results
- [Phase 6 Testing Progress](phases/phase-6/PHASE_6_TESTING_PROGRESS.md) - Testing status

#### Phase 7: Multi-Connector Support
- [Phase 7 Plan](phases/phase-7/PHASE_7_PLAN.md) - Connector implementation plan

#### Phase 8: Intelligent Insights & Automation
- [Phase 8 Summary](phases/phase-8/PHASE_8_SUMMARY.md) - AI scoring, notifications, API
- [Phase 8.2: Notifications](phases/phase-8/PHASE_8.2_NOTIFICATIONS.md) - Alert system
- [Phase 8.3: REST API](phases/phase-8/PHASE_8.3_API.md) - API implementation

### Technical Documentation
- [Parser Integration Technical Debt](technical/PARSER_INTEGRATION_TECHNICAL_DEBT.md) - Tech debt tracking
- [Enhanced Parser Summary](technical/ENHANCED_PARSER_SUMMARY.md) - Parser improvements
- [Intelligent Vendor System](technical/INTELLIGENT_VENDOR_SYSTEM.md) - Vendor matching system
- [Integration Summary](technical/INTEGRATION_SUMMARY.md) - System integration details

### API Reference
- [OpenAPI Specification](api/API_DOCUMENTATION.yaml) - REST API documentation

### Operations
- [Connector Readiness Guide](operations/CONNECTOR_READINESS.md) - Connector runbooks
- [Opportunity Readiness](operations/OPPORTUNITY_READINESS.md) - System readiness metrics

### Deployment & Build
- [Deployment Checklist](deployment/DEPLOYMENT_CHECKLIST.md) - Production deployment steps
- [Build Summary](deployment/BUILD_SUMMARY.md) - Build process overview
- [Complete Build Summary](deployment/COMPLETE_BUILD_SUMMARY.md) - Full build details
- [Improvements Summary](deployment/IMPROVEMENTS_SUMMARY.md) - Recent improvements
- [Push Summary](deployment/PUSH_SUMMARY.md) - Git push summary
- [Pull Request Phase 3](deployment/PULL_REQUEST_PHASE_3.md) - PR documentation
- [Create PR Instructions](deployment/CREATE_PR_INSTRUCTIONS.md) - How to create PRs

### Status & Progress Reports
- [Project Status](status/PROJECT_STATUS.md) - Current project state
- [System Status](status/SYSTEM_STATUS.md) - System health
- [Next Steps](status/NEXT_STEPS.md) - Upcoming work
- [Comprehensive Progress](status/COMPREHENSIVE_PROGRESS.md) - Full progress report
- [Week 1 Progress](status/WEEK1_PROGRESS.md) - Week 1 updates
- [Week 2 Progress](status/WEEK2_PROGRESS.md) - Week 2 updates
- [Week 2 Complete](status/WEEK2_COMPLETE.md) - Week 2 summary
- [Week 3 Progress](status/WEEK3_PROGRESS.md) - Week 3 updates

### Reports (Auto-Generated)
- [Dashboard](reports/DASHBOARD.md) - Live metrics and trends
- [Feedback Summary](reports/FEEDBACK_SUMMARY.md) - Annotation statistics

### Archive
- [Old Connector Readiness](archive/CONNECTOR_READINESS_OLD.md) - Deprecated version
- [Phase 2 Complete (Root)](archive/PHASE_2_COMPLETE_root.md) - Older version
