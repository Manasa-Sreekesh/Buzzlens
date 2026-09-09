// A saved structured PM-insights JSON lives as one plain-text sibling file
// next to its dataset's .xlsx — mirrors summaryFile.js. This is what the PM
// dashboard's 6 sections render from. Every item reference inside it must
// point at a real item id from the same dataset (validated on save, see
// validateInsights) so every card the dashboard shows can be traced back to
// an actual collected comment — never an invented one.

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config/constants');
const local = require('./analysis/localAnalysis');

function insightsFilePath(entry) {
  const abs = path.isAbsolute(entry.filepath) ? entry.filepath : path.join(ROOT_DIR, entry.filepath);
  return abs.replace(/\.xlsx$/i, '.insights.json');
}

function readSavedInsights(entry) {
  const p = insightsFilePath(entry);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

const ARRAY_SECTIONS = ['executiveSummary', 'topTopics', 'painPoints', 'loves', 'requests', 'recommendations'];
// These sections show a "mentions" count on the dashboard. `recommendations`
// has no mentions stat, so it's exempt regardless of analysisMode.
const SECTIONS_WITH_MENTIONS = ['executiveSummary', 'topTopics', 'painPoints', 'loves', 'requests'];
const OVERVIEW_FIELDS = ['topDiscussedTopic', 'biggestPainPoint', 'mostRequestedImprovement'];
const VALID_ANALYSIS_MODES = ['thorough', 'fast'];
const DEFAULT_ANALYSIS_MODE = 'thorough';

function analysisModeOf(json) {
  return json && VALID_ANALYSIS_MODES.includes(json.analysisMode) ? json.analysisMode : DEFAULT_ANALYSIS_MODE;
}

// Returns a list of human-readable error strings; empty array means valid.
// `validIds` is a Set of every item id actually present in this dataset.
//
// Two analysis modes, chosen by the top-level "analysisMode" field
// ("thorough" | "fast", default "thorough" if omitted):
// - "thorough" — the agent read every comment itself and authors mentions
//   (and, for topTopics, positive/negative) directly. Slower, but every
//   number reflects the agent's own full read, not a keyword heuristic.
// - "fast" — the agent supplies matchTerms per entry instead, and mentions/
//   sourceBreakdown/positive/negative are computed by an exhaustive local
//   keyword match over the whole dataset (see localAnalysis.js's
//   matchByTerms). Faster, but a keyword match, not the agent's own read.
function validateInsights(json, validIds) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return ['Insights JSON must be an object with "overview" and section arrays.'];
  }

  if (json.analysisMode !== undefined && !VALID_ANALYSIS_MODES.includes(json.analysisMode)) {
    errors.push(`analysisMode must be "thorough" or "fast" if set (omit it for the default, "thorough").`);
  }
  const mode = analysisModeOf(json);

  if (!json.overview || typeof json.overview !== 'object') {
    errors.push('Missing "overview" object.');
  } else {
    for (const f of OVERVIEW_FIELDS) {
      if (!json.overview[f] || typeof json.overview[f] !== 'string' || !json.overview[f].trim()) {
        errors.push(`overview.${f} must be a non-empty string.`);
      }
    }
  }

  for (const section of ARRAY_SECTIONS) {
    const arr = json[section];
    if (arr === undefined) continue; // a section can be genuinely empty for this dataset
    if (!Array.isArray(arr)) {
      errors.push(`"${section}" must be an array.`);
      continue;
    }
    const hasMentions = SECTIONS_WITH_MENTIONS.includes(section);
    arr.forEach((entry, i) => {
      const where = `${section}[${i}]`;
      if (!entry || typeof entry !== 'object') {
        errors.push(`${where} must be an object.`);
        return;
      }
      if (!Array.isArray(entry.itemIds) || entry.itemIds.length === 0) {
        errors.push(`${where}.itemIds must be a non-empty array of real dataset item ids — every card must be traceable to actual comments.`);
        return;
      }
      const unknown = entry.itemIds.filter((id) => !validIds.has(id));
      if (unknown.length) {
        errors.push(`${where}.itemIds references id(s) not found in this dataset: ${unknown.join(', ')}`);
      }
      if (entry.representativeItemId && !validIds.has(entry.representativeItemId)) {
        errors.push(`${where}.representativeItemId "${entry.representativeItemId}" is not in this dataset.`);
      }

      if (hasMentions && mode === 'fast') {
        if (!Array.isArray(entry.matchTerms) || entry.matchTerms.filter((t) => String(t || '').trim()).length === 0) {
          errors.push(
            `${where}.matchTerms must be a non-empty array of keywords/phrases (required in "fast" mode) — this is ` +
              `what drives its real, exhaustive "mentions" count over the whole dataset, not a hand-typed number.`
          );
        }
        if ('mentions' in entry) {
          errors.push(`${where}.mentions is computed automatically from matchTerms in "fast" mode — don't set it yourself.`);
        }
      } else if (hasMentions && mode === 'thorough') {
        if (typeof entry.mentions !== 'number' || entry.mentions < 0) {
          errors.push(
            `${where}.mentions must be a non-negative number — required in "thorough" mode (how many distinct ` +
              `people raised this, from your own read of the comments).`
          );
        }
      }

      if (section === 'topTopics') {
        if (mode === 'fast' && ('positive' in entry || 'negative' in entry)) {
          errors.push(`${where}.positive/negative are computed automatically from matchTerms in "fast" mode — don't set them yourself.`);
        } else if (mode === 'thorough' && (typeof entry.positive !== 'number' || typeof entry.negative !== 'number')) {
          errors.push(`${where}.positive and .negative must be numbers — required in "thorough" mode.`);
        }
      }
    });
  }

  return errors;
}

