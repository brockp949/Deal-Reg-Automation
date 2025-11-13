/**
 * Unit Tests for ThreadBuilder - Phase 2
 */

import { ThreadBuilder } from '../../parsing/ThreadBuilder';
import { ParsedEmailMetadata } from '../../parsing/types';

describe('ThreadBuilder', () => {
  let builder: ThreadBuilder;

  beforeEach(() => {
    builder = new ThreadBuilder();
  });

  const createTestMessage = (
    overrides: Partial<ParsedEmailMetadata>
  ): ParsedEmailMetadata => {
    return {
      message_id: '<test@example.com>',
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: 'recipient@example.com', name: 'Recipient' }],
      cc: [],
      bcc: [],
      subject: 'Test Subject',
      date: new Date('2024-01-15T10:00:00Z'),
      references: [],
      in_reply_to: null,
      gmail_thread_id: null,
      body_text: 'Test body',
      body_html: null,
      attachments: [],
      headers: {},
      ...overrides,
    };
  };

  describe('buildThreads', () => {
    it('should create single thread from one message', () => {
      const message = createTestMessage({
        message_id: '<msg1@example.com>',
      });

      builder.addMessage(message);
      const threads = builder.buildThreads();

      expect(threads).toHaveLength(1);
      expect(threads[0].message_count).toBe(1);
      expect(threads[0].messages[0].message_id).toBe('<msg1@example.com>');
    });

    it('should group messages by Gmail Thread ID', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T11:00:00Z'),
      });

      builder.addMessages([msg1, msg2]);
      const threads = builder.buildThreads();

      expect(threads).toHaveLength(1);
      expect(threads[0].message_count).toBe(2);
      expect(threads[0].thread_id).toBe('thread-123');
      expect(threads[0].messages[0].message_id).toBe('<msg1@example.com>');
      expect(threads[0].messages[1].message_id).toBe('<msg2@example.com>');
    });

    it('should thread by In-Reply-To when Gmail ID not available', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        date: new Date('2024-01-15T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        in_reply_to: '<msg1@example.com>',
        date: new Date('2024-01-15T11:00:00Z'),
      });

      builder.addMessages([msg1, msg2]);
      const threads = builder.buildThreads();

      expect(threads).toHaveLength(1);
      expect(threads[0].message_count).toBe(2);
    });

    it('should thread by References header', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        date: new Date('2024-01-15T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        in_reply_to: '<msg1@example.com>',
        references: ['<msg1@example.com>'],
        date: new Date('2024-01-15T11:00:00Z'),
      });

      const msg3 = createTestMessage({
        message_id: '<msg3@example.com>',
        references: ['<msg1@example.com>', '<msg2@example.com>'],
        date: new Date('2024-01-15T12:00:00Z'),
      });

      builder.addMessages([msg1, msg2, msg3]);
      const threads = builder.buildThreads();

      expect(threads).toHaveLength(1);
      expect(threads[0].message_count).toBe(3);
    });

    it('should fall back to subject matching', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        subject: 'Project Discussion',
        date: new Date('2024-01-15T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        subject: 'Re: Project Discussion',
        date: new Date('2024-01-15T11:00:00Z'),
      });

      builder.addMessages([msg1, msg2]);
      const threads = builder.buildThreads();

      expect(threads).toHaveLength(1);
      expect(threads[0].message_count).toBe(2);
    });

    it('should normalize subjects for matching (remove Re:, Fwd:)', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        subject: 'Project Discussion',
        date: new Date('2024-01-15T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        subject: 'RE: Project Discussion',
        date: new Date('2024-01-15T11:00:00Z'),
      });

      const msg3 = createTestMessage({
        message_id: '<msg3@example.com>',
        subject: 'Fwd: Project Discussion',
        date: new Date('2024-01-15T12:00:00Z'),
      });

      builder.addMessages([msg1, msg2, msg3]);
      const threads = builder.buildThreads();

      expect(threads).toHaveLength(1);
      expect(threads[0].message_count).toBe(3);
    });

    it('should not group messages with same subject if outside time window', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        subject: 'Weekly Update',
        date: new Date('2024-01-01T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        subject: 'Weekly Update',
        date: new Date('2024-01-20T10:00:00Z'), // 19 days later (outside 7-day window)
      });

      builder.addMessages([msg1, msg2]);
      const threads = builder.buildThreads();

      expect(threads).toHaveLength(2);
    });

    it('should sort messages within thread by date', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T12:00:00Z'), // Latest
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T10:00:00Z'), // Earliest
      });

      const msg3 = createTestMessage({
        message_id: '<msg3@example.com>',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T11:00:00Z'), // Middle
      });

      builder.addMessages([msg1, msg2, msg3]);
      const threads = builder.buildThreads();

      expect(threads[0].messages[0].message_id).toBe('<msg2@example.com>');
      expect(threads[0].messages[1].message_id).toBe('<msg3@example.com>');
      expect(threads[0].messages[2].message_id).toBe('<msg1@example.com>');
    });

    it('should extract unique participants from thread', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        from: { email: 'alice@example.com', name: 'Alice' },
        to: [{ email: 'bob@example.com', name: 'Bob' }],
        cc: [{ email: 'charlie@example.com', name: 'Charlie' }],
        gmail_thread_id: 'thread-123',
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        from: { email: 'bob@example.com', name: 'Bob' },
        to: [{ email: 'alice@example.com', name: 'Alice' }],
        cc: [],
        gmail_thread_id: 'thread-123',
      });

      builder.addMessages([msg1, msg2]);
      const threads = builder.buildThreads();

      expect(threads[0].participants).toHaveLength(3);

      const emails = threads[0].participants.map((p) => p.email);
      expect(emails).toContain('alice@example.com');
      expect(emails).toContain('bob@example.com');
      expect(emails).toContain('charlie@example.com');
    });

    it('should set thread date range correctly', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-20T15:30:00Z'),
      });

      builder.addMessages([msg1, msg2]);
      const threads = builder.buildThreads();

      expect(threads[0].date_start).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(threads[0].date_end).toEqual(new Date('2024-01-20T15:30:00Z'));
    });

    it('should use root message subject as thread subject', () => {
      const msg1 = createTestMessage({
        message_id: '<msg1@example.com>',
        subject: 'Original Subject',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T10:00:00Z'),
      });

      const msg2 = createTestMessage({
        message_id: '<msg2@example.com>',
        subject: 'Re: Original Subject',
        gmail_thread_id: 'thread-123',
        date: new Date('2024-01-15T11:00:00Z'),
      });

      builder.addMessages([msg1, msg2]);
      const threads = builder.buildThreads();

      expect(threads[0].subject).toBe('Original Subject');
    });
  });

  describe('getMessageCount', () => {
    it('should return correct message count', () => {
      const msg1 = createTestMessage({ message_id: '<msg1@example.com>' });
      const msg2 = createTestMessage({ message_id: '<msg2@example.com>' });

      builder.addMessages([msg1, msg2]);

      expect(builder.getMessageCount()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all messages', () => {
      const msg = createTestMessage({ message_id: '<msg1@example.com>' });
      builder.addMessage(msg);

      builder.clear();

      expect(builder.getMessageCount()).toBe(0);
    });
  });
});
