// A saved analysis lives as one plain-text sibling file next to its
// dataset's .xlsx — deliberately the simplest possible mechanism: no index,
// no schema, human-inspectable, easy for an agent to write to directly too.

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config/constants');

function summaryFilePath(entry) {
  const abs = path.isAbsolute(entry.filepath) ? entry.filepath : path.join(ROOT_DIR, entry.filepath);
  return abs.replace(/\.xlsx$/i, '.summary.md');
}

function readSavedSummary(entry) {
  const p = summaryFilePath(entry);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

module.exports = { summaryFilePath, readSavedSummary };
