/**
 * Environment Setup Verification Script
 *
 * Verifies that all prerequisites are met for Claude Skills testing
 * Run: node scripts/verify-setup.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REQUIRED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_SKILLS_ENABLED',
  'DATABASE_URL',
  'REDIS_URL',
];

const REQUIRED_FEATURE_FLAGS = [
  'FEATURE_INTELLIGENT_COLUMN_MAPPING',
  'FEATURE_SEMANTIC_ENTITY_EXTRACTION',
  'FEATURE_SEMANTIC_DUPLICATE_DETECTION',
];

console.log('🔍 Claude Skills Setup Verification\n');
console.log('=' .repeat(60));

let passed = 0;
let failed = 0;
const warnings = [];

// Check 1: .env file exists
console.log('\n📄 Checking .env file...');
const envPath = path.join(__dirname, '../backend/.env');
if (fs.existsSync(envPath)) {
  console.log('✅ .env file found');
  passed++;

  // Load .env
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const envVars = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      envVars[match[1]] = match[2];
    }
  });

  // Check required variables
  console.log('\n🔑 Checking required environment variables...');
  REQUIRED_ENV_VARS.forEach(varName => {
    if (envVars[varName] && envVars[varName] !== `your-${varName.toLowerCase().replace(/_/g, '-')}-here`) {
      console.log(`✅ ${varName} is set`);
      passed++;

      // Validate API key format
      if (varName === 'ANTHROPIC_API_KEY') {
        if (envVars[varName].startsWith('sk-ant-')) {
          console.log('   ✅ API key format looks valid');
          passed++;
        } else {
          console.log('   ⚠️  API key format may be invalid (should start with sk-ant-)');
          warnings.push(`${varName} format may be incorrect`);
          failed++;
        }
      }
    } else {
      console.log(`❌ ${varName} is NOT set or using placeholder value`);
      failed++;
    }
  });

  // Check feature flags
  console.log('\n🚩 Checking feature flags...');
  if (envVars['CLAUDE_SKILLS_ENABLED'] === 'true') {
    console.log('✅ CLAUDE_SKILLS_ENABLED=true');
    passed++;
  } else {
    console.log('❌ CLAUDE_SKILLS_ENABLED is not true');
    failed++;
  }

  REQUIRED_FEATURE_FLAGS.forEach(flag => {
    if (envVars[flag] === 'true') {
      console.log(`✅ ${flag}=true`);
      passed++;
    } else {
      console.log(`⚠️  ${flag} is not enabled`);
      warnings.push(`${flag} not enabled - skill will not run`);
    }
  });

  // Check cache settings
  console.log('\n💾 Checking cache configuration...');
  if (envVars['AI_CACHE_ENABLED'] === 'true') {
    console.log('✅ AI_CACHE_ENABLED=true');
    passed++;
  } else {
    console.log('⚠️  AI_CACHE_ENABLED is not true - caching disabled (higher costs)');
    warnings.push('Caching disabled - API costs will be higher');
  }

} else {
  console.log('❌ .env file NOT found at backend/.env');
  console.log('   Copy backend/.env.example to backend/.env and configure');
  failed++;
}

// Check 2: Redis connection
console.log('\n🔴 Checking Redis connection...');
try {
  execSync('redis-cli ping', { stdio: 'pipe' });
  console.log('✅ Redis is running and accessible');
  passed++;
} catch (error) {
  console.log('❌ Redis is NOT accessible');
  console.log('   Start Redis: redis-server');
  failed++;
}

// Check 3: Node.js version
console.log('\n📦 Checking Node.js version...');
try {
  const nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (majorVersion >= 18) {
    console.log(`✅ Node.js ${nodeVersion} (>= 18.x required)`);
    passed++;
  } else {
    console.log(`❌ Node.js ${nodeVersion} is too old (>= 18.x required)`);
    failed++;
  }
} catch (error) {
  console.log('❌ Could not determine Node.js version');
  failed++;
}

// Check 4: Backend dependencies
console.log('\n📚 Checking backend dependencies...');
const nodeModulesPath = path.join(__dirname, '../backend/node_modules');
if (fs.existsSync(nodeModulesPath)) {
  console.log('✅ Backend node_modules exists');
  passed++;

  // Check for specific dependencies
  const requiredDeps = ['exceljs', 'csv-parser', '@anthropic-ai/sdk'];
  requiredDeps.forEach(dep => {
    const depPath = path.join(nodeModulesPath, dep);
    if (fs.existsSync(depPath)) {
      console.log(`   ✅ ${dep} installed`);
      passed++;
    } else {
      console.log(`   ❌ ${dep} NOT installed`);
      failed++;
    }
  });
} else {
  console.log('❌ Backend dependencies NOT installed');
  console.log('   Run: cd backend && npm install');
  failed++;
}

// Check 5: Critical files exist
console.log('\n📁 Checking critical files...');
const criticalFiles = [
  'backend/src/skills/IntelligentColumnMapper.ts',
  'backend/src/skills/SemanticEntityExtractor.ts',
  'backend/src/skills/SemanticDuplicateDetector.ts',
  'backend/src/services/ClaudeClientService.ts',
  'backend/src/config/claude.ts',
  'backend/src/parsers/vendorSpreadsheetParser.ts',
];

criticalFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`);
    passed++;
  } else {
    console.log(`❌ ${file} NOT found`);
    failed++;
  }
});

// Check 6: Upload directory
console.log('\n📂 Checking upload directory...');
const uploadDir = path.join(__dirname, '../backend/uploads');
if (fs.existsSync(uploadDir)) {
  console.log('✅ Upload directory exists');
  passed++;

  // Check if writable
  try {
    const testFile = path.join(uploadDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('   ✅ Upload directory is writable');
    passed++;
  } catch (error) {
    console.log('   ❌ Upload directory is NOT writable');
    failed++;
  }
} else {
  console.log('⚠️  Upload directory does not exist');
  console.log('   Creating: mkdir backend/uploads');
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('   ✅ Created upload directory');
    passed++;
  } catch (error) {
    console.log('   ❌ Could not create upload directory');
    failed++;
  }
}

// Check 7: Documentation
console.log('\n📖 Checking documentation...');
const docs = [
  'docs/QUICK_START.md',
  'docs/TESTING_GUIDE.md',
  'docs/DEPLOYMENT_CHECKLIST.md',
  'docs/CLAUDE_SKILLS_INTEGRATION.md',
];

docs.forEach(doc => {
  const docPath = path.join(__dirname, '..', doc);
  if (fs.existsSync(docPath)) {
    console.log(`✅ ${doc}`);
    passed++;
  } else {
    console.log(`❌ ${doc} NOT found`);
    failed++;
  }
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n📊 SUMMARY\n');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`⚠️  Warnings: ${warnings.length}`);

if (warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  warnings.forEach(w => console.log(`   - ${w}`));
}

console.log('\n' + '='.repeat(60));

if (failed === 0) {
  console.log('\n🎉 SUCCESS! Your environment is ready for Claude Skills testing.');
  console.log('\nNext steps:');
  console.log('1. Start backend: cd backend && npm start');
  console.log('2. Follow QUICK_START.md for testing');
  console.log('3. Review TESTING_GUIDE.md for comprehensive tests');
  process.exit(0);
} else {
  console.log('\n⚠️  SETUP INCOMPLETE - Please fix the failed checks above.');
  console.log('\nRefer to:');
  console.log('- docs/QUICK_START.md - Quick setup guide');
  console.log('- docs/DEPLOYMENT_CHECKLIST.md - Detailed setup steps');
  process.exit(1);
}
