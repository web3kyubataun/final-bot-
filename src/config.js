require('dotenv').config();

// Support comma-separated owner IDs: BOT_OWNER_IDS=111,222,333
const raw = process.env.BOT_OWNER_IDS || process.env.BOT_OWNER_ID || process.env.OWNER_ID || '';
const OWNER_IDS = raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);

module.exports = {
  BOT_TOKEN:   process.env.BOT_TOKEN,
  OWNER_IDS,   // array of all owner user IDs
  OWNER_ID:    OWNER_IDS[0] || 0, // backwards compat

  // Paste entire service-account JSON as one-line string
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',

  // Twitter/X API Bearer Token (optional — for tweet URL verification)
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',

  // Auto-share new sheets with this email
  DEFAULT_SHARE_EMAIL: process.env.DEFAULT_SHARE_EMAIL || '',
};
