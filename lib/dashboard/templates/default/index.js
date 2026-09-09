const { fmtDate } = require('../../../utils/format');

const SOURCE_LABELS = { youtube: 'YouTube', twitter: 'Twitter/X', reddit: 'Reddit', community: 'Community' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n).trim()}…` : str;
}

function pct(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

// Comma-separated source list a card's evidence actually came from — read
// by both the CSS-free JS filter (data-sources="youtube,twitter") and, via
// sourceBreakdown's own counts, the small per-source tags in each card.
function sourcesAttr(breakdown) {
  return Object.keys(breakdown || {}).join(',');
}

// Segmented control for viewing a mixed-source dataset combined or narrowed
// to one source — only rendered when more than one source is present, so a
// single-source run's dashboard looks exactly as it did before this existed.
function filterBar(sources, bySource) {
  if (sources.length < 2) return '';
  const total = bySource.reduce((s, b) => s + b.total, 0);
  const btn = (value, label, count) =>
    `<button class="filter-btn${value === 'all' ? ' active' : ''}" data-filter-btn="${esc(value)}">${esc(label)} (${esc(count)})</button>`;
  const btns = [btn('all', 'All sources', total)].concat(
    sources.map((s) => {
      const b = bySource.find((x) => x.source === s);
      return btn(s, SOURCE_LABELS[s] || s, b ? b.total : 0);
    })
  );
  return `<div class="filter-bar" role="tablist" aria-label="Filter by source">${btns.join('')}</div>`;
}

// A ring chart built from three stroke-dasharray arcs on stacked <circle>
// elements — no charting library, just SVG. Used in Overview and regenerated
// client-side (mirrored in the inline <script>) whenever the source filter
// changes, so the percentage in the middle always matches what's on screen.
function sentimentDonutSVG(sentiment, size = 116) {
  const total = (sentiment.positive || 0) + (sentiment.negative || 0) + (sentiment.neutral || 0);
  const denom = total || 1;
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const segs = [
    [sentiment.positive || 0, 'var(--pos)'],
    [sentiment.negative || 0, 'var(--neg)'],
    [sentiment.neutral || 0, 'var(--neu)'],
  ];
  let acc = 0;
  const arcs = segs
    .map(([v, color]) => {
      const dash = (v / denom) * circumference;
      const el =
        dash > 0
          ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="13" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
          : '';
      acc += dash;
      return el;
    })
    .join('');
  const posPct = pct(sentiment.positive, denom);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Sentiment breakdown">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="13"/>
    ${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="19" font-weight="700" fill="var(--text)">${posPct}%</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="8.5" fill="var(--muted)">positive</text>
  </svg>`;
}

function sentimentBlockInner(sentiment) {
  const total = (sentiment.positive || 0) + (sentiment.negative || 0) + (sentiment.neutral || 0);
  return `<div class="sent-flex">
      ${sentimentDonutSVG(sentiment)}
      <div class="sent-legend">
        <div class="sent-legend-row"><span class="sent-dot pos"></span><b>${sentiment.positive || 0}</b> positive <span class="sent-legend-pct">(${pct(sentiment.positive, total)}%)</span></div>
        <div class="sent-legend-row"><span class="sent-dot neg"></span><b>${sentiment.negative || 0}</b> negative <span class="sent-legend-pct">(${pct(sentiment.negative, total)}%)</span></div>
        <div class="sent-legend-row"><span class="sent-dot neu"></span><b>${sentiment.neutral || 0}</b> neutral <span class="sent-legend-pct">(${pct(sentiment.neutral, total)}%)</span></div>
      </div>
    </div>`;
}

function miniSplitBar(pos, neg) {
  const total = pos + neg;
  if (!total) return `<div class="mini-bar"><div class="mini-seg neu" style="width:100%"></div></div>`;
  const p = pct(pos, total);
  return `<div class="mini-bar"><div class="mini-seg pos" style="width:${p}%"></div><div class="mini-seg neg" style="width:${100 - p}%"></div></div>`;
}

