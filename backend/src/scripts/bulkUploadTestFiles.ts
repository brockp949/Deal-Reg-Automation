/**
 * Bulk upload test files to the API for ingestion.
 *
 * Usage:
 *   npm run bulk:upload -- --dir "C:\\Users\\brock\\Documents\\CRM Automation\\actual data testing" --max-size-mb 150
 *
 * Notes:
 * - Skips files larger than --max-size-mb (default 150MB) to avoid huge uploads unless explicitly allowed.
 * - Sends to http://localhost:4000/api/files/upload by default (override with --api).
 * - If an API key is required, set env API_KEY=<key>.
 */

import fs from 'fs';
import path from 'path';

type Options = {
  dir: string;
  api: string;
  maxSizeMb: number;
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: any = {
    dir: 'C:\\Users\\brock\\Documents\\CRM Automation\\actual data testing',
    api: 'http://localhost:4000/api/files/upload',
    maxSizeMb: 150,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--dir' && next) opts.dir = next;
    if (arg === '--api' && next) opts.api = next;
    if (arg === '--max-size-mb' && next) opts.maxSizeMb = parseInt(next, 10);
  }

  return opts as Options;
}

async function uploadFile(filePath: string, api: string, apiKey?: string) {
  const stat = fs.statSync(filePath);
  const filename = path.basename(filePath);

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), filename);

  const headers: Record<string, string> = {};
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(api, {
    method: 'POST',
    body: form as any,
    headers,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  return { status: res.status, body: json, size: stat.size };
}

async function main() {
  const { dir, api, maxSizeMb } = parseArgs();
  const apiKey = process.env.API_KEY;

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(dir);
  const files = entries
    .map((name) => path.join(dir, name))
    .filter((p) => fs.statSync(p).isFile());

  console.log(`Found ${files.length} files in ${dir}`);

  for (const file of files) {
    const sizeMb = fs.statSync(file).size / (1024 * 1024);
    if (sizeMb > maxSizeMb) {
      console.log(`Skipping ${path.basename(file)} (${sizeMb.toFixed(1)} MB) > max ${maxSizeMb} MB`);
      continue;
    }

    console.log(`Uploading ${path.basename(file)} (${sizeMb.toFixed(1)} MB) ...`);
    try {
      const res = await uploadFile(file, api, apiKey);
      console.log(
        ` -> ${res.status} ${typeof res.body === 'object' ? JSON.stringify(res.body) : res.body}`
      );
    } catch (err: any) {
      console.error(` !! Failed ${path.basename(file)}: ${err.message}`);
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Bulk upload failed', err);
  process.exit(1);
});
