const path = require('path');
const { ROOT_DIR } = require('../config/constants');
const { readDatasetItems } = require('./excel');
const { getDataset } = require('./manifest');

/**
 * Re-reads a saved dataset's items from disk — this is what lets a topic be
 * reused for analysis without recollecting it.
 * @param {string|object} manifestEntryOrId
 * @returns {Promise<import('../collectors/types').RawItem[]>}
 */
async function loadDatasetItems(manifestEntryOrId) {
  const entry = typeof manifestEntryOrId === 'string' ? getDataset(manifestEntryOrId) : manifestEntryOrId;
  if (!entry) throw new Error(`Dataset not found: ${manifestEntryOrId}`);
  const absolutePath = path.isAbsolute(entry.filepath) ? entry.filepath : path.join(ROOT_DIR, entry.filepath);
  return readDatasetItems(absolutePath);
}

module.exports = { loadDatasetItems };
