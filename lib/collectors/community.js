const cheerio = require('cheerio');
const { uid } = require('../utils/id');
const heuristics = require('./heuristics');

const THROTTLE_MS = 500; // spacing between page fetches — more conservative than Reddit's,
// since arbitrary third-party sites have no documented rate tolerance.
const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB safety cap on pathologically large pages
const MAX_COMMENTS_PER_PAGE = 50;
const MIN_CONTAINER_MATCHES = 2; // guards against matching the page's own single article/review body
const TEXT_MAX_LEN = 600;
const TEXT_MIN_LEN = 15;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Tried in order; first strategy with >= MIN_CONTAINER_MATCHES matches wins.
// Covers common schema.org microdata, WordPress-style comment markup,
// generic comment/review class names, forum post markup, and a couple of
// attribute-based last resorts. This can't cover every site — that's what
// the --comment-selector override is for.
const CONTAINER_STRATEGIES = [
  '[itemprop="comment"], [itemtype*="schema.org/Comment"], [itemtype*="schema.org/Review"], [itemtype*="schema.org/UserComments"]',
  '#comments .comment, .comment-list .comment, ol.commentlist > li.comment, .comment-body',
  '.comment, .comment-item, .comment-entry',
  '.review, .review-item, .review-entry',
  '.post-content, .message-content, .forum-post, .post-body',
  '.post-message, #disqus_thread .post',
  '[data-comment-id], [data-testid*="comment" i], [id^="comment-"]',
];

const TEXT_SELECTORS = '[itemprop="text"], [itemprop="reviewBody"], .comment-content, .comment-body, .comment-text, .review-text, .review-body';
const AUTHOR_SELECTORS = '[itemprop="author"], .comment-author, .comment-meta .name, .author, .username, .user, cite';
const DATE_SELECTORS = 'time[datetime], [itemprop="datePublished"], .comment-date, .comment-meta time, .date, .timestamp';
const ENGAGEMENT_SELECTORS = '[itemprop="upvoteCount"], .vote-count, .likes, .like-count, .upvotes';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url, userAgent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'text/html' }, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms`);
    throw new Error(`Network error: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new Error(`Not an HTML page (Content-Type: ${contentType || 'unknown'})`);
  }

  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response too large (>${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)}MB), skipped`);
  }

  const html = await res.text();
  if (html.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Response too large (>${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)}MB), skipped`);
  }

  return html;
}

