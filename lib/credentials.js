// Non-interactive credential checking — reports what's missing rather than
// prompting for it, since this package is meant to be driven by an AI agent
// via a shell command, not a human sitting at a password prompt.

const { CREDENTIAL_INFO, REQUIRED_CREDENTIALS, SOURCE_CRED_VARS, ENV_PATH } = require('./config/constants');
const { hasCredential, getCredential, maskCredential } = require('./config/env');

/**
 * Checks whether a source's required credentials are present. Never
 * prompts. Returns { ready, creds, reason }.
 */
function checkSourceCredentials(sourceId) {
  const required = REQUIRED_CREDENTIALS[sourceId] || [];
  const missing = required.filter((name) => !hasCredential(name));
  if (missing.length) {
    const info = CREDENTIAL_INFO[missing[0]] || { label: missing[0], howTo: '' };
    return {
      ready: false,
      creds: {},
      reason: `Missing ${info.label} (env var ${missing[0]}). ${info.howTo} Add it to ${ENV_PATH} and re-run.`,
    };
  }
  const creds = {};
  for (const name of SOURCE_CRED_VARS[sourceId] || []) {
    const v = getCredential(name);
    if (v) creds[name] = v;
  }
  return { ready: true, creds };
}

function printCredentialStatus() {
  const allVars = [...new Set(Object.values(REQUIRED_CREDENTIALS).flat())];
  for (const name of allVars) {
    const label = CREDENTIAL_INFO[name]?.label || name;
    const set = hasCredential(name);
    const display = set ? maskCredential(getCredential(name)) : '(not set)';
    console.log(`  ${set ? '✔' : '✗'} ${label.padEnd(34)} ${display}`);
  }
}

module.exports = { checkSourceCredentials, printCredentialStatus };
