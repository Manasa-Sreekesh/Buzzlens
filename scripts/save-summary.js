#!/usr/bin/env node
// Saves an AI-written analysis for a dataset so it shows up in the
// dashboard. See ../SKILL.md.
//
// Usage:
//   node scripts/save-summary.js <datasetId> --insights <path-to-insights.json>   (drives the PM dashboard)
//   node scripts/save-summary.js <datasetId> --text "..."                        (optional plain-text copy)
//   node scripts/save-summary.js <datasetId> --file <path-to-summary.md>
//   node scripts/save-summary.js <datasetId> --insights <path> --text "..."      (both, in one call)

const fs = require('fs');
const { loadEnv } = require('../lib/config/env');
const { getDataset } = require('../lib/storage/manifest');
const { loadDatasetItems } = require('../lib/storage/datasetReader');
const { summaryFilePath } = require('../lib/summaryFile');
const { insightsFilePath, validateInsights } = require('../lib/insightsFile');
const { ensureVisibleLink } = require('../lib/utils/visibleLink');
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
  ensureVisibleLink();
  const opts = parseArgs(process.argv.slice(2));
  const datasetId = opts._[0];
  if (!datasetId) {
    return fail(
      'Usage: node scripts/save-summary.js <datasetId> --insights <path-to-insights.json> (or --text "..." / --file <path>)'
    );
  }

  const entry = getDataset(datasetId);
  if (!entry) return fail(`No dataset found with id "${datasetId}". Run "node scripts/list.js" to see saved datasets.`);

  let savedSomething = false;

  if (opts.insights) {
    if (!fs.existsSync(opts.insights)) return fail(`File not found: ${opts.insights}`);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(opts.insights, 'utf8'));
    } catch (e) {
      return fail(`--insights file is not valid JSON: ${e.message}`);
    }

    const items = await loadDatasetItems(entry);
    const validIds = new Set(items.map((i) => i.id));
    const errors = validateInsights(parsed, validIds);
    if (errors.length) {
      return fail(`--insights failed validation (every card must trace back to real comment ids):\n  - ${errors.join('\n  - ')}`);
    }

    fs.writeFileSync(insightsFilePath(entry), JSON.stringify(parsed, null, 2), 'utf8');
    logger.success(`Saved PM dashboard insights for "${entry.topic}" (${entry.id}).`);
    savedSomething = true;
  }

  let content = opts.text;
  if (opts.file) {
    if (!fs.existsSync(opts.file)) return fail(`File not found: ${opts.file}`);
    content = fs.readFileSync(opts.file, 'utf8');
  }
  content = (content || '').trim();
  if (content) {
    fs.writeFileSync(summaryFilePath(entry), content, 'utf8');
    logger.success(`Saved text summary for "${entry.topic}" (${entry.id}).`);
    savedSomething = true;
  }

  if (!savedSomething) {
    return fail('Nothing to save — provide --insights <path> (drives the PM dashboard), and/or --text "..." or --file <path>.');
  }

  logger.step(`View it with: node scripts/dashboard.js ${entry.id}`);
}

main().catch((e) => {
  console.error('save-summary.js crashed:', e.message);
  process.exit(1);
});
