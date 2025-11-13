/**
 * Thread Builder - Phase 2 Implementation
 * Reconstructs email conversation threads using Gmail thread IDs, References, and subject matching
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import {
  ParsedEmailMetadata,
  EmailThread,
  EmailAddress,
} from './types';

export interface ThreadBuilderOptions {
  use_gmail_thread_id?: boolean;
  subject_match_window_days?: number;
  normalize_subject?: boolean;
}

const DEFAULT_OPTIONS: Required<ThreadBuilderOptions> = {
  use_gmail_thread_id: true,
  subject_match_window_days: 7,
  normalize_subject: true,
};

export class ThreadBuilder {
  private messages: ParsedEmailMetadata[] = [];
  private options: Required<ThreadBuilderOptions>;

  constructor(options: ThreadBuilderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Add message to builder
   */
  addMessage(metadata: ParsedEmailMetadata): void {
    this.messages.push(metadata);
  }

  /**
   * Add multiple messages
   */
  addMessages(messages: ParsedEmailMetadata[]): void {
    this.messages.push(...messages);
  }

  /**
   * Build threads from all added messages
   */
  buildThreads(): EmailThread[] {
    logger.info('Building email threads', {
      messageCount: this.messages.length,
    });

    // Strategy 1: Use Gmail Thread ID if available
    if (this.options.use_gmail_thread_id) {
      const gmailThreads = this.buildThreadsByGmailId();
      if (gmailThreads.length > 0) {
        logger.info('Built threads using Gmail Thread ID', {
          threadCount: gmailThreads.length,
        });
        return gmailThreads;
      }
    }

    // Strategy 2: Use References/In-Reply-To (RFC 5256)
    const threads = this.buildThreadsByReferences();

    logger.info('Built threads', { threadCount: threads.length });

    return threads;
  }

  /**
   * Build threads using Gmail Thread ID (X-GM-THRID)
   */
  private buildThreadsByGmailId(): EmailThread[] {
    const threadMap = new Map<string, ParsedEmailMetadata[]>();

    // Group by Gmail thread ID
    for (const message of this.messages) {
      if (message.gmail_thread_id) {
        const threadId = message.gmail_thread_id;
        if (!threadMap.has(threadId)) {
          threadMap.set(threadId, []);
        }
        threadMap.get(threadId)!.push(message);
      }
    }

    // Convert to EmailThread objects
    const threads: EmailThread[] = [];

    for (const [threadId, messages] of threadMap) {
      threads.push(this.createThread(threadId, messages));
    }

    // Handle messages without Gmail thread ID using fallback
    const messagesWithoutThreadId = this.messages.filter(
      (m) => !m.gmail_thread_id
    );

    if (messagesWithoutThreadId.length > 0) {
      logger.debug('Processing messages without Gmail Thread ID', {
        count: messagesWithoutThreadId.length,
      });

      const fallbackThreads = this.buildThreadsByReferences(
        messagesWithoutThreadId
      );
      threads.push(...fallbackThreads);
    }

    return threads;
  }

  /**
   * Build threads using References and In-Reply-To headers
   */
  private buildThreadsByReferences(
    messages: ParsedEmailMetadata[] = this.messages
  ): EmailThread[] {
    const messageMap = new Map<string, ParsedEmailMetadata>();
    const threadMap = new Map<string, Set<string>>();

    // Index messages by Message-ID
    for (const message of messages) {
      messageMap.set(message.message_id, message);
    }

    // Build thread relationships
    for (const message of messages) {
      let threadId: string | null = null;

      // Check if this message replies to an existing thread
      if (message.in_reply_to) {
        threadId = this.findThreadByMessageId(message.in_reply_to, threadMap);
      }

      // Check references for thread membership
      if (!threadId && message.references.length > 0) {
        for (const ref of message.references) {
          threadId = this.findThreadByMessageId(ref, threadMap);
          if (threadId) break;
        }
      }

      // Check subject-based threading as fallback
      if (!threadId && this.options.normalize_subject) {
        threadId = this.findThreadBySubject(message, messages, threadMap);
      }

      // Create new thread if no match found
      if (!threadId) {
        threadId = uuidv4();
      }

      // Add message to thread
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, new Set<string>());
      }
      threadMap.get(threadId)!.add(message.message_id);

      // Also index by references for faster lookup
      for (const ref of message.references) {
        if (!threadMap.has(ref)) {
          threadMap.set(ref, new Set<string>());
        }
        threadMap.get(ref)!.add(message.message_id);
      }

      if (message.in_reply_to) {
        if (!threadMap.has(message.in_reply_to)) {
          threadMap.set(message.in_reply_to, new Set<string>());
        }
        threadMap.get(message.in_reply_to)!.add(message.message_id);
      }
    }

    // Convert to EmailThread objects
    const threads: EmailThread[] = [];
    const processedMessages = new Set<string>();

    for (const [threadId, messageIds] of threadMap) {
      if (threadId.includes('@') || threadId.startsWith('<')) {
        // Skip reference-only entries (Message-IDs used as keys)
        continue;
      }

      const threadMessages: ParsedEmailMetadata[] = [];

      for (const msgId of messageIds) {
        if (!processedMessages.has(msgId)) {
          const message = messageMap.get(msgId);
          if (message) {
            threadMessages.push(message);
            processedMessages.add(msgId);
          }
        }
      }

      if (threadMessages.length > 0) {
        threads.push(this.createThread(threadId, threadMessages));
      }
    }

    // Handle orphaned messages (no thread found)
    for (const message of messages) {
      if (!processedMessages.has(message.message_id)) {
        const singleThread = this.createThread(
          uuidv4(),
          [message]
        );
        threads.push(singleThread);
      }
    }

    return threads;
  }

  /**
   * Find thread ID by Message-ID
   */
  private findThreadByMessageId(
    messageId: string,
    threadMap: Map<string, Set<string>>
  ): string | null {
    for (const [threadId, messageIds] of threadMap) {
      if (messageIds.has(messageId)) {
        return threadId;
      }
    }
    return null;
  }

  /**
   * Find thread by subject matching (fallback strategy)
   */
  private findThreadBySubject(
    message: ParsedEmailMetadata,
    allMessages: ParsedEmailMetadata[],
    threadMap: Map<string, Set<string>>
  ): string | null {
    const normalizedSubject = this.normalizeSubject(message.subject);
    const windowMs =
      this.options.subject_match_window_days * 24 * 60 * 60 * 1000;

    for (const other of allMessages) {
      if (other.message_id === message.message_id) continue;

      const otherNormalized = this.normalizeSubject(other.subject);

      if (normalizedSubject === otherNormalized) {
        // Check date proximity
        const timeDiff = Math.abs(
          message.date.getTime() - other.date.getTime()
        );

        if (timeDiff <= windowMs) {
          // Find thread containing this message
          return this.findThreadByMessageId(other.message_id, threadMap);
        }
      }
    }

    return null;
  }

  /**
   * Normalize subject for matching (remove Re:, Fwd:, etc.)
   */
  private normalizeSubject(subject: string): string {
    return subject
      .replace(/^(Re|RE|Fwd|FW|Fw):\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Create EmailThread from messages
   */
  private createThread(
    threadId: string,
    messages: ParsedEmailMetadata[]
  ): EmailThread {
    // Sort messages by date
    const sortedMessages = [...messages].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    const rootMessage = sortedMessages[0];
    const participants = this.getUniqueParticipants(sortedMessages);

    const thread: EmailThread = {
      thread_id: threadId,
      messages: sortedMessages,
      root_message: rootMessage,
      participants,
      subject: rootMessage.subject,
      date_start: sortedMessages[0].date,
      date_end: sortedMessages[sortedMessages.length - 1].date,
      message_count: sortedMessages.length,
    };

    return thread;
  }

  /**
   * Get unique participants from messages
   */
  private getUniqueParticipants(
    messages: ParsedEmailMetadata[]
  ): EmailAddress[] {
    const participantMap = new Map<string, EmailAddress>();

    for (const message of messages) {
      // Add from
      const fromEmail = message.from.email.toLowerCase();
      if (!participantMap.has(fromEmail)) {
        participantMap.set(fromEmail, message.from);
      }

      // Add to
      for (const addr of message.to) {
        const email = addr.email.toLowerCase();
        if (!participantMap.has(email)) {
          participantMap.set(email, addr);
        }
      }

      // Add cc
      for (const addr of message.cc) {
        const email = addr.email.toLowerCase();
        if (!participantMap.has(email)) {
          participantMap.set(email, addr);
        }
      }
    }

    return Array.from(participantMap.values());
  }

  /**
   * Clear all messages from builder
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Get message count
   */
  getMessageCount(): number {
    return this.messages.length;
  }
}
