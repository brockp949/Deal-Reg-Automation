# Backend Scripts Documentation

This document provides detailed information about all available npm scripts in the backend package.

## Development Scripts

### `npm run dev`
Starts the development server with hot-reload using `tsx watch`.
- **Usage**: `npm run dev`
- **Description**: Watches for file changes and automatically restarts the server
- **Port**: Configured in `.env` (default: 4000)

### `npm run worker`
Starts the background worker process with hot-reload.
- **Usage**: `npm run worker`
- **Description**: Runs the Bull queue workers for background job processing
- **Note**: Requires Redis to be running

## Build & Production

### `npm run build`
Compiles TypeScript code to JavaScript for production.
- **Usage**: `npm run build`
- **Output**: `dist/` directory
- **Description**: Transpiles all TypeScript files using the TypeScript compiler

### `npm start`
Starts the production server using compiled JavaScript.
- **Usage**: `npm start`
- **Prerequisites**: Run `npm run build` first
- **Description**: Runs the compiled code from `dist/index.js`

## Database Management

### `npm run db:migrate`
Runs database migrations to update the schema.
- **Usage**: `npm run db:migrate`
- **Description**: Applies all pending database migrations in order
- **Location**: `src/db/migrate.ts`
- **Note**: Requires `DATABASE_URL` to be configured in `.env`

### `npm run db:seed`
Seeds the database with initial or test data.
- **Usage**: `npm run db:seed`
- **Description**: Populates the database with sample data for development
- **Location**: `src/db/seed.ts`
- **Warning**: May overwrite existing data

## Code Quality

### `npm run lint`
Runs ESLint to check code quality and style.
- **Usage**: `npm run lint`
- **Description**: Checks all TypeScript files in `src/` for linting errors
- **Fix**: Add `-- --fix` to automatically fix issues: `npm run lint -- --fix`

### `npm test`
Runs the Jest test suite.
- **Usage**: `npm test`
- **Options**:
  - `npm test -- --watch`: Run tests in watch mode
  - `npm test -- --coverage`: Generate coverage report
  - `npm test -- --testPathPatterns=<pattern>`: Run specific test files
  - `npm run test -- --runInBand`: Run tests sequentially (useful for debugging)
- **Location**: Tests are located in `src/__tests__/`

## Source Synchronization (Phase 1-3)

### `npm run source:sync`
Synchronizes data from Gmail and Google Drive sources.
- **Usage**: `npm run source:sync`
- **Description**: Fetches emails and documents from configured Google Workspace sources
- **Output**: Creates spool files in `uploads/source-sync/` directory
- **Manifest**: Generates `source-sync-manifest.json` listing all synced files
- **Prerequisites**:
  - Google service account credentials configured
  - `GMAIL_SYNC_ENABLED` or `DRIVE_SYNC_ENABLED` set to `true` in `.env`
- **Configuration**:
  ```env
  GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
  GOOGLE_PRIVATE_KEY=<your-private-key>
  GOOGLE_IMPERSONATED_USER=user@yourdomain.com
  GMAIL_SYNC_ENABLED=true
  GMAIL_SYNC_QUERIES=4IEC,quote,RFQ
  GMAIL_SYNC_WINDOW_DAYS=180
  DRIVE_SYNC_ENABLED=true
  DRIVE_SYNC_QUERIES=4IEC,meeting
  ```

### `npm run source:process`
Processes synced source files and extracts opportunity data.
- **Usage**: `npm run source:process [-- --manifest <path>]`
- **Description**: Parses spool files using appropriate parsers and generates opportunity records
- **Input**: Reads from `uploads/source-sync/source-sync-manifest.json` by default
- **Output**:
  - `uploads/opportunities/opportunities.json`: All extracted opportunities
  - `uploads/opportunities/opportunity-clusters.json`: Correlated opportunities
- **Prerequisites**: Run `npm run source:sync` first
- **Options**:
  - `--manifest <path>`: Use a specific manifest file instead of default

### `npm run source:show`
Displays extracted opportunities in a human-readable format.
- **Usage**: `npm run source:show [options]`
- **Description**: Shows opportunity records with formatting and filtering options
- **Prerequisites**: Run `npm run source:process` first
- **Options** (if implemented):
  - `--stage <stage>`: Filter by opportunity stage (rfq, quote, po_in_progress, etc.)
  - `--format <format>`: Output format (table, json, csv)

