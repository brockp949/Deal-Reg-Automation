# Implementation Plan: Intelligent Deal Registration Automation

This document outlines the plan for improving the Deal Registration Automation Tool based on the "Intelligent Deal Registration Automation System Design" document.

### Phase 1: Advanced AI Extraction & Validation (In Progress)

**Objective:** Replace basic extraction with the "System 1" (AI-based) and "System 2" (rule-based) model described in the PDF to achieve higher accuracy and deeper context.

**Status:**
-   [x] **Integrate a Powerful NLP/LLM Service:**
    -   Created `backend/src/services/aiExtractor.ts` with a mock implementation.
    -   Integrated into `fileProcessor.ts` for transcript and mbox files (results are logged).
-   [x] **Implement the "System 2" Validation Module:**
    -   Created `backend/src/services/validationService.ts`.
    -   Integrated into `fileProcessor.ts` (results are logged).
-   [ ] **Merge AI and Existing Data:**
    -   Update `fileProcessor.ts` to merge the validated AI data with the data from the existing parsers.

### Phase 2: Full Workflow Automation & Proactive Ingestion

**Objective:** Transition from a user-triggered workflow to a fully automated, "always-on" pipeline.

**Plan:**

1.  **Implement Automatic Ingestion Triggers:**
    *   **Email Ingestion:** Create a service to check an email inbox via IMAP periodically.
    *   **File System Watcher:** Create a service to watch a directory for new transcript files.
2.  **Enhance the Duplicate Detection & Merging Logic:**
    *   Improve the `findDuplicateDeal` function with fuzzy matching and more heuristics.
    *   Implement logic to merge new information into existing deal records.

### Phase 3: Intelligent Vendor Matching & External Submission

**Objective:** Improve vendor association and complete the automation loop by adding external submission.

**Plan:**

1.  **Implement "Intelligent Vendor Matching":**
    *   Enhance `vendorIntelligence` service to infer vendors from contact's email domain.
    *   Create a mechanism to learn associations between products and vendors.
2.  **Create the "Submission Module":**
    *   Create a `submissionService.ts` to handle external submissions.
    *   Implement different submission strategies (email, API).
    *   Integrate the service into the `fileProcessor`.

### Phase 4: User Trust, Feedback, and UI Enhancements

**Objective:** Build user trust and create a feedback loop for continuous improvement.

**Plan:**

1.  **Implement "Confirmation Mode" and a "Needs Review" Workflow:**
    *   Add a new status field to deals (e.g., `pending_approval`, `needs_review`).
    *   Create a "Review" page or dashboard widget in the frontend.
2.  **Build a Feedback Loop:**
    *   Log user corrections to deal data.
    *   Use the logged data to improve AI models or business rules.
3.  **Enhance UI for Transparency and Explainability:**
    *   Show the source of each piece of data in the UI.
    *   Display confidence scores.
    *   Allow users to see the original text snippet that led to an extraction.
