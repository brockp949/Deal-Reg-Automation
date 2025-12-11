## Phase 4 – Security & Config Metrics

Skip’s upload pipeline now exposes dedicated endpoints so dashboards (and operators) can monitor the guardrails delivered in Phase 4.

### File Security Metrics

- **Endpoint**: `GET /api/files/metrics/security`
- **Returns**:
  - `scanStatus`: counts per scan verdict (`passed`, `failed`, `pending`, `error`, etc.)
  - `blockedCount`: files that were prevented from processing
  - `quarantinedCount`: files currently quarantined because of AV failures
  - `duplicateEventsLast30Days`: deduplication hits logged in the last 30 days
- **Usage**: The front-end “Uploaded Files” view polls this endpoint every 15 seconds and renders the snapshot card shown above the file table.

### Config Snapshot Metrics

- **Endpoint**: `GET /api/configs/metrics`
- **Returns**:
  - `totalSnapshots`: count of stored JSON config uploads
  - `appliedSnapshots`: how many snapshots have been marked “applied”
  - `pendingSnapshots`: snapshots that have not been applied yet (`total - applied`)
- **Companion Endpoints**:
  - `GET /api/configs/snapshots` – list snapshots (newest first, limit configurable)
  - `POST /api/configs/snapshots/:id/apply` – mark a snapshot as applied (records a `config_applied` event)
- **Usage**: Metrics feed the “Config Uploads” card on the upload page; the snapshot endpoints will be wired into Skip’s agent flows in Phase 5.

### Telemetry Expectations

- Metrics endpoints are lightweight SQL aggregations and safe to poll.
- Security metrics are cached client-side by React Query for 15 seconds; config metrics for 30 seconds.
- Any new dashboards can read these APIs directly or reuse the same React Query hook used in `frontend/src/components/FileUploader.tsx`.
