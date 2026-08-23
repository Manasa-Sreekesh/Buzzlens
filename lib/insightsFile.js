// A saved structured PM-insights JSON lives as one plain-text sibling file
// next to its dataset's .xlsx — mirrors summaryFile.js. This is what the PM
// dashboard's 6 sections render from. Every item reference inside it must
// point at a real item id from the same dataset (validated on save, see
// validateInsights) so every card the dashboard shows can be traced back to
// an actual collected comment — never an invented one.

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config/constants');

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

const ARRAY_SECTIONS = ['topTopics', 'painPoints', 'loves', 'requests', 'recommendations'];
const OVERVIEW_FIELDS = ['topDiscussedTopic', 'biggestPainPoint', 'mostRequestedImprovement'];

// Returns a list of human-readable error strings; empty array means valid.
// `validIds` is a Set of every item id actually present in this dataset.
function validateInsights(json, validIds) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return ['Insights JSON must be an object with "overview" and section arrays.'];
  }

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
    });
  }

  return errors;
}

module.exports = { insightsFilePath, readSavedInsights, validateInsights };
