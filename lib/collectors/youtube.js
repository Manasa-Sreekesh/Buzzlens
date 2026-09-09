const { uid } = require('../utils/id');
const { resolveRange } = require('../utils/dateRange');
const heuristics = require('./heuristics');

const MAX_VIDEOS = 20;
// Per video: up to ~200 relevance-ranked top-level comments + ~100 most-recent
// ones, deduped by comment id (a comment can appear in both rankings) — this
// balances prominent opinions with newer feedback rather than just top comments.
const RELEVANCE_COMMENTS_TARGET = 200;
const RECENT_COMMENTS_TARGET = 100;
const MAX_COMMENTS_PER_VIDEO = RELEVANCE_COMMENTS_TARGET + RECENT_COMMENTS_TARGET;
const COMMENT_PAGE_SIZE = 100; // commentThreads.list's own per-page cap
// Every collected top-level comment gets its full reply thread, not just the
// first page — this safety ceiling only guards against a single pathological
// mega-thread consuming the whole run; realistic threads finish well under it.
const MAX_REPLY_PAGES = 50; // 50 * 100 = up to 5,000 replies per thread
const MAX_EXPLICIT_VIDEOS = 20; // caps an explicit --video-urls/--video-file list, not a search result
// The no-API-key fallback's own, separate, unchanged limits — it scrapes one
// page at a time with no pagination, so it stays at its original small scale
// regardless of the API path's targets above.
const NO_KEY_MAX_VIDEOS = 5;
const NO_KEY_MAX_COMMENTS_PER_VIDEO = 50;
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * @param {import('./types').CollectQuery} query
 * @param {{YOUTUBE_API_KEY?: string}} creds
 * @returns {Promise<import('./types').CollectResult>}
 */
async function collect(query, creds) {
  const explicitIds = query.videoIds && query.videoIds.length ? [...new Set(query.videoIds)] : [];
  return creds.YOUTUBE_API_KEY
    ? collectViaApi(query, creds.YOUTUBE_API_KEY, explicitIds)
    : collectViaPublicPages(query, explicitIds);
}

