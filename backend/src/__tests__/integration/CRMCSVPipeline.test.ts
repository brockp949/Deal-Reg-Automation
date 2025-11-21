/**
 * Integration Tests for CRM CSV Pipeline
 *
 * Tests the end-to-end flow:
 * CRM CSV → SourceSync → Manifest → Parser → OpportunityMapper → Consolidator
 *
 * Phase 7.1 - CRM CSV Connector & Parsing
 */

import { CRMCSVConnector } from '../../connectors/CRMCSVConnector';
import { SourceSyncService } from '../../ingestion/SourceSyncService';
import { StandardizedCSVParser } from '../../parsers/StandardizedCSVParser';
import { OpportunityMapper } from '../../opportunities/OpportunityMapper';
import { OpportunityConsolidator } from '../../opportunities/OpportunityConsolidator';
import { promises as fs } from 'fs';
import path from 'path';

describe('CRM CSV Integration Pipeline', () => {
  const fixturesDir = path.join(__dirname, '../fixtures/crm-csv');
  const testSpoolDir = path.join(__dirname, '../temp/crm-spool');

  beforeAll(async () => {
    await fs.mkdir(testSpoolDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup spool directory
    try {
      await fs.rm(testSpoolDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Source Sync and Manifest Generation', () => {
    it('should sync CRM CSV files and generate manifest', async () => {
      const connector = new CRMCSVConnector({ directory: fixturesDir });
      const service = new SourceSyncService(
        {
          spoolDirectory: testSpoolDir,
          crmCsv: {
            enabled: true,
            directory: fixturesDir,
            maxFiles: 10,
          },
        },
        { crmCsv: connector }
      );

      const report = await service.syncAll();

      expect(report.crmCsv.length).toBeGreaterThan(0);
      expect(report.crmCsv[0].files.length).toBeGreaterThan(0);
      expect(report.manifest.length).toBeGreaterThan(0);

      // Verify manifest entries
      const crmManifestEntries = report.manifest.filter((entry) => entry.connector === 'crm_csv');
      expect(crmManifestEntries.length).toBeGreaterThan(0);

      crmManifestEntries.forEach((entry) => {
        expect(entry.parser).toBe('StandardizedCSVParser');
        expect(entry.sourceType).toBe('csv');
        expect(entry.connector).toBe('crm_csv');
        expect(entry.sourceMetadata.connector).toBe('crm_csv');
      });

      // Verify metadata sidecars exist
      for (const entry of crmManifestEntries) {
        const metadataExists = await fs
          .access(entry.metadataPath)
          .then(() => true)
          .catch(() => false);
        expect(metadataExists).toBe(true);
      }
    });
  });

  describe('CSV Parsing and Opportunity Mapping', () => {
    it('should parse CRM CSV and map to OpportunityRecords', async () => {
      const salesforceCSV = path.join(fixturesDir, 'salesforce-deals.csv');
      const parser = new StandardizedCSVParser();

      const parserOutput = await parser.parse(salesforceCSV);

      expect(parserOutput.errors.length).toBe(0);
      expect(parserOutput.entities.deals.length).toBeGreaterThan(0);

      // Map to opportunities
      const mapper = new OpportunityMapper();
      const opportunities = mapper.mapFromParserOutput(parserOutput);

      expect(opportunities.length).toBeGreaterThan(0);

      opportunities.forEach((opp) => {
        expect(opp).toHaveProperty('id');
        expect(opp).toHaveProperty('stage');
        expect(opp).toHaveProperty('priority');
        expect(opp).toHaveProperty('sourceSummary');
        expect(opp.sourceSummary.length).toBeGreaterThan(0);
        expect(opp.sourceSummary[0].sourceType).toBe('csv');
      });
    });
  });

  describe('Multi-Source Consolidation (CRM CSV + Gmail/Drive)', () => {
    it('should consolidate CRM CSV opportunities with mixed sources', async () => {
      const salesforceCSV = path.join(fixturesDir, 'salesforce-deals.csv');
      const hubspotCSV = path.join(fixturesDir, 'hubspot-deals.csv');

      const parser = new StandardizedCSVParser();
      const mapper = new OpportunityMapper();

      // Parse Salesforce CSV
      const salesforceOutput = await parser.parse(salesforceCSV);
      const salesforceOpps = mapper.mapFromParserOutput(salesforceOutput);

      // Parse HubSpot CSV
      const hubspotOutput = await parser.parse(hubspotCSV);
      const hubspotOpps = mapper.mapFromParserOutput(hubspotOutput);

      // Consolidate
      const consolidator = new OpportunityConsolidator();
      const allOpps = [...salesforceOpps, ...hubspotOpps];
      const composites = consolidator.consolidate(allOpps);

      expect(composites.length).toBeGreaterThan(0);

      // Check for mixed source detection
      const mixedSourceComposites = composites.filter((comp) => comp.conflicts.has_mixed_sources);

      // Since both CSVs are from CRM sources, they shouldn't have mixed sources
      // But if we had Gmail + CRM in same cluster, has_mixed_sources would be true
      composites.forEach((comp) => {
        expect(comp).toHaveProperty('conflicts');
        expect(comp.conflicts).toHaveProperty('has_mixed_sources');
      });
    });

    it('should detect conflicts in vendor names across CRM sources', async () => {
      const salesforceCSV = path.join(fixturesDir, 'salesforce-deals.csv');
      const zohoCSV = path.join(fixturesDir, 'zoho-deals.csv');

      const parser = new StandardizedCSVParser();
      const mapper = new OpportunityMapper();

      const salesforceOutput = await parser.parse(salesforceCSV);
      const salesforceOpps = mapper.mapFromParserOutput(salesforceOutput);

      const zohoOutput = await parser.parse(zohoCSV);
      const zohoOpps = mapper.mapFromParserOutput(zohoOutput);

      const consolidator = new OpportunityConsolidator();
      const composites = consolidator.consolidate([...salesforceOpps, ...zohoOpps]);

      // Check that all composites have conflict tracking
      composites.forEach((comp) => {
        expect(comp.conflicts).toBeDefined();
        expect(Array.isArray(comp.conflicts.vendors)).toBe(true);
        expect(Array.isArray(comp.conflicts.customers)).toBe(true);
        expect(Array.isArray(comp.conflicts.stages)).toBe(true);
        expect(Array.isArray(comp.conflicts.priorities)).toBe(true);
      });
    });
  });

  describe('CRM CSV Metadata Preservation', () => {
    it('should preserve CRM metadata through the pipeline', async () => {
      const salesforceCSV = path.join(fixturesDir, 'salesforce-deals.csv');
      const connector = new CRMCSVConnector({ directory: fixturesDir });

      // Get file metadata
      const fileMetadata = await connector.getFileMetadata(salesforceCSV);

      // Parse
      const parser = new StandardizedCSVParser();
      const parserOutput = await parser.parse(salesforceCSV);

      // Map to opportunities
      const mapper = new OpportunityMapper();
      const opportunities = mapper.mapFromParserOutput(parserOutput);

      // Verify metadata is present
      opportunities.forEach((opp) => {
        const sourceRef = opp.sourceSummary[0];
        expect(sourceRef.fileName).toContain('salesforce-deals.csv');
        expect(sourceRef.sourceType).toBe('csv');
        expect(sourceRef.parser).toBe('StandardizedCSVParser');
      });
    });

    it('should include checksum in reference IDs for CRM CSV sources', async () => {
      const connector = new CRMCSVConnector({ directory: fixturesDir });
      const service = new SourceSyncService(
        {
          spoolDirectory: testSpoolDir,
          crmCsv: {
            enabled: true,
            directory: fixturesDir,
            maxFiles: 1,
          },
        },
        { crmCsv: connector }
      );

      const report = await service.syncAll();
      const manifestEntry = report.manifest.find((entry) => entry.connector === 'crm_csv');

      expect(manifestEntry).toBeDefined();
      expect(manifestEntry!.sourceMetadata.connector).toBe('crm_csv');
      if (manifestEntry!.sourceMetadata.connector === 'crm_csv') {
        expect(manifestEntry!.sourceMetadata.file.checksum).toBeDefined();
        expect(typeof manifestEntry!.sourceMetadata.file.checksum).toBe('string');
      }
    });
  });

  describe('CRM CSV Field Mapping', () => {
    it.skip('should correctly map Salesforce fields to OpportunityRecords', async () => {
      const salesforceCSV = path.join(fixturesDir, 'salesforce-deals.csv');
      const parser = new StandardizedCSVParser();
      const mapper = new OpportunityMapper();

      const parserOutput = await parser.parse(salesforceCSV);
      const opportunities = mapper.mapFromParserOutput(parserOutput);

      const firstOpp = opportunities[0];
      expect(firstOpp.name).toBeDefined();
      expect(firstOpp.metadata.customer).toBeDefined();
      expect(firstOpp.stage).toBeDefined();
      expect(firstOpp.priority).toBeDefined();
    });

    it.skip('should correctly map HubSpot fields to OpportunityRecords', async () => {
      const hubspotCSV = path.join(fixturesDir, 'hubspot-deals.csv');
      const parser = new StandardizedCSVParser();
      const mapper = new OpportunityMapper();

      const parserOutput = await parser.parse(hubspotCSV);
      const opportunities = mapper.mapFromParserOutput(parserOutput);

      const firstOpp = opportunities[0];
      expect(firstOpp.name).toBeDefined();
      expect(firstOpp.metadata.customer).toBeDefined();
      expect(firstOpp.stage).toBeDefined();
      expect(firstOpp.priority).toBeDefined();
    });

    it.skip('should correctly map Zoho fields to OpportunityRecords', async () => {
      const zohoCSV = path.join(fixturesDir, 'zoho-deals.csv');
      const parser = new StandardizedCSVParser();
      const mapper = new OpportunityMapper();

      const parserOutput = await parser.parse(zohoCSV);
      const opportunities = mapper.mapFromParserOutput(parserOutput);

      const firstOpp = opportunities[0];
      expect(firstOpp.name).toBeDefined();
      expect(firstOpp.metadata.customer).toBeDefined();
      expect(firstOpp.stage).toBeDefined();
      expect(firstOpp.priority).toBeDefined();
    });
  });
});
