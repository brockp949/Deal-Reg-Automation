import request from 'supertest';
let app: any;
let config: any;

describe('Security & auth guards', () => {
  const originalApiKeys = process.env.OPPORTUNITY_API_KEYS;

beforeAll(() => {
  process.env.OPPORTUNITY_API_KEYS = 'readkey:read:Read Key,writekey:write:Write Key,adminkey:admin:Admin Key';
  jest.resetModules();
  // Import after env is set
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  config = require('../../config').config;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app = require('../../app').default;
});

afterAll(() => {
  process.env.OPPORTUNITY_API_KEYS = originalApiKeys;
});

  it('denies missing API key on admin route', async () => {
    const res = await request(app).get(`${config.apiPrefix}/merge/audit/export`);
    expect(res.status).toBe(401);
  });

  it('denies read key on admin route', async () => {
    const res = await request(app)
      .get(`${config.apiPrefix}/merge/audit/export`)
      .set('x-api-key', 'readkey');
    expect(res.status).toBe(403);
  });

  it('allows admin key on merge route', async () => {
    const res = await request(app)
      .get(`${config.apiPrefix}/merge/audit/export`)
      .set('x-api-key', 'adminkey');
    // Not asserting 200 because handler may require DB; only asserting not 401/403
    expect([200, 400, 404, 500]).toContain(res.status);
  });
});
