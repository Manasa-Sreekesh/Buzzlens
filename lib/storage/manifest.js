const fs = require('fs');
const path = require('path');
const { DATA_DIR, MANIFEST_PATH } = require('../config/constants');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadManifest() {
  ensureDataDir();
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { version: 1, datasets: [] };
  }
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.datasets)) return { version: 1, datasets: [] };
    return parsed;
  } catch (e) {
    return { version: 1, datasets: [] };
  }
}

// Atomic write: temp file + rename, so an interrupted write can't corrupt
// the manifest that indexes every saved dataset.
function saveManifest(manifest) {
  ensureDataDir();
  const tmpPath = path.join(DATA_DIR, `.manifest.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmpPath, MANIFEST_PATH);
}

function appendDataset(entry) {
  const manifest = loadManifest();
  manifest.datasets.unshift(entry);
  saveManifest(manifest);
  return entry;
}

function listDatasets({ topic, source } = {}) {
  let datasets = loadManifest().datasets;
  if (topic) {
    const needle = topic.toLowerCase();
    datasets = datasets.filter((d) => d.topic.toLowerCase().includes(needle));
  }
  if (source) {
    datasets = datasets.filter((d) => d.sourcesSucceeded.includes(source) || d.sourcesPartial.includes(source));
  }
  return datasets;
}

function getDataset(id) {
  return loadManifest().datasets.find((d) => d.id === id) || null;
}

module.exports = { loadManifest, saveManifest, appendDataset, listDatasets, getDataset };
