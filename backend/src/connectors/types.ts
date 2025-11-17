export interface GoogleAuthConfig {
  clientEmail: string;
  privateKey: string;
  impersonatedUser?: string;
}

export interface GmailSearchQuery {
  name: string;
  query: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

export interface GmailSearchOptions {
  userId: string;
  query: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  maxResults?: number;
  pageToken?: string | null;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  headers: Record<string, string>;
  labelIds?: string[];
  labels?: string[];
}

export interface GmailMessagePayload {
  summary: GmailMessageSummary;
  raw: string;
}

export interface DriveSearchQuery {
  name: string;
  query: string;
  mimeTypes?: string[];
  folderIds?: string[];
}

export interface DriveSearchOptions {
  q: string;
  pageSize?: number;
  fields?: string;
  orderBy?: string;
}

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

export interface DriveFileContent {
  summary: DriveFileSummary;
  content: Buffer;
  fileExtension: string;
}

export interface CRMCSVFileSummary {
  fileName: string;
  filePath: string;
  fileSize: number;
  modifiedTime: string;
  createdTime: string;
  checksum: string;
}

export type GmailSourceMetadata = {
  connector: 'gmail';
  queryName?: string;
  message: GmailMessageSummary;
};

export type DriveSourceMetadata = {
  connector: 'drive';
  queryName?: string;
  file: DriveFileSummary;
};

export type CRMCSVSourceMetadata = {
  connector: 'crm_csv';
  file: CRMCSVFileSummary;
};

export interface TeamsTranscriptSummary {
  id: string;
  meetingId: string;
  organizerId?: string;
  subject?: string;
  startTime?: string;
  endTime?: string;
  participants?: Array<{ name?: string; email?: string; role?: string }>;
  duration?: number;
}

export interface ZoomTranscriptSummary {
  id: string;
  meetingId: string;
  meetingUuid?: string;
  topic?: string;
  startTime?: string;
  duration?: number;
  hostId?: string;
  hostEmail?: string;
  participantCount?: number;
}

export type TeamsSourceMetadata = {
  connector: 'teams_transcript';
  queryName?: string;
  transcript: TeamsTranscriptSummary;
};

export type ZoomSourceMetadata = {
  connector: 'zoom_transcript';
  queryName?: string;
  transcript: ZoomTranscriptSummary;
};

export type SourceMetadata =
  | GmailSourceMetadata
  | DriveSourceMetadata
  | CRMCSVSourceMetadata
  | TeamsSourceMetadata
  | ZoomSourceMetadata;
