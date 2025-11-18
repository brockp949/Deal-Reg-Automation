import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import app from '../../server';
import { config } from '../../config';

describe('opportunities API', () => {
  const opportunitiesDir = path.resolve(config.upload.directory, 'opportunities');
  const opportunitiesPath = path.join(opportunitiesDir, 'opportunities.json');
  const apiKey = 'test-key';

  beforeAll(async () => {
    process.env.OPPORTUNITY_API_KEY = apiKey;
    await fs.mkdir(opportunitiesDir, { recursive: true });
    await fs.writeFile(
      opportunitiesPath,
      JSON.stringify(
        [
          { id: 'opp-1', name: 'ClearLED PDU', stage: 'rfq', priority: 'high' },
          { id: 'opp-2', name: 'Marshalling Cabinet', stage: 'quote', priority: 'medium' },
          { id: 'opp-3', name: 'Integration Pilot', stage: 'integration', priority: 'high' },
        ],
        null,
        2
      )
    );
  });

  it('rejects missing API key when configured', async () => {
    const response = await request(app).get('/api/opportunities');
    expect(response.status).toBe(401);
  });

  it('returns all opportunities with valid API key', async () => {
    const response = await request(app).get('/api/opportunities').set('x-api-key', apiKey);
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(3);
    expect(response.body.total).toBe(3);
  });

  it('filters by stage/priority/search with pagination', async () => {
    const response = await request(app)
      .get('/api/opportunities')
      .set('x-api-key', apiKey)
      .query({ stage: 'rfq', priority: 'high', search: 'clear', limit: 1, offset: 0 });
    expect(response.body.count).toBe(1);
    expect(response.body.total).toBe(1);
    expect(response.body.data[0].id).toBe('opp-1');
  });
});
