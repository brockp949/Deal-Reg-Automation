# Deal Registration Automation Tool

A comprehensive web-based platform for automating vendor deal registration tracking by processing emails, meeting transcripts, and CRM exports.

## Features

- **Intelligent File Processing**: Upload and parse .mbox emails, transcripts, and vTiger CSV exports
- **Automated Data Extraction**: AI-powered extraction of vendor and deal information
- **Vendor Management**: Track vendors and their associated deals in one place
- **Vendor Approval Guardrails**: Auto-detected vendors are quarantined until you explicitly approve them
- **Export & Email**: Generate Excel reports and email them to partners
- **Scalable Architecture**: Handle large files efficiently with background processing

## Tech Stack

### Frontend
- React 18 + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query (React Query)
- React Hook Form + Zod

### Backend
- Node.js 20+ with TypeScript
- Express.js
- PostgreSQL 15+
- Redis (for job queues)
- Bull MQ (background jobs)

### File Processing
- mailparser (emails)
- csv-parser (CSV files)
- Anthropic Claude API (AI extraction)

## Project Structure

```
deal-reg-automation/
├── backend/           # Node.js/Express API
├── frontend/          # React application
├── docker-compose.yml # Local development setup
└── README.md
```

## Project Plan

- See `docs/INTELLIGENT_AUTOMATED_DEAL_REGISTRATION_PLAN.md` for the full phased implementation plan, epics/stories with estimates, rollout timeline, risks, and milestones.
- See `docs/PHASES_1-7_COMBINED.md` for the consolidated Phase 1–7 documentation (combined from all phase files).

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15+
- Redis 7+

### Quick Start

1. Clone the repository
```bash
git clone <repo-url>
cd deal-reg-automation
```

2. Set up environment variables
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

3. Start with Docker Compose
```bash
docker-compose up -d
```

4. Access the application
- Frontend: http://localhost:3200
- Backend API: http://localhost:4000
- API Docs: http://localhost:4000/api-docs

### Vendor Approval Workflow

1. Upload your official vendor roster first (CSV/Excel import or manual add). These vendors are automatically marked as `approved`.
2. When file processing discovers a vendor that isn't in your list, the system records it in the review queue instead of creating it.
   - API: `GET /api/vendor-review` (pending suggestions)
   - API: `POST /api/vendor-review/:id/decision` with `{ "action": "approve", ... }` or `{ "action": "deny" }`
3. Approving a suggestion either maps it to an existing vendor or creates a new approved vendor entry. Denying it teaches the system to ignore that alias going forward.
4. Deals, contacts, and relationships tied to unapproved vendors are skipped until the vendor is approved, preventing rogue data from entering your pipeline.

### Development Setup (Without Docker)

#### Backend
```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Opportunity Tracker CLI (Phase 3 Pipeline)

After running the Google source sync (`npm run source:sync`) and processing manifests (`npm run source:process -- --manifest <path>`), you can inspect readiness data directly from the CLI:

1. `npm run source:show -- --filter "<keyword>" --clusters`
   - Lists stored opportunities (`uploads/opportunities/opportunities.json`) and correlated clusters (`opportunity-clusters.json`). Use `--limit`, `--file`, or `--clusters-file` to customize output.
2. `npm run source:metrics`
   - Generates `uploads/opportunities/readiness-metrics.json`, summarizing per-stage totals, priority mix, and cluster coverage for dashboards/readiness docs.
3. `npm run source:report`
   - Builds `uploads/opportunities/opportunity-readiness-report.md` and publishes a copy to `docs/OPPORTUNITY_READINESS.md` for easy sharing.
4. `npm run source:export`
   - Converts `consolidated-opportunities.json` into tracker-ready JSON/CSV composites (`composite-opportunities.json` / `.csv`) for downstream analytics.
5. `npm run source:quality`
   - Scores each composite for completeness, consistency, freshness, and structured action items (owners/dates), writing `quality-findings.json` that feeds readiness metrics/reports.
6. `npm run source:ci`
   - Runs the full ingestion → consolidation → quality → reporting pipeline (process/export/quality/report) used by CI and scheduled automations.
7. `npm run source:publish`
   - Takes the latest metrics/quality/composite artifacts, snapshots them into history, generates `uploads/opportunities/dashboard.json`, and publishes `docs/DASHBOARD.md` for live dashboards.

## Development Roadmap

### Phase 1: MVP (Current)
- [x] Project setup
- [ ] Basic file upload
- [ ] Simple parsing (mbox, CSV, text)
- [ ] Manual vendor/deal entry
- [ ] Basic list views
- [ ] Excel export

### Phase 2: AI Integration
- [ ] Claude/GPT-4 entity extraction
- [ ] Automated vendor matching
- [ ] Confidence scoring
- [ ] Duplicate detection

### Phase 3: Advanced Features
- [ ] Email sending
- [ ] Advanced filtering & search
- [ ] Analytics dashboard
- [ ] Bulk operations

### Phase 4: Polish & Scale
- [ ] Performance optimization
- [ ] Production deployment
- [ ] User documentation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details



