#!/usr/bin/env node
// Lists previously collected datasets, so a topic can be reused for
// analysis or a dashboard without recollecting it.

const { loadEnv } = require('../lib/config/env');
const { listDatasets } = require('../lib/storage/manifest');
const { readSavedInsights } = require('../lib/insightsFile');

loadEnv();
const datasets = listDatasets();

if (!datasets.length) {
  console.log('No saved datasets yet. Run "node scripts/search.js --topic ... --sources ..." first.');
} else {
  for (const d of datasets) {
    const hasInsights = readSavedInsights(d) !== null;
    const focus = d.analysisTopic ? ` (focus: "${d.analysisTopic}")` : '';
    console.log(`${d.id}  "${d.topic}"${focus}  ${d.createdAt}  ${d.counts.total} items  ${hasInsights ? '[has PM insights]' : '[no insights yet]'}`);
  }
}
