#!/usr/bin/env node
// Prints which credentials are already configured in .env, so the agent can
// check this BEFORE asking the user about API keys in Phase 1, rather than
// asking blind and only reacting when a source later reports something
// missing. Never prints raw values — every credential is masked.
//
// Usage:
//   node scripts/credentials.js

const fs = require('fs');
const { loadEnv } = require('../lib/config/env');
const { printCredentialStatus } = require('../lib/credentials');
const { ENV_PATH } = require('../lib/config/constants');
const logger = require('../lib/utils/logger');

loadEnv();

if (!fs.existsSync(ENV_PATH)) {
  logger.warn(`No .env file yet at ${ENV_PATH} — every credential below is unset. Copy .env.example to .env to add keys.`);
} else {
  logger.heading(`Credential status (${ENV_PATH})`);
}
printCredentialStatus();
console.log('\nYouTube and Reddit work with none of these set (lower-fidelity public fallback). Twitter/X requires TWITTER_BEARER_TOKEN.');
