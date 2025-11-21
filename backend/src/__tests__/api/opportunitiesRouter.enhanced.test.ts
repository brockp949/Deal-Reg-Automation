import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import app from '../../server';
import { config } from '../../config';

describe.skip('Opportunities API - Enhanced Features', () => {
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const opportunitiesPath = path.join(opportunitiesDir, 'opportunities.json');
  const insightsPath = path.join(opportunitiesDir, 'insights.json');

  const readApiKey = 'read-key-123';
  const adminApiKey = 'admin-key-456';

  beforeAll(async () => {
    // Configure multiple API keys
    process.env.OPPORTUNITY_API_KEYS = `${readApiKey}:read:Read Key,${adminApiKey}:admin:Admin Key`;

    await fs.mkdir(opportunitiesDir, { recursive: true });

    // Create test opportunities
    await fs.writeFile(
      opportunitiesPath,
      JSON.stringify([
        {
          id: 'opp-1',
          name: 'Alpha Deal',
          stage: 'rfq',
          priority: 'high',
          createdAt: '2025-01-01T00:00:00Z',
        },
        {
          id: 'opp-2',
          name: 'Beta Deal',
          stage: 'quote',
          priority: 'medium',
          createdAt: '2025-01-15T00:00:00Z',
        },
        {
          id: 'opp-3',
          name: 'Gamma Deal',
          stage: 'po_in_progress',
          priority: 'high',
          createdAt: '2025-02-01T00:00:00Z',
        },
        {
          id: 'opp-4',
          name: 'Delta Deal',
          stage: 'rfq',
          priority: 'low',
          createdAt: '2024-12-01T00:00:00Z',
        },
      ])
    );

    // Create test insights
    await fs.writeFile(
      insightsPath,
      JSON.stringify({
        insights: [
          {
            opportunity_id: 'opp-1',
            winProbability: 0.75,
            momentumScore: 0.8,
            riskFlags: [],
          },
          {
            opportunity_id: 'opp-2',
            winProbability: 0.45,
            momentumScore: 0.5,
            riskFlags: ['stalled'],
          },
        ],
      })
    );
  });

  afterAll(async () => {
    delete process.env.OPPORTUNITY_API_KEYS;
    await fs.rm(opportunitiesDir, { recursive: true, force: true });
  });

  describe('Role-Based Authentication', () => {
    it('should allow read role to GET /api/opportunities', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
    });

    it('should allow admin role to GET /api/opportunities', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .set('x-api-key', adminApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
    });

    it('should reject invalid API key', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .set('x-api-key', 'invalid-key');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid API key');
    });

    it('should reject missing API key', async () => {
      const response = await request(app).get('/api/opportunities');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Missing API key');
    });
  });

  describe('Sorting', () => {
    it('should sort by name ascending', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ sortBy: 'name', sortOrder: 'asc' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data[0].name).toBe('Alpha Deal');
      expect(response.body.data[1].name).toBe('Beta Deal');
    });

    it('should sort by priority descending', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ sortBy: 'priority', sortOrder: 'desc' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      const priorities = response.body.data.map((o: any) => o.priority);
      expect(priorities[0]).toBe('high');
      expect(priorities[priorities.length - 1]).toBe('low');
    });

    it('should sort by createdAt descending by default', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      const dates = response.body.data.map((o: any) => new Date(o.createdAt).getTime());

      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });

    it('should reject invalid sortBy field', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ sortBy: 'invalid' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid sortBy');
    });

    it('should reject invalid sortOrder', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ sortOrder: 'invalid' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid sortOrder');
    });
  });

  describe('Date Filters', () => {
    it('should filter by createdAfter', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ createdAfter: '2025-01-10T00:00:00Z' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(2); // opp-2, opp-3
      expect(response.body.data.every((o: any) => new Date(o.createdAt) >= new Date('2025-01-10'))).toBe(true);
    });

    it('should filter by createdBefore', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ createdBefore: '2025-01-10T00:00:00Z' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(2); // opp-1, opp-4
      expect(response.body.data.every((o: any) => new Date(o.createdAt) <= new Date('2025-01-10'))).toBe(true);
    });

    it('should filter by date range', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({
          createdAfter: '2025-01-01T00:00:00Z',
          createdBefore: '2025-01-31T23:59:59Z',
        })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(2); // opp-1, opp-2
    });
  });

  describe('Insights Integration', () => {
    it('should include insights when requested', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ includeInsights: 'true' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      const withInsight = response.body.data.find((o: any) => o.id === 'opp-1');
      expect(withInsight.insight).toBeDefined();
      expect(withInsight.insight.winProbability).toBe(0.75);
      expect(withInsight.insight.momentumScore).toBe(0.8);
    });

    it('should not include insights by default', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data[0].insight).toBeUndefined();
    });

    it('should handle missing insights gracefully', async () => {
      await fs.unlink(insightsPath);

      const response = await request(app)
        .get('/api/opportunities')
        .query({ includeInsights: 'true' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data[0].insight).toBeUndefined();

      // Restore insights file
      await fs.writeFile(
        insightsPath,
        JSON.stringify({
          insights: [
            { opportunity_id: 'opp-1', winProbability: 0.75, momentumScore: 0.8, riskFlags: [] },
          ],
        })
      );
    });
  });

  describe('Combined Filters', () => {
    it('should apply multiple filters together', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({
          stage: 'rfq',
          priority: 'high',
          sortBy: 'createdAt',
          sortOrder: 'desc',
        })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].id).toBe('opp-1');
    });

    it('should filter, sort, and paginate correctly', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({
          priority: 'high',
          sortBy: 'name',
          sortOrder: 'asc',
          limit: 1,
          offset: 0,
        })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.total).toBe(2);
      expect(response.body.data[0].name).toBe('Alpha Deal');
    });
  });

  describe('GET /api/opportunities/:id', () => {
    it('should get a single opportunity by ID', async () => {
      const response = await request(app)
        .get('/api/opportunities/opp-1')
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe('opp-1');
      expect(response.body.data.name).toBe('Alpha Deal');
    });

    it('should include insights for single opportunity', async () => {
      const response = await request(app)
        .get('/api/opportunities/opp-1')
        .query({ includeInsights: 'true' })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data.insight).toBeDefined();
      expect(response.body.data.insight.winProbability).toBe(0.75);
    });

    it('should return 404 for non-existent opportunity', async () => {
      const response = await request(app)
        .get('/api/opportunities/non-existent')
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('should require authentication', async () => {
      const response = await request(app).get('/api/opportunities/opp-1');

      expect(response.status).toBe(401);
    });
  });

  describe('Query Response Format', () => {
    it('should return query parameters in response', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({
          stage: 'rfq',
          sortBy: 'name',
          sortOrder: 'asc',
          includeInsights: 'true',
        })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.query).toEqual({
        stage: 'rfq',
        priority: undefined,
        search: undefined,
        createdAfter: undefined,
        createdBefore: undefined,
        sortBy: 'name',
        sortOrder: 'asc',
        includeInsights: true,
      });
    });

    it('should include pagination metadata', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ limit: 2, offset: 1 })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(response.body.total).toBe(4);
      expect(response.body.offset).toBe(1);
      expect(response.body.limit).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty opportunities file', async () => {
      await fs.writeFile(opportunitiesPath, '[]');

      const response = await request(app)
        .get('/api/opportunities')
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.total).toBe(0);

      // Restore
      await fs.writeFile(
        opportunitiesPath,
        JSON.stringify([
          { id: 'opp-1', name: 'Alpha Deal', stage: 'rfq', priority: 'high', createdAt: '2025-01-01T00:00:00Z' },
        ])
      );
    });

    it('should handle missing opportunities file', async () => {
      await fs.unlink(opportunitiesPath);

      const response = await request(app)
        .get('/api/opportunities')
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);

      // Restore
      await fs.writeFile(
        opportunitiesPath,
        JSON.stringify([
          { id: 'opp-1', name: 'Alpha Deal', stage: 'rfq', priority: 'high', createdAt: '2025-01-01T00:00:00Z' },
        ])
      );
    });

    it('should enforce max limit of 500', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ limit: 1000 })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(500);
    });

    it('should handle negative offset gracefully', async () => {
      const response = await request(app)
        .get('/api/opportunities')
        .query({ offset: -10 })
        .set('x-api-key', readApiKey);

      expect(response.status).toBe(200);
      expect(response.body.offset).toBe(0);
    });
  });
});
