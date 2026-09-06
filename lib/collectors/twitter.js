const { uid } = require('../utils/id');
const { resolveRange } = require('../utils/dateRange');
const heuristics = require('./heuristics');

const MAX_RESULTS = 100;
const MAX_EXPLICIT_TWEETS = 20; // caps an explicit --tweet-urls/--tweet-file list, not a search result
const MAX_TWEETS_FOR_REPLIES = 20; // how many top-level tweets (by engagement) we also fetch replies for
const TWEET_FIELDS = 'created_at,public_metrics,author_id,conversation_id';
const EXPANSIONS = 'expansions=author_id&user.fields=username';
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

  const explicitIds = query.tweetIds && query.tweetIds.length ? [...new Set(query.tweetIds)] : [];
  const { topic, keywords = [], timePeriod, customStart, customEnd } = query;
  const searchTerm = [topic, ...keywords].filter(Boolean).join(' OR ');
  const { sinceISO } = resolveRange({ timePeriod, customStart, customEnd });

  const earliestAllowed = new Date(Date.now() - RECENT_SEARCH_WINDOW_MS);
  const requestedSince = new Date(sinceISO);
  const effectiveSince = requestedSince > earliestAllowed ? requestedSince : earliestAllowed;
  const windowClamped = requestedSince < earliestAllowed;

  // 1. Topic search (unchanged in spirit) — failure here doesn't block an
  // explicit tweet list from still being collected.
  let searchedTweets = [];
  let searchErrorMessage = null;
  try {
    const searchUrl =
      `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(`(${searchTerm}) -is:retweet lang:en`)}` +
      `&max_results=${MAX_RESULTS}&start_time=${effectiveSince.toISOString()}` +
      `&tweet.fields=${TWEET_FIELDS}&${EXPANSIONS}`;
    const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!searchRes.ok) throw await httpError(searchRes);
    const searchData = await searchRes.json();
    searchedTweets = attachUsernames(searchData.data || [], searchData.includes?.users || []);
  } catch (e) {
    searchErrorMessage = e.message;
  }

  // 2. Explicit tweet list — deduped against the search results, capped,
  // fetched via Tweet lookup (works for any tweet regardless of age, unlike
  // recent-search's ~7-day window).
  const searchedIds = new Set(searchedTweets.map((t) => t.id));
  const dedupedExplicit = explicitIds.filter((id) => !searchedIds.has(id));
  const explicitToFetch = dedupedExplicit.slice(0, MAX_EXPLICIT_TWEETS);
  const explicitTruncatedCount = dedupedExplicit.length - explicitToFetch.length;
  const dedupedAwayCount = explicitIds.length - dedupedExplicit.length;

  const tweetErrors = [];
  let explicitTweets = [];
  if (explicitToFetch.length) {
    try {
      const lookupUrl =
        `https://api.twitter.com/2/tweets?ids=${explicitToFetch.join(',')}` +
        `&tweet.fields=${TWEET_FIELDS}&${EXPANSIONS}`;
      const res = await fetch(lookupUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw await httpError(res);
      const data = await res.json();
      explicitTweets = attachUsernames(data.data || [], data.includes?.users || []);
      const found = new Set(explicitTweets.map((t) => t.id));
      for (const id of explicitToFetch) {
        if (!found.has(id)) tweetErrors.push(`"${id}": not found (deleted, private, or invalid ID)`);
      }
    } catch (e) {
      tweetErrors.push(`Listed-tweet lookup failed: ${e.message}`);
    }
  }

  const allTweets = [...searchedTweets, ...explicitTweets];

  if (allTweets.length === 0) {
    return {
      items: [],
      postCount: 0,
      status: 'error',
      errorMessage: [searchErrorMessage, ...tweetErrors].filter(Boolean).join(' ') || 'No tweets found from the topic search or the listed tweets.',
    };
  }

  const items = allTweets.map((tw) => toItem(tw, false));

  // 3. Replies ("comments under the posts") for a bounded number of the
  // most-engaged tweets — each reply search costs its own API call, so this
  // is capped rather than done for every tweet collected.
  const forReplies = [...allTweets]
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, MAX_TWEETS_FOR_REPLIES);

  // A reply-search can surface a tweet that's already been collected —
  // either as one of the top-level search/explicit results, or as a reply
  // fetched for a different tweet's thread (replies can cross-reference each
  // other in the same conversation). Track every tweet id already turned
  // into an item so none of them get added twice.
  const collectedIds = new Set(allTweets.map((t) => t.id));
  for (const tw of forReplies) {
    try {
      const replies = await fetchReplies(tw, token);
      for (const r of replies) {
        if (collectedIds.has(r.id)) continue;
        collectedIds.add(r.id);
        items.push(toItem(r, true));
      }
    } catch (e) {
      // A single tweet's replies failing shouldn't drop its own (already-collected) tweet.
    }
  }

  const notes = [];
  if (searchErrorMessage) notes.push(searchErrorMessage);
  if (windowClamped) notes.push('Twitter/X recent-search only covers the last ~7 days; the requested time period was clamped.');
  if (explicitTruncatedCount > 0) notes.push(`Only the first ${MAX_EXPLICIT_TWEETS} of the additional listed tweets were used.`);
  if (dedupedAwayCount > 0) notes.push(`${dedupedAwayCount} listed tweet(s) were already found by the topic search — collected once, not twice.`);
  if (tweetErrors.length) notes.push(`Some listed tweets could not be read: ${tweetErrors.join('; ')}`);

  return {
    items,
    postCount: allTweets.length,
    status: tweetErrors.length ? 'partial' : 'ok',
    errorMessage: notes.length ? notes.join(' ') : undefined,
  };
}

