// Default search window is 12 months. 24hours/7days/15days/30days are
// available for the user to narrow it, and custom for an exact range.
const DEFAULT_TIME_PERIOD = '12months';

const PERIOD_MS = {
  '24hours': 86400000,
  '7days': 7 * 86400000,
  '15days': 15 * 86400000,
  '30days': 30 * 86400000,
  '12months': 365 * 86400000,
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
// Reddit only offers day/week/month/year/all buckets, so 15days/30days are
// served from the month bucket (a superset) and then filtered precisely
// client-side in the Reddit collector using resolveRange's sinceISO/untilISO.
function toRedditWindow(timePeriod) {
  return (
    { '24hours': 'day', '7days': 'week', '15days': 'month', '30days': 'month', '12months': 'year', custom: 'all' }[
      timePeriod
    ] || 'year'
  );
}

// Prose form, used in search.js's log lines ("Researching X — the last 12 months").
const TIME_PERIOD_LABELS = {
  '24hours': 'the last 24 hours',
  '7days': 'the last 7 days',
  '15days': 'the last 15 days',
  '30days': 'the last 30 days',
  '12months': 'the last 12 months',
  custom: 'a custom date range',
};

// Short form, used on the dashboard's "Date range" stat tile.
const TIME_PERIOD_SHORT_LABELS = {
  '24hours': 'Last 24 hours',
  '7days': 'Last 7 days',
  '15days': 'Last 15 days',
  '30days': 'Last 30 days',
  '12months': 'Last 12 months',
};

// The dashboard shows the *requested* window (e.g. "Last 12 months"), not
// the actual min/max dates of whatever items happened to come back — a
// narrower observed spread (e.g. a quiet week within a 12-month search)
// shouldn't read as if a narrower window was searched.
function formatTimePeriodLabel({ timePeriod, customStart, customEnd }) {
  if (timePeriod === 'custom' && customStart && customEnd) {
    return `${customStart} to ${customEnd}`;
  }
  return TIME_PERIOD_SHORT_LABELS[timePeriod] || TIME_PERIOD_SHORT_LABELS[DEFAULT_TIME_PERIOD];
}

module.exports = {
  resolveRange,
  toRedditWindow,
  DEFAULT_TIME_PERIOD,
  PERIOD_MS,
  TIME_PERIOD_LABELS,
  formatTimePeriodLabel,
};