// Computes, per section entry, how many of its itemIds came from each
// source — persisted straight into the saved .insights.json file itself,
// not just recomputed at dashboard render time, so the file on disk is
// never out of sync with what the dashboard shows.
//
// In "fast" mode, entries in SECTIONS_WITH_MENTIONS also get their
// mentions/positive/negative computed here, from an exhaustive full-dataset
// keyword match (local.matchByTerms) — never limited to the entry's own
// itemIds. In "thorough" mode (the default), mentions/positive/negative
// stay exactly as the agent wrote them — only sourceBreakdown is computed,
// same as before matchTerms/fast mode existed.
function attachSourceBreakdown(json, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const allSources = [...new Set(items.map((i) => i.source))];
  const mode = analysisModeOf(json);

  const countBySource = (itemIds) => {
    const counts = {};
    for (const id of itemIds || []) {
      const item = byId.get(id);
      if (item) counts[item.source] = (counts[item.source] || 0) + 1;
    }
    return counts;
  };

  for (const section of ARRAY_SECTIONS) {
    if (!Array.isArray(json[section])) continue;
    const usesMatchTerms = mode === 'fast' && SECTIONS_WITH_MENTIONS.includes(section);
    for (const entry of json[section]) {
      if (!entry || typeof entry !== 'object') continue;
      const match = usesMatchTerms ? local.matchByTerms(items, entry.matchTerms) : null;
      if (match) {
        entry.mentions = match.mentions;
        entry.sourceBreakdown = match.sourceBreakdown;
        // Only topTopics cards render these, but attaching them unconditionally
        // is harmless for the other sections (the dashboard just ignores them).
        entry.positive = match.matchedItems.filter((i) => i.sentiment === 'positive').length;
        entry.negative = match.matchedItems.filter((i) => i.sentiment === 'negative').length;
      } else {
        entry.sourceBreakdown = countBySource(entry.itemIds);
      }
    }
  }

  if (json.overview && typeof json.overview === 'object') {
    json.overview.sourceBreakdown = local.sourceBreakdown(items, allSources);
  }

  return json;
}

module.exports = {
  insightsFilePath,
  readSavedInsights,
  validateInsights,
  attachSourceBreakdown,
  analysisModeOf,
  DEFAULT_ANALYSIS_MODE,
};
