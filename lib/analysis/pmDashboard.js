// Builds the structured data the PM-focused dashboard's 6 sections render
// from (see SKILL.md Phase 2/3 and lib/insightsFile.js for the schema).
//
// If the agent has saved grounded insights, those are used directly —
// they're already id-validated against the real dataset at save time, so
// every card is traceable to actual comments. Otherwise everything here
// falls back to the deterministic local analysis so the dashboard is never
// empty, just less specific (generic theme buckets instead of the agent's
// own read of what the comments are actually about) than an agent-written
// analysis would be.

const local = require('./localAnalysis');

function truncate(s, n) {
  const str = String(s || '').trim();
  return str.length > n ? `${str.slice(0, n).trim()}…` : str;
}

function resolveItems(ids, byId, cap = 20) {
  return (ids || []).map((id) => byId.get(id)).filter(Boolean).slice(0, cap);
}

function formatDateRange(items) {
  const dates = items.map((i) => new Date(i.date)).filter((d) => !isNaN(d.getTime()));
  if (!dates.length) return 'Unknown';
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  const shortOpts = { month: 'short', day: 'numeric' };
  const longOpts = { month: 'short', day: 'numeric', year: 'numeric' };
  if (min.toDateString() === max.toDateString()) return min.toLocaleDateString('en-US', longOpts);
  return `${min.toLocaleDateString('en-US', shortOpts)} – ${max.toLocaleDateString('en-US', longOpts)}`;
}

function contentUnitLabel(sources) {
  if (sources.length === 1 && sources[0] === 'youtube') return 'Videos analyzed';
  if (sources.length === 1 && sources[0] === 'reddit') return 'Threads analyzed';
  if (sources.length === 1 && sources[0] === 'community') return 'Pages analyzed';
  if (sources.length === 1 && sources[0] === 'twitter') return 'Tweets analyzed';
  return 'Sources analyzed';
}

// A YouTube comment's own link deep-links to that specific comment
// (`&lc=<id>`) — stripping that back off gives the plain video link, for a
// "watch the video" action distinct from "view this specific comment".
function baseContentLink(item) {
  if (item.source === 'youtube') return String(item.link || '').replace(/&lc=[^&]*/, '');
  return item.link;
}

// One row per distinct video/thread/page actually collected from, each
// with a real link and how many of the collected comments came from it —
// this is what lets the dashboard list "videos analyzed" with working
// links, not just a count.
function buildContentUnits(items) {
  const byUnit = new Map();
  for (const i of items) {
    const key = `${i.source}::${i.contentTitle}`;
    if (!byUnit.has(key)) {
      byUnit.set(key, { title: i.contentTitle, source: i.source, link: baseContentLink(i), count: 0 });
    }
    byUnit.get(key).count += 1;
  }
  return [...byUnit.values()].sort((a, b) => b.count - a.count);
}

function fallbackTopTopics(items, n = 6) {
  return local
    .clusterByTheme(items)
    .slice(0, n)
    .map((c) => ({
      topic: c.theme,
      mentions: c.userCount,
      positive: c.items.filter((i) => i.sentiment === 'positive').length,
      negative: c.items.filter((i) => i.sentiment === 'negative').length,
      evidence: c.items.slice(0, 20),
    }));
}

// Shared shape for the pain-points/loves/requests fallbacks: cluster by
// theme+sentiment, and use the highest-engagement real comment's own text
// as the "description" — grounded (it's an actual quote), just not
// abstracted into a clean problem statement the way an agent's own reading
// of the thread would produce.
function fallbackFromClusters(clusters, textField, n = 5) {
  return clusters.slice(0, n).map((c) => {
    const top = c.items[0] || null;
    return {
      [textField]: top ? truncate(top.text, 140) : c.theme,
      mentions: c.userCount,
      relatedTopic: c.theme,
      representative: top,
      evidence: c.items.slice(0, 20),
    };
  });
}

function buildPmDashboard({ items, sources, savedInsights }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const sentiment = local.computeSentimentCounts(items);

  const topTopics = savedInsights?.topTopics?.length
    ? savedInsights.topTopics.map((t) => ({ ...t, evidence: resolveItems(t.itemIds, byId) }))
    : fallbackTopTopics(items);

  const painPoints = savedInsights?.painPoints?.length
    ? savedInsights.painPoints.map((p) => ({
        ...p,
        representative: byId.get(p.representativeItemId) || null,
        evidence: resolveItems(p.itemIds, byId),
      }))
    : fallbackFromClusters(local.clusterByTheme(items, { sentiment: 'negative' }), 'description');

  const loves = savedInsights?.loves?.length
    ? savedInsights.loves.map((l) => ({
        ...l,
        representative: byId.get(l.representativeItemId) || null,
        evidence: resolveItems(l.itemIds, byId),
      }))
    : fallbackFromClusters(local.clusterByTheme(items, { sentiment: 'positive' }), 'description');

  const requests = savedInsights?.requests?.length
    ? savedInsights.requests.map((r) => ({
        ...r,
        representative: byId.get(r.representativeItemId) || null,
        evidence: resolveItems(r.itemIds, byId),
      }))
    : fallbackFromClusters(local.recommendationClusters(items), 'request');

  // No deterministic fallback for PM recommendations — "what this may mean"
  // is interpretation, and inventing that heuristically would break the
  // no-fabrication rule. This section stays empty until an agent writes it.
  const recommendations = savedInsights?.recommendations?.length
    ? savedInsights.recommendations.map((r) => ({ ...r, evidence: resolveItems(r.itemIds, byId) }))
    : [];

  const contentUnits = buildContentUnits(items);

  const overview = {
    totalComments: items.length,
    totalContentUnits: contentUnits.length,
    contentUnitLabel: contentUnitLabel(sources),
    contentUnits,
    dateRange: formatDateRange(items),
    sentiment,
    topDiscussedTopic: savedInsights?.overview?.topDiscussedTopic || topTopics[0]?.topic || 'Not enough data yet',
    biggestPainPoint: savedInsights?.overview?.biggestPainPoint || painPoints[0]?.description || 'Not enough data yet',
    mostRequestedImprovement:
      savedInsights?.overview?.mostRequestedImprovement || requests[0]?.request || 'Not enough data yet',
  };

  return {
    hasAgentInsights: Boolean(savedInsights),
    overview,
    topTopics,
    painPoints,
    loves,
    requests,
    recommendations,
  };
}

module.exports = { buildPmDashboard };
