/**
 * Transcript Format Normalizer
 *
 * Normalizes transcripts from Teams, Zoom, and Google Drive into a standard format.
 * Handles VTT format, speaker diarization, and timestamp extraction.
 *
 * Phase 7.2 - Teams/Zoom Transcript Connector & NLP Enhancements
 */

export interface NormalizedTranscript {
  text: string;
  segments: TranscriptSegment[];
  speakers: Speaker[];
  metadata: TranscriptMetadata;
}

export interface TranscriptSegment {
  speaker?: string;
  text: string;
  startTime?: number; // seconds
  endTime?: number; // seconds
  confidence?: number;
}

export interface Speaker {
  id: string;
  name?: string;
  email?: string;
  segmentCount: number;
}

export interface TranscriptMetadata {
  format: 'vtt' | 'text' | 'json';
  source: 'teams' | 'zoom' | 'drive' | 'unknown';
  totalDuration?: number;
  speakerCount: number;
  hasTimestamps: boolean;
}

/**
 * Parse VTT (WebVTT) format transcript
 */
export function parseVTT(content: string): NormalizedTranscript {
  const segments: TranscriptSegment[] = [];
  const speakerMap = new Map<string, Speaker>();

  // Split into blocks (separated by blank lines)
  const blocks = content.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');

    // Skip WEBVTT header and NOTE blocks
    if (lines[0]?.startsWith('WEBVTT') || lines[0]?.startsWith('NOTE')) {
      continue;
    }

    // Parse timestamp line (format: 00:00:00.000 --> 00:00:05.000)
    const timestampLine = lines.find((line) => line.includes('-->'));
    if (!timestampLine) continue;

    const [startStr, endStr] = timestampLine.split('-->').map((s) => s.trim());
    const startTime = parseVTTTimestamp(startStr);
    const endTime = parseVTTTimestamp(endStr);

    // Parse speaker and text
    // Format can be:
    // - "Speaker Name: Text here"
    // - "<v Speaker Name>Text here</v>"
    // - Just "Text here" (no speaker)
    const textLines = lines.filter(
      (line) => !line.includes('-->') && !line.match(/^\d+$/) && line.trim()
    );
    const textContent = textLines.join(' ');

    let speaker: string | undefined;
    let text = textContent;

    // Check for <v Speaker> format (Teams style)
    const vTagMatch = textContent.match(/<v\s+([^>]+)>(.*?)<\/v>/);
    if (vTagMatch) {
      speaker = vTagMatch[1].trim();
      text = vTagMatch[2].trim();
    }
    // Check for "Speaker: Text" format (Zoom style)
    else {
      const colonMatch = textContent.match(/^([^:]+):\s*(.+)$/);
      if (colonMatch && colonMatch[1].length < 50) {
        // Assume it's a speaker if less than 50 chars
        speaker = colonMatch[1].trim();
        text = colonMatch[2].trim();
      }
    }

    if (text) {
      segments.push({
        speaker,
        text,
        startTime,
        endTime,
      });

      // Track speakers
      if (speaker) {
        if (!speakerMap.has(speaker)) {
          speakerMap.set(speaker, {
            id: speaker,
            name: speaker,
            segmentCount: 0,
          });
        }
        speakerMap.get(speaker)!.segmentCount++;
      }
    }
  }

  // Calculate total duration
  const lastSegment = segments[segments.length - 1];
  const totalDuration = lastSegment?.endTime;

  return {
    text: segments.map((s) => s.text).join(' '),
    segments,
    speakers: Array.from(speakerMap.values()),
    metadata: {
      format: 'vtt',
      source: detectSource(content),
      totalDuration,
      speakerCount: speakerMap.size,
      hasTimestamps: segments.some((s) => s.startTime !== undefined),
    },
  };
}

/**
 * Parse plain text transcript with speaker diarization
 */
export function parseTextTranscript(content: string, source?: 'teams' | 'zoom' | 'drive'): NormalizedTranscript {
  const segments: TranscriptSegment[] = [];
  const speakerMap = new Map<string, Speaker>();

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let speaker: string | undefined;
    let text = trimmed;
    let startTime: number | undefined;

    // Check for timestamp at start (format: [00:01:23] or (00:01:23))
    const timestampMatch = trimmed.match(/^[\[\(](\d{1,2}:\d{2}:\d{2})[\]\)]\s*/);
    if (timestampMatch) {
      startTime = parseTimestamp(timestampMatch[1]);
      text = trimmed.substring(timestampMatch[0].length);
    }

    // Check for speaker format: "Speaker Name: Text"
    const speakerMatch = text.match(/^([^:]{1,50}):\s*(.+)$/);
    if (speakerMatch) {
      const potentialSpeaker = speakerMatch[1].trim();
      // Validate it looks like a name (not a sentence)
      if (isLikelySpeakerName(potentialSpeaker)) {
        speaker = potentialSpeaker;
        text = speakerMatch[2].trim();
      }
    }

    if (text) {
      segments.push({
        speaker,
        text,
        startTime,
      });

      if (speaker) {
        if (!speakerMap.has(speaker)) {
          speakerMap.set(speaker, {
            id: speaker,
            name: speaker,
            segmentCount: 0,
          });
        }
        speakerMap.get(speaker)!.segmentCount++;
      }
    }
  }

  return {
    text: segments.map((s) => s.text).join(' '),
    segments,
    speakers: Array.from(speakerMap.values()),
    metadata: {
      format: 'text',
      source: source || detectSource(content),
      speakerCount: speakerMap.size,
      hasTimestamps: segments.some((s) => s.startTime !== undefined),
    },
  };
}

