const { uid } = require('../utils/id');
const { toRedditWindow, resolveRange } = require('../utils/dateRange');
const heuristics = require('./heuristics');

const MAX_POSTS_FOR_SELFTEXT = 20;
const MAX_POSTS_FOR_COMMENTS = 6;
const DEFAULT_USER_AGENT = 'buzzlens-cli/0.1 (local research tool)';
const THROTTLE_MS = 350; // spacing between requests to stay well under public rate limits

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('./types').CollectQuery} query
 * @param {{REDDIT_CLIENT_ID?: string, REDDIT_CLIENT_SECRET?: string, REDDIT_USER_AGENT?: string}} creds
 * @returns {Promise<import('./types').CollectResult>}
 */
async function collect(query, creds) {
  const userAgent = creds.REDDIT_USER_AGENT || DEFAULT_USER_AGENT;
  const useOAuth = Boolean(creds.REDDIT_CLIENT_ID && creds.REDDIT_CLIENT_SECRET);

  try {
    const auth = useOAuth
      ? await getOAuthToken(creds.REDDIT_CLIENT_ID, creds.REDDIT_CLIENT_SECRET, userAgent)
      : null;
    return await runCollection(query, { userAgent, auth });
  } catch (e) {
    const blocked = /429|403/.test(e.message);
    return {
      items: [],
      postCount: 0,
      status: 'error',
      errorMessage:
        blocked && !useOAuth
          ? `Reddit's public JSON endpoint blocked this request (${e.message.match(/\d{3}/)?.[0] || 'blocked'}) — ` +
            "this happens from some networks/IPs even with a normal browser user agent, and isn't something this " +
            'tool can work around. Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (free, from ' +
            'https://www.reddit.com/prefs/apps) to use the authenticated API instead, or try again later/on a ' +
            'different network.'
          : blocked
            ? 'Reddit rate-limited this request. Try again later.'
            : `Reddit collection failed: ${e.message}`,
    };
  }
}

async function getOAuthToken(clientId, clientSecret, userAgent) {
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit OAuth token request failed (HTTP ${res.status})`);
  const data = await res.json();
  return { token: data.access_token, base: 'https://oauth.reddit.com' };
}

async function runCollection(query, { userAgent, auth }) {
  const { topic, keywords = [], timePeriod, customStart, customEnd } = query;
  const searchTerm = [topic, ...keywords].join(' ');
  const t = toRedditWindow(timePeriod);
  const { sinceISO, untilISO } = resolveRange({ timePeriod, customStart, customEnd });
  const base = auth ? auth.base : 'https://www.reddit.com';
  const headers = { Accept: 'application/json', 'User-Agent': userAgent };
  if (auth) headers.Authorization = `Bearer ${auth.token}`;

  const searchRes = await fetch(
    `${base}/search.json?q=${encodeURIComponent(searchTerm)}&sort=relevance&t=${t}&limit=25&type=link`,
    { headers }
  );
  if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
  const searchData = await searchRes.json();
  // Reddit's own t= bucket (day/week/month/all) is coarser than every BuzzLens
  // period, so filter precisely to the requested window here.
  const posts = (searchData.data?.children || []).filter((post) => {
    const createdISO = new Date(post.data.created_utc * 1000).toISOString();
    return createdISO >= sinceISO && createdISO <= untilISO;
  });

  const items = [];
  const errors = [];

  for (const post of posts.slice(0, MAX_POSTS_FOR_SELFTEXT)) {
    const p = post.data;
    if (p.selftext && p.selftext.length > 30 && p.selftext !== '[removed]') {
      const text = p.selftext.slice(0, 600);
      items.push({
        id: uid('rd'),
        source: 'reddit',
        contentTitle: p.title,
        author: `u/${p.author}`,
        text,
        date: new Date(p.created_utc * 1000).toISOString(),
        link: `https://reddit.com${p.permalink}`,
        sentiment: heuristics.sentiment(text),
        theme: heuristics.theme(text),
        engagement: p.score || 0,
      });
    }
  }

  for (const post of posts.slice(0, MAX_POSTS_FOR_COMMENTS)) {
    const p = post.data;
    await sleep(THROTTLE_MS);
    try {
      const commRes = await fetch(`${base}${p.permalink}.json?limit=50&depth=2`, { headers });
      if (!commRes.ok) {
        errors.push(`"${p.title}": HTTP ${commRes.status}`);
        continue;
      }
      const commData = await commRes.json();
      for (const c of commData[1]?.data?.children || []) {
        if (c.kind !== 't1') continue;
        const cd = c.data;
        const text = cd.body;
        if (!text || text === '[deleted]' || text === '[removed]' || text.length < 15) continue;
        const createdISO = new Date(cd.created_utc * 1000).toISOString();
        if (createdISO < sinceISO || createdISO > untilISO) continue;
        items.push({
          id: uid('rd'),
          source: 'reddit',
          contentTitle: p.title,
          author: `u/${cd.author}`,
          text: text.slice(0, 600),
          date: createdISO,
          link: `https://reddit.com${p.permalink}`,
          sentiment: heuristics.sentiment(text),
          theme: heuristics.theme(text),
          engagement: Math.max(cd.score || 0, 0),
        });
      }
    } catch (e) {
      errors.push(`"${p.title}": ${e.message}`);
    }
  }

  return {
    items,
    postCount: posts.length,
    status: errors.length ? 'partial' : 'ok',
    errorMessage: errors.length ? `Some threads could not be read: ${errors.join('; ')}` : undefined,
  };
}

module.exports = {
  id: 'reddit',
  label: 'Reddit',
  requiredCredentials: [],
  collect,
};
