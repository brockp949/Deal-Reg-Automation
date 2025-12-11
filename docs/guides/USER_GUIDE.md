# Deal Registration Automation Tool - User Guide

## Quick Start Overview

This tool automates deal registration discovery from multiple sources:
- vTiger CRM exports (baseline)
- Vendor partner lists
- Email archives (MBOX files up to 5GB)
- Meeting transcripts (with AI-powered extraction)

---

## Step-by-Step Setup Guide

### Step 1: Initial Setup - Establish Your Deals Baseline

**Purpose**: Load your existing CRM data to establish a baseline of current deals in your pipeline.

#### A. Export Deals from vTiger CRM

1. **Login to your vTiger instance**
2. **Navigate to Deals module**
3. **Export deals**:
   - Click the **Export** button
   - Select fields to include:
     - ✅ Deal Name
     - ✅ Organization Name
     - ✅ Contact Name
     - ✅ Amount
     - ✅ Sales Stage
     - ✅ Description
     - ✅ Next Step
   - Download as **CSV format**
   - Save file (e.g., `current_deals.csv`)

#### B. Upload vTiger Export to the Tool

1. **Access the application**: Open `http://localhost:3200` in your browser
2. **Navigate to File Upload** section
3. **Upload your CSV**:
   - Click "Choose File" or drag-and-drop
   - Select your `current_deals.csv`
   - Click **Upload**
4. **Process the file**:
   - Click **Process** button next to the uploaded file
   - System will automatically detect vTiger format
   - Wait for "Processing Complete" status
5. **Review imported data**:
   - Navigate to **Deals** tab to see imported deals
   - Navigate to **Vendors** tab to see extracted organizations
   - Navigate to **Contacts** tab to see associated contacts

**What Gets Imported**:
- **Vendors**: All unique organizations from your deals
- **Deals**: All deal records with amounts, stages, and descriptions
- **Contacts**: Decision makers and partners mentioned in deals

---

### Step 2: Upload Vendor Partner List

**Purpose**: Import your authorized vendor/partner list to filter incoming deal registrations.

#### A. Prepare Vendor List

1. **Create or export vendor list** as CSV with these columns:
   - `Company Name` (required)
   - `Website` (optional)
   - `Primary Contact Name` (optional)
   - `Primary Contact Email` (optional)
   - `Phone` (optional)

**Example CSV**:
```csv
Company Name,Website,Primary Contact Name,Primary Contact Email,Phone
Acme Corp,acme.com,John Smith,john@acme.com,555-0100
TechVendor Inc,techvendor.com,Jane Doe,jane@techvendor.com,555-0200
```

#### B. Upload Vendor List

1. **Access application**: `http://localhost:3200`
2. **Navigate to Vendors** section
3. **Click "Import Vendors"** button
4. **Select your CSV file**
5. **Monitor progress**:
   - Progress bar shows 0-100% completion
   - Large lists process in background
   - Receive notification when complete
6. **Review imported vendors**:
   - Check vendor count increased
   - Verify key partners are present

**System Behavior**:
- Automatically deduplicates vendors by name
- Normalizes company names for matching
- Extracts email domains for filtering

---

### Step 3: Upload Email Archives (MBOX Files)

**Purpose**: Extract potential deal registrations from email conversations with partners and prospects.

#### A. Export MBOX from Email Client

**Gmail (Google Takeout)**:
1. Go to `takeout.google.com`
2. Deselect all, select only **Mail**
3. Click "All Mail data included" → Select specific labels (e.g., "Partners", "Deal Reg")
4. Choose **MBOX** format
5. Download archive (can be up to 5GB)

**Outlook**:
1. File → Open & Export → Import/Export
2. Select "Export to a file" → PST file
3. Convert PST to MBOX using tool like `readpst` or online converter

**Thunderbird**:
1. Select folder → Right-click → "Save As" → MBOX format

#### B. Upload MBOX File

1. **Access application**: `http://localhost:3200`
2. **Navigate to File Upload** section
3. **Upload MBOX**:
   - Supports files up to **5GB**
   - Drag-and-drop or click "Choose File"
   - Select your `.mbox` file
4. **Process the file**:
   - Click **Process** button
   - System processes in background
   - Large files may take 10-30 minutes
5. **Monitor progress**:
   - Check **Processing Status** column
   - Status updates: Pending → Processing → Completed
6. **Review results**:
   - Navigate to **Deals** tab
   - Filter by `extraction_method = 'email_extraction'`
   - Review confidence scores and detected keywords

**What Gets Extracted**:
- **Tier 1 Keywords**: deal registration, register deal, opportunity registration
- **Tier 2 Keywords**: co-sell, partner-led, RFP, proposal
- **Tier 3 Keywords**: project, pricing, quote request
- **Entities**: Company names, contact info, deal values, dates
- **Context**: Email threads, participants, timestamps

---

### Step 4: Upload Meeting Transcripts

**Purpose**: Extract deal registrations from sales calls and partner meetings using AI-powered NLP.

#### A. Prepare Transcript Files

**Supported Formats**:
- Plain text (`.txt`) files
- Speaker-labeled transcripts preferred

**Transcript Format Examples**:

**Option 1: Timestamped with speakers**
```
[00:02:15] Sarah Johnson (Partner): We have a large customer interested in your solution
[00:02:28] Mike Chen (Sales): Tell me more about the opportunity
[00:03:12] Sarah Johnson: They're looking at a $500K deployment starting Q2
```

**Option 2: Simple speaker labels**
```
Sarah Johnson: We have a large customer interested in your solution
Mike Chen: Tell me more about the opportunity
Sarah Johnson: They're looking at a $500K deployment starting Q2
```

