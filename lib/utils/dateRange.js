const PERIOD_MS = {
  '24hours': 86400000,
  '7days': 7 * 86400000,
  '30days': 30 * 86400000,
};

// Returns { sinceISO, untilISO } for a query's time period, used to build
// source-specific date filters (YouTube publishedAfter, Reddit's `t=` window).
function resolveRange({ timePeriod, customStart, customEnd }) {
  const now = new Date();
  if (timePeriod === 'custom' && customStart && customEnd) {
    return { sinceISO: new Date(customStart).toISOString(), untilISO: new Date(customEnd).toISOString() };
  }
  const ms = PERIOD_MS[timePeriod] || PERIOD_MS['7days'];
  return { sinceISO: new Date(now.getTime() - ms).toISOString(), untilISO: now.toISOString() };
}

// Maps a BuzzLens time period to Reddit's `t=` search window parameter.
function toRedditWindow(timePeriod) {
  return { '24hours': 'day', '7days': 'week', '30days': 'month', custom: 'all' }[timePeriod] || 'week';
}

module.exports = { resolveRange, toRedditWindow };