// Ranked horizontal bar chart above the Top Topics card grid. Each row
// carries data-sources (for the existing show/hide filter) and
// data-topic-bar (an index into the embedded DATA.topics array) so the
// inline <script> can recompute the bar width/value against the real
// per-source mention count when the source filter changes — never just
// hiding the bar and leaving a stale, all-source width behind.
function topicMentionsChart(topics) {
  if (!topics.length) return '';
  const max = Math.max(...topics.map((t) => t.mentions || 0), 1);
  const rows = topics
    .map((t, i) => {
      const w = Math.round(((t.mentions || 0) / max) * 100);
      return `
      <div class="tchart-row" data-topic-bar="${i}" data-sources="${esc(sourcesAttr(t.sourceBreakdown))}">
        <span class="tchart-label">${esc(t.topic)}</span>
        <div class="tchart-track"><div class="tchart-fill" style="width:${w}%"></div></div>
        <span class="tchart-value">${esc(t.mentions)}</span>
      </div>`;
    })
    .join('');
  return `<div class="tchart">${rows}</div>`;
}

// A YouTube comment's own citation link deep-links to that specific
// comment (`&lc=<id>`) — stripping that back off gives the plain video
// link, for a "watch the video" action distinct from "view this comment".
function videoLink(item) {
  if (item.source === 'youtube') return String(item.link || '').replace(/&lc=[^&]*/, '');
  return item.link;
}

// Only a YouTube link with `&lc=<id>` actually deep-links to one specific
// comment — without it (the no-API-key fallback collects comments with no
// stable per-comment id at all), item.link IS the video link, and labeling
// it "cite this comment" would be a lie. Every other source's `link` is
// already a genuine per-item permalink (Reddit permalink, tweet URL, a
// community page's best-effort in-page anchor), so those are always precise.
function citeInfo(item) {
  const isPreciseYoutube = item.source === 'youtube' && /[&?]lc=/.test(item.link || '');
  if (item.source === 'youtube' && !isPreciseYoutube) {
    return { href: videoLink(item), label: 'Watch video ↗', precise: false };
  }
  const sourceLabel = item.source === 'youtube' ? 'YouTube' : 'source';
  return { href: item.link, label: `Cite this comment on ${sourceLabel} →`, precise: true };
}

// One row inside an evidence modal: the real comment, a link to its
// video/thread, date, likes/engagement, and a citation link — precise
// (deep-links to the exact comment) when the source supports it, honestly
// labeled "watch video" instead when it doesn't (see citeInfo above), never
// mislabeled as a comment-level citation it can't actually deliver.
function evidenceRow(item) {
  const likesLabel = item.source === 'youtube' ? 'likes' : 'engagement';
  const vLink = videoLink(item);
  const cite = citeInfo(item);
  return `
    <div class="ev-row">
      <div class="ev-row-head">
        <span class="tag src-${esc(item.source)}">${esc(item.source)}</span>
        <span class="tag sent-${esc(item.sentiment)}">${esc(item.sentiment)}</span>
        ${vLink ? `<a class="ev-title" href="${esc(vLink)}" target="_blank" rel="noopener">${esc(truncate(item.contentTitle, 70))} ↗</a>` : `<span class="ev-title">${esc(truncate(item.contentTitle, 70))}</span>`}
      </div>
      <p class="ev-text">"${esc(item.text)}"</p>
      <div class="ev-row-foot">
        <span>${esc(item.author)} &middot; ${esc(fmtDate(item.date))} &middot; ${esc(item.engagement ?? 0)} ${likesLabel}</span>
        ${cite.precise && cite.href ? `<a href="${esc(cite.href)}" target="_blank" rel="noopener">${esc(cite.label)}</a>` : ''}
      </div>
    </div>`;
}

// One row in the "Videos analyzed" modal: title, direct link, and how many
// collected comments came from it.
function contentUnitRow(u) {
  return `
    <div class="ev-row">
      <div class="ev-row-head"><span class="tag src-${esc(u.source)}">${esc(u.source)}</span>${u.link ? `<a class="ev-title" href="${esc(u.link)}" target="_blank" rel="noopener">${esc(u.title)} ↗</a>` : `<span class="ev-title">${esc(u.title)}</span>`}</div>
      <div class="ev-row-foot"><span>${esc(u.count)} comment${u.count === 1 ? '' : 's'} collected</span></div>
    </div>`;
}

// A "View N comments" trigger. `group`/`index` address into the embedded
// EVIDENCE map client-side so the modal has real data to render — nothing
// is looked up or invented on the fly.
function evidenceButton(group, index, count, label = 'View comments') {
  if (!count) return '';
  return `<button class="ev-btn" data-evidence="${esc(group)}-${esc(index)}">${esc(label)} (${count})</button>`;
}

