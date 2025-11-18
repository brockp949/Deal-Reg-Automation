import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import { OpportunityRecord } from '../opportunities/types';

const router = express.Router();

router.get('/', async (req, res) => {
  const stageFilter = (req.query.stage as string) || undefined;
  const priorityFilter = (req.query.priority as string) || undefined;
  const searchQuery = ((req.query.search as string) || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const opportunitiesPath = path.resolve(
    config.upload.directory,
    'opportunities',
    'opportunities.json'
  );
  const raw = await fs.readFile(opportunitiesPath, 'utf-8');
  let records = JSON.parse(raw) as OpportunityRecord[];

  if (stageFilter) {
    records = records.filter((record) => record.stage === stageFilter);
  }
  if (priorityFilter) {
    records = records.filter((record) => record.priority === priorityFilter);
  }
  if (searchQuery) {
    records = records.filter((record) => record.name?.toLowerCase().includes(searchQuery));
  }

  const paged = records.slice(offset, offset + limit);

  res.json({ data: paged, count: paged.length, total: records.length, offset, limit });
});

export default router;
