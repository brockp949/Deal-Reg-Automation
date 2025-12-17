# Input Transcripts Directory

This directory is used for ingesting transcript files for deal extraction processing.

## Directory Structure

```
input_transcripts/
├── mbox/       # Email archives (.mbox files)
├── pdf/        # PDF transcripts
├── docx/       # Word documents
├── txt/        # Plain text files
└── processed/  # Archive of processed files (date-based subdirectories)
```

## File Naming Convention

Use the standard naming format for best results:

```
{source}_{date}_{description}.{ext}
```

### Examples:
- `gmail_2024-01-15_q1-deals.mbox`
- `zoom_2024-01-15_partner-call.txt`
- `teams_2024-01-15_quarterly-review.docx`
- `manual_2024-01-15_sales-notes.pdf`

### Source Identifiers:
- `gmail` - Gmail email exports
- `outlook` - Outlook email exports
- `zoom` - Zoom meeting transcripts
- `teams` - Microsoft Teams transcripts
- `drive` - Google Drive documents
- `manual` - Manually created files
- `import` - Imported from other sources
- `crm` - CRM exports
- `vtiger` - vTiger exports
- `salesforce` - Salesforce exports

## How to Ingest Files

### Option 1: Manual Upload
1. Place files in the appropriate subdirectory based on type
2. Run: `npm run parse:transcripts` from the backend directory

### Option 2: Git-Based Ingestion (Recommended)
1. Place files in the appropriate subdirectory
2. Run: `./scripts/ingest-files.sh` (Linux/Mac) or `.\scripts\ingest-files.ps1` (Windows)
3. This will commit and push the files, triggering automatic processing via GitHub Actions

### Option 3: API Upload
Upload files via the `/api/files/upload` endpoint.

## Processing

When files are processed:
1. Text is extracted from each file
2. Deals are identified and separated
3. Deal details are extracted (name, value, status, etc.)
4. Results are exported to CSV and/or Google Sheets
5. Processed files are moved to the `processed/` directory

## Notes

- Large files (>10MB) may take longer to process
- Scanned PDFs will use OCR for text extraction
- Files in `processed/` are organized by date for easy archival