// Extracts an 11-character YouTube video ID from a watch/share/shorts URL,
// or passes through a bare ID unchanged. Returns null if it can't recognize
// the input as either.
function extractVideoId(input) {
  const s = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  let url;
  try {
    url = new URL(s);
  } catch (e) {
    return null;
  }
  if (/(^|\.)youtu\.be$/.test(url.hostname)) {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (/(^|\.)youtube\.com$/.test(url.hostname)) {
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

// --- API-key path --------------------------------------------------------
//
// Combines a topic search with an optional explicit video list (--video-urls
// / --video-file) — both run together rather than one replacing the other.
// Any explicit id that the search already turned up is fetched once, not
// twice: explicitIds is deduped against the search results before use.

async function collectViaApi(query, apiKey, explicitIds = []) {
  const { topic, keywords = [], timePeriod, customStart, customEnd } = query;
  const searchTerm = [topic, ...keywords].join(' ');
  const { sinceISO } = resolveRange({ timePeriod, customStart, customEnd });

  let searchedVideos = [];
  let searchErrorMessage = null;
  try {
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchTerm)}` +
      `&type=video&maxResults=${MAX_VIDEOS}&order=relevance&publishedAfter=${sinceISO}&relevanceLanguage=en&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      const e = await safeJson(searchRes);
      throw new Error(e?.error?.message || `HTTP ${searchRes.status}`);
    }
    const searchData = await searchRes.json();
    searchedVideos = (searchData.items || []).slice(0, MAX_VIDEOS).map((v) => ({ id: v.id.videoId, title: v.snippet.title }));
  } catch (e) {
    searchErrorMessage = `YouTube topic search failed: ${e.message}`;
  }

  const searchedIds = new Set(searchedVideos.map((v) => v.id));
  const dedupedExplicit = explicitIds.filter((id) => !searchedIds.has(id));
  const explicitToFetch = dedupedExplicit.slice(0, MAX_EXPLICIT_VIDEOS);
  const explicitTruncatedCount = dedupedExplicit.length - explicitToFetch.length;
  const dedupedAwayCount = explicitIds.length - dedupedExplicit.length;

  const videoErrors = [];
  let explicitTitleById = {};
  if (explicitToFetch.length) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${explicitToFetch.join(',')}&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const e = await safeJson(res);
        throw new Error(e?.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      for (const v of data.items || []) explicitTitleById[v.id] = v.snippet.title;
    } catch (e) {
      videoErrors.push(`Listed-video lookup failed: ${e.message}`);
    }
    for (const id of explicitToFetch) {
      if (!explicitTitleById[id]) videoErrors.push(`"${id}": not found (private, deleted, or invalid ID)`);
    }
  }

  const videos = [
    ...searchedVideos,
    ...explicitToFetch.filter((id) => explicitTitleById[id]).map((id) => ({ id, title: explicitTitleById[id] })),
  ];

  if (videos.length === 0) {
    return {
      items: [],
      postCount: 0,
      status: 'error',
      errorMessage: [searchErrorMessage, ...videoErrors].filter(Boolean).join(' ') || 'No videos found from the topic search or the listed videos.',
    };
  }

  const items = [];
  for (const video of videos) {
    try {
      items.push(...(await fetchCommentItemsViaApi(video.id, video.title, apiKey)));
    } catch (e) {
      videoErrors.push(`"${video.title}": ${e.message}`);
    }
  }

  if (items.length === 0 && videoErrors.length > 0) {
    return {
      items: [],
      postCount: videos.length,
      status: 'error',
      errorMessage: `YouTube comment collection failed for all videos: ${[searchErrorMessage, ...videoErrors].filter(Boolean).join('; ')}`,
    };
  }

  const notes = [];
  if (searchErrorMessage) notes.push(searchErrorMessage);
  if (explicitTruncatedCount > 0) notes.push(`Only the first ${MAX_EXPLICIT_VIDEOS} of the additional listed videos were used.`);
  if (dedupedAwayCount > 0) notes.push(`${dedupedAwayCount} listed video(s) were already found by the topic search — collected once, not twice.`);
  if (videoErrors.length) notes.push(`Some videos could not be read: ${videoErrors.join('; ')}`);

  return {
    items,
    postCount: videos.length,
    status: videoErrors.length ? 'partial' : 'ok',
    errorMessage: notes.length ? notes.join(' ') : undefined,
  };
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Fetches a video's top-level comments (CommentThreads: list — the only
// endpoint that can list a video's comments), then for every thread that has
// replies, its full reply list (Comments: list with parentId — CommentThreads
// only inlines up to 5 replies per thread, so this is needed for the rest).
// Top-level comments come from two paginated passes — relevance-ranked and
// most-recent — merged and deduped by thread id, so the set balances
// prominent opinions with newer feedback rather than just top comments.
// https://developers.google.com/youtube/v3/docs/search (video discovery, in collectViaApi)
// https://developers.google.com/youtube/v3/docs/comments (replies, here)
async function fetchCommentItemsViaApi(videoId, videoTitle, apiKey) {
  const [relevanceThreads, recentThreads] = await Promise.all([
    fetchCommentThreadsPaged(videoId, apiKey, { order: 'relevance', maxTotal: RELEVANCE_COMMENTS_TARGET }),
    fetchCommentThreadsPaged(videoId, apiKey, { order: 'time', maxTotal: RECENT_COMMENTS_TARGET }),
  ]);

  const byThreadId = new Map();
  for (const c of [...relevanceThreads, ...recentThreads]) {
    if (!byThreadId.has(c.id)) byThreadId.set(c.id, c);
  }

  const items = [];
  for (const c of byThreadId.values()) {
    const top = c.snippet.topLevelComment.snippet;
    const text = String(top.textDisplay || '').replace(/<[^>]+>/g, '').trim();
    if (text) {
      items.push({
        id: uid('yt'),
        source: 'youtube',
        contentTitle: videoTitle,
        author: top.authorDisplayName || 'YouTube User',
        text,
        date: top.publishedAt,
        // &lc=<commentId> deep-links straight to this comment on the video
        // page (same mechanism used for replies below) — every citation
        // should point at the specific comment, not just the video.
        link: `https://youtube.com/watch?v=${videoId}&lc=${c.snippet.topLevelComment.id}`,
        sentiment: heuristics.sentiment(text),
        theme: heuristics.theme(text),
        engagement: top.likeCount || 0,
      });
    }

    if ((c.snippet.totalReplyCount || 0) > 0) {
      try {
        const replies = await fetchRepliesViaApi(c.id, apiKey);
        for (const r of replies) {
          items.push({
            id: uid('yt'),
            source: 'youtube',
            contentTitle: videoTitle,
            author: r.author,
            text: r.text,
            date: r.date,
            link: `https://youtube.com/watch?v=${videoId}&lc=${r.id}`,
            sentiment: heuristics.sentiment(r.text),
            theme: heuristics.theme(r.text),
            engagement: r.likeCount,
          });
        }
      } catch (e) {
        // A single thread's replies failing shouldn't drop its (already-collected) top-level comment.
      }
    }
  }
  return items;
}

