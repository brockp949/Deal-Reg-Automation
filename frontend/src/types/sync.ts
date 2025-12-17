/**
 * Sync Types
 *
 * TypeScript interfaces for Gmail and Google Drive sync features
 */

// Google Account
export interface GoogleAccount {
  id: string;
  accountEmail: string;
  serviceType: 'gmail' | 'drive';
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

// Gmail Label
export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
}

// Drive Folder
export interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  createdTime?: string;
}

// Drive File Summary
export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

// Sync Configuration
export interface SyncConfig {
  id: string;
  tokenId: string;
  name: string;
  serviceType: 'gmail' | 'drive';
  enabled: boolean;

  // Gmail-specific
  gmailLabelIds?: string[];
  gmailDateFrom?: string;
  gmailDateTo?: string;

  // Drive-specific
  driveFolderId?: string;
  driveFolderUrl?: string;
  driveIncludeSubfolders?: boolean;

  // Schedule
  syncFrequency: 'manual' | 'hourly' | 'daily' | 'weekly';
  lastSyncAt?: string;
  nextSyncAt?: string;

  // Metadata
  createdAt: string;
  updatedAt?: string;
  accountEmail?: string;
}

// Sync Run (History Entry)
export interface SyncRun {
  id: string;
  configId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  itemsFound: number;
  itemsProcessed: number;
  dealsCreated: number;
  errorsCount: number;
  errorMessage?: string;
  triggerType: 'manual' | 'scheduled';
}

// Sync Job Status
export interface SyncJobStatus {
  id: string;
  type: 'gmail_sync' | 'drive_sync';
  configId: string;
  triggerType: 'manual' | 'scheduled';
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  result?: SyncJobResult;
  failedReason?: string;
  attemptsMade: number;
  processedOn?: number;
  finishedOn?: number;
}

// Sync Job Result
export interface SyncJobResult {
  configId: string;
  syncRunId: string;
  itemsFound: number;
  itemsProcessed: number;
  dealsCreated: number;
  errorsCount: number;
  duration: number;
}

// Gmail Preview
export interface GmailPreview {
  count: number;
  sample: Array<{
    id: string;
    subject: string;
    from: string;
    date: string;
  }>;
}

// Drive Preview
export interface DrivePreview {
  count: number;
  sample: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
  }>;
}

// Create Gmail Sync Config Input
export interface CreateGmailSyncConfigInput {
  tokenId: string;
  name: string;
  labelIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  syncFrequency?: 'manual' | 'hourly' | 'daily' | 'weekly';
}

// Create Drive Sync Config Input
export interface CreateDriveSyncConfigInput {
  tokenId: string;
  name: string;
  folderId?: string;
  folderUrl?: string;
  includeSubfolders?: boolean;
  syncFrequency?: 'manual' | 'hourly' | 'daily' | 'weekly';
}

// Update Sync Config Input
export interface UpdateSyncConfigInput {
  name?: string;
  enabled?: boolean;
  syncFrequency?: 'manual' | 'hourly' | 'daily' | 'weekly';

  // Gmail-specific
  labelIds?: string[];
  dateFrom?: string;
  dateTo?: string;

  // Drive-specific
  folderId?: string;
  folderUrl?: string;
  includeSubfolders?: boolean;
}

// Google Auth Status
export interface GoogleAuthStatus {
  gmailConfigured: boolean;
  driveConfigured: boolean;
}

// Resolved URL Response
export interface ResolvedUrlResponse {
  folderId: string;
  folderInfo?: DriveFolder;
}
