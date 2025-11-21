import request from 'supertest';

// Mock DB so tests do not hit a real database
const mockQuery = jest.fn();
jest.mock('../db', () => ({
  __esModule: true,
  query: mockQuery,
  default: {
    query: mockQuery,
    end: jest.fn(),
  },
}));

const loadApp = async (envOverrides: Record<string, string | undefined> = {}) => {
  jest.resetModules();
  Object.assign(process.env, envOverrides);
  return (await import('../app')).default;
};

describe.skip('Security guardrails and rate limits', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('clear-all endpoint is rejected when not enabled', async () => {
    const app = await loadApp({
      CLEAR_ALL_ENDPOINT_ENABLED: 'false',
      CLEAR_ALL_TOKEN: 'secret-token',
    });

    const res = await request(app).delete('/api/files/clear-all');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('clear-all endpoint requires valid token when enabled', async () => {
    const app = await loadApp({
      CLEAR_ALL_ENDPOINT_ENABLED: 'true',
      CLEAR_ALL_TOKEN: 'secret-token',
    });

    const resMissing = await request(app).delete('/api/files/clear-all');
    expect(resMissing.status).toBe(401);

    const resInvalid = await request(app)
      .delete('/api/files/clear-all')
      .set('X-Admin-Token', 'wrong');
    expect(resInvalid.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('AI usage stats rejects invalid dates', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/ai/usage?startDate=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid date/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('AI usage stats returns filtered summary with parameterized query', async () => {
    const app = await loadApp();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ date: '2024-01-01', extraction_type: 'deal', total_requests: 5 }] }) // getAIUsageStats
      .mockResolvedValueOnce({
        rows: [{
          total_requests: '5',
          total_tokens: '10',
          total_cache_hits: '2',
          avg_confidence: '0.9',
          avg_success_rate: '0.8',
        }],
      }); // summary

    const res = await request(app).get('/api/ai/usage?startDate=2024-01-01&endDate=2024-01-31&extractionType=deal');

    expect(res.status).toBe(200);
    expect(res.body.summary.totalRequests).toBe(5);
    expect(res.body.summary.totalCacheHits).toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    // ensure parameterized query used (no interpolated SQL with unsanitized values)
    const summaryCallSql = mockQuery.mock.calls[1][0] as string;
    expect(summaryCallSql).toMatch(/WHERE/);
    expect(summaryCallSql).not.toContain('2024-01-01\''); // not interpolated as raw string
  });
});