// Pages through commentThreads.list for one video/order until either
// maxTotal threads are collected or YouTube runs out of pages — this is what
// lets a video's top-level comment count go beyond one page's worth.
async function fetchCommentThreadsPaged(videoId, apiKey, { order, maxTotal }) {
  const threads = [];
  let pageToken = '';
  while (threads.length < maxTotal) {
    const pageSize = Math.min(COMMENT_PAGE_SIZE, maxTotal - threads.length);
    const url =
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}` +
      `&maxResults=${pageSize}&order=${order}&key=${apiKey}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url);
    if (!res.ok) {
      const e = await safeJson(res);
      throw new Error(e?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const pageItems = data.items || [];
    threads.push(...pageItems);
    pageToken = data.nextPageToken;
    if (!pageToken || !pageItems.length) break;
  }
  return threads;
}

// Pages through every reply to one top-level comment (comments.list) until
// exhausted, preserving the thread's full discussion context rather than
// just its first page. MAX_REPLY_PAGES is a defensive ceiling against a
// single pathological mega-thread, not an intended limit.
async function fetchRepliesViaApi(parentId, apiKey) {
  const replies = [];
  let pageToken = '';
  for (let page = 0; page < MAX_REPLY_PAGES; page++) {
    const url =
      `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${parentId}` +
      `&maxResults=${COMMENT_PAGE_SIZE}&key=${apiKey}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url);
    if (!res.ok) {
      const e = await safeJson(res);
      throw new Error(e?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    for (const item of data.items || []) {
      const s = item.snippet;
      const text = String(s.textDisplay || '').replace(/<[^>]+>/g, '').trim();
      if (!text) continue;
      replies.push({
        id: item.id,
        author: s.authorDisplayName || 'YouTube User',
        text,
        date: s.publishedAt,
        likeCount: s.likeCount || 0,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return replies;
}

// --- No-API-key fallback ---------------------------------------------------
//
// Used when YOUTUBE_API_KEY isn't set. Reads the same public search/watch
// page HTML a signed-out browser gets — nothing beyond what's already
// visible to a logged-out visitor, and no credential of any kind. It's more
// fragile than the API path (it depends on YouTube's page structure rather
// than a stable public API, so it can break if that structure changes) and
// it's more limited: only one page of top-level comments per video (~20,
// vs. up to MAX_COMMENTS_PER_VIDEO from the paginated, dual-order API path),
// no reply threads, and
// comment dates are approximated from YouTube's relative labels ("3 days
// ago") rather than exact timestamps. This mirrors the caveat callers
// should surface to the user before they pick this route.

async function collectViaPublicPages(query, explicitIds = []) {
  const { topic, keywords = [], timePeriod, customStart, customEnd } = query;
  const searchTerm = [topic, ...keywords].join(' ');
  const { sinceISO } = resolveRange({ timePeriod, customStart, customEnd });

  let searchedVideos = [];
  let searchErrorMessage = null;
  try {
    searchedVideos = await searchVideosNoKey(searchTerm);
    if (!searchedVideos.length) {
      searchErrorMessage = 'YouTube search without an API key returned no videos — try different keywords, or add YOUTUBE_API_KEY.';
    }
  } catch (e) {
    searchErrorMessage = `YouTube topic search without an API key failed: ${e.message}. Add YOUTUBE_API_KEY to use the API instead.`;
  }

  const searchedIds = new Set(searchedVideos.map((v) => v.videoId));
  const dedupedExplicit = explicitIds.filter((id) => !searchedIds.has(id));
  const explicitToFetch = dedupedExplicit.slice(0, MAX_EXPLICIT_VIDEOS);
  const explicitTruncatedCount = dedupedExplicit.length - explicitToFetch.length;
  const dedupedAwayCount = explicitIds.length - dedupedExplicit.length;

  if (!searchedVideos.length && !explicitToFetch.length) {
    return { items: [], postCount: 0, status: 'error', errorMessage: searchErrorMessage };
  }

  const items = [];
  const videoErrors = [];

  for (const video of searchedVideos) {
    try {
      const { comments } = await fetchWatchPageNoKey(video.videoId);
      for (const c of comments) {
        const date = approxDateFromRelative(c.publishedTime);
        if (date < sinceISO) continue;
        items.push({
          id: uid('yt'),
          source: 'youtube',
          contentTitle: video.title,
          author: c.author || 'YouTube User',
          text: c.text,
          date,
          link: `https://youtube.com/watch?v=${video.videoId}`,
          sentiment: heuristics.sentiment(c.text),
          theme: heuristics.theme(c.text),
          engagement: parseCount(c.likeCount),
        });
      }
    } catch (e) {
      videoErrors.push(`"${video.title}": ${e.message}`);
    }
  }

  // Explicit videos are an exact target list, not a time-windowed search
  // (mirrors --community-urls) — no sinceISO filtering on their comments.
  for (const id of explicitToFetch) {
    try {
      const { title, comments } = await fetchWatchPageNoKey(id);
      for (const c of comments) {
        items.push({
          id: uid('yt'),
          source: 'youtube',
          contentTitle: title || id,
          author: c.author || 'YouTube User',
          text: c.text,
          date: approxDateFromRelative(c.publishedTime),
          link: `https://youtube.com/watch?v=${id}`,
          sentiment: heuristics.sentiment(c.text),
          theme: heuristics.theme(c.text),
          engagement: parseCount(c.likeCount),
        });
      }
    } catch (e) {
      videoErrors.push(`"${id}": ${e.message}`);
    }
  }

  const totalVideoCount = searchedVideos.length + explicitToFetch.length;
  if (items.length === 0 && videoErrors.length > 0) {
    return {
      items: [],
      postCount: totalVideoCount,
      status: 'error',
      errorMessage: `YouTube comment collection without an API key failed for all videos: ${[searchErrorMessage, ...videoErrors].filter(Boolean).join('; ')}`,
    };
  }

  const disclaimer =
    'Collected without a YouTube API key: fewer comments per video, no reply threads, and dates ' +
    "approximated from YouTube's relative timestamps. Add YOUTUBE_API_KEY to .env for the fuller, more reliable API path.";
  const notes = [disclaimer];
  if (searchErrorMessage) notes.push(searchErrorMessage);
  if (explicitTruncatedCount > 0) notes.push(`Only the first ${MAX_EXPLICIT_VIDEOS} of the additional listed videos were used.`);
  if (dedupedAwayCount > 0) notes.push(`${dedupedAwayCount} listed video(s) were already found by the topic search — collected once, not twice.`);
  if (videoErrors.length) notes.push(`Some videos could not be read: ${videoErrors.join('; ')}`);

  return {
    items,
    postCount: totalVideoCount,
    status: videoErrors.length ? 'partial' : 'ok',
    errorMessage: notes.join(' '),
  };
}

