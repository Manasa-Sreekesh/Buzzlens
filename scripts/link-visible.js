#!/usr/bin/env node
// Runs automatically after `npm install` (see package.json's postinstall).
// See ../lib/utils/visibleLink.js for why this exists.

const { ensureVisibleLink } = require('../lib/utils/visibleLink');
const logger = require('../lib/utils/logger');

const target = ensureVisibleLink();
if (target) {
  logger.step(`Visible symlink ready at: ${target}`);
}
