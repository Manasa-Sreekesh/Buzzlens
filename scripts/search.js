#!/usr/bin/env node
// Collects real user feedback for a topic and prints a grounded summary for
// the calling AI agent to read and write its own analysis from. Never
// falls back to fake data. See ../SKILL.md for the full workflow.
//
// Usage:
//   node scripts/search.js --topic "Galaxy AI" --sources youtube,reddit --time 7days
//   node scripts/search.js --topic "X" --sources youtube --keywords "AI,camera" --time custom --start 2026-01-01 --end 2026-02-01
//   node scripts/search.js --topic "Product X" --sources community --community-urls "https://forum.example.com/thread/1,https://reviews.example.com/product-x"
//   node scripts/search.js --topic "Product X" --sources community --community-urls "https://weird-site.example.com" --comment-selector ".weird-thing" --text-selector ".say" --author-selector ".who"

const { loadEnv } = require('../lib/config/env');
const { getCollector, listCollectors } = require('../lib/collectors');
const { saveDataset } = require('../lib/storage/datasetWriter');
const { checkSourceCredentials } = require('../lib/credentials');
const { buildReport } = require('../lib/analysis/buildReport');
const logger = require('../lib/utils/logger');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    }
  }
  return opts;
}

function parseListArg(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function fail(message) {
  logger.error(message);
  process.exitCode = 1;
}

function printSummary(entry, report) {
  const { stats, positiveClusters, negativeClusters, recommendationClusters, topQuotesBySource } = report;

  console.log('');
  logger.heading(`Dataset saved: ${entry.id}`);
  logger.step(`File: ${entry.filepath}`);
  logger.step(`Topic: ${entry.topic} | Total items: ${stats.totalItems} | Sources: ${entry.sourcesSucceeded.join(', ') || 'none'}`);
  if (entry.sourcesFailed.length) {
    for (const f of entry.sourcesFailed) logger.warn(`  Skipped ${f.source}: ${f.reason}`);
  }

  console.log(`\nSentiment: ${stats.sentiment.positive} positive / ${stats.sentiment.negative} negative / ${stats.sentiment.neutral} neutral (of ${stats.totalItems})`);

  const printClusters = (title, clusters) => {
    console.log(`\n${title}:`);
    if (!clusters.length) {
      console.log('  (none found)');
      return;
    }
    for (const c of clusters) {
      console.log(`  - ${c.theme} — ${c.userCount} distinct user(s), ${c.count} item(s)`);
      if (c.items[0]) console.log(`    e.g. "${c.items[0].text}" — ${c.items[0].author} (${c.items[0].source})`);
    }
  };
  printClusters('What people like', positiveClusters);
  printClusters("What people don't like", negativeClusters);
  printClusters('Recommendations / feature requests', recommendationClusters);

  console.log('\nTop quotes by source:');
  for (const q of topQuotesBySource) {
    console.log(`  [${q.source}] "${q.text}" — ${q.author}, ${q.sentiment}`);
  }

  console.log(
    `\nNext: write your own analysis from the data above (or open ${entry.filepath} for the full set), ` +
      `covering sentiment, what people like/dislike, recommendations (with user counts), and representative ` +
      `quotes. Then save it with:\n` +
      `  node scripts/save-summary.js ${entry.id} --text "..."\n` +
      `Then view it with:\n` +
      `  node scripts/dashboard.js ${entry.id}`
  );
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const topic = String(opts.topic || '').trim();
  if (!topic) return fail('--topic is required, e.g. --topic "Galaxy AI"');

  const validIds = listCollectors().map((c) => c.id);
  const sources = parseListArg(opts.sources).map((s) => s.toLowerCase());
  const invalid = sources.filter((s) => !validIds.includes(s));
  if (invalid.length) return fail(`Unknown source(s): ${invalid.join(', ')}. Valid: ${validIds.join(', ')}.`);
  if (!sources.length) return fail(`--sources is required, e.g. --sources ${validIds.join(',')}.`);

  const timePeriod = opts.time || '7days';
  if (timePeriod === 'custom' && (!opts.start || !opts.end)) {
    return fail('--start and --end are required when --time custom is used.');
  }

  const communityUrls = parseListArg(opts['community-urls']);
  if (sources.includes('community')) {
    if (!communityUrls.length) {
      return fail('--community-urls is required (comma-separated) when --sources includes community.');
    }
    const malformed = communityUrls.filter((u) => !/^https?:\/\//i.test(u));
    if (malformed.length) {
      return fail(`--community-urls must be full http(s) URLs. Invalid: ${malformed.join(', ')}`);
    }
  }
  const communitySelectors =
    opts['comment-selector'] || opts['text-selector'] || opts['author-selector'] || opts['date-selector']
      ? {
          comment: opts['comment-selector'],
          text: opts['text-selector'],
          author: opts['author-selector'],
          date: opts['date-selector'],
        }
      : undefined;

  const query = {
    topic,
    keywords: parseListArg(opts.keywords),
    timePeriod,
    customStart: opts.start,
    customEnd: opts.end,
    communityUrls,
    communitySelectors,
  };
  const sourceResults = [];

  logger.heading(`Researching "${topic}"`);
  for (const sourceId of sources) {
    const collector = getCollector(sourceId);
    const { ready, creds, reason } = checkSourceCredentials(sourceId);
    if (!ready) {
      logger.warn(`${collector.label}: skipped — ${reason}`);
      sourceResults.push({ sourceId, result: { items: [], postCount: 0, status: 'error', errorMessage: reason } });
      continue;
    }
    logger.step(`Collecting from ${collector.label}...`);
    try {
      const result = await collector.collect(query, creds);
      const statusWord = { ok: 'done', partial: 'partial', skipped: 'skipped', error: 'FAILED' }[result.status] || result.status;
      logger.step(`  ${collector.label}: ${statusWord} — ${result.items.length} items from ${result.postCount} posts/videos.${result.errorMessage ? ` (${result.errorMessage})` : ''}`);
      sourceResults.push({ sourceId, result });
    } catch (e) {
      logger.warn(`${collector.label}: unexpected error — ${e.message}`);
      sourceResults.push({ sourceId, result: { items: [], postCount: 0, status: 'error', errorMessage: e.message } });
    }
  }

  const totalItems = sourceResults.reduce((sum, r) => sum + r.result.items.length, 0);
  if (totalItems === 0) {
    return fail('\nNo data was collected from any source — nothing was saved. See the messages above for why.');
  }

  const entry = await saveDataset({ query, sourceResults });
  const allItems = sourceResults.flatMap((r) => r.result.items);
  const report = buildReport({ manifestEntry: entry, items: allItems });

  printSummary(entry, report);
}

main().catch((e) => {
  console.error('search.js crashed:', e.message);
  process.exit(1);
});
