// Builds the structured report the dashboard renders, for a single
// collected dataset. Every field here is computed locally and
// deterministically from localAnalysis.js — no LLM call is made. If an
// agent has saved a written analysis (see scripts/save-summary.js), pass it
// as `savedSummary` to use it as the narrative instead of the placeholder.

const local = require('./localAnalysis');
const { buildPmDashboard } = require('./pmDashboard');

const NO_SUMMARY_PLACEHOLDER =
  'No analysis has been saved for this dataset yet. Ask the AI agent that collected this data ' +
  '(see SKILL.md) to read it and write one, then save it with ' +
  '`node scripts/save-summary.js <id> --insights <path-to-insights.json>`.';

function buildReport({ manifestEntry, items, savedSummary = null, savedInsights = null }) {
  const sources = [...new Set(items.map((i) => i.source))];
  const capClusterItems = (clusters, cap = 30) => clusters.map((c) => ({ ...c, items: c.items.slice(0, cap) }));

  return {
    generatedAt: new Date().toISOString(),
    usedLLM: Boolean(savedSummary),
    provider: savedSummary ? 'agent' : 'heuristic',
    dataset: {
      id: manifestEntry.id,
      topic: manifestEntry.topic,
      sourcesSucceeded: manifestEntry.sourcesSucceeded,
      itemCount: items.length,
      sentiment: local.computeSentimentCounts(items),
    },
    stats: {
      totalItems: items.length,
      sentiment: local.computeSentimentCounts(items),
      topThemes: local.topThemes(items),
    },
    narrative: savedSummary || NO_SUMMARY_PLACEHOLDER,
    pmDashboard: buildPmDashboard({ items, sources, savedInsights }),
    positiveClusters: capClusterItems(local.clusterByTheme(items, { sentiment: 'positive' })),
    negativeClusters: capClusterItems(local.clusterByTheme(items, { sentiment: 'negative' })),
    recommendationClusters: capClusterItems(local.recommendationClusters(items)),
    topQuotesBySource: local.topQuotePerSource(items, sources),
    painPoints: local.painPoints(items),
    featureRequests: local.featureRequests(items),
    strengths: local.strengths(items),
    weaknesses: local.weaknesses(items),
    sourceBreakdown: local.sourceBreakdown(items, sources),
    representativeQuotes: local.representativeQuotes(items),
    limitations: null,
  };
}

module.exports = { buildReport };
