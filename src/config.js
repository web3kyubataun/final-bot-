module.exports = {
 BOT_TOKEN: process.env.BOT_TOKEN || '',
 OWNER_IDS: (process.env.BOT_OWNER_IDS || process.env.OWNER_IDS || '')
 .split(',').map(s => s.trim()).filter(Boolean),
 TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID || '',
 TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET || '',
 TWITTER_CALLBACK_URL: process.env.TWITTER_CALLBACK_URL || '',
 TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',
 GOOGLE_SERVICE_ACCOUNT: process.env.GOOGLE_SERVICE_ACCOUNT || '',
 PORT: parseInt(process.env.PORT || '3001', 10),
};