function overviewSection(ov) {
  const hasLinks = ov.contentUnits.some((u) => u.link);
  return `
  <section class="ov-section">
    <div class="ov-stats">
      <div class="ov-stat"><div class="ov-num" id="ov-total-comments">${esc(ov.totalComments)}</div><div class="ov-label">Comments analyzed</div></div>
      <div class="ov-stat ${hasLinks ? 'ov-stat-clickable' : ''}" ${hasLinks ? 'data-open-videos tabindex="0" role="button"' : ''}>
        <div class="ov-num">${esc(ov.totalContentUnits)}</div>
        <div class="ov-label">${esc(ov.contentUnitLabel)}${hasLinks ? ' — view links ↗' : ''}</div>
      </div>
      <div class="ov-stat"><div class="ov-num ov-num-sm">${esc(ov.dateRange)}</div><div class="ov-label">Date range</div></div>
    </div>
    <div class="ov-sentiment" id="ov-sentiment-block">${sentimentBlockInner(ov.sentiment)}</div>
    <div class="ov-callouts">
      <div class="callout"><div class="callout-label">Top discussed topic</div><div class="callout-value">${esc(ov.topDiscussedTopic)}</div></div>
      <div class="callout neg"><div class="callout-label">Biggest pain point</div><div class="callout-value">${esc(ov.biggestPainPoint)}</div></div>
      <div class="callout rec"><div class="callout-label">Most requested improvement</div><div class="callout-value">${esc(ov.mostRequestedImprovement)}</div></div>
    </div>
  </section>`;
}

function topTopicsSection(topics) {
  if (!topics.length) return sectionEmpty('2. Top Topics / Features', 'No clear topics found in this data yet.');
  const chart = topicMentionsChart(topics);
  const cards = topics
    .map(
      (t, i) => `
      <div class="topic-card" data-sources="${esc(sourcesAttr(t.sourceBreakdown))}">
        <div class="topic-head"><span class="topic-name">${esc(t.topic)}</span><span class="topic-mentions">${esc(t.mentions)} mention${t.mentions === 1 ? '' : 's'}</span></div>
        ${miniSplitBar(t.positive || 0, t.negative || 0)}
        <div class="topic-foot"><span>${t.positive || 0} pos &middot; ${t.negative || 0} neg</span>${evidenceButton('topic', i, t.evidence.length, 'View')}</div>
      </div>`
    )
    .join('');
  return `
  <section>
    <h2>2. Top Topics / Features</h2>
    ${chart}
    <div class="topic-grid" data-card-container>${cards}</div>
    <p class="filter-empty" hidden>No comments from this source for any topic.</p>
  </section>`;
}

// Shared card renderer for Pain Points / What Users Love / User Requests —
// same shape: a specific description, mention count, a real representative
// comment, and a link to the full supporting evidence.
function insightListSection({ title, items, group, textField, tone, emptyText, showRelatedTopic }) {
  if (!items.length) return sectionEmpty(title, emptyText);
  const cards = items
    .map(
      (it, i) => `
      <div class="insight-card ${tone}" data-sources="${esc(sourcesAttr(it.sourceBreakdown))}">
        <div class="insight-head">
          <p class="insight-text">${esc(it[textField])}</p>
          <span class="insight-mentions">${esc(it.mentions)} mention${it.mentions === 1 ? '' : 's'}</span>
        </div>
        ${showRelatedTopic && it.relatedTopic ? `<div class="insight-related">Related: ${esc(it.relatedTopic)}</div>` : ''}
        ${
          it.representative
            ? `<p class="insight-quote">"${esc(truncate(it.representative.text, 220))}" <span class="insight-quote-author">— ${esc(it.representative.author)}</span>${
                it.representative.link
                  ? ` <a class="insight-cite" href="${esc(citeInfo(it.representative).href)}" target="_blank" rel="noopener">${citeInfo(it.representative).precise ? 'cite' : 'watch video'} ↗</a>`
                  : ''
              }</p>`
            : ''
        }
        <div class="insight-foot">${evidenceButton(group, i, it.evidence.length, 'View supporting comments')}</div>
      </div>`
    )
    .join('');
  return `
  <section>
    <h2>${esc(title)}</h2>
    <div class="insight-list" data-card-container>${cards}</div>
    <p class="filter-empty" hidden>${esc(`No comments from this source for "${title}".`)}</p>
  </section>`;
}

