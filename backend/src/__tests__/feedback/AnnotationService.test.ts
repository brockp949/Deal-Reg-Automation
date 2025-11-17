import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import AnnotationService from '../../feedback/AnnotationService';

describe('AnnotationService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annotation-service-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('applies stage and priority overrides to opportunity records', async () => {
    const service = new AnnotationService({ baseDir: tempDir });
    await service.saveAnnotations([
      {
        opportunity_id: 'opp-1',
        stage: 'quote',
        priority: 'high',
        reviewer: 'Alice',
        reviewed_at: '2025-11-17T00:00:00.000Z',
        notes: 'Needs manual correction',
      },
    ]);

    const records = [
      {
        id: 'opp-1',
        name: 'ClearLED',
        stage: 'rfq',
        priority: 'medium',
        costUpsideNotes: [],
        actors: [],
        nextSteps: [],
        sourceTags: [],
        sourceSummary: [],
        metadata: { parser: 'StandardizedParser' },
      },
    ];

    const result = await service.applyAnnotations(records as any);
    expect(result.records[0].stage).toBe('quote');
    expect(result.records[0].priority).toBe('high');
    expect(result.records[0].metadata.annotations?.reviewer).toBe('Alice');
    expect(result.stats.stageOverrides).toBe(1);
    expect(result.stats.priorityOverrides).toBe(1);
    expect(result.stats.totalAnnotations).toBe(1);
  });

  it('imports annotations from file and merges duplicates', async () => {
    const service = new AnnotationService({ baseDir: tempDir });
    const importFile = path.join(tempDir, 'import.json');
    await fs.writeFile(
      importFile,
      JSON.stringify({
        annotations: [
          { opportunity_id: 'opp-1', stage: 'quote' },
          { opportunity_id: 'opp-2', priority: 'high' },
        ],
      })
    );

    const summary = await service.importAnnotations(importFile, 'Bob');
    expect(summary.added).toBe(2);
    const annotations = await service.loadAnnotations();
    expect(annotations).toHaveLength(2);
    expect(annotations[0].reviewer).toBe('Bob');
  });
});