function engagementOf(tw) {
  const m = tw.public_metrics || {};
  return (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0);
}

function attachUsernames(tweets, users) {
  const byId = {};
  for (const u of users) byId[u.id] = u.username;
  return tweets.map((tw) => ({ ...tw, username: byId[tw.author_id] || 'unknown' }));
}

function toItem(tw, isReply) {
  return {
    id: uid('tw'),
    source: 'twitter',
    contentTitle: isReply ? `Reply to a tweet by @${tw.username}` : `Tweet by @${tw.username}`,
    author: `@${tw.username}`,
    text: tw.text,
    date: tw.created_at,
    link: `https://twitter.com/${tw.username}/status/${tw.id}`,
    sentiment: heuristics.sentiment(tw.text),
    theme: heuristics.theme(tw.text),
    engagement: engagementOf(tw),
  };
}

// Replies to a tweet are themselves tweets, findable via recent-search's
// conversation_id filter — same endpoint/window limitation as the main
// search (so this only surfaces replies from roughly the last 7 days).
async function fetchReplies(tw, token) {
  const url =
    `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(`conversation_id:${tw.conversation_id || tw.id} -is:retweet lang:en`)}` +
    `&max_results=${MAX_RESULTS}&tweet.fields=${TWEET_FIELDS}&${EXPANSIONS}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await httpError(res);
  const data = await res.json();
  const tweets = attachUsernames(data.data || [], data.includes?.users || []);
  return tweets.filter((r) => r.id !== tw.id);
}

async function httpError(res) {
  const body = await safeJson(res);
  if (res.status === 403 || res.status === 401) {
    return new Error('Twitter/X requires a paid API tier for search access. Your token does not have access to this endpoint.');
  }
  if (res.status === 429) {
    return new Error('Twitter/X rate-limited this request (HTTP 429). Try again later.');
  }
  return new Error(body?.detail || body?.title || `HTTP ${res.status}`);
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Extracts a numeric tweet ID from a twitter.com/x.com status URL, or
// passes through a bare numeric ID unchanged. Returns null if it can't
// recognize the input as either.
function extractTweetId(input) {
  const s = String(input || '').trim();
  if (/^\d{5,20}$/.test(s)) return s;
  let url;
  try {
    url = new URL(s);
  } catch (e) {
    return null;
  }
  if (!/(^|\.)(twitter\.com|x\.com)$/.test(url.hostname)) return null;
  const m = url.pathname.match(/\/status(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}

module.exports = {
  id: 'twitter',
  label: 'Twitter / X',
  requiredCredentials: ['TWITTER_BEARER_TOKEN'],
  collect,
  extractTweetId,
};
