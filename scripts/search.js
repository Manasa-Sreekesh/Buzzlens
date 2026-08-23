#!/usr/bin/env node
// Collects real user feedback for a topic and prints a grounded summary for
// the calling AI agent to read and write its own analysis from. Never
// falls back to fake data. See ../SKILL.md for the full workflow.
//
// Usage:
//   node scripts/search.js --topic "Galaxy AI" --sources youtube,reddit                  # defaults to --time 30days
//   node scripts/search.js --topic "Galaxy AI" --sources youtube,reddit --time 7days      # or 15days
//   node scripts/search.js --topic "X" --sources youtube --keywords "AI,camera" --time custom --start 2026-01-01 --end 2026-02-01
//   node scripts/search.js --topic "Product X" --sources community --community-urls "https://forum.example.com/thread/1,https://reviews.example.com/product-x"
//   node scripts/search.js --topic "Product X" --sources community --community-urls "https://weird-site.example.com" --comment-selector ".weird-thing" --text-selector ".say" --author-selector ".who"
//   node scripts/search.js --topic "Product X" --sources youtube --video-urls "https://youtu.be/dQw4w9WgXcQ,https://www.youtube.com/watch?v=abc12345678"
//   node scripts/search.js --topic "Product X" --sources youtube --video-file youtube-videos.txt

const fs = require('fs');
const { loadEnv } = require('../lib/config/env');
const { getCollector, listCollectors } = require('../lib/collectors');
const { saveDataset } = require('../lib/storage/datasetWriter');
const { checkSourceCredentials } = require('../lib/credentials');
const { buildReport } = require('../lib/analysis/buildReport');
const youtube = require('../lib/collectors/youtube');
const { DEFAULT_TIME_PERIOD } = require('../lib/utils/dateRange');
const { ensureVisibleLink } = require('../lib/utils/visibleLink');
const logger = require('../lib/utils/logger');

const TIME_PERIOD_LABELS = {
  '24hours': 'the last 24 hours',
  '7days': 'the last 7 days',
  '15days': 'the last 15 days',
  '30days': 'the last 30 days',
  custom: 'a custom date range',
};

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
  const entryTimeLabel =
    entry.timePeriod === 'custom'
      ? `${entry.customStart} to ${entry.customEnd}`
      : TIME_PERIOD_LABELS[entry.timePeriod] || entry.timePeriod;
  logger.step(`Topic: ${entry.topic} | Window: ${entryTimeLabel} | Total items: ${stats.totalItems} | Sources: ${entry.sourcesSucceeded.join(', ') || 'none'}`);
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
  ensureVisibleLink();
  const opts = parseArgs(process.argv.slice(2));

  const topic = String(opts.topic || '').trim();
  if (!topic) return fail('--topic is required, e.g. --topic "Galaxy AI"');

  const validIds = listCollectors().map((c) => c.id);
  const sources = parseListArg(opts.sources).map((s) => s.toLowerCase());
  const invalid = sources.filter((s) => !validIds.includes(s));
  if (invalid.length) return fail(`Unknown source(s): ${invalid.join(', ')}. Valid: ${validIds.join(', ')}.`);
  if (!sources.length) return fail(`--sources is required, e.g. --sources ${validIds.join(',')}.`);

  const validTimePeriods = ['24hours', '7days', '15days', '30days', 'custom'];
  const timePeriod = opts.time || DEFAULT_TIME_PERIOD;
  if (!validTimePeriods.includes(timePeriod)) {
    return fail(`Unknown --time value "${timePeriod}". Valid: ${validTimePeriods.join(', ')} (default ${DEFAULT_TIME_PERIOD}).`);
  }
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

  if (opts['video-urls'] && opts['video-file']) {
    return fail('Use either --video-urls or --video-file, not both — pick one.');
  }
  let videoIds = [];
  if (opts['video-urls'] || opts['video-file']) {
    if (!sources.includes('youtube')) {
      return fail('--video-urls/--video-file require --sources to include youtube.');
    }
    let rawVideos;
    if (opts['video-urls']) {
      rawVideos = parseListArg(opts['video-urls']);
    } else {
      const filePath = String(opts['video-file']);
      if (!fs.existsSync(filePath)) {
        return fail(`--video-file not found: ${filePath}`);
      }
      rawVideos = fs
        .readFileSync(filePath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    }
    if (!rawVideos.length) {
      return fail('No video URLs/IDs found — check --video-urls or the contents of --video-file.');
    }
    const invalidVideos = [];
    for (const raw of rawVideos) {
      const id = youtube.extractVideoId(raw);
      if (id) videoIds.push(id);
      else invalidVideos.push(raw);
    }
    if (invalidVideos.length) {
      return fail(`Could not recognize as YouTube video URLs/IDs: ${invalidVideos.join(', ')}`);
    }
    videoIds = [...new Set(videoIds)];
  }

  const query = {
    topic,
    keywords: parseListArg(opts.keywords),
    timePeriod,
    customStart: opts.start,
    customEnd: opts.end,
    communityUrls,
    communitySelectors,
    videoIds,
  };
  const sourceResults = [];

  const timeLabel = timePeriod === 'custom' ? `${opts.start} to ${opts.end}` : TIME_PERIOD_LABELS[timePeriod];
  logger.heading(`Researching "${topic}" — ${timeLabel}`);
  if (videoIds.length) {
    logger.step(`YouTube: using ${videoIds.length} explicitly listed video(s) — skipping keyword search and the --time window for this source.`);
  }
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
