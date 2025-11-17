interface ConnectorDescriptor {
  key: string;
  displayName: string;
  type: 'gmail' | 'drive' | 'crm_csv' | 'teams_transcript';
  enabled: boolean;
  description: string;
  envFlags: string[];
}

const env = process.env;

export const CONNECTORS: ConnectorDescriptor[] = [
  {
    key: 'gmail',
    displayName: 'Gmail (RFQ inbox)',
    type: 'gmail',
    enabled: env.GMAIL_SYNC_ENABLED === 'true',
    description: 'Existing Gmail connector (Phase 1) using predefined queries + metadata sidecars.',
    envFlags: ['GMAIL_SYNC_ENABLED'],
  },
  {
    key: 'drive',
    displayName: 'Google Drive (meeting notes)',
    type: 'drive',
    enabled: env.DRIVE_SYNC_ENABLED === 'true',
    description: 'Existing Drive connector fetching transcripts for parsing.',
    envFlags: ['DRIVE_SYNC_ENABLED'],
  },
  {
    key: 'crm_csv',
    displayName: 'CRM CSV Exports',
    type: 'crm_csv',
    enabled: env.CRM_CSV_ENABLED === 'true',
    description:
      'Stub connector for CRM exports. When enabled, runbook expects nightly CSV drops in uploads/crm for future parsing.',
    envFlags: ['CRM_CSV_ENABLED'],
  },
  {
    key: 'teams_transcript',
    displayName: 'Teams/Zoom Transcripts',
    type: 'teams_transcript',
    enabled: env.TEAMS_TRANSCRIPT_ENABLED === 'true',
    description:
      'Stub connector for Teams/Zoom transcripts. When enabled, SourceSync should pull transcripts via API (Phase 7).',
    envFlags: ['TEAMS_TRANSCRIPT_ENABLED'],
  },
];

export function getEnabledConnectors(): ConnectorDescriptor[] {
  return CONNECTORS.filter((connector) => connector.enabled);
}

export default CONNECTORS;
