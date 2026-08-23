const { uid } = require('../utils/id');
const { resolveRange } = require('../utils/dateRange');
const heuristics = require('./heuristics');

const MAX_VIDEOS = 5;
const MAX_COMMENTS_PER_VIDEO = 50;

/**
 * @param {import('./types').CollectQuery} query
 * @param {{YOUTUBE_API_KEY: string}} creds
 * @returns {Promise<import('./types').CollectResult>}
 */
async function collect(query, creds) {
  const apiKey = creds.YOUTUBE_API_KEY;
  if (!apiKey) {
    return { items: [], postCount: 0, status: 'skipped', errorMessage: 'No YOUTUBE_API_KEY configured.' };
  }

  const { topic, keywords = [], timePeriod, customStart, customEnd } = query;
  const searchTerm = [topic, ...keywords].join(' ');
  const { sinceISO } = resolveRange({ timePeriod, customStart, customEnd });

  let videos;
  try {
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchTerm)}` +
      `&type=video&maxResults=8&order=relevance&publishedAfter=${sinceISO}&relevanceLanguage=en&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      const e = await safeJson(searchRes);
      throw new Error(e?.error?.message || `HTTP ${searchRes.status}`);
    }
    const searchData = await searchRes.json();
    videos = (searchData.items || []).slice(0, MAX_VIDEOS);
  } catch (e) {
    return { items: [], postCount: 0, status: 'error', errorMessage: `YouTube search failed: ${e.message}` };
  }

  const items = [];
  const videoErrors = [];

  for (const video of videos) {
    const videoId = video.id.videoId;
    const videoTitle = video.snippet.title;
    try {
      const commentsUrl =
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}` +
        `&maxResults=${MAX_COMMENTS_PER_VIDEO}&order=relevance&key=${apiKey}`;
      const commRes = await fetch(commentsUrl);
      if (!commRes.ok) {
        const e = await safeJson(commRes);
        videoErrors.push(`"${videoTitle}": ${e?.error?.message || `HTTP ${commRes.status}`}`);
        continue;
      }
      const commData = await commRes.json();
      for (const c of commData.items || []) {
        const top = c.snippet.topLevelComment.snippet;
        const text = String(top.textDisplay || '').replace(/<[^>]+>/g, '').trim();
        if (!text) continue;
        items.push({
          id: uid('yt'),
          source: 'youtube',
          contentTitle: videoTitle,
          author: top.authorDisplayName || 'YouTube User',
          text,
          date: top.publishedAt,
          link: `https://youtube.com/watch?v=${videoId}`,
          sentiment: heuristics.sentiment(text),
          theme: heuristics.theme(text),
          engagement: top.likeCount || 0,
        });
      }
    } catch (e) {
      videoErrors.push(`"${videoTitle}": ${e.message}`);
    }
  }

  if (items.length === 0 && videoErrors.length > 0) {
    return {
      items: [],
      postCount: videos.length,
      status: 'error',
      errorMessage: `YouTube comment collection failed for all videos: ${videoErrors.join('; ')}`,
    };
  }

  return {
    items,
    postCount: videos.length,
    status: videoErrors.length ? 'partial' : 'ok',
    errorMessage: videoErrors.length
      ? `Some videos could not be read: ${videoErrors.join('; ')}`
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
  id: 'youtube',
  label: 'YouTube',
  requiredCredentials: ['YOUTUBE_API_KEY'],
  collect,
};
