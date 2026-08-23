const { fmtDateTime, fmtDate } = require('../../../utils/format');

const MAX_TABLE_ITEMS = 2000;

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

// Very small markdown-ish -> HTML pass for LLM/heuristic narrative text:
// numbered/`##` headings, **bold**, blank-line paragraphs. Deliberately
// minimal — this is prose from a grounded analysis, not arbitrary markdown.
function renderNarrative(text) {
  const lines = String(text || '').split(/\r?\n/);
  let html = '';
  let para = [];
  const flush = () => {
    if (para.length) {
      html += `<p>${para.join(' ')}</p>`;
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,3}|\d{1,2}\.)\s+(.*)/);
    if (heading) {
      flush();
      html += `<h4>${esc(heading[2])}</h4>`;
      continue;
    }
    const bolded = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    para.push(bolded);
  }
  flush();
  return html;
}

function sentimentBar(sentiment) {
  const total = (sentiment.positive || 0) + (sentiment.negative || 0) + (sentiment.neutral || 0) || 1;
  const p = Math.round((sentiment.positive / total) * 100);
  const n = Math.round((sentiment.negative / total) * 100);
  const u = 100 - p - n;
  return `
    <div class="sent-bar">
      <div class="sent-seg pos" style="width:${p}%" title="Positive ${p}%"></div>
      <div class="sent-seg neg" style="width:${n}%" title="Negative ${n}%"></div>
      <div class="sent-seg neu" style="width:${u}%" title="Neutral ${u}%"></div>
    </div>`;
}

// "143 comments from 5 videos" / "87 posts &amp; comments from 14 threads" / "62 tweets"
function formatSourceCount(source, counts) {
  if (!counts) return '';
  const c = counts.comments ?? 0;
  const p = counts.posts ?? 0;
  if (source === 'youtube') return `${c} comments from ${p} video${p === 1 ? '' : 's'}`;
  if (source === 'reddit') return `${c} posts/comments from ${p} thread${p === 1 ? '' : 's'}`;
  if (source === 'twitter') return `${c} tweets`;
  if (source === 'community') return `${c} comments from ${p} page${p === 1 ? '' : 's'}`;
  return `${c} items`;
}

function statTile(num, label) {
  return `<div class="stat-tile"><div class="num">${esc(num)}</div><div class="label">${esc(label)}</div></div>`;
}

// A clickable snippet card: theme, distinct-user count, one preview quote.
// Full member list opens in a modal via data-cluster-id (client-side JS
// looks it up in the embedded JSON — no extra request).
function clusterCard(cluster, clusterId, tone) {
  const preview = cluster.items[0];
  return `
    <div class="cluster-card ${tone}" data-open-cluster="${esc(clusterId)}" tabindex="0" role="button">
      <div class="cluster-head">
        <span class="cluster-theme">${esc(cluster.theme)}</span>
        <span class="cluster-users">${cluster.userCount} user${cluster.userCount === 1 ? '' : 's'}</span>
      </div>
      ${preview ? `<p class="cluster-quote">"${esc(truncate(preview.text, 130))}"</p>` : ''}
      <div class="cluster-foot">See all ${cluster.count} →</div>
    </div>`;
}

function clusterColumn({ title, icon, clusters, tone, prefix, emptyText }) {
  if (!clusters.length) {
    return `<div class="col-empty">${esc(emptyText)}</div>`;
  }
  return clusters.map((c, i) => clusterCard(c, `${prefix}-${i}`, tone)).join('');
}

