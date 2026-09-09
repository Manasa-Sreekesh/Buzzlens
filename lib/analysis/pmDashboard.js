// Builds the structured data the PM-focused dashboard's executive summary
// and 6 numbered sections render from (see SKILL.md Phase 2/3 and
// lib/insightsFile.js for the schema).
//
// If the agent has saved grounded insights, those are used directly —
// they're already id-validated against the real dataset at save time, so
// every card is traceable to actual comments. Otherwise everything here
// falls back to the deterministic local analysis so the dashboard is never
// empty, just less specific (generic theme buckets instead of the agent's
// own read of what the comments are actually about) than an agent-written
// analysis would be.
//
// Two analysis modes (see lib/insightsFile.js's analysisModeOf), chosen by
// the user, not silently defaulted to the fast one:
// - "thorough" (default) — the agent read every comment itself and wrote
//   mentions/positive/negative directly. Used as-is here.
// - "fast" — the agent supplied matchTerms instead, and mentions/
//   sourceBreakdown/positive/negative are computed by an exhaustive local
//   keyword match over the whole dataset (see matchByTerms/
//   applyExhaustiveMatch below) — never the agent's own tally, and never
//   limited to the handful of items it cited as evidence.

const local = require('./localAnalysis');
const { formatTimePeriodLabel } = require('../utils/dateRange');
const { analysisModeOf } = require('../insightsFile');

function truncate(s, n) {
  const str = String(s || '').trim();
  return str.length > n ? `${str.slice(0, n).trim()}…` : str;
}

function resolveItems(ids, byId, cap = 20) {
  return (ids || []).map((id) => byId.get(id)).filter(Boolean).slice(0, cap);
}

// How many of a card's resolved evidence items came from each source (e.g.
// { youtube: 5, twitter: 2 }) — lets the dashboard filter/hide cards by
// source and show a per-source breakdown, without ever asking the agent to
// tag this itself: it's derived straight from each item's own `source`.
function sourceCounts(evidence) {
  const counts = {};
  for (const it of evidence) counts[it.source] = (counts[it.source] || 0) + 1;
  return counts;
}

function withSourceBreakdown(list) {
  return list.map((entry) => ({ ...entry, sourceBreakdown: entry.sourceBreakdown || sourceCounts(entry.evidence) }));
}

// In "fast" mode, an entry's mentions/sourceBreakdown (and, for topTopics,
// positive/negative counts) come from the exhaustive full-dataset match,
// overriding whatever the agent wrote — so these numbers can never drift
// from what's actually in the data. In "thorough" mode (or for entries
// saved before matchTerms/fast mode existed), this is a no-op — the
// agent's own mentions/positive/negative pass through unchanged.
function applyExhaustiveMatch(entry, items, mode) {
  if (mode !== 'fast') return entry;
  const m = local.matchByTerms(items, entry.matchTerms);
  if (!m) return entry;
  return {
    ...entry,
    mentions: m.mentions,
    sourceBreakdown: m.sourceBreakdown,
    // Only topTopics cards render these, but attaching them unconditionally
    // is harmless for the other sections (the template just ignores them).
    positive: m.matchedItems.filter((i) => i.sentiment === 'positive').length,
    negative: m.matchedItems.filter((i) => i.sentiment === 'negative').length,
  };
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

function buildPmDashboard({ items, sources, savedInsights, timePeriod, customStart, customEnd }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const sentiment = local.computeSentimentCounts(items);
  const analysisMode = analysisModeOf(savedInsights);

  // No deterministic fallback for the executive summary — like
  // recommendations, "what matters most" is interpretation, so this stays
  // empty until an agent writes it.
  const executiveSummary = savedInsights?.executiveSummary?.length
    ? savedInsights.executiveSummary.map((e) =>
        applyExhaustiveMatch({ ...e, evidence: resolveItems(e.itemIds, byId) }, items, analysisMode)
      )
    : [];

  const topTopics = savedInsights?.topTopics?.length
    ? savedInsights.topTopics.map((t) =>
        applyExhaustiveMatch({ ...t, evidence: resolveItems(t.itemIds, byId) }, items, analysisMode)
      )
    : fallbackTopTopics(items);

  const painPoints = savedInsights?.painPoints?.length
    ? savedInsights.painPoints.map((p) =>
        applyExhaustiveMatch(
          { ...p, representative: byId.get(p.representativeItemId) || null, evidence: resolveItems(p.itemIds, byId) },
          items,
          analysisMode
        )
      )
    : fallbackFromClusters(local.clusterByTheme(items, { sentiment: 'negative' }), 'description');

  const loves = savedInsights?.loves?.length
    ? savedInsights.loves.map((l) =>
        applyExhaustiveMatch(
          { ...l, representative: byId.get(l.representativeItemId) || null, evidence: resolveItems(l.itemIds, byId) },
          items,
          analysisMode
        )
      )
    : fallbackFromClusters(local.clusterByTheme(items, { sentiment: 'positive' }), 'description');

  const requests = savedInsights?.requests?.length
    ? savedInsights.requests.map((r) =>
        applyExhaustiveMatch(
          { ...r, representative: byId.get(r.representativeItemId) || null, evidence: resolveItems(r.itemIds, byId) },
          items,
          analysisMode
        )
      )
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
    dateRange: formatTimePeriodLabel({ timePeriod, customStart, customEnd }),
    sentiment,
    // Per-source totals so a mixed-source run (e.g. YouTube + Twitter/X) can
    // be viewed combined or filtered down to one source on the dashboard —
    // always derived fresh from the real items, not authored by the agent.
    bySource: sources.length > 1 ? local.sourceBreakdown(items, sources) : [],
    topDiscussedTopic: savedInsights?.overview?.topDiscussedTopic || topTopics[0]?.topic || 'Not enough data yet',
    biggestPainPoint: savedInsights?.overview?.biggestPainPoint || painPoints[0]?.description || 'Not enough data yet',
    mostRequestedImprovement:
      savedInsights?.overview?.mostRequestedImprovement || requests[0]?.request || 'Not enough data yet',
  };

  return {
    hasAgentInsights: Boolean(savedInsights),
    executiveSummary: withSourceBreakdown(executiveSummary),
    overview,
    topTopics: withSourceBreakdown(topTopics),
    painPoints: withSourceBreakdown(painPoints),
    loves: withSourceBreakdown(loves),
    requests: withSourceBreakdown(requests),
    recommendations: withSourceBreakdown(recommendations),
  };
}

module.exports = { buildPmDashboard };
