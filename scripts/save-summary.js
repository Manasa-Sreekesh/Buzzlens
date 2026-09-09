#!/usr/bin/env node
// Saves an AI-written analysis for a dataset so it shows up in the
// dashboard. See ../SKILL.md.
//
// Usage:
//   node scripts/save-summary.js <datasetId> --insights <path-to-insights.json>   (drives the PM dashboard)
//   node scripts/save-summary.js <datasetId> --text "..."                        (optional plain-text copy)
//   node scripts/save-summary.js <datasetId> --file <path-to-summary.md>
//   node scripts/save-summary.js <datasetId> --insights <path> --text "..."      (both, in one call)
//   node scripts/save-summary.js <datasetId> --insights <path> --no-open         (skip auto-opening the dashboard)
//
// On a successful save, the dashboard opens automatically (a background
// `dashboard.js` process is spawned) — no separate command needed.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadEnv } = require('../lib/config/env');
const { getDataset } = require('../lib/storage/manifest');
const { loadDatasetItems } = require('../lib/storage/datasetReader');
const { summaryFilePath } = require('../lib/summaryFile');
const { insightsFilePath, validateInsights, attachSourceBreakdown } = require('../lib/insightsFile');
const { ensureVisibleLink } = require('../lib/utils/visibleLink');
const logger = require('../lib/utils/logger');

// Spawns `dashboard.js <id>` detached from this process and immediately
// unref'd, so save-summary.js can exit right away instead of blocking on
// the dashboard's own long-running server. This is what makes "the
// dashboard just opens" true regardless of whether whatever ran this
// script remembers to run a separate dashboard command afterward.
function launchDashboard(datasetId) {
  try {
    const dashboardScript = path.join(__dirname, 'dashboard.js');
    const child = spawn(process.execPath, [dashboardScript, datasetId], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

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

    attachSourceBreakdown(parsed, items);
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

  if (opts['no-open']) {
    logger.step(`View it with: node scripts/dashboard.js ${entry.id}`);
  } else if (launchDashboard(entry.id)) {
    logger.step('Opening the dashboard now...');
  } else {
    logger.step(`Couldn't auto-open the dashboard — view it with: node scripts/dashboard.js ${entry.id}`);
  }
}

main().catch((e) => {
  console.error('save-summary.js crashed:', e.message);
  process.exit(1);
});
