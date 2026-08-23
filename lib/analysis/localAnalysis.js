// Local, deterministic analysis. These functions ground everything in the
// raw collected items (sentiment/theme tags from collectors/heuristics.js,
// engagement counts, distinct authors) — no invention, no LLM call. This is
// the structured "highlight card" data (pain points, feature requests,
// strengths, weaknesses, theme clusters, representative quotes) the
// dashboard renders, and what search.js prints for the calling agent to
// read and write its own analysis from.

const FEATURE_THEMES = new Set(['Features', 'Updates', 'Documentation']);
const STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'about', 'people', 'users', 'saying', 'there', 'think',
  'feel', 'does', 'have', 'with', 'that', 'this', 'from', 'they', 'their', 'most', 'more',
  'less', 'some', 'many', 'the', 'and', 'for',
]);

function computeSentimentCounts(items) {
  return {
    positive: items.filter((i) => i.sentiment === 'positive').length,
    negative: items.filter((i) => i.sentiment === 'negative').length,
    neutral: items.filter((i) => i.sentiment === 'neutral').length,
  };
}

function topThemes(items, n = 8) {
  const counts = {};
  for (const i of items) counts[i.theme] = (counts[i.theme] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([theme, count]) => ({ theme, count }));
}

// Sentiment-stratified sample, sorted by engagement within each group, so
// prompts/quote lists don't get drowned out by whichever sentiment is most
// common and instead surface the strongest example of each.
function stratifiedSample(items, limit = 60) {
  const groups = { positive: [], negative: [], neutral: [] };
  for (const i of items) (groups[i.sentiment] || groups.neutral).push(i);
  for (const key of Object.keys(groups)) groups[key].sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
  const perGroup = Math.ceil(limit / 3);
  const picked = [...groups.positive.slice(0, perGroup), ...groups.negative.slice(0, perGroup), ...groups.neutral.slice(0, perGroup)];
  return picked.slice(0, limit);
}

function painPoints(items, n = 5) {
  return items
    .filter((i) => i.sentiment === 'negative')
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, n);
}

function featureRequests(items, n = 5) {
  return items
    .filter((i) => FEATURE_THEMES.has(i.theme) && i.sentiment !== 'positive')
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, n);
}

// Ranks themes by the fraction of items within that theme that are
// positive/negative (min 3 items in the theme to be considered), giving a
// grounded "this is a strength/weakness" signal without inventing anything.
function themeSentimentRanking(items, sentimentKey, n = 5) {
  const byTheme = {};
  for (const i of items) {
    byTheme[i.theme] = byTheme[i.theme] || [];
    byTheme[i.theme].push(i);
  }
  return Object.entries(byTheme)
    .map(([theme, themeItems]) => {
      const matching = themeItems.filter((i) => i.sentiment === sentimentKey);
      return {
        theme,
        count: themeItems.length,
        ratio: matching.length / themeItems.length,
        example: matching.sort((a, b) => (b.engagement || 0) - (a.engagement || 0))[0] || null,
      };
    })
    .filter((t) => t.count >= 3 && t.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio || b.count - a.count)
    .slice(0, n);
}

function strengths(items, n = 5) {
  return themeSentimentRanking(items, 'positive', n);
}

function weaknesses(items, n = 5) {
  return themeSentimentRanking(items, 'negative', n);
}

function sourceBreakdown(items, sources) {
  return sources.map((src) => {
    const srcItems = items.filter((i) => i.source === src);
    const pos = srcItems.filter((i) => i.sentiment === 'positive').length;
    const neg = srcItems.filter((i) => i.sentiment === 'negative').length;
    const tone = pos > neg * 1.5 ? 'mostly positive' : neg > pos * 1.5 ? 'mostly negative' : 'mixed';
    return { source: src, total: srcItems.length, positive: pos, negative: neg, tone };
  });
}

function buildOverviewText(topic, items) {
  const total = items.length;
  if (total === 0) return `No items were available for "${topic}".`;
  const { positive, negative, neutral } = computeSentimentCounts(items);
  const posP = Math.round((positive / total) * 100);
  const negP = Math.round((negative / total) * 100);
  const neuP = Math.round((neutral / total) * 100);
  const tone = posP > negP + 10 ? 'predominantly positive' : negP > posP + 10 ? 'predominantly negative' : 'mixed';
  return `Analysis of ${total} collected items about "${topic}". Overall sentiment is ${tone}: ${posP}% positive, ${negP}% negative, ${neuP}% neutral/mixed.`;
}