function recommendationsSection(recs) {
  if (!recs.length) {
    return sectionEmpty(
      '6. PM Recommendations',
      'No PM recommendations yet — these require the AI agent\'s own read of the comments, not just local heuristics.'
    );
  }
  const cards = recs
    .map(
      (r, i) => `
      <div class="rec-card" data-sources="${esc(sourcesAttr(r.sourceBreakdown))}">
        <div class="rec-row"><span class="rec-label">User signal</span><p>${esc(r.signal)}</p></div>
        <div class="rec-row"><span class="rec-label">Insight</span><p>${esc(r.insight)}</p></div>
        <div class="rec-row"><span class="rec-label">PM action</span><p>${esc(r.action)}</p></div>
        <div class="insight-foot">${evidenceButton('rec', i, r.evidence.length, 'View evidence')}</div>
      </div>`
    )
    .join('');
  return `
  <section>
    <h2>6. PM Recommendations</h2>
    <div class="rec-list" data-card-container>${cards}</div>
    <p class="filter-empty" hidden>No comments from this source behind any recommendation.</p>
  </section>`;
}

function sectionEmpty(title, text) {
  return `
  <section>
    <h2>${esc(title)}</h2>
    <div class="col-empty">${esc(text)}</div>
  </section>`;
}

// Sits above the numbered sections — the handful of findings a PM or leader
// most needs to walk away with. Same evidence-traceability rule as every
// other card: no fabricated summary text, every finding backed by real
// itemIds. No local fallback (same reasoning as PM Recommendations) — this
// requires the agent's own judgment about what matters most.
function executiveSummarySection(summary) {
  if (!summary.length) return '';
  const items = summary
    .map(
      (s, i) => `
      <li class="summary-item" data-sources="${esc(sourcesAttr(s.sourceBreakdown))}">
        <p class="summary-text">${esc(s.finding)}</p>
        <div class="insight-foot">${evidenceButton('summary', i, s.evidence.length, 'View supporting comments')}</div>
      </li>`
    )
    .join('');
  return `
  <section class="exec-summary">
    <h2>Executive Summary</h2>
    <ul class="summary-list" data-card-container>${items}</ul>
    <p class="filter-empty" hidden>No comments from this source behind any executive summary finding.</p>
  </section>`;
}

