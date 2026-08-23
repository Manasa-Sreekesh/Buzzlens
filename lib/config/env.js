const fs = require('fs');
const dotenv = require('dotenv');
const { ENV_PATH } = require('./constants');

function loadEnv() {
  if (fs.existsSync(ENV_PATH)) {
    dotenv.config({ path: ENV_PATH });
  }
}

function getCredential(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function hasCredential(name) {
  return Boolean(getCredential(name));
}

function hasAllCredentials(names) {
  return names.every(hasCredential);
}

function missingCredentials(names) {
  return names.filter((name) => !hasCredential(name));
}

// Masks a credential for display only — never log/print a raw value.
function maskCredential(value) {
  if (!value) return '(not set)';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

// Upserts KEY=value into the local .env file, preserving all other lines.
// Creates the file (from .env.example if present, else empty) if missing.
async function setCredential(name, value) {
  let lines = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  }

  const escaped = String(value).replace(/\r?\n/g, ' ').trim();
  const linePattern = new RegExp(`^${name}=`);
  let found = false;
  const nextLines = lines.map((line) => {
    if (linePattern.test(line)) {
      found = true;
      return `${name}=${escaped}`;
    }
    return line;
  });
  if (!found) {
    if (nextLines.length && nextLines[nextLines.length - 1].trim() !== '') {
      nextLines.push('');
    }
    nextLines.push(`${name}=${escaped}`);
  }

  fs.writeFileSync(ENV_PATH, nextLines.join('\n'), { mode: 0o600 });
  try {
    fs.chmodSync(ENV_PATH, 0o600);
  } catch (e) {
    // best-effort; not fatal on platforms without POSIX permissions
  }

  process.env[name] = escaped;
}

module.exports = {
  loadEnv,
  getCredential,
  hasCredential,
  hasAllCredentials,
  missingCredentials,
  maskCredential,
  setCredential,
};
