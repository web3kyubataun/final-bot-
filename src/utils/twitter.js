const config = require('../config');

const TWEET_REGEX = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i;

function isValidTweetLink(url) {
  return TWEET_REGEX.test(url);
}

/**
 * Optionally verify tweet via Twitter API v2.
 * Falls back to format-only check if no bearer token.
 */
async function verifyTweet(url) {
  if (!isValidTweetLink(url)) {
    return { valid: false, reason: 'Invalid tweet URL format. Must be twitter.com or x.com/status/...' };
  }

  if (!config.TWITTER_BEARER_TOKEN) {
    return { valid: true, reason: 'Format valid (API verification skipped — no bearer token configured)' };
  }

  // Extract tweet ID
  const match = url.match(/\/status\/(\d+)/);
  if (!match) return { valid: false, reason: 'Could not extract tweet ID' };

  const tweetId = match[1];

  try {
    const fetch = require('node-fetch');
    const res = await fetch(`https://api.twitter.com/2/tweets/${tweetId}`, {
      headers: { Authorization: `Bearer ${config.TWITTER_BEARER_TOKEN}` },
    });
    if (res.ok) {
      return { valid: true, reason: 'Tweet verified via API' };
    } else if (res.status === 404) {
      return { valid: false, reason: 'Tweet not found or deleted' };
    } else {
      return { valid: true, reason: 'Format valid (API check inconclusive)' };
    }
  } catch {
    return { valid: true, reason: 'Format valid (API check failed, allowed)' };
  }
}

module.exports = { isValidTweetLink, verifyTweet };