function render({ report, datasets }) {
  const topic = datasets[0].manifestEntry.topic;
  const analysisTopic = datasets[0].manifestEntry.analysisTopic || null;
  const displayTitle = analysisTopic || topic;
  const allItems = datasets.flatMap((d) => d.items);
  const sources = [...new Set(allItems.map((i) => i.source))];
  const pm = report.pmDashboard;

  // Every evidence group a "View comments" button can open, keyed the same
  // way the buttons are (`${group}-${index}`) — all real, already-collected
  // items, nothing computed client-side.
  const evidenceGroups = {};
  pm.executiveSummary.forEach((s, i) => (evidenceGroups[`summary-${i}`] = { title: `${s.finding} — ${s.evidence.length} comment(s)`, items: s.evidence }));
  pm.topTopics.forEach((t, i) => (evidenceGroups[`topic-${i}`] = { title: `${t.topic} — ${t.evidence.length} comment(s)`, items: t.evidence }));
  pm.painPoints.forEach((p, i) => (evidenceGroups[`pain-${i}`] = { title: `${p.description} — ${p.evidence.length} comment(s)`, items: p.evidence }));
  pm.loves.forEach((l, i) => (evidenceGroups[`love-${i}`] = { title: `${l.description} — ${l.evidence.length} comment(s)`, items: l.evidence }));
  pm.requests.forEach((r, i) => (evidenceGroups[`req-${i}`] = { title: `${r.request} — ${r.evidence.length} comment(s)`, items: r.evidence }));
  pm.recommendations.forEach((r, i) => (evidenceGroups[`rec-${i}`] = { title: `Evidence — ${r.evidence.length} comment(s)`, items: r.evidence }));

  const embeddedData = JSON.stringify({
    evidenceGroups,
    bySource: pm.overview.bySource,
    totalComments: pm.overview.totalComments,
    sentiment: pm.overview.sentiment,
    // Per-topic mention count + real sourceBreakdown so the topic mentions
    // chart can be recomputed exactly (not just hidden/shown) on filter.
    topics: pm.topTopics.map((t) => ({ mentions: t.mentions, sourceBreakdown: t.sourceBreakdown })),
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BuzzLens — ${esc(displayTitle)}</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #131826; --border: #232b3d; --text: #e6e9f0; --muted: #93a0b8;
    --pos: #34c98a; --neg: #e35d6a; --neu: #7c8aa5; --accent: #5b8def; --rec: #c99a3a;
    --pos-bg: #12241d; --neg-bg: #271418; --rec-bg: #26200f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .dashboard { max-width: 980px; margin: 0 auto; padding: 24px 20px 60px; }
  header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
  header h1 { font-size: 21px; margin: 0; }
  header .sub { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  .badge { display: inline-block; font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: var(--accent); color: #fff; margin-left: 6px; vertical-align: middle; }
  .badge.local { background: var(--neu); }
  .notice-banner { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--rec); border-radius: 8px; padding: 10px 14px; font-size: 12.5px; color: var(--muted); margin-bottom: 20px; }

  .exec-summary { margin-bottom: 26px; }
  .exec-summary h2 { font-size: 16px; }
  .summary-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .summary-item { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 10px; padding: 14px 16px; }
  .summary-text { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.45; }

  .filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; }
  .filter-btn { background: var(--panel); border: 1px solid var(--border); color: var(--muted); border-radius: 999px; padding: 5px 13px; font-size: 12px; cursor: pointer; }
  .filter-btn:hover { border-color: var(--accent); color: var(--text); }
  .filter-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .filtered-out { display: none !important; }
  .filter-empty { color: var(--muted); font-size: 12px; font-style: italic; margin-top: 8px; }

  section { margin-bottom: 30px; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  .col-empty { color: var(--muted); font-size: 12.5px; font-style: italic; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }

  /* Overview */
  .ov-stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .ov-stat { flex: 1 1 160px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; }
  .ov-stat-clickable { cursor: pointer; }
  .ov-stat-clickable:hover, .ov-stat-clickable:focus { border-color: var(--accent); outline: none; }
  .ov-stat-clickable .ov-label { color: var(--accent); }
  .ov-num { font-size: 22px; font-weight: 700; }
  .ov-num-sm { font-size: 15px; font-weight: 600; }
  .ov-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; margin-top: 2px; }
  .ov-sentiment { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .sent-flex { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  .sent-legend { display: flex; flex-direction: column; gap: 7px; font-size: 12.5px; color: var(--muted); }
  .sent-legend-row { display: flex; align-items: center; gap: 7px; }
  .sent-legend-row b { color: var(--text); }
  .sent-legend-pct { color: var(--muted); }
  .sent-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
  .sent-dot.pos { background: var(--pos); } .sent-dot.neg { background: var(--neg); } .sent-dot.neu { background: var(--neu); }
  .ov-callouts { display: flex; gap: 12px; flex-wrap: wrap; }
  .callout { flex: 1 1 220px; background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; padding: 10px 14px; }
  .callout.neg { border-left-color: var(--neg); }
  .callout.rec { border-left-color: var(--rec); }
  .callout-label { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); margin-bottom: 3px; }
  .callout-value { font-size: 13.5px; font-weight: 600; }

  /* Top topics */
  .tchart { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .tchart-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
  .tchart-label { flex: 0 0 140px; color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tchart-track { flex: 1 1 auto; background: var(--border); border-radius: 4px; height: 8px; overflow: hidden; }
  .tchart-fill { height: 100%; border-radius: 4px; background: var(--accent); }
  .tchart-value { flex: 0 0 32px; text-align: right; color: var(--muted); }
  .topic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .topic-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .topic-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 6px; }
  .topic-name { font-weight: 600; font-size: 13.5px; }
  .topic-mentions { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .mini-bar { display: flex; height: 6px; border-radius: 4px; overflow: hidden; background: var(--border); margin-bottom: 6px; }
  .mini-seg.pos { background: var(--pos); } .mini-seg.neg { background: var(--neg); } .mini-seg.neu { background: var(--neu); }
  .topic-foot { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--muted); }

  /* Pain points / loves / requests */
  .insight-list { display: flex; flex-direction: column; gap: 10px; }
  .insight-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; border-left: 3px solid var(--border); }
  .insight-card.neg { border-left-color: var(--neg); }
  .insight-card.pos { border-left-color: var(--pos); }
  .insight-card.rec { border-left-color: var(--rec); }
  .insight-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .insight-text { font-weight: 600; font-size: 13.5px; margin: 0; }
  .insight-mentions { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .insight-related { font-size: 11px; color: var(--accent); margin-top: 4px; }
  .insight-quote { font-size: 12.5px; color: var(--muted); margin: 8px 0 0; font-style: italic; }
  .insight-quote-author { font-style: normal; }
  .insight-cite { font-style: normal; color: var(--accent); text-decoration: none; }
  .insight-cite:hover { text-decoration: underline; }
  .insight-foot { margin-top: 8px; }

  /* Recommendations */
  .rec-list { display: flex; flex-direction: column; gap: 12px; }
  .rec-card { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--rec); border-radius: 10px; padding: 14px 16px; }
  .rec-row { margin-bottom: 8px; }
  .rec-row:last-of-type { margin-bottom: 0; }
  .rec-row p { margin: 2px 0 0; font-size: 13px; }
  .rec-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--rec); font-weight: 600; }

  .ev-btn { background: transparent; color: var(--accent); border: 1px solid var(--border); border-radius: 6px; padding: 5px 11px; font-size: 11.5px; cursor: pointer; }
  .ev-btn:hover { border-color: var(--accent); }

  .tag { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
  .tag.sent-positive { color: var(--pos); border-color: var(--pos); }
  .tag.sent-negative { color: var(--neg); border-color: var(--neg); }
  .tag.sent-neutral { color: var(--neu); border-color: var(--neu); }

  footer { color: var(--muted); font-size: 11px; text-align: center; margin-top: 30px; }

  /* Modal */
  .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 50; align-items: center; justify-content: center; padding: 24px; }
  .modal-backdrop.open { display: flex; }
  .modal { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 720px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
  .modal-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
  .modal-head h3 { margin: 0; font-size: 14.5px; }
  .modal-body { padding: 14px 18px; overflow-y: auto; flex: 1 1 auto; }
  .modal-close { background: transparent; border: none; color: var(--muted); font-size: 18px; cursor: pointer; padding: 0 4px; }
  .ev-row { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
  .ev-row-head { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
  .ev-title { font-size: 11px; color: var(--muted); }
  a.ev-title { color: var(--accent); text-decoration: none; }
  a.ev-title:hover { text-decoration: underline; }
  .ev-text { font-size: 13px; margin: 0 0 6px; }
  .ev-row-foot { display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 11px; gap: 10px; flex-wrap: wrap; }
  .ev-row-foot a { color: var(--accent); text-decoration: none; }

  @media (max-width: 640px) {
    .ov-stats, .ov-callouts { flex-direction: column; }
    .sent-flex { justify-content: center; }
    .tchart-label { flex-basis: 90px; }
  }
</style>
</head>
<body>
<div class="dashboard">
  <header>
    <div>
      <h1>${esc(displayTitle)} <span class="badge ${pm.hasAgentInsights ? '' : 'local'}">${pm.hasAgentInsights ? 'AI agent analysis' : 'Preliminary local analysis'}</span></h1>
      <div class="sub">${analysisTopic ? `Analysis focus, searched under &quot;${esc(topic)}&quot; &middot; ` : ''}Sources: ${esc(sources.join(', ') || 'none')}</div>
    </div>
  </header>

  ${filterBar(sources, pm.overview.bySource)}

  ${
    pm.hasAgentInsights
      ? ''
      : `<div class="notice-banner">This is a preliminary view built from local keyword/theme heuristics only. Ask the AI agent that collected this data to read the comments and save its analysis for topic names, pain points, and PM recommendations grounded in what people actually said.</div>`
  }

  ${executiveSummarySection(pm.executiveSummary)}

  <h2 style="margin-bottom:12px">1. Overview</h2>
  ${overviewSection(pm.overview)}

  ${topTopicsSection(pm.topTopics)}

  ${insightListSection({
    title: '3. Top Pain Points',
    items: pm.painPoints,
    group: 'pain',
    textField: 'description',
    tone: 'neg',
    emptyText: 'No clear pain points found in this data yet.',
  })}

  ${insightListSection({
    title: '4. What Users Love',
    items: pm.loves,
    group: 'love',
    textField: 'description',
    tone: 'pos',
    emptyText: 'No clearly positive themes found in this data yet.',
  })}

  ${insightListSection({
    title: '5. User Requests / Suggestions',
    items: pm.requests,
    group: 'req',
    textField: 'request',
    tone: 'rec',
    emptyText: 'No explicit feature requests found in this data yet.',
    showRelatedTopic: true,
  })}

  ${recommendationsSection(pm.recommendations)}

  <footer>Every card above is grounded in real collected comments — use "View comments" / "View evidence" to see the source. ${pm.hasAgentInsights ? 'Written by the AI agent that ran BuzzLens.' : 'No AI analysis has been saved for this dataset yet.'}</footer>
</div>

<div class="modal-backdrop" id="modal-evidence">
  <div class="modal">
    <div class="modal-head"><h3 id="modal-evidence-title"></h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body" id="modal-evidence-body"></div>
  </div>
</div>

<div class="modal-backdrop" id="modal-videos">
  <div class="modal">
    <div class="modal-head"><h3>${esc(pm.overview.contentUnitLabel)}</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body">${pm.overview.contentUnits.map(contentUnitRow).join('') || '<p>None collected.</p>'}</div>
  </div>
</div>

<script id="buzzlens-data" type="application/json">${embeddedData}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('buzzlens-data').textContent);

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function videoLink(item) {
    if (item.source === 'youtube') return String(item.link || '').replace(/&lc=[^&]*/, '');
    return item.link;
  }
  // Mirrors citeInfo() server-side: only a YouTube link with &lc=<id> is a
  // true per-comment citation; without it, item.link IS just the video
  // link, so it's labeled "watch video" instead of falsely "cite".
  function citeInfo(item) {
    var isPreciseYoutube = item.source === 'youtube' && /[&?]lc=/.test(item.link || '');
    if (item.source === 'youtube' && !isPreciseYoutube) {
      return { href: videoLink(item), label: 'Watch video ↗', precise: false };
    }
    var sourceLabel = item.source === 'youtube' ? 'YouTube' : 'source';
    return { href: item.link, label: 'Cite this comment on ' + sourceLabel + ' →', precise: true };
  }
  function renderEvidenceRow(item) {
    var likesLabel = item.source === 'youtube' ? 'likes' : 'engagement';
    var vLink = videoLink(item);
    var cite = citeInfo(item);
    var titleHtml = vLink
      ? '<a class="ev-title" href="' + esc(vLink) + '" target="_blank" rel="noopener">' + esc(item.contentTitle || '') + ' ↗</a>'
      : '<span class="ev-title">' + esc(item.contentTitle || '') + '</span>';
    return '<div class="ev-row"><div class="ev-row-head">' +
      '<span class="tag src-' + esc(item.source) + '">' + esc(item.source) + '</span>' +
      '<span class="tag sent-' + esc(item.sentiment) + '">' + esc(item.sentiment) + '</span>' +
      titleHtml +
      '</div><p class="ev-text">"' + esc(item.text) + '"</p>' +
      '<div class="ev-row-foot"><span>' + esc(item.author) + ' &middot; ' + esc(item.date ? item.date.slice(0,10) : '') + ' &middot; ' + esc(item.engagement || 0) + ' ' + likesLabel + '</span>' +
      (cite.precise && cite.href ? '<a href="' + esc(cite.href) + '" target="_blank" rel="noopener">' + esc(cite.label) + '</a>' : '') + '</div></div>';
  }

  function openModal(id) { document.getElementById(id).classList.add('open'); }
  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { btn.closest('.modal-backdrop').classList.remove('open'); });
  });
  document.querySelectorAll('.modal-backdrop').forEach(function (bd) {
    bd.addEventListener('click', function (e) { if (e.target === bd) bd.classList.remove('open'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(function (bd) { bd.classList.remove('open'); });
  });

  document.querySelectorAll('[data-open-videos]').forEach(function (el) {
    el.addEventListener('click', function () { openModal('modal-videos'); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal('modal-videos'); } });
  });

  var currentFilter = 'all';

  document.querySelectorAll('[data-evidence]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-evidence');
      var group = DATA.evidenceGroups[key];
      if (!group) return;
      var items = currentFilter === 'all' ? group.items : group.items.filter(function (i) { return i.source === currentFilter; });
      document.getElementById('modal-evidence-title').textContent = group.title + (currentFilter === 'all' ? '' : ' — filtered to ' + currentFilter);
      document.getElementById('modal-evidence-body').innerHTML = items.map(renderEvidenceRow).join('') || '<p>No supporting comments from this source.</p>';
      openModal('modal-evidence');
    });
  });

  // --- Source filter (only present when the dataset mixes more than one source) ---

  function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

  // Mirrors sentimentDonutSVG() server-side.
  function sentimentDonutSVG(sentiment) {
    var size = 116, r = size / 2 - 12, cx = size / 2, cy = size / 2;
    var total = (sentiment.positive || 0) + (sentiment.negative || 0) + (sentiment.neutral || 0);
    var denom = total || 1;
    var circumference = 2 * Math.PI * r;
    var segs = [[sentiment.positive || 0, 'var(--pos)'], [sentiment.negative || 0, 'var(--neg)'], [sentiment.neutral || 0, 'var(--neu)']];
    var acc = 0, arcs = '';
    for (var i = 0; i < segs.length; i++) {
      var v = segs[i][0], color = segs[i][1];
      var dash = (v / denom) * circumference;
      if (dash > 0) {
        arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="13" stroke-dasharray="' + dash.toFixed(2) + ' ' + (circumference - dash).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      }
      acc += dash;
    }
    var posPct = pct(sentiment.positive, denom);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Sentiment breakdown">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="13"/>' + arcs +
      '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="19" font-weight="700" fill="var(--text)">' + posPct + '%</text>' +
      '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="8.5" fill="var(--muted)">positive</text></svg>';
  }

  function sentimentBlockInner(sentiment) {
    var total = (sentiment.positive || 0) + (sentiment.negative || 0) + (sentiment.neutral || 0);
    return '<div class="sent-flex">' + sentimentDonutSVG(sentiment) +
      '<div class="sent-legend">' +
      '<div class="sent-legend-row"><span class="sent-dot pos"></span><b>' + (sentiment.positive || 0) + '</b> positive <span class="sent-legend-pct">(' + pct(sentiment.positive, total) + '%)</span></div>' +
      '<div class="sent-legend-row"><span class="sent-dot neg"></span><b>' + (sentiment.negative || 0) + '</b> negative <span class="sent-legend-pct">(' + pct(sentiment.negative, total) + '%)</span></div>' +
      '<div class="sent-legend-row"><span class="sent-dot neu"></span><b>' + (sentiment.neutral || 0) + '</b> neutral <span class="sent-legend-pct">(' + pct(sentiment.neutral, total) + '%)</span></div>' +
      '</div></div>';
  }

  function applyFilter(src) {
    currentFilter = src;

    document.querySelectorAll('[data-sources]').forEach(function (el) {
      var list = (el.getAttribute('data-sources') || '').split(',').filter(Boolean);
      el.classList.toggle('filtered-out', src !== 'all' && list.indexOf(src) === -1);
    });

    document.querySelectorAll('[data-card-container]').forEach(function (container) {
      var cards = container.querySelectorAll('[data-sources]');
      var anyVisible = Array.prototype.some.call(cards, function (c) { return !c.classList.contains('filtered-out'); });
      var emptyMsg = container.nextElementSibling;
      if (emptyMsg && emptyMsg.classList.contains('filter-empty')) {
        emptyMsg.hidden = cards.length === 0 || anyVisible;
      }
    });

    document.querySelectorAll('[data-filter-btn]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-filter-btn') === src);
    });

    var totalEl = document.getElementById('ov-total-comments');
    var sentBlock = document.getElementById('ov-sentiment-block');
    if (src === 'all') {
      if (totalEl) totalEl.textContent = DATA.totalComments;
      if (sentBlock) sentBlock.innerHTML = sentimentBlockInner(DATA.sentiment);
    } else {
      var srcData = (DATA.bySource || []).filter(function (b) { return b.source === src; })[0] || { total: 0, positive: 0, negative: 0 };
      if (totalEl) totalEl.textContent = srcData.total;
      if (sentBlock) sentBlock.innerHTML = sentimentBlockInner({ positive: srcData.positive, negative: srcData.negative, neutral: srcData.total - srcData.positive - srcData.negative });
    }

    // Topic mentions chart: recompute each bar's real value from its own
    // sourceBreakdown (not just hide/show) so widths never go stale.
    if (DATA.topics && DATA.topics.length) {
      var visibleValues = [];
      document.querySelectorAll('[data-topic-bar]').forEach(function (row) {
        var idx = parseInt(row.getAttribute('data-topic-bar'), 10);
        var t = DATA.topics[idx];
        if (!t) return;
        var v = src === 'all' ? (t.mentions || 0) : ((t.sourceBreakdown || {})[src] || 0);
        row.setAttribute('data-value', v);
        if (v > 0) visibleValues.push(v);
      });
      var maxV = Math.max.apply(null, visibleValues.length ? visibleValues : [1]);
      document.querySelectorAll('[data-topic-bar]').forEach(function (row) {
        var v = parseInt(row.getAttribute('data-value') || '0', 10);
        var fill = row.querySelector('.tchart-fill');
        var valueEl = row.querySelector('.tchart-value');
        if (fill) fill.style.width = (maxV ? Math.round((v / maxV) * 100) : 0) + '%';
        if (valueEl) valueEl.textContent = v;
      });
    }
  }

  document.querySelectorAll('[data-filter-btn]').forEach(function (btn) {
    btn.addEventListener('click', function () { applyFilter(btn.getAttribute('data-filter-btn')); });
  });
})();
</script>
</body>
</html>`;
}

module.exports = { render };