### `npm run source:quality`
Evaluates consolidated opportunities for completeness, consistency, and freshness issues.
- **Usage**: `npm run source:quality [options]`
- **Description**: Reads `composite-opportunities.json` + `opportunities.json`, scores each composite, and writes `quality-findings.json` summarizing remediation guidance plus structured action-item coverage (owners/due dates). The summary is also consumed by readiness metrics/reporting.
- **Prerequisites**: Run `npm run source:process` (and `npm run source:export`) so composites exist.
- **Options**:
  - `--records <path>`: Custom path to opportunity records JSON.
  - `--composites <path>`: Custom path to composite opportunities JSON.
  - `--output <path>`: Destination for findings (defaults to `uploads/opportunities/quality-findings.json`).
  - `--stale-warning-days <number>` / `--stale-critical-days <number>`: Override freshness thresholds.

### `npm run source:ci`
Runs the full consolidation/quality/reporting pipeline for CI and scheduled automation.
- **Usage**: `npm run source:ci`
- **Description**: Sequentially executes `source:process`, `source:export`, `source:quality`, and `source:report` so readiness artifacts (metrics, composites, quality findings, published report) are always in sync.
- **Prerequisites**: Run `npm run source:sync` first (or ensure manifests already exist). Requires `GOOGLE_*` credentials when run in automation.

### `npm run source:publish`
Publishes dashboard artifacts and historical snapshots.
- **Usage**: `npm run source:publish [-- --history-limit 60 --trend-limit 30 --publish docs/DASHBOARD.md]`
- **Description**: Loads the latest readiness metrics, quality findings, and composites to (1) snapshot them into `uploads/opportunities/history/<run>`, (2) generate `uploads/opportunities/dashboard.json`, and (3) optionally render `docs/DASHBOARD.md` for sharing. Retains the most recent N snapshots (default 90) and powers dashboard trends.
- **Prerequisites**: Run `npm run source:ci` (or the individual commands) so metrics/quality/composites are up to date.

### `npm run source:feedback`
Manages stakeholder annotations for opportunities.
- **Usage**: `npm run source:feedback -- --import feedback.json [--reviewer "Name"]` or `npm run source:feedback -- --list`
- **Description**: Imports reviewer annotations (stage/priority corrections, notes, verdicts) into `uploads/opportunities/feedback/annotations.json`. After importing, rerun `npm run source:ci` so overrides apply to opportunities/composites. Use `--list` to print the latest summary (`feedback-summary.json` / `docs/FEEDBACK_SUMMARY.md`).
- **Prerequisites**: Annotation files must contain `opportunity_id` plus optional `stage`, `priority`, `notes`, `verdict`, `reviewer`, `reviewed_at`.

## Typical Workflow

### First-time Setup
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run db:migrate

# (Optional) Seed database with sample data
npm run db:seed
```

### Development
```bash
# Start development server
npm run dev

# In another terminal, start workers
npm run worker

# Run tests
npm test -- --watch
```

### Source Sync Workflow (Phase 1-3)
```bash
# Step 1: Sync data from Google Workspace
npm run source:sync

# Step 2: Process synced files and extract opportunities
npm run source:process

# Step 3: View extracted opportunities
npm run source:show
```

### Production Deployment
```bash
# Run linter
npm run lint

# Run tests
npm test

# Build production bundle
npm run build

# Run migrations on production database
npm run db:migrate

# Start production server
npm start
```

## Troubleshooting

### Source Sync Issues

**Problem**: "Google service account credentials are not configured"
- **Solution**: Ensure `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` are set in `.env`

**Problem**: "Neither Gmail nor Drive sync is enabled"
- **Solution**: Set `GMAIL_SYNC_ENABLED=true` or `DRIVE_SYNC_ENABLED=true` in `.env`

**Problem**: Rate limiting errors from Google APIs
- **Solution**: The connectors have built-in rate limiting, but if errors persist:
  - Reduce `GMAIL_SYNC_MAX_RESULTS` or `DRIVE_SYNC_PAGE_SIZE`
  - Increase delay between sync runs
  - Check Google API quota in Cloud Console

### Database Issues

**Problem**: Migration fails with "relation already exists"
- **Solution**: The table was already created. Either:
  - Drop the table manually
  - Skip to the next migration
  - Reset the database (WARNING: data loss)

**Problem**: Cannot connect to database
- **Solution**: Verify `DATABASE_URL` in `.env` and ensure PostgreSQL is running

## Environment Variables Reference

See [.env.example](../.env.example) for a complete list of environment variables and their descriptions.

## Additional Resources

- [Phase 1-3 Documentation](../docs/OPPORTUNITY_TRACKER_PLAN.md)
- [Testing Guide](../PHASE_6_TESTING_PROGRESS.md)
- [Project Status](../docs/PROJECT_STATUS.md)