function topQuoteChip(item) {
  return `
    <div class="quote-chip">
      <div class="item-row-head"><span class="tag src-${esc(item.source)}">${esc(item.source)}</span><span class="tag sent-${esc(item.sentiment)}">${esc(item.sentiment)}</span></div>
      <p class="item-text">"${esc(truncate(item.text, 100))}"</p>
      <div class="item-row-foot"><span>${esc(item.author)}</span>${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener">source</a>` : ''}</div>
    </div>`;
}

function dataTableRows(items) {
  return items
    .slice(0, MAX_TABLE_ITEMS)
    .map(
      (i) => `
      <tr data-source="${esc(i.source)}" data-sentiment="${esc(i.sentiment)}" data-theme="${esc(i.theme)}">
        <td>${esc(i.source)}</td>
        <td class="title-cell">${esc(i.contentTitle)}</td>
        <td class="text-cell">${esc(i.text)}</td>
        <td>${esc(fmtDate(i.date))}</td>
        <td><span class="tag sent-${esc(i.sentiment)}">${esc(i.sentiment)}</span></td>
        <td>${esc(i.theme)}</td>
        <td>${esc(i.engagement)}</td>
        <td>${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">link</a>` : ''}</td>
      </tr>`
    )
    .join('');
}

function badgeLabel(report) {
  if (report.provider === 'agent') return 'Written by your AI agent';
  if (report.usedLLM) return `AI via ${report.provider}`;
  return 'Local heuristic';
}

function footerLine(report) {
  if (report.provider === 'agent') return 'This analysis was written by the AI coding agent that ran BuzzLens — no external API call was made by BuzzLens itself.';
  if (report.usedLLM) return `Dataset content was sent to ${report.provider} for this analysis.`;
  return 'No external LLM was used for this analysis — everything above was computed locally.';
}

function render({ report, datasets }, opts = {}) {
  const interactive = Boolean(opts.interactive);
  const topic = datasets[0].manifestEntry.topic;
  const allItems = datasets.flatMap((d) => d.items);
  const sources = [...new Set(allItems.map((i) => i.source))];
  const truncated = allItems.length > MAX_TABLE_ITEMS;

  // Everything the client-side modals/Q&A need, all already-collected data —
  // no field here is invented client-side, it's just re-shown.
  const embeddedData = JSON.stringify({
    positiveClusters: report.positiveClusters,
    negativeClusters: report.negativeClusters,
    recommendationClusters: report.recommendationClusters,
    narrativeHtml: renderNarrative(report.narrative),
    usedLLM: report.usedLLM,
    provider: report.provider,
    limitations: report.limitations,
    interactive,
  }).replace(/</g, '\\u003c');

  const sourceCountTiles = (datasets[0].manifestEntry.sourcesSucceeded || [])
    .map((src) => statTile(formatSourceCount(src, datasets[0].manifestEntry.counts?.[src]), src.charAt(0).toUpperCase() + src.slice(1)))
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BuzzLens — ${esc(topic)}</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #131826; --border: #232b3d; --text: #e6e9f0; --muted: #93a0b8;
    --pos: #34c98a; --neg: #e35d6a; --neu: #7c8aa5; --accent: #5b8def; --rec: #c99a3a;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f5f6f9; --panel: #ffffff; --border: #e3e6ed; --text: #1a2030; --muted: #5b6478; }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; overflow: hidden; }
  body { background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .dashboard { height: 100vh; display: flex; flex-direction: column; padding: 16px; gap: 12px; }
  header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
  header h1 { font-size: 19px; margin: 0; }
  header .sub { color: var(--muted); font-size: 12.5px; }
  header .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .stat-row { display: flex; gap: 10px; flex-wrap: wrap; flex: 0 0 auto; }
  .stat-tile { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 8px 14px; min-width: 120px; }
  .stat-tile .num { font-size: 17px; font-weight: 600; }
  .stat-tile .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .stat-tile.sentiment { min-width: 220px; }
  .sent-bar { display: flex; height: 8px; border-radius: 5px; overflow: hidden; background: var(--border); margin: 4px 0 4px; }
  .sent-seg.pos { background: var(--pos); } .sent-seg.neg { background: var(--neg); } .sent-seg.neu { background: var(--neu); }
  .sent-nums { display: flex; gap: 10px; font-size: 11px; color: var(--muted); }
  .sent-nums b { color: var(--text); }
  .main-grid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(3, 1fr) 300px; gap: 12px; }
  .col { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; min-height: 0; }
  .col h2 { font-size: 13px; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .col-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
  .col-empty { color: var(--muted); font-size: 12.5px; font-style: italic; }
  .cluster-card { border: 1px solid var(--border); border-radius: 9px; padding: 9px 11px; cursor: pointer; background: rgba(127,127,127,.03); transition: border-color .1s; }
  .cluster-card:hover, .cluster-card:focus { border-color: var(--accent); outline: none; }
  .cluster-card.pos { border-left: 3px solid var(--pos); }
  .cluster-card.neg { border-left: 3px solid var(--neg); }
  .cluster-card.rec { border-left: 3px solid var(--rec); }
  .cluster-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .cluster-theme { font-weight: 600; font-size: 12.5px; }
  .cluster-users { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .cluster-quote { font-size: 12px; color: var(--muted); margin: 0 0 4px; }
  .cluster-foot { font-size: 11px; color: var(--accent); }
  .sidebar { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .qa-box { flex: 0 0 auto; }
  .qa-row { display: flex; gap: 6px; margin-bottom: 6px; }
  .qa-row input { flex: 1; min-width: 0; }
  .qa-answer { white-space: pre-wrap; font-size: 12px; max-height: 140px; overflow-y: auto; border-top: 1px solid var(--border); padding-top: 6px; margin-top: 6px; display: none; }
  .quotes-box { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .quotes-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .quote-chip { border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; font-size: 11.5px; }
  select, input[type=text] { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; font-size: 12.5px; }
  button, .btn { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 7px 13px; font-size: 12.5px; cursor: pointer; }
  button.ghost, .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .tag { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
  .tag.sent-positive { color: var(--pos); border-color: var(--pos); }
  .tag.sent-negative { color: var(--neg); border-color: var(--neg); }
  .tag.sent-neutral { color: var(--neu); border-color: var(--neu); }
  .badge { display: inline-block; font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: var(--accent); color: #fff; margin-left: 6px; vertical-align: middle; }
  .badge.local { background: var(--neu); }
  footer { flex: 0 0 auto; color: var(--muted); font-size: 11px; text-align: center; }

  /* Modal */
  .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 50; align-items: center; justify-content: center; padding: 30px; }
  .modal-backdrop.open { display: flex; }
  .modal { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 760px; max-height: 100%; display: flex; flex-direction: column; overflow: hidden; }
  .modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
  .modal-head h3 { margin: 0; font-size: 15px; }
  .modal-body { padding: 14px 18px; overflow-y: auto; flex: 1 1 auto; }
  .modal-close { background: transparent; border: none; color: var(--muted); font-size: 18px; cursor: pointer; padding: 0 4px; }
  .item-row { border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; margin-bottom: 8px; }
  .item-row-head { display: flex; gap: 6px; align-items: center; margin-bottom: 5px; flex-wrap: wrap; }
  .item-author { font-size: 11.5px; color: var(--muted); }
  .item-date { font-size: 11px; color: var(--muted); margin-left: auto; }
  .item-text { font-size: 12.5px; margin: 0 0 5px; }
  .item-row-foot { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; }
  .item-row-foot a { color: var(--accent); }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; position: sticky; top: 0; background: var(--panel); }
  .title-cell { max-width: 200px; } .text-cell { max-width: 320px; }
  .filters { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; position: sticky; top: 0; background: var(--panel); padding-bottom: 6px; }
  .notice { color: var(--muted); font-size: 12px; }

  @media (max-width: 1000px) {
    html, body { overflow: auto; height: auto; }
    .dashboard { height: auto; }
    .main-grid { grid-template-columns: 1fr 1fr; }
    .col-body { max-height: 340px; }
  }
  @media (max-width: 640px) {
    .main-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="dashboard">
  <header>
    <div>
      <h1>${esc(topic)} <span class="badge ${report.usedLLM || report.provider === 'agent' ? '' : 'local'}">${esc(badgeLabel(report))}</span></h1>
      <div class="sub">Sources: ${esc(sources.join(', ') || 'none')} &middot; ${esc(fmtDateTime(report.generatedAt))}</div>
    </div>
    <div class="actions">
      <button class="ghost" id="open-analysis">Read full analysis</button>
      <button class="ghost" id="open-data">View full dataset (${allItems.length})</button>
    </div>
  </header>

  <div class="stat-row">
    ${statTile(report.stats.totalItems, 'Total items')}
    <div class="stat-tile sentiment">
      ${sentimentBar(report.stats.sentiment)}
      <div class="sent-nums"><span><b>${report.stats.sentiment.positive}</b> pos</span><span><b>${report.stats.sentiment.negative}</b> neg</span><span><b>${report.stats.sentiment.neutral}</b> neutral</span></div>
    </div>
    ${sourceCountTiles}
  </div>

  <div class="main-grid">
    <div class="col">
      <h2>👍 What people like</h2>
      <div class="col-body">${clusterColumn({ clusters: report.positiveClusters, tone: 'pos', prefix: 'pos', emptyText: 'No clearly positive clusters yet.' })}</div>
    </div>
    <div class="col">
      <h2>👎 What people don't like</h2>
      <div class="col-body">${clusterColumn({ clusters: report.negativeClusters, tone: 'neg', prefix: 'neg', emptyText: 'No clearly negative clusters yet.' })}</div>
    </div>
    <div class="col">
      <h2>💡 New recommendations</h2>
      <div class="col-body">${clusterColumn({ clusters: report.recommendationClusters, tone: 'rec', prefix: 'rec', emptyText: 'No explicit feature requests found in this data.' })}</div>
    </div>
    <div class="sidebar">
      <div class="col qa-box">
        <h2>Ask a question</h2>
        <div class="qa-row">
          <input type="text" id="qa-input" placeholder="e.g. biggest complaints?" ${interactive ? '' : 'disabled'} />
          <button id="qa-ask" ${interactive ? '' : 'disabled'}>Ask</button>
        </div>
        <div class="notice">${interactive ? 'Grounded in this dataset.' : 'Live Q&amp;A needs the running dashboard — run <code>node scripts/dashboard.js</code>.'}</div>
        <div id="qa-answer" class="qa-answer"></div>
      </div>
      <div class="col quotes-box">
        <h2>Top quotes by source</h2>
        <div class="quotes-body">${report.topQuotesBySource.map(topQuoteChip).join('') || '<div class="col-empty">No items collected.</div>'}</div>
      </div>
    </div>
  </div>

  <footer>${esc(footerLine(report))}</footer>
</div>

<!-- Modals -->
<div class="modal-backdrop" id="modal-cluster">
  <div class="modal">
    <div class="modal-head"><h3 id="modal-cluster-title"></h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body" id="modal-cluster-body"></div>
  </div>
</div>

<div class="modal-backdrop" id="modal-analysis">
  <div class="modal">
    <div class="modal-head"><h3>Full analysis</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body" id="modal-analysis-body"></div>
  </div>
</div>

<div class="modal-backdrop" id="modal-data">
  <div class="modal">
    <div class="modal-head"><h3>Full dataset</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body">
      <div class="filters">
        <select id="f-source"><option value="">All sources</option>${sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
        <select id="f-sentiment"><option value="">All sentiment</option><option value="positive">Positive</option><option value="negative">Negative</option><option value="neutral">Neutral</option></select>
        <input type="text" id="f-text" placeholder="Search text..." />
      </div>
      <table id="data-table">
        <thead><tr><th>Source</th><th>Title</th><th>Text</th><th>Date</th><th>Sentiment</th><th>Theme</th><th>Engagement</th><th></th></tr></thead>
        <tbody>${dataTableRows(allItems)}</tbody>
      </table>
      ${truncated ? `<p class="notice">Showing first ${MAX_TABLE_ITEMS} of ${allItems.length} — full dataset is in the saved Excel file(s).</p>` : ''}
    </div>
  </div>
</div>

<script id="buzzlens-data" type="application/json">${embeddedData}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('buzzlens-data').textContent);
  var CLUSTERS = { pos: DATA.positiveClusters, neg: DATA.negativeClusters, rec: DATA.recommendationClusters };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function renderItemRow(item) {
    return '<div class="item-row"><div class="item-row-head">' +
      '<span class="tag src-' + esc(item.source) + '">' + esc(item.source) + '</span>' +
      '<span class="tag sent-' + esc(item.sentiment) + '">' + esc(item.sentiment) + '</span>' +
      '<span class="item-author">' + esc(item.author) + '</span>' +
      '<span class="item-date">' + esc(item.date ? item.date.slice(0,10) : '') + '</span>' +
      '</div><p class="item-text">"' + esc(item.text) + '"</p>' +
      '<div class="item-row-foot"><span>' + esc(item.engagement) + ' engagement &middot; ' + esc(item.theme) + '</span>' +
      (item.link ? '<a href="' + esc(item.link) + '" target="_blank" rel="noopener">source</a>' : '') + '</div></div>';
  }

  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { btn.closest('.modal-backdrop').classList.remove('open'); });
  });
  document.querySelectorAll('.modal-backdrop').forEach(function (bd) {
    bd.addEventListener('click', function (e) { if (e.target === bd) bd.classList.remove('open'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(function (bd) { bd.classList.remove('open'); });
  });

  document.querySelectorAll('[data-open-cluster]').forEach(function (card) {
    function open() {
      var id = card.getAttribute('data-open-cluster');
      var parts = id.split('-');
      var group = CLUSTERS[parts[0]];
      var cluster = group && group[Number(parts[1])];
      if (!cluster) return;
      document.getElementById('modal-cluster-title').textContent = cluster.theme + ' — ' + cluster.userCount + ' users, ' + cluster.count + ' items';
      document.getElementById('modal-cluster-body').innerHTML = cluster.items.map(renderItemRow).join('');
      openModal('modal-cluster');
    }
    card.addEventListener('click', open);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });

  var analysisBtn = document.getElementById('open-analysis');
  if (analysisBtn) analysisBtn.addEventListener('click', function () {
    document.getElementById('modal-analysis-body').innerHTML = DATA.narrativeHtml + (DATA.limitations ? '<p class="notice">Limitations: ' + esc(DATA.limitations) + '</p>' : '');
    openModal('modal-analysis');
  });

  var dataBtn = document.getElementById('open-data');
  if (dataBtn) dataBtn.addEventListener('click', function () { openModal('modal-data'); });

  var table = document.getElementById('data-table');
  var fSource = document.getElementById('f-source');
  var fSentiment = document.getElementById('f-sentiment');
  var fText = document.getElementById('f-text');
  if (table) {
    function applyFilters() {
      var rows = table.tBodies[0].rows;
      var src = fSource.value, sent = fSentiment.value, text = fText.value.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var show = (!src || r.dataset.source === src) && (!sent || r.dataset.sentiment === sent) && (!text || r.textContent.toLowerCase().indexOf(text) !== -1);
        r.style.display = show ? '' : 'none';
      }
    }
    fSource.addEventListener('change', applyFilters);
    fSentiment.addEventListener('change', applyFilters);
    fText.addEventListener('input', applyFilters);
  }

  var askBtn = document.getElementById('qa-ask');
  var qaInput = document.getElementById('qa-input');
  var qaAnswer = document.getElementById('qa-answer');
  if (askBtn) {
    askBtn.addEventListener('click', function () {
      var question = qaInput.value.trim();
      if (!question) return;
      askBtn.disabled = true;
      qaAnswer.style.display = 'block';
      qaAnswer.textContent = 'Thinking...';
      fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: question }) })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var text = data.answer || data.error || 'No answer returned.';
          if (data.usedLLM) text += '\\n\\n[via ' + data.provider + ' — sent to it]';
          else text += '\\n\\n[local heuristic — nothing left this machine]';
          qaAnswer.textContent = text;
        })
        .catch(function (e) { qaAnswer.textContent = 'Request failed: ' + e.message; })
        .finally(function () { askBtn.disabled = false; });
    });
    qaInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') askBtn.click(); });
  }
})();
</script>
</body>
</html>`;
}

module.exports = { render };
