require('dotenv').config();

const rawOwnerId = process.env.BOT_OWNER_ID || process.env.OWNER_ID || '0';

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OWNER_ID: parseInt(rawOwnerId, 10),

  // Google Sheets — paste entire service account JSON as string
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',

  // Twitter/X API (optional — for tweet verification)
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',

  // Default email to share new sheets with
  DEFAULT_SHARE_EMAIL: process.env.DEFAULT_SHARE_EMAIL || '',
};
