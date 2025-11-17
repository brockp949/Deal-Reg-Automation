/**
 * Load Testing Script
 *
 * Generates a large manifest with synthetic data to validate:
 * - Pipeline instrumentation and metrics recording
 * - Data retention and query performance
 * - Memory usage and processing efficiency
 *
 * Phase 7.3 - Deployment Hardening & Observability
 */

import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';
import logger from '../utils/logger';
import { SourceManifestEntry } from '../ingestion/SourceSyncService';
import { OpportunityMapper } from '../opportunities/OpportunityMapper';
import { OpportunityConsolidator } from '../opportunities/OpportunityConsolidator';
import { recordPipelineMetrics } from '../metrics/pipelineMetrics';

interface LoadTestConfig {
  manifestSize: number; // Number of manifest entries
  opportunitiesPerEntry: number; // Avg opportunities per source
  runConsolidation: boolean;
  runMetrics: boolean;
  outputDirectory: string;
}

const DEFAULT_CONFIG: LoadTestConfig = {
  manifestSize: 1000, // 1000 source files
  opportunitiesPerEntry: 3, // ~3000 opportunities total
  runConsolidation: true,
  runMetrics: true,
  outputDirectory: path.resolve(config.upload.directory, 'load-test'),
};

class LoadTestRunner {
  private config: LoadTestConfig;

