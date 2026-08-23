const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');

const DATA_DIR = path.join(ROOT_DIR, 'data');
const DATASETS_DIR = path.join(DATA_DIR, 'datasets');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');

const DEFAULT_DASHBOARD_PORT = 4173;

// Sources selectable during a research run, in display order.
const SOURCES = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'twitter', label: 'Twitter / X' },
  { id: 'community', label: 'Community site' },
];

// Credentials required before a source's collector can run.
const REQUIRED_CREDENTIALS = {
  youtube: ['YOUTUBE_API_KEY'],
  reddit: [],
  twitter: ['TWITTER_BEARER_TOKEN'],
  community: [],
};

// All credential vars a source's collector will read, including optional
// ones beyond what's strictly required (e.g. Reddit's optional OAuth
// upgrade). Used to assemble the `creds` object passed into collect().
const SOURCE_CRED_VARS = {
  youtube: ['YOUTUBE_API_KEY'],
  reddit: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT'],
  twitter: ['TWITTER_BEARER_TOKEN'],
  community: ['COMMUNITY_USER_AGENT'],
};

// Explanatory copy shown when a credential is missing and needs to be
// reported. Kept short — full detail lives in the README.
const CREDENTIAL_INFO = {
  YOUTUBE_API_KEY: {
    label: 'YouTube Data API v3 key',
    howTo:
      'Get one at https://console.cloud.google.com -> APIs & Services -> ' +
      'Library -> enable "YouTube Data API v3" -> Credentials -> Create API Key.',
  },
  TWITTER_BEARER_TOKEN: {
    label: 'Twitter / X API v2 Bearer Token',
    howTo:
      'Get one at https://developer.twitter.com/en/portal/dashboard. ' +
      'Note: recent-search access requires a PAID X API tier — the free tier ' +
      'does not support search, and BuzzLens will report that clearly rather ' +
      'than substituting fake data if your token lacks access.',
  },
  REDDIT_CLIENT_ID: {
    label: 'Reddit script app client ID',
    howTo:
      'Optional, for higher rate limits. Get one at ' +
      'https://www.reddit.com/prefs/apps -> "create app" -> choose "script".',
  },
  REDDIT_CLIENT_SECRET: {
    label: 'Reddit script app client secret',
    howTo: 'Issued alongside the client ID at https://www.reddit.com/prefs/apps.',
  },
  COMMUNITY_USER_AGENT: {
    label: 'Community site User-Agent override',
    howTo:
      'Optional. A realistic desktop-Chrome User-Agent is used by default. Set this only if a specific ' +
      'site blocks that default but allows something else — it will not bypass JS-challenge/bot-detection ' +
      'systems, which report as an HTTP error either way.',
  },
};

module.exports = {
  ROOT_DIR,
  ENV_PATH,
  DATA_DIR,
  DATASETS_DIR,
  MANIFEST_PATH,
  REPORTS_DIR,
  DEFAULT_DASHBOARD_PORT,
  SOURCES,
  REQUIRED_CREDENTIALS,
  SOURCE_CRED_VARS,
  CREDENTIAL_INFO,
};
