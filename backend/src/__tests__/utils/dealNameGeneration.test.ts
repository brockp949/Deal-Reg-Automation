import { generateDealName } from '../../utils/fileHelpers';

describe('generateDealName', () => {
  it('prefers AI suggestions when they look meaningful', () => {
    const name = generateDealName({
      ai_suggested_name: 'Acme Fiber Buildout Q1',
      customer_name: 'Acme Fiber',
      vendor_name: 'Juniper',
    });

    expect(name).toBe('Acme Fiber Buildout Q1');
  });

  it('builds a structured name that blends customer, use case, vendor, and value cues', () => {
    const name = generateDealName({
      customer_name: 'Globex Retail',
      vendor_name: 'HPE',
      product_service_requirements: '12 sites SD-WAN rollout with 48-port switches',
      deal_value: 1_500_000,
      registration_date: new Date('2025-02-15'),
    });

    expect(name.toLowerCase()).toContain('globex');
    expect(name.toLowerCase()).toContain('hpe');
    expect(name.toLowerCase()).toMatch(/switch|sd-wan|site/);
    expect(name).toMatch(/\$1\.5|1\.5m|large build/i);
  });

  it('falls back to vendor plus time window when context is sparse', () => {
    const name = generateDealName({
      vendor_name: 'Cisco',
      registration_date: new Date('2025-01-10'),
    });

    expect(name).toContain('Cisco');
    expect(name).toMatch(/Jan 2025/);
  });
});
