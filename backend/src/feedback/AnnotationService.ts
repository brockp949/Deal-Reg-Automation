import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { OpportunityPriority, OpportunityRecord, OpportunityStage } from '../opportunities/types';

export interface OpportunityAnnotation {
  opportunity_id: string;
  stage?: OpportunityStage;
  priority?: OpportunityPriority;
  verdict?: string;
  notes?: string;
  reviewer?: string;
  reviewed_at?: string;
}

export interface AnnotationStats {
  totalAnnotations: number;
  stageOverrides: number;
  priorityOverrides: number;
  notesCount: number;
  lastUpdated?: string;
}

interface AnnotationFile {
  annotations: OpportunityAnnotation[];
  updated_at?: string;
}

export interface AnnotationServiceOptions {
  baseDir: string;
  fileName?: string;
}

export class AnnotationService {
  private readonly filePath: string;

  constructor(private readonly options: AnnotationServiceOptions) {
    if (!options.baseDir) {
      throw new Error('AnnotationService requires a baseDir option');
    }
    const fileName = options.fileName ?? path.join('opportunities', 'feedback', 'annotations.json');
    this.filePath = path.resolve(options.baseDir, fileName);
  }

  async loadAnnotations(): Promise<OpportunityAnnotation[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed: AnnotationFile = JSON.parse(raw);
      if (Array.isArray(parsed.annotations)) {
        return parsed.annotations;
      }
      return [];
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async saveAnnotations(annotations: OpportunityAnnotation[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: AnnotationFile = {
      annotations,
      updated_at: new Date().toISOString(),
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  async importAnnotations(
    filePath: string,
    reviewer?: string
  ): Promise<{ added: number; updated: number }> {
    const imported = await this.loadImportFile(filePath);
    const existing = await this.loadAnnotations();
    const map = new Map(existing.map((annotation) => [annotation.opportunity_id, annotation]));
    let added = 0;
    let updated = 0;

    for (const annotation of imported) {
      if (!annotation.opportunity_id) continue;
      const now = new Date().toISOString();
      const normalized: OpportunityAnnotation = {
        ...annotation,
        reviewer: annotation.reviewer ?? reviewer,
        reviewed_at: annotation.reviewed_at ?? now,
      };
      if (map.has(annotation.opportunity_id)) {
        map.set(annotation.opportunity_id, { ...map.get(annotation.opportunity_id), ...normalized });
        updated += 1;
      } else {
        map.set(annotation.opportunity_id, normalized);
        added += 1;
      }
    }

    await this.saveAnnotations(Array.from(map.values()));
    logger.info('Imported annotations', { added, updated });
    return { added, updated };
  }

  private async loadImportFile(filePath: string): Promise<OpportunityAnnotation[]> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as OpportunityAnnotation[];
    }
    if (Array.isArray(parsed.annotations)) {
      return parsed.annotations as OpportunityAnnotation[];
    }
    throw new Error('Annotations file must be an array or { annotations: [...] }');
  }

  async applyAnnotations(records: OpportunityRecord[]): Promise<{
    records: OpportunityRecord[];
    stats: AnnotationStats;
  }> {
    const annotations = await this.loadAnnotations();
    if (!annotations.length) {
      return {
        records,
        stats: {
          totalAnnotations: 0,
          stageOverrides: 0,
          priorityOverrides: 0,
          notesCount: 0,
        },
      };
    }

    const annotationMap = new Map(annotations.map((annotation) => [annotation.opportunity_id, annotation]));
    let stageOverrides = 0;
    let priorityOverrides = 0;
    let notesCount = 0;

    const updatedRecords = records.map((record) => {
      const annotation = annotationMap.get(record.id);
      if (!annotation) {
        return record;
      }
      const updated = { ...record };
      updated.metadata = {
        ...record.metadata,
        annotations: {
          originalStage: record.stage,
          originalPriority: record.priority,
          stageOverride: annotation.stage,
          priorityOverride: annotation.priority,
          reviewer: annotation.reviewer,
          reviewed_at: annotation.reviewed_at,
          notes: annotation.notes,
          verdict: annotation.verdict,
        },
      };

      if (annotation.stage && this.isValidStage(annotation.stage)) {
        updated.stage = annotation.stage;
        stageOverrides += 1;
      }
      if (annotation.priority && this.isValidPriority(annotation.priority)) {
        updated.priority = annotation.priority;
        priorityOverrides += 1;
      }
      if (annotation.notes) {
        notesCount += 1;
      }
      return updated;
    });

    const stats: AnnotationStats = {
      totalAnnotations: annotations.length,
      stageOverrides,
      priorityOverrides,
      notesCount,
      lastUpdated: new Date().toISOString(),
    };

    return { records: updatedRecords, stats };
  }

  private isValidStage(value: string): value is OpportunityStage {
    return ['rfq', 'quote', 'po_in_progress', 'integration', 'research', 'unknown'].includes(value);
  }

  private isValidPriority(value: string): value is OpportunityPriority {
    return ['high', 'medium', 'low'].includes(value);
  }
}

export default AnnotationService;
