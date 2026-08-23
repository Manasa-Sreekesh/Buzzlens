const youtube = require('./youtube');
const reddit = require('./reddit');
const twitter = require('./twitter');
const community = require('./community');

const REGISTRY = { youtube, reddit, twitter, community };

function getCollector(sourceId) {
  const collector = REGISTRY[sourceId];
  if (!collector) throw new Error(`Unknown source: ${sourceId}`);
  return collector;
}

function listCollectors() {
  return Object.values(REGISTRY);
}

module.exports = { getCollector, listCollectors };
