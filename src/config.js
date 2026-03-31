require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OWNER_ID: parseInt(process.env.OWNER_ID || '0'),
  // Paste the entire google-service-account.json content as a string here (preferred)
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  // OR use a file path (fallback, only if above is empty)
  GOOGLE_SERVICE_ACCOUNT_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './google-service-account.json',
  DEFAULT_SHARE_EMAIL: process.env.DEFAULT_SHARE_EMAIL || '',
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',
};
