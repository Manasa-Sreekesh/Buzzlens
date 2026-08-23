// Some collectors (e.g. community-site scraping) can't always resolve a
// date and pass through '' rather than guessing — render that as blank
// instead of the literal string "Invalid Date".
function fmtDate(d) {
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d) {
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtCompactTimestamp(d = new Date()) {
  // e.g. 2026-08-16T020000Z — filesystem/URL-safe, sortable.
  return new Date(d).toISOString().replace(/[:.]/g, '').replace(/\d{3}Z$/, 'Z');
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

module.exports = { fmtDate, fmtDateTime, fmtCompactTimestamp, fmt };
