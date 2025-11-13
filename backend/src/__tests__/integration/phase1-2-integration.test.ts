/**
 * Integration Test: Phase 1 + Phase 2
 * Tests end-to-end workflow from MBOX ingestion to thread reconstruction
 */

import * as path from 'path';
import * as fs from 'fs';
import { MboxSplitter } from '../../ingestion/MboxSplitter';
import { MessageStreamIterator } from '../../ingestion/MessageStreamIterator';
import { GmailLabelFilter } from '../../ingestion/GmailLabelFilter';
import { EmailParser } from '../../parsing/EmailParser';
import { ThreadBuilder } from '../../parsing/ThreadBuilder';
import { MultipartHandler } from '../../parsing/MultipartHandler';

describe('Phase 1 + Phase 2 Integration', () => {
  const fixturesDir = path.join(__dirname, '../fixtures');
  const testMboxPath = path.join(fixturesDir, 'deal_registration.mbox');
  const tempChunksDir = path.join(__dirname, '../temp_chunks');

  beforeAll(() => {
    // Create temp directory for chunks
    if (!fs.existsSync(tempChunksDir)) {
      fs.mkdirSync(tempChunksDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up temp chunks
    if (fs.existsSync(tempChunksDir)) {
      const files = fs.readdirSync(tempChunksDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempChunksDir, file));
      }
      fs.rmdirSync(tempChunksDir);
    }
  });

  it('should process MBOX end-to-end: split → stream → parse → thread', async () => {
    // Phase 1: Split MBOX (if file is large enough)
    const splitter = new MboxSplitter({
      chunk_size_mb: 1, // Small size for testing
      output_dir: tempChunksDir,
    });

    // Check if test file exists
    if (!fs.existsSync(testMboxPath)) {
      console.log('Test MBOX file not found, skipping split test');
      // Use the file directly without splitting
      const iterator = new MessageStreamIterator(testMboxPath);
      const parser = new EmailParser();
      const threadBuilder = new ThreadBuilder();

      for await (const message of iterator.iterate()) {
        const metadata = parser.parse(message);
        threadBuilder.addMessage(metadata);
      }

      const threads = threadBuilder.buildThreads();
      expect(threads.length).toBeGreaterThan(0);
      return;
    }

    const stats = fs.statSync(testMboxPath);
    console.log(`Processing MBOX file: ${stats.size} bytes`);

    let metadata;
    if (stats.size > 1024 * 1024) {
      // File is > 1MB, split it
      metadata = await splitter.split_mbox(testMboxPath);

      expect(metadata.chunks.length).toBeGreaterThan(0);
      expect(metadata.original_file).toBe(testMboxPath);

      console.log(`Split into ${metadata.chunks.length} chunks`);
    }

    // Phase 1 + 2: Stream, parse, and build threads
    const parser = new EmailParser();
    const threadBuilder = new ThreadBuilder({
      use_gmail_thread_id: true,
      subject_match_window_days: 7,
    });
    const multipartHandler = new MultipartHandler();
    const labelFilter = new GmailLabelFilter();

    let processedCount = 0;
    let filteredCount = 0;

    if (metadata && metadata.chunks.length > 0) {
      // Process chunks
      for (const chunk of metadata.chunks) {
        const iterator = new MessageStreamIterator(chunk.path);

        for await (const message of iterator.iterate()) {
          processedCount++;

          // Phase 1: Label filtering (optional)
          const labelResult = labelFilter.should_process(message);

          if (labelResult.shouldProcess) {
            filteredCount++;

            // Phase 2: Parse email
            const parsedMetadata = parser.parse(message);

            // Phase 2: Extract text content
            const textContent = multipartHandler.extractBestTextContent(message);

            // Add to thread builder
            threadBuilder.addMessage(parsedMetadata);

            // Log sample
            if (processedCount <= 3) {
              console.log(`\nMessage ${processedCount}:`);
              console.log(`  Subject: ${parsedMetadata.subject}`);
              console.log(`  From: ${parsedMetadata.from.email}`);
              console.log(`  To: ${parsedMetadata.to.map((a) => a.email).join(', ')}`);
              console.log(`  Labels: ${labelResult.labels.join(', ')}`);
              console.log(`  Score: ${labelResult.score}`);
              console.log(`  Text source: ${textContent.source}`);
            }
          }
        }
      }
    } else {
      // Process file directly
      const iterator = new MessageStreamIterator(testMboxPath);

      for await (const message of iterator.iterate()) {
        processedCount++;

        const labelResult = labelFilter.should_process(message);

        if (labelResult.shouldProcess) {
          filteredCount++;
          const parsedMetadata = parser.parse(message);
          const textContent = multipartHandler.extractBestTextContent(message);
          threadBuilder.addMessage(parsedMetadata);

          if (processedCount <= 3) {
            console.log(`\nMessage ${processedCount}:`);
            console.log(`  Subject: ${parsedMetadata.subject}`);
            console.log(`  From: ${parsedMetadata.from.email}`);
            console.log(`  Text source: ${textContent.source}`);
          }
        }
      }
    }

    // Phase 2: Build threads
    const threads = threadBuilder.buildThreads();

    console.log('\n--- Processing Summary ---');
    console.log(`Total messages processed: ${processedCount}`);
    console.log(`Messages after filtering: ${filteredCount}`);
    console.log(`Threads reconstructed: ${threads.length}`);

    // Assertions
    expect(processedCount).toBeGreaterThan(0);
    expect(filteredCount).toBeGreaterThan(0);
    expect(threads.length).toBeGreaterThan(0);

    // Analyze threads
    for (const thread of threads) {
      console.log(`\nThread: ${thread.subject}`);
      console.log(`  Messages: ${thread.message_count}`);
      console.log(`  Participants: ${thread.participants.length}`);
      console.log(`  Date range: ${thread.date_start.toISOString()} to ${thread.date_end.toISOString()}`);

      expect(thread.messages.length).toBe(thread.message_count);
      expect(thread.participants.length).toBeGreaterThan(0);
      expect(thread.date_start.getTime()).toBeLessThanOrEqual(
        thread.date_end.getTime()
      );
    }

    // Verify threading quality
    const totalMessages = threads.reduce(
      (sum, thread) => sum + thread.message_count,
      0
    );
    expect(totalMessages).toBe(filteredCount);

    console.log('\n✅ Phase 1+2 integration test passed!');
  }, 30000); // 30 second timeout for large files

  it('should handle streaming with label filtering', async () => {
    if (!fs.existsSync(testMboxPath)) {
      console.log('Test MBOX not found, skipping');
      return;
    }

    const iterator = new MessageStreamIterator(testMboxPath);
    const labelFilter = new GmailLabelFilter({
      min_priority_score: 20, // Lower threshold for testing
    });

    let totalMessages = 0;
    let highPriorityMessages = 0;

    for await (const message of iterator.iterate()) {
      totalMessages++;

      const { shouldProcess, score, labels } = labelFilter.should_process(message);

      if (shouldProcess) {
        highPriorityMessages++;
      }

      if (totalMessages === 1) {
        console.log('First message labels:', labels);
        console.log('First message score:', score);
      }
    }

    console.log(`Processed ${totalMessages} messages`);
    console.log(`High priority: ${highPriorityMessages}`);

    expect(totalMessages).toBeGreaterThan(0);
  });

  it('should parse and thread multiple messages correctly', async () => {
    if (!fs.existsSync(testMboxPath)) {
      console.log('Test MBOX not found, skipping');
      return;
    }

    const parser = new EmailParser();
    const threadBuilder = new ThreadBuilder();
    const iterator = new MessageStreamIterator(testMboxPath);

    const messages = [];
    for await (const message of iterator.iterate()) {
      const parsed = parser.parse(message);
      messages.push(parsed);
      threadBuilder.addMessage(parsed);
    }

    const threads = threadBuilder.buildThreads();

    console.log(`\nParsed ${messages.length} messages into ${threads.length} threads`);

    // Verify all messages are accounted for
    const threadedMessages = threads.reduce(
      (sum, t) => sum + t.message_count,
      0
    );
    expect(threadedMessages).toBe(messages.length);

    // Verify thread structure
    for (const thread of threads) {
      expect(thread.root_message).toBeDefined();
      expect(thread.messages[0]).toBe(thread.root_message);
      expect(thread.subject).toBe(thread.root_message.subject);
    }
  });

  it('should extract text from HTML and plain text emails', async () => {
    if (!fs.existsSync(testMboxPath)) {
      console.log('Test MBOX not found, skipping');
      return;
    }

    const iterator = new MessageStreamIterator(testMboxPath);
    const multipartHandler = new MultipartHandler();

    let plainTextCount = 0;
    let htmlConvertedCount = 0;

    for await (const message of iterator.iterate()) {
      const { text, source } = multipartHandler.extractBestTextContent(message);

      if (source === 'plain') {
        plainTextCount++;
      } else if (source === 'html') {
        htmlConvertedCount++;
      }

      expect(text).toBeDefined();
    }

    console.log(`\nText extraction:`);
    console.log(`  Plain text: ${plainTextCount}`);
    console.log(`  HTML converted: ${htmlConvertedCount}`);

    expect(plainTextCount + htmlConvertedCount).toBeGreaterThan(0);
  });
});