  constructor(config: Partial<LoadTestConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate synthetic manifest entries
   */
  async generateManifest(): Promise<SourceManifestEntry[]> {
    logger.info('Generating synthetic manifest...', {
      size: this.config.manifestSize,
      opportunitiesPerEntry: this.config.opportunitiesPerEntry,
    });

    const manifest: SourceManifestEntry[] = [];
    const connectorTypes = ['gmail', 'drive', 'crm_csv', 'teams_transcript', 'zoom_transcript'];
    const companies = [
      'Acme Corp', 'TechVentures Inc', 'Global Solutions Ltd', 'Innovation Partners',
      'Digital Dynamics', 'Enterprise Systems', 'CloudWorks', 'DataFlow Inc',
      'SmartBiz Solutions', 'FutureTech Group', 'NextGen Enterprises', 'ProActive Corp',
    ];
    const products = [
      '4IEC Gateway', 'ClearLED Media Player', 'SmartHub Controller', 'EdgeCompute Unit',
      'IoT Sensor Array', 'Cloud Integration Platform', 'Enterprise Dashboard',
    ];

    for (let i = 0; i < this.config.manifestSize; i++) {
      const connector = connectorTypes[i % connectorTypes.length];
      const company = companies[Math.floor(Math.random() * companies.length)];
      const product = products[Math.floor(Math.random() * products.length)];
      const timestamp = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString();

      // Generate source content with opportunity keywords
      const numOpportunities = Math.floor(Math.random() * this.config.opportunitiesPerEntry) + 1;
      const sourceContent = this.generateSourceContent(company, product, numOpportunities);

      const entry: SourceManifestEntry = {
        sourceId: `load-test-${connector}-${i}`,
        connector: connector as any,
        timestamp,
        metadata: {
          connector,
          timestamp,
          ...(connector === 'gmail' && {
            messageId: `msg-${i}@example.com`,
            threadId: `thread-${Math.floor(i / 3)}`,
            subject: `${product} Opportunity - ${company}`,
            from: `sales@${company.toLowerCase().replace(/\s+/g, '')}.com`,
            to: 'deals@ourcompany.com',
            date: timestamp,
            hasAttachments: Math.random() > 0.5,
          }),
          ...(connector === 'drive' && {
            fileId: `file-${i}`,
            fileName: `${company.replace(/\s+/g, '_')}_RFQ_${i}.pdf`,
            mimeType: 'application/pdf',
            webViewLink: `https://drive.google.com/file/${i}`,
            createdTime: timestamp,
            modifiedTime: timestamp,
            size: Math.floor(Math.random() * 5000000) + 100000,
          }),
          ...(connector === 'crm_csv' && {
            file: {
              fileName: `salesforce_export_${i}.csv`,
              filePath: `/load-test/crm/file_${i}.csv`,
              fileSize: Math.floor(Math.random() * 1000000) + 50000,
              lastModified: timestamp,
              checksum: `md5-${i}-${Math.random().toString(36).substring(7)}`,
            },
            format: 'salesforce',
            confidence: 0.95,
          }),
        },
        rawContent: sourceContent,
        spoolPath: path.join(this.config.outputDirectory, 'spool', `source-${i}.json`),
      };

      manifest.push(entry);
    }

    logger.info('Synthetic manifest generated', { entries: manifest.length });
    return manifest;
  }

  /**
   * Generate synthetic source content with opportunity keywords
   */
  private generateSourceContent(company: string, product: string, numOpportunities: number): string {
    const dealSizes = [50000, 75000, 100000, 150000, 200000, 300000, 500000];
    const stages = ['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won'];
    const contacts = ['John Smith', 'Sarah Johnson', 'Michael Chen', 'Emily Davis'];

    let content = `Discussion about ${product} opportunity with ${company}.\n\n`;

    for (let i = 0; i < numOpportunities; i++) {
      const dealSize = dealSizes[Math.floor(Math.random() * dealSizes.length)];
      const stage = stages[Math.floor(Math.random() * stages.length)];
      const contact = contacts[Math.floor(Math.random() * contacts.length)];
      const quantity = Math.floor(Math.random() * 500) + 50;

      content += `Opportunity ${i + 1}:\n`;
      content += `- Contact: ${contact} at ${company}\n`;
      content += `- Product: ${product}\n`;
      content += `- Quantity: ${quantity} units\n`;
      content += `- Deal Size: $${dealSize.toLocaleString()}\n`;
      content += `- Stage: ${stage}\n`;
      content += `- Close Date: Q${Math.floor(Math.random() * 4) + 1} 2026\n\n`;
    }

    content += `Action items:\n`;
    content += `- Send detailed quote by end of week\n`;
    content += `- Schedule technical review meeting\n`;
    content += `- Provide ROI analysis\n`;

    return content;
  }

  /**
   * Process manifest through opportunity mapping
   */
  async processManifest(manifest: SourceManifestEntry[]): Promise<any[]> {
    logger.info('Processing manifest through opportunity mapper...');
    const startTime = Date.now();

    const mapper = new OpportunityMapper();
    const opportunities = [];

    for (const entry of manifest) {
      const mapped = await mapper.mapFromSource(entry);
      opportunities.push(...mapped);
    }

    const duration = Date.now() - startTime;
    logger.info('Mapping completed', {
      manifestEntries: manifest.length,
      opportunitiesFound: opportunities.length,
      durationMs: duration,
      avgPerEntry: (duration / manifest.length).toFixed(2),
    });

    return opportunities;
  }

  /**
   * Run consolidation on opportunities
   */
  async consolidateOpportunities(opportunities: any[]): Promise<any[]> {
    if (!this.config.runConsolidation) {
      logger.info('Skipping consolidation (disabled)');
      return [];
    }

    logger.info('Running opportunity consolidation...');
    const startTime = Date.now();

    const consolidator = new OpportunityConsolidator();
    const composites = await consolidator.consolidate(opportunities);

    const duration = Date.now() - startTime;
    logger.info('Consolidation completed', {
      opportunities: opportunities.length,
      composites: composites.length,
      durationMs: duration,
      compressionRatio: (opportunities.length / composites.length).toFixed(2),
    });

    return composites;
  }

  /**
   * Record pipeline metrics
   */
  async recordMetrics(phase: string, duration: number, metadata: Record<string, any>): Promise<void> {
    if (!this.config.runMetrics) {
      logger.info('Skipping metrics recording (disabled)');
      return;
    }

    logger.info('Recording pipeline metrics...');

    await recordPipelineMetrics({
      phase,
      startTime: new Date(Date.now() - duration),
      endTime: new Date(),
      duration,
      status: 'success',
      metadata,
    });

    logger.info('Metrics recorded');
  }

  /**
   * Run full load test
   */
  async run(): Promise<void> {
    logger.info('========== LOAD TEST STARTED ==========');
    logger.info('Configuration:', this.config);

    const overallStart = Date.now();

    // Create output directory
    await fs.mkdir(this.config.outputDirectory, { recursive: true });
    await fs.mkdir(path.join(this.config.outputDirectory, 'spool'), { recursive: true });

    // Phase 1: Generate manifest
    const manifestStart = Date.now();
    const manifest = await this.generateManifest();
    const manifestDuration = Date.now() - manifestStart;

    // Write manifest to disk
    const manifestPath = path.join(this.config.outputDirectory, 'load-test-manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    logger.info('Manifest written', { path: manifestPath });

    await this.recordMetrics('load-test-manifest-generation', manifestDuration, {
      manifestSize: manifest.length,
    });

    // Phase 2: Process manifest
    const processStart = Date.now();
    const opportunities = await this.processManifest(manifest);
    const processDuration = Date.now() - processStart;

    await this.recordMetrics('load-test-opportunity-mapping', processDuration, {
      manifestEntries: manifest.length,
      opportunitiesFound: opportunities.length,
    });

    // Phase 3: Consolidate opportunities
    const consolidateStart = Date.now();
    const composites = await this.consolidateOpportunities(opportunities);
    const consolidateDuration = Date.now() - consolidateStart;

    if (this.config.runConsolidation) {
      await this.recordMetrics('load-test-consolidation', consolidateDuration, {
        opportunities: opportunities.length,
        composites: composites.length,
      });
    }

    // Overall summary
    const overallDuration = Date.now() - overallStart;
    logger.info('========== LOAD TEST COMPLETED ==========');
    logger.info('Summary:', {
      manifestSize: manifest.length,
      opportunitiesFound: opportunities.length,
      compositesCreated: composites.length,
      totalDurationMs: overallDuration,
      totalDurationSec: (overallDuration / 1000).toFixed(2),
      phases: {
        manifestGeneration: `${manifestDuration}ms`,
        opportunityMapping: `${processDuration}ms`,
        consolidation: `${consolidateDuration}ms`,
      },
    });

    await this.recordMetrics('load-test-complete', overallDuration, {
      manifestSize: manifest.length,
      opportunities: opportunities.length,
      composites: composites.length,
    });
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const sizeIndex = args.indexOf('--size');
  const manifestSize = sizeIndex !== -1 ? parseInt(args[sizeIndex + 1], 10) : DEFAULT_CONFIG.manifestSize;

  const oppIndex = args.indexOf('--opportunities');
  const opportunitiesPerEntry = oppIndex !== -1 ? parseInt(args[oppIndex + 1], 10) : DEFAULT_CONFIG.opportunitiesPerEntry;

  const noConsolidation = args.includes('--no-consolidation');
  const noMetrics = args.includes('--no-metrics');

  const runner = new LoadTestRunner({
    manifestSize,
    opportunitiesPerEntry,
    runConsolidation: !noConsolidation,
    runMetrics: !noMetrics,
  });

  await runner.run();
}

main().catch((error) => {
  logger.error('Load test failed', { error: error.message, stack: error.stack });
  process.exit(1);
});
