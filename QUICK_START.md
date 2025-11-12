# Quick Start - Deal Registration Automation

## 🚀 Initial Setup (Do This First)

### Step 1: Load vTiger Baseline ⏱️ 5 minutes

```
1. Export deals from vTiger as CSV
2. Open http://localhost:3200
3. Upload CSV file
4. Click "Process"
5. Wait for "Completed" status
```

**What you get**: All current CRM deals, vendors, and contacts loaded

---

### Step 2: Upload Vendor List ⏱️ 2 minutes

```
1. Prepare CSV with: Company Name, Website, Contact
2. Navigate to "Vendors" → "Import Vendors"
3. Upload CSV
4. Monitor progress bar
5. Verify vendor count
```

**What you get**: Authorized partner list for filtering

---

## 📥 Ongoing Usage

### Option A: Email Archive Processing ⏱️ 10-30 minutes

```
1. Export MBOX from Gmail/Outlook (up to 5GB)
2. Upload to File Upload section
3. Click "Process"
4. Wait for background processing
5. Review deals in "Deals" tab
```

**When to use**: Monthly/quarterly email archive scans

**What you get**:
- Deals from partner email conversations
- Confidence scores
- Keyword tier classification

---

### Option B: Transcript Processing ⏱️ 2-5 minutes

```
1. Save meeting transcript as .txt file
2. Upload transcript file
3. Click "Process"
4. AI extracts deal data automatically
5. Review high-confidence deals (score > 0.7)
```

**When to use**: After each partner/prospect sales call

**What you get**:
- Buying signal scores
- Extracted deal details
- Contextual intelligence
- Competitor mentions

---

## 📊 Filtering & Reviewing Deals

### Find Hot Leads
```
Deals → Filter by:
- Buying Signal Score: > 0.6
- Status: registered
- Sort by: Confidence Score (DESC)
```

### Find Vendor Displacement
```
Deals → Filter by:
- Current Vendor: Not empty
- Reason for Change: Not empty
```

### Review by Source
```
Deals → Filter by:
- Extraction Method: transcript_nlp (from calls)
- Extraction Method: email_extraction (from emails)
- Extraction Method: vtiger_import (from CRM)
```

---

## 📋 File Format Requirements

### vTiger CSV
Must include columns:
- `Deals Deal Name` or `Deal Name`
- `Deals Organization Name` or `Organization Name`
- `Deals Amount` or `Amount`
- `Deals Sales Stage` or `Sales Stage`

### Vendor CSV
Must include column:
- `Company Name` (required)
Optional: `Website`, `Contact Name`, `Email`, `Phone`

### MBOX Files
- Max size: 5GB
- Format: Standard MBOX (.mbox extension)
- Source: Gmail, Outlook, Thunderbird

### Transcript Files
- Format: Plain text (.txt)
- Best with speaker labels: `Name: utterance`
- Can include timestamps: `[00:12:34] Name: utterance`

---

## 🎯 Best Practices

**Daily**:
- Upload transcripts from partner calls
- Review new high-confidence deals (score > 0.7)

**Weekly**:
- Process weekly email batch
- Update vendor list if partners change
- Export deals for registration submission

**Monthly**:
- Process full monthly MBOX archive
- Sync vTiger baseline
- Clean up duplicate deals