**Option 3: Unlabeled (less accurate)**
```
We have a large customer interested in your solution.
Tell me more about the opportunity.
They're looking at a $500K deployment starting Q2.
```

#### B. Upload Transcript

1. **Access application**: `http://localhost:3200`
2. **Upload transcript file** (`.txt` format)
3. **Click Process** button
4. **System applies 5-stage NLP pipeline**:
   - **Stage 1**: Pre-processing (remove filler words, normalize text)
   - **Stage 2**: Entity extraction (companies, contacts, amounts, dates)
   - **Stage 3**: Intent classification (price inquiry, technical question, etc.)
   - **Stage 4**: Relationship extraction (who works for whom, roles)
   - **Stage 5**: Data synthesis and confidence scoring
5. **Buying signal detection**:
   - Scores conversation 0-1 based on deal indicators
   - Conversations scoring < 0.5 are automatically filtered out
   - High-signal conversations create deal records

**What Gets Extracted**:
- **Partner Info**: Company name, contact, email, phone, role
- **Prospect Info**: Company name, contact, job title, address
- **Deal Details**: Value, currency, close date, description
- **Contextual Intelligence**:
  - Current vendor (if switching)
  - Reason for change
  - Identified competitors
  - Potential challenges
  - Requested support
- **Confidence Scores**:
  - Buying signal score (0-1)
  - Overall confidence score (0-1)
  - Entity-level confidence

---

## Understanding Extracted Data

### Confidence Scores

**Buying Signal Score (0-1)**:
- **0.8-1.0**: Strong signals (explicit pricing, timeline, commitment)
- **0.5-0.8**: Moderate signals (implied interest, questions, comparisons)
- **0-0.5**: Weak signals (exploratory, informational only) - *Filtered out*

**Overall Confidence Score (0-1)**:
Weighted combination of:
- 30% Buying signals detected
- 30% Data completeness (how many fields filled)
- 20% Corroboration (multiple sources confirm data)
- 20% Entity confidence (accuracy of extracted entities)

### Deal Status Values

- **registered**: New deal registration pending review
- **approved**: Deal registration approved
- **rejected**: Deal registration rejected
- **closed-won**: Deal won
- **closed-lost**: Deal lost

### Extraction Methods

Filter deals by source:
- `transcript_nlp`: Extracted from meeting transcripts
- `email_extraction`: Extracted from MBOX files
- `vtiger_import`: Imported from vTiger CRM
- `manual`: Manually entered

---

## Querying and Filtering Data

### View Deals with High Confidence

Navigate to Deals tab and filter:
- **Confidence Score**: > 0.7
- **Buying Signal Score**: > 0.6
- **Status**: registered

### Find Vendor Displacement Opportunities

Filter deals where:
- **Current Vendor**: Not empty
- **Reason for Change**: Not empty
- Shows customers actively switching vendors

### Track Competitor Mentions

Search deals:
- **Identified Competitors**: Contains competitor name
- See which competitors are mentioned most

### Find Hot Leads

Sort/filter by:
- **Buying Signal Score**: Descending
- **Expected Close Date**: Next 90 days
- **Deal Stage**: Value Proposition or Requirements Gathering

---

## Tips for Best Results

### For vTiger Exports
- Include as many fields as possible in export
- Export regularly to keep baseline current
- Use consistent naming for organizations

### For Vendor Lists
- Keep vendor list up-to-date
- Include email domains for better matching
- Add primary contacts for follow-up

### For MBOX Files
- Include email threads (not just single messages)
- Export from relevant folders (Partners, Sales, Deal Reg)
- Larger archives = more comprehensive discovery

### For Transcripts
- Use speaker labels when possible
- Include timestamps for better context
- Longer conversations (10+ minutes) work best
- Record actual sales/partner calls, not internal meetings

---

## Troubleshooting

### File Upload Fails
- **Check file size**: Max 5GB for MBOX, no limit for CSV/TXT
- **Check file format**: Must be `.csv`, `.mbox`, or `.txt`
- **Check file permissions**: Ensure file is not locked

### Processing Stuck
- **Check Processing Status**: Should show "Processing" or "Completed"
- **Large files**: MBOX files >2GB may take 20-30 minutes
- **Check backend logs**: `docker-compose logs backend worker`

### Low Extraction Quality
- **For transcripts**: Use speaker-labeled format
- **For emails**: Include full thread context
- **For CSV**: Ensure column headers match expected format

### No Deals Extracted
- **Check buying signal threshold**: Transcripts need score > 0.5
- **Check email keywords**: Must contain Tier 1-3 keywords
- **Review source data quality**: May need clearer deal indicators

---

## Data Privacy & Security

- All data processed locally on your infrastructure
- No data sent to external services except AI API calls (if configured)
- Database encrypted at rest
- MBOX files deleted after processing (optional)
- Supports GDPR compliance for contact data

---

## Next Steps

1. ✅ Upload vTiger export (establish baseline)
2. ✅ Upload vendor partner list
3. ✅ Upload MBOX archives (historical emails)
4. ✅ Upload recent meeting transcripts
5. Review and triage extracted deals
6. Export deal registrations for submission
7. Set up recurring imports (weekly/monthly)

---

## Support

- **Documentation**: `/docs` folder
- **API Reference**: `http://localhost:4000/api/docs`
- **Logs**: `docker-compose logs backend worker`
- **Issues**: Contact your system administrator

---

**Version**: 1.0.0
**Last Updated**: November 2025

