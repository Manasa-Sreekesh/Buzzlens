// Default search window is 30 days. 7days and 15days are available for the
// user to narrow it, and custom for an exact range.
const DEFAULT_TIME_PERIOD = '30days';

const PERIOD_MS = {
  '24hours': 86400000,
  '7days': 7 * 86400000,
  '15days': 15 * 86400000,
  '30days': 30 * 86400000,
};

// Returns { sinceISO, untilISO } for a query's time period, used to build
// source-specific date filters (YouTube publishedAfter, Reddit's `t=` window).
function resolveRange({ timePeriod, customStart, customEnd }) {
  const now = new Date();
  if (timePeriod === 'custom' && customStart && customEnd) {
    return { sinceISO: new Date(customStart).toISOString(), untilISO: new Date(customEnd).toISOString() };
  }
  const ms = PERIOD_MS[timePeriod] || PERIOD_MS[DEFAULT_TIME_PERIOD];
  return { sinceISO: new Date(now.getTime() - ms).toISOString(), untilISO: now.toISOString() };
}

// Maps a BuzzLens time period to Reddit's `t=` search window parameter.
// Reddit only offers day/week/month/year/all buckets, so 15days is served
// from the month bucket (a superset) and then filtered precisely client-side
// in the Reddit collector using resolveRange's sinceISO/untilISO.
function toRedditWindow(timePeriod) {
  return { '24hours': 'day', '7days': 'week', '15days': 'month', '30days': 'month', custom: 'all' }[timePeriod] || 'month';
}

module.exports = { resolveRange, toRedditWindow, DEFAULT_TIME_PERIOD, PERIOD_MS };
