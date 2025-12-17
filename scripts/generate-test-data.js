/**
 * Test Data Generation Script
 *
 * Generates test files for Claude Skills testing
 * Run: node scripts/generate-test-data.js
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const OUTPUT_DIR = path.join(__dirname, '../test-data');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`📁 Created ${OUTPUT_DIR}`);
}

console.log('🎲 Generating test data files...\n');

// =============================================================================
// Test File 1: Standard Format Spreadsheet
// =============================================================================
async function generateStandardSpreadsheet() {
  console.log('📊 Generating test-standard.xlsx...');

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Deals');

  // Headers
  worksheet.columns = [
    { header: 'Opportunity', key: 'opportunity', width: 25 },
    { header: 'Stage', key: 'stage', width: 15 },
    { header: 'Next Steps', key: 'nextSteps', width: 30 },
    { header: 'Last Update', key: 'lastUpdate', width: 12 },
    { header: 'Units', key: 'units', width: 15 },
    { header: 'Revenue', key: 'revenue', width: 15 },
  ];

  // Data rows
  const deals = [
    {
      opportunity: 'Project Phoenix',
      stage: 'Qualified',
      nextSteps: 'Follow up call scheduled for next week',
      lastUpdate: '2025-12-01',
      units: '1000 licenses',
      revenue: '$500K',
    },
    {
      opportunity: 'Acme Corp Expansion',
      stage: 'Proposal',
      nextSteps: 'Send updated proposal with pricing',
      lastUpdate: '2025-12-10',
      units: '500 units',
      revenue: '$250,000',
    },
    {
      opportunity: 'Enterprise Deal Alpha',
      stage: 'Negotiation',
      nextSteps: 'Legal review contract terms',
      lastUpdate: '2025-12-15',
      units: '2500 seats',
      revenue: '$1.2M',
    },
  ];

  deals.forEach(deal => worksheet.addRow(deal));

  const filePath = path.join(OUTPUT_DIR, 'test-standard.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Test File 2: Custom Column Names Spreadsheet
// =============================================================================
async function generateCustomColumnsSpreadsheet() {
  console.log('📊 Generating test-custom-columns.xlsx...');

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Deals');

  // Custom column names that should be mapped by AI
  worksheet.columns = [
    { header: 'Deal Name', key: 'dealName', width: 25 },
    { header: 'Sales Stage', key: 'salesStage', width: 15 },
    { header: 'Action Items', key: 'actionItems', width: 30 },
    { header: 'Updated', key: 'updated', width: 12 },
    { header: 'Volume', key: 'volume', width: 15 },
    { header: 'Budget', key: 'budget', width: 15 },
  ];

  const deals = [
    {
      dealName: 'TechCorp Integration',
      salesStage: 'Discovery',
      actionItems: 'Schedule technical demo',
      updated: '12/5/2025',
      volume: '750',
      budget: '$380K',
    },
    {
      dealName: 'Global Solutions Package',
      salesStage: 'Proposal Sent',
      actionItems: 'Waiting for decision maker approval',
      updated: '12/12/2025',
      volume: '1200 users',
      budget: '€450,000',
    },
  ];

  deals.forEach(deal => worksheet.addRow(deal));

  const filePath = path.join(OUTPUT_DIR, 'test-custom-columns.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Test File 3: Unusual Format Spreadsheet
// =============================================================================
async function generateUnusualFormatSpreadsheet() {
  console.log('📊 Generating test-unusual-format.xlsx...');

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Opportunities');

  // Very unusual column names
  worksheet.columns = [
    { header: 'Project Title', key: 'projectTitle', width: 25 },
    { header: 'Current Phase', key: 'currentPhase', width: 15 },
    { header: 'TODO', key: 'todo', width: 30 },
    { header: 'Modified Date', key: 'modifiedDate', width: 15 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: '$ Value', key: 'dollarValue', width: 15 },
  ];

  const deals = [
    {
      projectTitle: 'Digital Transformation Initiative',
      currentPhase: 'Negotiation',
      todo: 'Send executive summary',
      modifiedDate: '01-Dec-2025',
      qty: '250',
      dollarValue: '150K USD',
    },
    {
      projectTitle: 'Cloud Migration Project',
      currentPhase: 'Won',
      todo: 'Onboarding kickoff',
      modifiedDate: 'Dec 17, 2025',
      qty: '500 VM',
      dollarValue: '$2.5M-$3.2M',
    },
  ];

  deals.forEach(deal => worksheet.addRow(deal));

  const filePath = path.join(OUTPUT_DIR, 'test-unusual-format.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Test File 4: CSV Format
// =============================================================================
function generateCSVFile() {
  console.log('📄 Generating test-standard.csv...');

  const csvContent = `Opportunity,Stage,Next Steps,Last Update,Units,Revenue
"Project Delta","Qualified","Schedule requirements gathering","2025-12-01","800","$400K"
"Enterprise Suite Deal","Proposal","Prepare executive presentation","2025-12-10","1500 licenses","€650,000"
"Cloud Platform Upgrade","Negotiation","Finalize SLA terms","2025-12-15","2000 users","$1.8M"
`;

  const filePath = path.join(OUTPUT_DIR, 'test-standard.csv');
  fs.writeFileSync(filePath, csvContent);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Test File 5: MBOX Email (Standard Format)
// =============================================================================
function generateStandardMBOX() {
  console.log('📧 Generating test-email-standard.mbox...');

  const mboxContent = `From MAILER-DAEMON Mon Dec 17 10:00:00 2025
From: john.smith@acme.com
To: sales@example.com
Subject: RE: Project Phoenix - $500K Opportunity
Date: Mon, 17 Dec 2025 10:00:00 -0500
Message-ID: <12345@acme.com>

Hi Sales Team,

We're moving forward with Acme Corporation on the Project Phoenix deal.
Deal value is approximately $500K USD for the initial phase.

Key details:
- Customer: Acme Corporation
- Project: Phoenix Digital Transformation
- Timeline: Q1 2026
- Volume: 1000 licenses

Please send over the standard enterprise agreement.

Best regards,
John Smith
Senior Account Manager
Acme Corporation
john.smith@acme.com
+1-555-0123

From MAILER-DAEMON Mon Dec 17 11:00:00 2025
From: maria@techcorp.de
To: sales@example.com
Subject: Q2 Budget for TechCorp GmbH
Date: Mon, 17 Dec 2025 11:00:00 +0100
Message-ID: <67890@techcorp.de>

Hallo,

TechCorp GmbH is interested in your cloud solution. We have allocated
€750K in our Q2 budget for this initiative.

Can you please provide:
1. Enterprise pricing for 500 users
2. Implementation timeline
3. Support SLA options

Contact details:
Klaus Müller, CTO
klaus.mueller@techcorp.de
+49-30-12345678

Regards,
Maria Garcia
TechCorp GmbH
`;

  const filePath = path.join(OUTPUT_DIR, 'test-email-standard.mbox');
  fs.writeFileSync(filePath, mboxContent);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Test File 6: Sales Call Transcript
// =============================================================================
function generateSalesTranscript() {
  console.log('📝 Generating test-transcript-sales-call.txt...');

  const transcriptContent = `SALES CALL TRANSCRIPT
Date: December 17, 2025
Duration: 45 minutes
Participants: John Smith (Acme Corp), Sarah Johnson (Sales Rep)

---

Sarah: Hi John, thanks for taking the time today. I understand you're looking at
our enterprise solution for Acme Corporation?

John: Yes, that's right. I'm John Smith, VP of Technology at Acme. We're evaluating
platforms for our digital transformation project - we're calling it Project Phoenix
internally.

Sarah: Great! Can you tell me a bit about your requirements and timeline?

John: We're looking to roll this out in Q1 2026. We'd need licenses for about
1,000 users initially, with potential to expand to 2,500 by end of year.

Sarah: Perfect. And what's your budget range for this project?

John: We're thinking around $750K to $1M for the initial phase. That would cover
the licenses, implementation, and first year of support.

Sarah: That works well with our enterprise pricing. Have you looked at any
competing solutions?

John: We evaluated a few others, but yours has the features we need - especially
the API integrations and compliance certifications.

Sarah: Excellent. Can I get your contact information so I can send over a
detailed proposal?

John: Sure. Email is john.smith@acme.com and my direct line is 555-0123.
I'm based in our New York office.

Sarah: Perfect. I'll have a proposal to you by end of week. Anything else you
need from us at this stage?

John: Just the proposal with detailed pricing and implementation timeline.
We're ready to move quickly if the terms are right.

Sarah: Understood. I'll prioritize this and get it over to you. Thanks John!

John: Thanks Sarah, looking forward to the proposal.

---

EXTRACTED DETAILS:
Company: Acme Corporation
Contact: John Smith, VP of Technology
Email: john.smith@acme.com
Phone: 555-0123
Project: Project Phoenix (Digital Transformation)
Budget: $750K - $1M
Timeline: Q1 2026
Volume: 1,000 users (initial), potential 2,500 by EOY
Status: Qualified - Proposal Stage
`;

  const filePath = path.join(OUTPUT_DIR, 'test-transcript-sales-call.txt');
  fs.writeFileSync(filePath, transcriptContent);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Test File 7: Complex Multi-Language Email
// =============================================================================
function generateMultiLanguageMBOX() {
  console.log('📧 Generating test-email-multilanguage.mbox...');

  const mboxContent = `From MAILER-DAEMON Mon Dec 17 12:00:00 2025
From: pierre.dubois@entreprisefr.fr
To: sales@example.com
Subject: Proposition pour Entreprise SA
Date: Mon, 17 Dec 2025 12:00:00 +0100
Message-ID: <11111@entreprisefr.fr>

Bonjour,

Entreprise SA (Paris) évalue votre solution pour notre projet de transformation
numérique. Notre budget est de €1.2M-€2.5M pour 2026.

Détails:
- Société: Entreprise SA
- Contact: Pierre Dubois, Directeur Technique
- Email: pierre.dubois@entreprisefr.fr
- Téléphone: +33-1-23-45-67-89
- Volume: 800 utilisateurs
- Délai: T1 2026

Pouvez-vous nous envoyer une proposition commerciale?

Cordialement,
Pierre Dubois
Entreprise SA

From MAILER-DAEMON Mon Dec 17 13:00:00 2025
From: ana.martinez@empresasa.es
To: sales@example.com
Subject: Presupuesto para Empresa SA Madrid
Date: Mon, 17 Dec 2025 13:00:00 +0100
Message-ID: <22222@empresasa.es>

Estimados,

Empresa SA (Madrid) está interesada en su plataforma empresarial. Tenemos
un presupuesto aprobado de $1.5M USD para este proyecto.

Información:
- Empresa: Empresa SA Madrid
- Contacto: Ana Martínez, Gerente de TI
- Email: ana.martinez@empresasa.es
- Teléfono: +34-91-123-4567
- Usuarios: 600
- Inicio: Enero 2026

¿Pueden enviarnos documentación técnica y precios?

Saludos,
Ana Martínez
`;

  const filePath = path.join(OUTPUT_DIR, 'test-email-multilanguage.mbox');
  fs.writeFileSync(filePath, mboxContent);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Test File 8: Edge Cases Spreadsheet
// =============================================================================
async function generateEdgeCasesSpreadsheet() {
  console.log('📊 Generating test-edge-cases.xlsx...');

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Edge Cases');

  worksheet.columns = [
    { header: 'Opportunity', key: 'opportunity', width: 30 },
    { header: 'Stage', key: 'stage', width: 15 },
    { header: 'Revenue', key: 'revenue', width: 20 },
  ];

  const deals = [
    {
      opportunity: 'Deal with "Quotes" and Special Chars!',
      stage: 'Won',
      revenue: '$500K',
    },
    {
      opportunity: 'Very Long Deal Name That Goes On And On And Contains Many Words To Test Column Width Handling',
      stage: 'Qualified',
      revenue: '€1,234,567.89',
    },
    {
      opportunity: 'Deal with\nLinebreak',
      stage: 'Lost',
      revenue: '~$750K (approximate)',
    },
    {
      opportunity: '',  // Empty opportunity name
      stage: 'Qualified',
      revenue: '$100K',
    },
    {
      opportunity: 'Unicode Test: 日本語 中文 한국어',
      stage: 'Proposal',
      revenue: '¥50,000,000',
    },
    {
      opportunity: 'Range Deal',
      stage: 'Negotiation',
      revenue: '$1.2M-$2.5M',
    },
  ];

  deals.forEach(deal => worksheet.addRow(deal));

  const filePath = path.join(OUTPUT_DIR, 'test-edge-cases.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Generate README for test data
// =============================================================================
function generateTestDataREADME() {
  console.log('📖 Generating test-data/README.md...');

  const readmeContent = `# Test Data Files

This directory contains generated test files for Claude Skills testing.

## Generated Files

### Spreadsheets (Excel)

1. **test-standard.xlsx**
   - Standard column names: Opportunity, Stage, Next Steps, etc.
   - Purpose: Test baseline functionality
   - Expected: 100% mapping accuracy

2. **test-custom-columns.xlsx**
   - Custom column names: Deal Name, Sales Stage, Action Items, etc.
   - Purpose: Test semantic column mapping
   - Expected: IntelligentColumnMapper should map all columns correctly

3. **test-unusual-format.xlsx**
   - Unusual column names: Project Title, Current Phase, TODO, etc.
   - Purpose: Test AI's ability to understand non-standard formats
   - Expected: 90%+ mapping accuracy with AI

4. **test-edge-cases.xlsx**
   - Edge cases: Empty values, special characters, Unicode, ranges
   - Purpose: Test error handling and robustness
   - Expected: Graceful handling of edge cases

### CSV Files

5. **test-standard.csv**
   - Standard CSV format
   - Purpose: Test CSV parsing with IntelligentColumnMapper
   - Expected: Same accuracy as Excel format

### Email Files (MBOX)

6. **test-email-standard.mbox**
   - Standard English emails with deal information
   - Purpose: Test SemanticEntityExtractor on emails
   - Expected: Extract vendors, contacts, deal values, emails, phones

7. **test-email-multilanguage.mbox**
   - Emails in French and Spanish
   - Purpose: Test multi-language entity extraction
   - Expected: Extract entities from non-English text

### Transcript Files

8. **test-transcript-sales-call.txt**
   - Sales call transcript with structured conversation
   - Purpose: Test entity extraction from conversational text
   - Expected: Extract customer, contact, budget, timeline, buying signals

## Using Test Files

### Quick Test (5 minutes)

Upload test-standard.xlsx via UI or API:

\`\`\`bash
curl -X POST http://localhost:4000/api/files/upload \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -F "file=@test-data/test-standard.xlsx" \\
  -F "intent=vendor_deals"
\`\`\`

Check logs for:
- "Using IntelligentColumnMapper skill for dynamic column mapping"
- "IntelligentColumnMapper result"

### Comprehensive Testing

Follow [../docs/TESTING_GUIDE.md](../docs/TESTING_GUIDE.md) and use these files for:
- Phase 2: IntelligentColumnMapper Testing
- Phase 3: SemanticEntityExtractor Testing
- Phase 4: SemanticDuplicateDetector Testing

## Expected Results

| File | Skill Used | Expected Accuracy |
|------|------------|-------------------|
| test-standard.xlsx | IntelligentColumnMapper | 100% |
| test-custom-columns.xlsx | IntelligentColumnMapper | 95%+ |
| test-unusual-format.xlsx | IntelligentColumnMapper | 90%+ |
| test-edge-cases.xlsx | IntelligentColumnMapper | 85%+ (with warnings) |
| test-email-standard.mbox | SemanticEntityExtractor | 90%+ |
| test-email-multilanguage.mbox | SemanticEntityExtractor | 85%+ |
| test-transcript-sales-call.txt | SemanticEntityExtractor | 90%+ |

## Regenerating Test Data

To regenerate all test files:

\`\`\`bash
node scripts/generate-test-data.js
\`\`\`

This will overwrite existing files in test-data/.

## Adding Custom Test Files

You can add your own test files to this directory. Recommended formats:
- Excel: .xlsx
- CSV: .csv
- Email: .mbox
- Transcript: .txt

See [../docs/TESTING_GUIDE.md](../docs/TESTING_GUIDE.md) for guidance on creating test cases.
`;

  const filePath = path.join(OUTPUT_DIR, 'README.md');
  fs.writeFileSync(filePath, readmeContent);
  console.log(`   ✅ Created ${filePath}`);
}

// =============================================================================
// Main execution
// =============================================================================
async function main() {
  try {
    // Check if ExcelJS is available
    if (!ExcelJS) {
      console.log('❌ ExcelJS not found. Install it first:');
      console.log('   cd backend && npm install');
      process.exit(1);
    }

    // Generate all test files
    await generateStandardSpreadsheet();
    await generateCustomColumnsSpreadsheet();
    await generateUnusualFormatSpreadsheet();
    generateCSVFile();
    generateStandardMBOX();
    generateSalesTranscript();
    generateMultiLanguageMBOX();
    await generateEdgeCasesSpreadsheet();
    generateTestDataREADME();

    console.log('\n✅ All test data files generated successfully!');
    console.log(`\n📁 Files created in: ${OUTPUT_DIR}`);
    console.log('\nNext steps:');
    console.log('1. Review test-data/README.md for file descriptions');
    console.log('2. Use these files with docs/TESTING_GUIDE.md');
    console.log('3. Upload files via UI or API to test skills');

  } catch (error) {
    console.error('\n❌ Error generating test data:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
