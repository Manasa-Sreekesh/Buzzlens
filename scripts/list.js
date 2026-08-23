#!/usr/bin/env node
// Lists previously collected datasets, so a topic can be reused for
// analysis or a dashboard without recollecting it.

const { loadEnv } = require('../lib/config/env');
const { listDatasets } = require('../lib/storage/manifest');
const { readSavedSummary } = require('../lib/summaryFile');

loadEnv();
const datasets = listDatasets();

if (!datasets.length) {
  console.log('No saved datasets yet. Run "node scripts/search.js --topic ... --sources ..." first.');
} else {
  for (const d of datasets) {
    const hasSummary = readSavedSummary(d) !== null;
    console.log(`${d.id}  "${d.topic}"  ${d.createdAt}  ${d.counts.total} items  ${hasSummary ? '[has summary]' : '[no summary yet]'}`);
  }
}
