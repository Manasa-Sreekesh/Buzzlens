#!/usr/bin/env node
// Saves an AI-written analysis for a dataset so it shows up in the
// dashboard. See ../SKILL.md.
//
// Usage:
//   node scripts/save-summary.js <datasetId> --text "..."
//   node scripts/save-summary.js <datasetId> --file <path-to-summary.md>

const fs = require('fs');
const { loadEnv } = require('../lib/config/env');
const { getDataset } = require('../lib/storage/manifest');
const { summaryFilePath } = require('../lib/summaryFile');
const logger = require('../lib/utils/logger');

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else {
        opts[key] = next;
        i++;
      }
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

function fail(message) {
  logger.error(message);
  process.exitCode = 1;
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  const datasetId = opts._[0];
  if (!datasetId) return fail('Usage: node scripts/save-summary.js <datasetId> --text "..." (or --file <path>)');

  const entry = getDataset(datasetId);
  if (!entry) return fail(`No dataset found with id "${datasetId}". Run "node scripts/list.js" to see saved datasets.`);

  let content = opts.text;
  if (opts.file) {
    if (!fs.existsSync(opts.file)) return fail(`File not found: ${opts.file}`);
    content = fs.readFileSync(opts.file, 'utf8');
  }
  content = (content || '').trim();
  if (!content) return fail('Provide --text "..." or --file <path> with the summary content.');

  fs.writeFileSync(summaryFilePath(entry), content, 'utf8');
  logger.success(`Saved summary for "${entry.topic}" (${entry.id}).`);
  logger.step(`View it with: node scripts/dashboard.js ${entry.id}`);
}

main().catch((e) => {
  console.error('save-summary.js crashed:', e.message);
  process.exit(1);
});
