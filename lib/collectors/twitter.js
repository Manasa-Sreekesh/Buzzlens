const { uid } = require('../utils/id');
const { resolveRange } = require('../utils/dateRange');
const heuristics = require('./heuristics');

const MAX_RESULTS = 100;
// X API v2 recent-search only covers roughly the last 7 days, regardless of
// what the user asked for — this is a platform limitation, not a bug.
const RECENT_SEARCH_WINDOW_MS = 7 * 86400000 - 10 * 60 * 1000; // 7 days minus a safety margin

/**
 * @param {import('./types').CollectQuery} query
 * @param {{TWITTER_BEARER_TOKEN: string}} creds
 * @returns {Promise<import('./types').CollectResult>}
 */
async function collect(query, creds) {
  const token = creds.TWITTER_BEARER_TOKEN;
  if (!token) {
    return { items: [], postCount: 0, status: 'skipped', errorMessage: 'No TWITTER_BEARER_TOKEN configured.' };
  }

  const { topic, keywords = [], timePeriod, customStart, customEnd } = query;
  const searchTerm = [topic, ...keywords].filter(Boolean).join(' OR ');
  const { sinceISO } = resolveRange({ timePeriod, customStart, customEnd });

  const earliestAllowed = new Date(Date.now() - RECENT_SEARCH_WINDOW_MS);
  const requestedSince = new Date(sinceISO);
  const effectiveSince = requestedSince > earliestAllowed ? requestedSince : earliestAllowed;
  const windowClamped = requestedSince < earliestAllowed;

  const url =
    `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(`(${searchTerm}) -is:retweet lang:en`)}` +
    `&max_results=${MAX_RESULTS}&start_time=${effectiveSince.toISOString()}` +
    `&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username`;

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return { items: [], postCount: 0, status: 'error', errorMessage: `Twitter/X request failed: ${e.message}` };
  }

  if (!res.ok) {
    const body = await safeJson(res);
    if (res.status === 403 || res.status === 401) {
      return {
        items: [],
        postCount: 0,
        status: 'error',
        errorMessage: 'Twitter/X requires a paid API tier for search access. Your token does not have access to this endpoint.',
      };
    }
    if (res.status === 429) {
      return {
        items: [],
        postCount: 0,
        status: 'error',
        errorMessage: 'Twitter/X rate-limited this request (HTTP 429). Try again later.',
      };
    }
    return {
      items: [],
      postCount: 0,
      status: 'error',
      errorMessage: `Twitter/X search failed: ${body?.detail || body?.title || `HTTP ${res.status}`}`,
    };
  }

  const data = await res.json();
  const tweets = data.data || [];
  const users = {};
  for (const u of data.includes?.users || []) users[u.id] = u.username;

  const items = tweets.map((tw) => {
    const metrics = tw.public_metrics || {};
    const engagement = (metrics.like_count || 0) + (metrics.retweet_count || 0) + (metrics.reply_count || 0);
    return {
      id: uid('tw'),
      source: 'twitter',
      contentTitle: `Tweet by @${users[tw.author_id] || 'unknown'}`,
      author: `@${users[tw.author_id] || 'unknown'}`,
      text: tw.text,
      date: tw.created_at,
      link: `https://twitter.com/${users[tw.author_id] || 'i'}/status/${tw.id}`,
      sentiment: heuristics.sentiment(tw.text),
      theme: heuristics.theme(tw.text),
      engagement,
    };
  });

  return {
    items,
    postCount: items.length,
    status: windowClamped ? 'partial' : 'ok',
    errorMessage: windowClamped
      ? 'Twitter/X recent-search only covers the last ~7 days; the requested time period was clamped.'
      : undefined,
  };
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

module.exports = {
  id: 'twitter',
  label: 'Twitter / X',
  requiredCredentials: ['TWITTER_BEARER_TOKEN'],
  collect,
};
