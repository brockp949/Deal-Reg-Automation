import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import { OpportunityRecord } from '../opportunities/types';
import type { OpportunityInsight } from '../insights/OpportunityInsightService';
import { requireRole } from './middleware/apiKeyAuth';

const router = express.Router();

type SortField = 'name' | 'stage' | 'priority' | 'createdAt';
type SortOrder = 'asc' | 'desc';

interface OpportunityQuery {
  stage?: string;
  priority?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  includeInsights?: boolean;
  limit: number;
  offset: number;
}

type EnrichedOpportunityRecord = OpportunityRecord & {
  insight?: OpportunityInsight | null;
};

interface InsightFilePayload {
  insights?: OpportunityInsight[];
}

/**
 * GET /api/opportunities
 * Query opportunities with filtering, sorting, and pagination
 * Accessible by all authenticated roles
 */
router.get('/', requireRole(['read', 'write', 'admin']), async (req, res) => {
  try {
    const query: OpportunityQuery = {
      stage: (req.query.stage as string) || undefined,
      priority: (req.query.priority as string) || undefined,
      search: (req.query.search as string) || undefined,
      createdAfter: (req.query.createdAfter as string) || undefined,
      createdBefore: (req.query.createdBefore as string) || undefined,
      sortBy: (req.query.sortBy as SortField) || 'createdAt',
      sortOrder: (req.query.sortOrder as SortOrder) || 'desc',
      includeInsights: req.query.includeInsights === 'true',
      limit: Math.min(Number(req.query.limit) || 100, 500),
      offset: Math.max(Number(req.query.offset) || 0, 0),
    };

    // Validate sortBy
    const validSortFields: SortField[] = ['name', 'stage', 'priority', 'createdAt'];
    if (query.sortBy && !validSortFields.includes(query.sortBy)) {
      return res.status(400).json({
        error: 'Invalid sortBy field',
        validFields: validSortFields,
      });
    }

    // Validate sortOrder
    if (query.sortOrder && !['asc', 'desc'].includes(query.sortOrder)) {
      return res.status(400).json({
        error: 'Invalid sortOrder',
        validOrders: ['asc', 'desc'],
      });
    }

    // Load opportunities
    const opportunitiesPath = path.resolve(
      config.upload.directory,
      'opportunities',
      'opportunities.json'
    );

    let rawData: string;
    try {
      rawData = await fs.readFile(opportunitiesPath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return res.json({ data: [], count: 0, total: 0, offset: query.offset, limit: query.limit });
      }
      throw error;
    }

    let records = JSON.parse(rawData) as OpportunityRecord[];

    // Apply filters
    if (query.stage) {
      records = records.filter((record) => record.stage === query.stage);
    }

    if (query.priority) {
      records = records.filter((record) => record.priority === query.priority);
    }

    if (query.search) {
      const searchLower = query.search.toLowerCase();
      records = records.filter(
        (record) =>
          record.name?.toLowerCase().includes(searchLower) ||
          record.id?.toLowerCase().includes(searchLower)
      );
    }

    // Date filters
    if (query.createdAfter) {
      const afterDate = new Date(query.createdAfter);
      if (!isNaN(afterDate.getTime())) {
        records = records.filter((record) => {
          const recordDate = new Date(record.createdAt || 0);
          return recordDate >= afterDate;
        });
      }
    }

    if (query.createdBefore) {
      const beforeDate = new Date(query.createdBefore);
      if (!isNaN(beforeDate.getTime())) {
        records = records.filter((record) => {
          const recordDate = new Date(record.createdAt || 0);
          return recordDate <= beforeDate;
        });
      }
    }

    // Sorting
    if (query.sortBy) {
      records.sort((a, b) => {
        let aVal: any;
        let bVal: any;

        switch (query.sortBy) {
          case 'name':
            aVal = a.name || '';
            bVal = b.name || '';
            break;
          case 'stage':
            aVal = a.stage || '';
            bVal = b.stage || '';
            break;
          case 'priority':
            // Priority order: high > medium > low
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            aVal = priorityOrder[a.priority || 'low'] || 0;
            bVal = priorityOrder[b.priority || 'low'] || 0;
            break;
          case 'createdAt':
            aVal = new Date(a.createdAt || 0).getTime();
            bVal = new Date(b.createdAt || 0).getTime();
            break;
          default:
            aVal = 0;
            bVal = 0;
        }

        if (aVal < bVal) return query.sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return query.sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const totalAfterFilter = records.length;

    // Pagination
    const paged = records.slice(query.offset, query.offset + query.limit);

    // Include insights if requested
    let enrichedData: EnrichedOpportunityRecord[] = paged as EnrichedOpportunityRecord[];
    if (query.includeInsights) {
      const insightsPath = path.resolve(
        config.upload.directory,
        'opportunities',
        'insights.json'
      );

      try {
        const insightsRaw = await fs.readFile(insightsPath, 'utf-8');
        const insightsData = JSON.parse(insightsRaw) as InsightFilePayload;
        const insightsMap = new Map<string, OpportunityInsight>(
          (insightsData.insights ?? []).map((insight) => [insight.opportunity_id, insight])
        );

        enrichedData = paged.map<EnrichedOpportunityRecord>((record) => ({
          ...record,
          insight: insightsMap.get(record.id) ?? null,
        }));
      } catch (error: any) {
        // Insights file not found, continue without insights
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    res.json({
      data: enrichedData,
      count: enrichedData.length,
      total: totalAfterFilter,
      offset: query.offset,
      limit: query.limit,
      query: {
        stage: query.stage,
        priority: query.priority,
        search: query.search,
        createdAfter: query.createdAfter,
        createdBefore: query.createdBefore,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        includeInsights: query.includeInsights,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to fetch opportunities',
      message: error.message,
    });
  }
});

/**
 * GET /api/opportunities/:id
 * Get a single opportunity by ID
 * Accessible by all authenticated roles
 */
router.get('/:id', requireRole(['read', 'write', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const includeInsights = req.query.includeInsights === 'true';

    const opportunitiesPath = path.resolve(
      config.upload.directory,
      'opportunities',
      'opportunities.json'
    );

    const rawData = await fs.readFile(opportunitiesPath, 'utf-8');
    const records = JSON.parse(rawData) as OpportunityRecord[];

    const record = records.find((r) => r.id === id);

    if (!record) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    let enrichedRecord: EnrichedOpportunityRecord = record;

    if (includeInsights) {
      const insightsPath = path.resolve(
        config.upload.directory,
        'opportunities',
        'insights.json'
      );

      try {
        const insightsRaw = await fs.readFile(insightsPath, 'utf-8');
        const insightsData = JSON.parse(insightsRaw) as InsightFilePayload;
        const insight = (insightsData.insights ?? []).find(
          (i) => i.opportunity_id === id
        );

        enrichedRecord = {
          ...record,
          insight: insight ?? null,
        };
      } catch (error: any) {
        // Insights not found, continue without
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    res.json({ data: enrichedRecord });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Opportunities data not found' });
    }

    res.status(500).json({
      error: 'Failed to fetch opportunity',
      message: error.message,
    });
  }
});

export default router;
