# Connector Readiness Checklist

Phase 6.3 prepares the opportunity tracker for upcoming connectors (CRM CSV and Teams/Zoom transcripts). Use this checklist before enabling each connector:

## CRM CSV Exports (`crm_csv`)
- [ ] Ensure nightly CSV drops are staged under `uploads/crm/*.csv`.
- [ ] Set `CRM_CSV_ENABLED=true` in `backend/.env` so the connector registry advertises this source.
- [ ] Map CSV columns to OpportunityMapper fields (doc coming in Phase 7).
- [ ] Update SourceSync manifest templates to include `crm_csv` entries (parser stub allowed for now).

## Teams/Zoom Transcripts (`teams_transcript`)
- [ ] Configure API credentials (Graph API/Zoom) and set `TEAMS_TRANSCRIPT_ENABLED=true`.
- [ ] Provide download path or API endpoint for transcripts; store under `uploads/transcripts`.
- [ ] Ensure transcript parser supports Teams/Zoom format (Phase 7 deliverable).
- [ ] Validate connector registry shows this source in readiness plan (`getEnabledConnectors`).

Both connectors log their readiness status via `getEnabledConnectors()` and surface in dashboards once enabled. Refer to `backend/src/connectors/ConnectorRegistry.ts` for authoritative metadata.