// Parses the first integer found in text like "12 likes" or "👍 12".
function parseEngagementNumber(text) {
  const match = String(text || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function resolveField($, $container, overrideSelector, builtInSelectors) {
  if (overrideSelector) {
    const $match = $container.find(overrideSelector).first();
    return $match.length ? $match : null;
  }
  const $match = $container.find(builtInSelectors).first();
  return $match.length ? $match : null;
}

function extractText($, $container, overrideSelector, containerSelector) {
  const $match = resolveField($, $container, overrideSelector, TEXT_SELECTORS);
  if ($match) {
    const t = $match.text().trim().replace(/\s+/g, ' ');
    if (t) return t;
  }
  if (overrideSelector) return ''; // explicit override found nothing — don't fall back to guessing

  // Fallback: the container's own text, with any nested containers (e.g.
  // threaded replies matching the same selector) stripped first, so a
  // parent comment's text doesn't absorb its children's text too.
  const $clone = $container.clone();
  if (containerSelector) $clone.find(containerSelector).remove();
  const t = $clone.text().trim().replace(/\s+/g, ' ');
  return t;
}

function extractAuthor($, $container, overrideSelector, index) {
  const $match = resolveField($, $container, overrideSelector, AUTHOR_SELECTORS);
  const t = $match ? $match.text().trim().replace(/\s+/g, ' ') : '';
  // Deliberately unique per item, not a shared literal — see community.js
  // module doc comment on why this matters for distinct-user counts.
  return t || `Anonymous #${index + 1}`;
}

function extractDate($, $container, overrideSelector) {
  const $match = resolveField($, $container, overrideSelector, DATE_SELECTORS);
  if (!$match) return '';
  const raw = $match.attr('datetime') || $match.attr('content') || $match.text().trim();
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function extractEngagement($, $container) {
  const $match = $container.find(ENGAGEMENT_SELECTORS).first();
  return $match.length ? parseEngagementNumber($match.text()) : 0;
}

function extractLink($, $container, pageUrl) {
  const id = $container.attr('id');
  const $anchor = $container.find('a[href^="#"], a.permalink, a[href*="#comment"]').first();
  const href = $anchor.length ? $anchor.attr('href') : id ? `#${id}` : null;
  if (!href) return pageUrl;
  try {
    return new URL(href, pageUrl).toString();
  } catch (e) {
    return pageUrl;
  }
}

function findContainers($, overrideSelector) {
  if (overrideSelector) {
    return { $containers: $(overrideSelector), usedOverride: true };
  }
  for (const strategy of CONTAINER_STRATEGIES) {
    const $matches = $(strategy);
    if ($matches.length >= MIN_CONTAINER_MATCHES) {
      return { $containers: $matches, containerSelector: strategy, usedOverride: false };
    }
  }
  return { $containers: $(), usedOverride: false };
}

/**
 * @param {string} html
 * @param {{comment?: string, text?: string, author?: string, date?: string}=} selectors
 * @param {string} pageUrl
 * @param {string} pageTitleFallback
 */
function extractComments(html, selectors = {}, pageUrl, pageTitleFallback) {
  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().trim() || pageTitleFallback;

  const { $containers, containerSelector } = findContainers($, selectors.comment);
  const comments = [];

  $containers.slice(0, MAX_COMMENTS_PER_PAGE).each((index, el) => {
    const $container = $(el);
    const text = extractText($, $container, selectors.text, containerSelector);
    if (!text || text.length < TEXT_MIN_LEN) return; // no resolvable text — not counted, not invented
    const trimmedText = text.slice(0, TEXT_MAX_LEN);

    comments.push({
      id: uid('cm'),
      source: 'community',
      contentTitle: pageTitle,
      author: extractAuthor($, $container, selectors.author, index),
      text: trimmedText,
      date: extractDate($, $container, selectors.date),
      link: extractLink($, $container, pageUrl),
      sentiment: heuristics.sentiment(trimmedText),
      theme: heuristics.theme(trimmedText),
      engagement: extractEngagement($, $container),
    });
  });

  return comments;
}

/**
 * @param {import('./types').CollectQuery} query
 * @param {{COMMUNITY_USER_AGENT?: string}} creds
 * @returns {Promise<import('./types').CollectResult>}
 */
async function collect(query, creds) {
  const urls = query.communityUrls || [];
  if (!urls.length) {
    return { items: [], postCount: 0, status: 'skipped', errorMessage: 'No --community-urls provided.' };
  }

  const userAgent = creds.COMMUNITY_USER_AGENT || DEFAULT_USER_AGENT;
  const items = [];
  const notes = [];
  let pagesLoaded = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i > 0) await sleep(THROTTLE_MS);
    try {
      let pathname = url;
      try {
        pathname = new URL(url).pathname;
      } catch (e) {
        /* keep raw url as fallback title */
      }
      const html = await fetchPage(url, userAgent);
      pagesLoaded++;
      const comments = extractComments(html, query.communitySelectors, url, pathname);
      if (comments.length === 0) {
        notes.push(
          `"${url}": 0 comments auto-detected${query.communitySelectors?.comment ? ' with the given --comment-selector' : ''}.`
        );
      }
      items.push(...comments);
    } catch (e) {
      notes.push(`"${url}": ${e.message}`);
    }
  }

  const status = items.length > 0 ? (notes.length ? 'partial' : 'ok') : pagesLoaded > 0 ? 'ok' : 'error';

  return {
    items,
    postCount: urls.length,
    status,
    errorMessage: notes.length ? notes.join('; ') : undefined,
  };
}

module.exports = {
  id: 'community',
  label: 'Community site',
  requiredCredentials: [],
  collect,
};