async function searchVideosNoKey(searchTerm) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`;
  const res = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const data = extractYtInitialData(html);
  if (!data) throw new Error('could not read search results (YouTube may have changed its page format)');

  const seen = new Set();
  const videos = [];
  for (const vr of findAll(data, 'videoRenderer')) {
    if (!vr.videoId || seen.has(vr.videoId)) continue;
    seen.add(vr.videoId);
    videos.push({
      videoId: vr.videoId,
      title: (vr.title?.runs || []).map((r) => r.text).join('') || 'Untitled video',
    });
    if (videos.length >= NO_KEY_MAX_VIDEOS) break;
  }
  return videos;
}

async function fetchWatchPageNoKey(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const title = extractTitleNoKey(html);

  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const versionMatch = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
  if (!apiKeyMatch || !versionMatch) throw new Error('could not read page config (YouTube may have changed its page format)');

  const data = extractYtInitialData(html);
  const token = data && findCommentContinuationToken(data);
  if (!token) return { title, comments: [] }; // comments disabled or hidden for this video — not an error

  const nextRes = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${apiKeyMatch[1]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': DESKTOP_UA },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: versionMatch[1] } },
      continuation: decodeURIComponent(token),
    }),
  });
  if (!nextRes.ok) throw new Error(`comments request failed (HTTP ${nextRes.status})`);
  const nextData = await nextRes.json();

  const mutations = nextData.frameworkUpdates?.entityBatchUpdate?.mutations || [];
  const comments = [];
  for (const m of mutations) {
    const payload = m.payload?.commentEntityPayload;
    const text = payload?.properties?.content?.content;
    if (!text) continue;
    comments.push({
      text,
      author: payload.author?.displayName,
      publishedTime: payload.properties.publishedTime,
      likeCount: payload.toolbar?.likeCountLiked || payload.toolbar?.likeCountNotliked,
    });
    if (comments.length >= NO_KEY_MAX_COMMENTS_PER_VIDEO) break;
  }
  return { title, comments };
}

// Best-effort title extraction from the watch page's <meta name="title">
// tag (present whether or not comments/ytInitialData parse cleanly).
function extractTitleNoKey(html) {
  const m = html.match(/<meta name="title" content="([^"]*)"/);
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim() || null;
}

function extractYtInitialData(html) {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// Walks the whole parsed page-data tree collecting every value found under
// the given key name — resilient to YouTube nesting the same renderer type
// at different depths depending on page layout.
function findAll(node, key, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node[key]) out.push(node[key]);
  for (const k of Object.keys(node)) findAll(node[k], key, out);
  return out;
}

function findCommentContinuationToken(data) {
  for (const section of findAll(data, 'itemSectionRenderer')) {
    if (section.sectionIdentifier !== 'comment-item-section') continue;
    for (const c of section.contents || []) {
      const token = c.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token) return token;
    }
  }
  return null;
}

function approxDateFromRelative(text) {
  const m = String(text || '').match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return new Date().toISOString();
  const unitMs = {
    second: 1e3,
    minute: 60e3,
    hour: 3600e3,
    day: 86400e3,
    week: 7 * 86400e3,
    month: 30 * 86400e3,
    year: 365 * 86400e3,
  }[m[2].toLowerCase()];
  return new Date(Date.now() - parseInt(m[1], 10) * unitMs).toISOString();
}

function parseCount(text) {
  if (!text) return 0;
  const m = String(text).trim().match(/^([\d.,]+)\s*([KMB]?)$/i);
  if (!m) return parseInt(text, 10) || 0;
  const num = parseFloat(m[1].replace(/,/g, ''));
  const mult = { K: 1e3, M: 1e6, B: 1e9, '': 1 }[m[2].toUpperCase()];
  return Math.round(num * mult);
}

module.exports = {
  id: 'youtube',
  label: 'YouTube',
  requiredCredentials: [],
  collect,
  extractVideoId,
};
