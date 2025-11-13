/**
 * Parsing Configuration - Phase 2
 * Configuration for email parsing and thread reconstruction
 */

export interface ParsingConfig {
  parsing: {
    prefer_plain_text: boolean;
    preserve_html: boolean;
    max_attachment_size_mb: number;
  };
  threading: {
    use_gmail_thread_id: boolean;
    subject_match_window_days: number;
    normalize_subject: boolean;
  };
  html_conversion: {
    preserve_links: boolean;
    convert_lists: boolean;
    max_line_length: number;
  };
}

export const DEFAULT_PARSING_CONFIG: ParsingConfig = {
  parsing: {
    prefer_plain_text: true,
    preserve_html: false,
    max_attachment_size_mb: 10,
  },
  threading: {
    use_gmail_thread_id: true,
    subject_match_window_days: 7,
    normalize_subject: true,
  },
  html_conversion: {
    preserve_links: true,
    convert_lists: true,
    max_line_length: 80,
  },
};

/**
 * Get parsing config with overrides
 */
export function getParsingConfig(
  overrides?: Partial<ParsingConfig>
): ParsingConfig {
  if (!overrides) {
    return DEFAULT_PARSING_CONFIG;
  }

  return {
    parsing: {
      ...DEFAULT_PARSING_CONFIG.parsing,
      ...(overrides.parsing || {}),
    },
    threading: {
      ...DEFAULT_PARSING_CONFIG.threading,
      ...(overrides.threading || {}),
    },
    html_conversion: {
      ...DEFAULT_PARSING_CONFIG.html_conversion,
      ...(overrides.html_conversion || {}),
    },
  };
}

/**
 * Load parsing config from environment
 */
export function loadParsingConfigFromEnv(): ParsingConfig {
  const config = { ...DEFAULT_PARSING_CONFIG };

  if (process.env.PREFER_PLAIN_TEXT !== undefined) {
    config.parsing.prefer_plain_text = process.env.PREFER_PLAIN_TEXT === 'true';
  }

  if (process.env.PRESERVE_HTML !== undefined) {
    config.parsing.preserve_html = process.env.PRESERVE_HTML === 'true';
  }

  if (process.env.USE_GMAIL_THREAD_ID !== undefined) {
    config.threading.use_gmail_thread_id =
      process.env.USE_GMAIL_THREAD_ID === 'true';
  }

  if (process.env.SUBJECT_MATCH_WINDOW_DAYS) {
    config.threading.subject_match_window_days = parseInt(
      process.env.SUBJECT_MATCH_WINDOW_DAYS,
      10
    );
  }

  return config;
}