function representativeQuotes(items, n = 6) {
  return stratifiedSample(items, n);
}

// Groups items by theme (optionally filtered to one sentiment), sorted by
// how many items are in each group. Each cluster reports how many distinct
// authors contributed to it — the grounded basis for "N users said this"
// snippets in the dashboard — and its full member list, sorted by
// engagement, for the expand-to-see-all view.
function clusterByTheme(items, { sentiment = null } = {}) {
  const filtered = sentiment ? items.filter((i) => i.sentiment === sentiment) : items;
  const byTheme = {};
  for (const i of filtered) {
    byTheme[i.theme] = byTheme[i.theme] || [];
    byTheme[i.theme].push(i);
  }
  return Object.entries(byTheme)
    .map(([theme, themeItems]) => {
      const sorted = [...themeItems].sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
      return {
        theme,
        count: themeItems.length,
        userCount: new Set(themeItems.map((i) => i.author)).size,
        items: sorted,
      };
    })
    .sort((a, b) => b.count - a.count);
}

// Feature/update/documentation-themed items that aren't purely praise —
// the closest grounded proxy for "new recommendations users are asking
// for" without inventing requests that aren't actually in the data.
function recommendationClusters(items) {
  const candidates = items.filter((i) => FEATURE_THEMES.has(i.theme) && i.sentiment !== 'positive');
  return clusterByTheme(candidates);
}

// One representative (highest-engagement) item per source, for a
// "top quotes across sources" snapshot.
function topQuotePerSource(items, sources) {
  return sources
    .map((src) => [...items].filter((i) => i.source === src).sort((a, b) => (b.engagement || 0) - (a.engagement || 0))[0])
    .filter(Boolean);
}

// Keyword match + sentiment cue scoring against the loaded items — no LLM
// required, grounded only in items actually present in the dataset.
function answerQuestion(question, items) {
  const q = question.toLowerCase();
  const words = q.replace(/[^a-z\s]/g, '').split(/\s+/).filter((w) => w.length > 3);
  const keywords = words.filter((w) => !STOP_WORDS.has(w));

  const scored = items
    .map((d) => {
      const txt = `${d.text} ${d.contentTitle} ${d.theme}`.toLowerCase();
      let score = keywords.reduce((s, kw) => s + (txt.includes(kw) ? 2 : 0), 0);
      if (d.sentiment === 'negative' && /complaint|problem|issue|bad/.test(q)) score += 3;
      if (d.sentiment === 'positive' && /good|love|best|positive/.test(q)) score += 3;
      return { ...d, _score: score };
    })
    .filter((d) => d._score > 0)
    .sort((a, b) => b._score - a._score || (b.engagement || 0) - (a.engagement || 0));

  const relevant = scored.slice(0, 6);
  if (relevant.length < 2) {
    return {
      question,
      answer: `The collected data does not contain enough evidence related to this question (only ${relevant.length} clearly relevant item(s) out of ${items.length} total). Consider running a new search with more specific keywords.`,
      snippets: [],
      sourceBreakdown: [],
      note: 'Insufficient evidence in the loaded dataset(s).',
    };
  }

  const posRel = relevant.filter((d) => d.sentiment === 'positive').length;
  const negRel = relevant.filter((d) => d.sentiment === 'negative').length;
  const tone = posRel > negRel + 1 ? 'positive' : negRel > posRel + 1 ? 'negative' : 'mixed';
  const themesInvolved = [...new Set(relevant.map((d) => d.theme))].slice(0, 3).join(', ');

  return {
    question,
    answer:
      `Based on ${relevant.length} relevant items, sentiment on this is ${tone}. ` +
      `${posRel > 0 ? `${posRel} item(s) express positive views` : ''}${posRel > 0 && negRel > 0 ? '; ' : ''}` +
      `${negRel > 0 ? `${negRel} item(s) raise concerns or negative feedback` : ''}. ` +
      `Most discussed themes: ${themesInvolved}.`,
    snippets: relevant.slice(0, 4),
    sourceBreakdown: sourceBreakdown(relevant, [...new Set(relevant.map((d) => d.source))]),
    note: null,
  };
}

module.exports = {
  computeSentimentCounts,
  topThemes,
  stratifiedSample,
  painPoints,
  featureRequests,
  strengths,
  weaknesses,
  sourceBreakdown,
  buildOverviewText,
  representativeQuotes,
  clusterByTheme,
  recommendationClusters,
  topQuotePerSource,
  answerQuestion,
};
