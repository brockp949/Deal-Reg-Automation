import {
  findRelatedEntities,
  buildDealCorrelationMap,
  getDataLineage,
  updateCorrelationKeys,
  findCrossSourceDuplicates,
} from '../../services/correlationEngine';

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const { query } = require('../../db');

describe('Correlation Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findRelatedEntities', () => {
    it('returns vendors, contacts, deals, and source files for a deal', async () => {
      query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'deal-1',
              vendor_id: 'vendor-1',
              source_file_ids: ['file-1'],
              customer_name: 'Acme',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'file-1',
              file_name: 'acme.mbox',
              file_type: 'mbox',
              uploaded_at: new Date('2024-01-01'),
              processed_at: new Date('2024-01-02'),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'vendor-1', vendor_name: 'Acme Vendor', source_file_ids: ['file-2'] }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'contact-1', name: 'John Doe' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'deal-2', customer_name: 'Acme', vendor_id: 'vendor-2' }],
        });

      const result = await findRelatedEntities('deal-1', 'deal');

      expect(result.primaryEntity.id).toBe('deal-1');
      expect(result.relatedVendors[0].id).toBe('vendor-1');
      expect(result.relatedContacts[0].id).toBe('contact-1');
      expect(result.relatedDeals[0].id).toBe('deal-2');
      expect(result.sourceFiles[0].id).toBe('file-1');
    });

    it('throws if primary entity is missing', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await expect(findRelatedEntities('deal-404')).rejects.toThrow('Entity deal-404 not found');
    });
  });

  describe('buildDealCorrelationMap', () => {
    it('builds correlation map with vendors, contacts, sources, and provenance', async () => {
      query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'deal-1',
              vendor_id: 'vendor-1',
              vendor_name: 'Acme Vendor',
              source_file_ids: ['file-1'],
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'file-1',
              file_name: 'acme.mbox',
              uploaded_at: new Date('2024-01-01'),
              ai_confidence_score: 0.9,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'vendor-1', vendor_name: 'Acme Vendor', source_file_ids: ['file-2'] }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'contact-1',
              name: 'John Doe',
              source_file_ids: ['file-3'],
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ field_name: 'deal_value', raw_value: '50000', source_file_id: 'file-1', extraction_method: 'ai', extracted_at: new Date(), confidence: 0.95 }],
        });

      const map = await buildDealCorrelationMap('deal-1');
      expect(map.dealId).toBe('deal-1');
      expect(map.vendorCorrelations.length).toBeGreaterThanOrEqual(1);
      expect(map.contactCorrelations.length).toBeGreaterThanOrEqual(1);
      expect(map.sources.length).toBe(1);
      expect(map.fieldProvenance.get('deal_value')?.length).toBe(1);
    });
  });

  describe('getDataLineage', () => {
    it('returns history grouped by field', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: 'deal-1', deal_value: 50000 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              field_name: 'deal_value',
              raw_value: '50000',
              source_file_id: 'file-1',
              sourceFileName: 'acme.mbox',
              extraction_method: 'ai',
              extracted_at: new Date(),
              confidence: 0.9,
            },
          ],
        });

      const lineage = await getDataLineage('deal-1', 'deal_value');
      expect(lineage.length).toBe(1);
      expect(lineage[0].fieldName).toBe('deal_value');
      expect(lineage[0].history.length).toBe(1);
    });
  });

  describe('updateCorrelationKeys', () => {
    it('updates missing keys and reports stats', async () => {
      query
        .mockResolvedValueOnce({
          rows: [
            { id: 'deal-1', deal_name: 'Cloud Migration', customer_name: 'Acme' },
            { id: 'deal-2', deal_name: 'Cloud Migration', customer_name: 'Globex' },
          ],
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const result = await updateCorrelationKeys('deal');
      expect(result.updated).toBe(2);
      expect(result.errors).toBe(0);
    });
  });

  describe('findCrossSourceDuplicates', () => {
    it('groups entities by correlation key when sources overlap', async () => {
      query
        .mockResolvedValueOnce({
          rows: [
            { correlation_key: 'deal:acme:azure', entity_ids: ['deal-1', 'deal-2'], count: 2 },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'deal-1', correlation_key: 'deal:acme:azure' },
            { id: 'deal-2', correlation_key: 'deal:acme:azure' },
          ],
        });

      const duplicates = await findCrossSourceDuplicates(['file-1'], 'deal');
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].entities.length).toBe(2);
      expect(duplicates[0].correlationKey).toBe('deal:acme:azure');
    });
  });
});
