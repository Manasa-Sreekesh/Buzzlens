const path = require('path');
const fs = require('fs');
const { uid } = require('../utils/id');
const { slugify } = require('../utils/slug');
const { fmtCompactTimestamp, fmtDateTime } = require('../utils/format');
const { DATASETS_DIR } = require('../config/constants');
const { writeDatasetWorkbook } = require('./excel');
const { appendDataset } = require('./manifest');

/**
 * @param {{ query: import('../collectors/types').CollectQuery, sourceResults: Array<{sourceId: string, result: import('../collectors/types').CollectResult}> }} args
 */
async function saveDataset({ query, sourceResults }) {
  fs.mkdirSync(DATASETS_DIR, { recursive: true });

  const allItems = [];
  const counts = {};
  const sourcesSucceeded = [];
  const sourcesPartial = [];
  const sourcesFailed = [];

  for (const { sourceId, result } of sourceResults) {
    counts[sourceId] = { posts: result.postCount || 0, comments: result.items.length };
    allItems.push(...result.items);
    if (result.status === 'ok') sourcesSucceeded.push(sourceId);
    else if (result.status === 'partial') sourcesPartial.push(sourceId);
    else sourcesFailed.push({ source: sourceId, reason: result.errorMessage || 'Unknown error' });
  }

  allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  const sentiment = {
    positive: allItems.filter((i) => i.sentiment === 'positive').length,
    negative: allItems.filter((i) => i.sentiment === 'negative').length,
    neutral: allItems.filter((i) => i.sentiment === 'neutral').length,
  };

  const id = uid('ds');
  const createdAt = new Date().toISOString();
  const filename = `${slugify(query.topic)}_${fmtCompactTimestamp(createdAt)}.xlsx`;
  const filepath = path.join(DATASETS_DIR, filename);

  const summaryRows = [
    ['Topic', query.topic],
    ['Analysis Focus', query.analysisTopic || '(same as topic)'],
    ['Keywords', query.keywords || []],
    ['Time Period', query.timePeriod],
    ['Sources Requested', sourceResults.map((r) => r.sourceId)],
    ['Sources Succeeded', sourcesSucceeded],
    ['Sources Partial', sourcesPartial],
    ['Sources Failed', sourcesFailed.map((f) => `${f.source} (${f.reason})`)],
    ['Collected At', fmtDateTime(createdAt)],
    ['Total Items', allItems.length],
    ['Positive', sentiment.positive],
    ['Negative', sentiment.negative],
    ['Neutral', sentiment.neutral],
  ];

  await writeDatasetWorkbook(filepath, { items: allItems, summaryRows });

  const entry = {
    id,
    topic: query.topic,
    analysisTopic: query.analysisTopic || null,
    keywords: query.keywords || [],
    timePeriod: query.timePeriod,
    customStart: query.customStart || null,
    customEnd: query.customEnd || null,
    sourcesRequested: sourceResults.map((r) => r.sourceId),
    sourcesSucceeded,
    sourcesPartial,
    sourcesFailed,
    counts: { ...counts, total: allItems.length },
    sentiment,
    createdAt,
    filename,
    filepath: path.relative(path.join(DATASETS_DIR, '..', '..'), filepath),
    schemaVersion: 1,
  };

  appendDataset(entry);
  return entry;
}

module.exports = { saveDataset };
