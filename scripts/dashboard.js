#!/usr/bin/env node
// Opens the local dashboard for a saved dataset. If an analysis has been
// saved (scripts/save-summary.js), it's shown as the narrative; otherwise
// the dashboard shows the always-available structured stats/clusters/quotes
// with a note that no summary has been written yet.
//
// Usage:
//   node scripts/dashboard.js <datasetId>
//   node scripts/dashboard.js <datasetId> --static

const { loadEnv } = require('../lib/config/env');
const { getDataset } = require('../lib/storage/manifest');
const { loadDatasetItems } = require('../lib/storage/datasetReader');
const { readSavedSummary } = require('../lib/summaryFile');
const { buildReport } = require('../lib/analysis/buildReport');
const logger = require('../lib/utils/logger');

function fail(message) {
  logger.error(message);
  process.exitCode = 1;
}

async function main() {
  loadEnv();
  const [datasetId, ...rest] = process.argv.slice(2);
  const isStatic = rest.includes('--static');

  if (!datasetId) return fail('Usage: node scripts/dashboard.js <datasetId> [--static]');

  const entry = getDataset(datasetId);
  if (!entry) return fail(`No dataset found with id "${datasetId}". Run "node scripts/list.js" to see saved datasets.`);

  const items = await loadDatasetItems(entry);
  const savedSummary = readSavedSummary(entry);
  const report = buildReport({ manifestEntry: entry, items, savedSummary });
  const datasets = [{ manifestEntry: entry, items }];

  if (isStatic) {
    const { generateStaticReport } = require('../lib/dashboard/staticGenerator');
    const filepath = await generateStaticReport({ report, datasets });
    logger.success(`Static report saved: ${filepath}`);
  } else {
    const { startDashboard } = require('../lib/dashboard/server');
    await startDashboard({ report, datasets });
  }
}

main().catch((e) => {
  console.error('dashboard.js crashed:', e.message);
  process.exit(1);
});
