describe('ConnectorRegistry', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.CRM_CSV_ENABLED;
  });

  it('includes stub connectors with env flags', async () => {
    const { CONNECTORS } = await import('../../connectors/ConnectorRegistry');
    expect(CONNECTORS.some((c) => c.key === 'crm_csv')).toBe(true);
    expect(CONNECTORS.some((c) => c.key === 'teams_transcript')).toBe(true);
  });

  it('returns enabled connectors based on env', async () => {
    process.env.CRM_CSV_ENABLED = 'true';
    const { getEnabledConnectors } = await import('../../connectors/ConnectorRegistry');
    const enabled = getEnabledConnectors();
    expect(enabled.some((c) => c.key === 'crm_csv')).toBe(true);
  });
});