/**
 * Parse JSON transcript (Zoom JSON format)
 */
export function parseJSONTranscript(content: string): NormalizedTranscript {
  const data = JSON.parse(content);
  const segments: TranscriptSegment[] = [];
  const speakerMap = new Map<string, Speaker>();

  // Zoom JSON format: { transcript: [{ start_time, end_time, text, speaker }] }
  const transcriptArray = data.transcript || data.segments || [];

  for (const item of transcriptArray) {
    const speaker = item.speaker || item.speaker_name;
    const text = item.text || item.content;
    const startTime = item.start_time || item.startTime;
    const endTime = item.end_time || item.endTime;

    if (text) {
      segments.push({
        speaker,
        text,
        startTime: startTime ? parseFloat(startTime) : undefined,
        endTime: endTime ? parseFloat(endTime) : undefined,
      });

      if (speaker) {
        if (!speakerMap.has(speaker)) {
          speakerMap.set(speaker, {
            id: speaker,
            name: speaker,
            segmentCount: 0,
          });
        }
        speakerMap.get(speaker)!.segmentCount++;
      }
    }
  }

  const lastSegment = segments[segments.length - 1];
  const totalDuration = lastSegment?.endTime;

  return {
    text: segments.map((s) => s.text).join(' '),
    segments,
    speakers: Array.from(speakerMap.values()),
    metadata: {
      format: 'json',
      source: detectSource(content),
      totalDuration,
      speakerCount: speakerMap.size,
      hasTimestamps: segments.some((s) => s.startTime !== undefined),
    },
  };
}

/**
 * Auto-detect and parse transcript format
 */
export function normalizeTranscript(content: string): NormalizedTranscript {
  // Check for VTT format
  if (content.includes('WEBVTT') || content.includes('-->')) {
    return parseVTT(content);
  }

  // Check for JSON format
  if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
    try {
      return parseJSONTranscript(content);
    } catch (error) {
      // Not valid JSON, fall through to text parsing
    }
  }

  // Default to plain text
  return parseTextTranscript(content);
}

/**
 * Extract action items from transcript segments
 */
export function extractActionItems(segments: TranscriptSegment[]): string[] {
  const actionItems: string[] = [];
  const actionKeywords = /\b(action item|todo|follow up|next step|will send|will share|will schedule|need to|should|must)\b/i;

  for (const segment of segments) {
    if (actionKeywords.test(segment.text)) {
      actionItems.push(segment.text);
    }
  }

  return actionItems;
}

/**
 * Extract attendees/participants from transcript
 */
export function extractAttendees(normalized: NormalizedTranscript): string[] {
  const attendees = new Set<string>();

  // Add all speakers
  normalized.speakers.forEach((speaker) => {
    if (speaker.name) {
      attendees.add(speaker.name);
    }
  });

  // Look for explicit attendee listings in text
  const attendeePatterns = [
    /attendees?:\s*([^\n]+)/i,
    /participants?:\s*([^\n]+)/i,
    /present:\s*([^\n]+)/i,
  ];

  for (const pattern of attendeePatterns) {
    const match = normalized.text.match(pattern);
    if (match) {
      const names = match[1].split(/[,;]/);
      names.forEach((name) => {
        const cleaned = name.trim().replace(/\band\b/gi, '').trim();
        if (cleaned && cleaned.length > 2) {
          attendees.add(cleaned);
        }
      });
    }
  }

  return Array.from(attendees);
}

/**
 * Parse VTT timestamp (format: 00:00:00.000)
 */
function parseVTTTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');
  if (parts.length !== 3) return 0;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const secondsParts = parts[2].split('.');
  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = secondsParts[1] ? parseInt(secondsParts[1], 10) : 0;

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/**
 * Parse simple timestamp (format: 00:01:23)
 */
function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');
  if (parts.length !== 3) return 0;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Check if a string looks like a speaker name
 */
function isLikelySpeakerName(text: string): boolean {
  // Must be reasonably short
  if (text.length > 50 || text.length < 2) return false;

  // Should not contain typical sentence markers
  if (/[.!?]/.test(text)) return false;

  // Should not be all uppercase (likely a label/heading)
  if (text === text.toUpperCase() && text.length > 5) return false;

  // Should not start with common sentence starters
  const sentenceStarters = /^(the|a|an|this|that|these|those|it|there|here|we|they|i|you)\b/i;
  if (sentenceStarters.test(text)) return false;

  return true;
}

/**
 * Detect transcript source from content
 */
function detectSource(content: string): 'teams' | 'zoom' | 'drive' | 'unknown' {
  const lower = content.toLowerCase();

  if (lower.includes('microsoft teams') || lower.includes('<v ')) {
    return 'teams';
  }
  if (lower.includes('zoom') || lower.includes('zoom.us')) {
    return 'zoom';
  }
  if (lower.includes('google meet') || lower.includes('meet.google.com')) {
    return 'drive';
  }

  return 'unknown';
}
