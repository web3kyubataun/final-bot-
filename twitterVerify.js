/**
 * twitterVerify.js
 * Auto-verification for Twitter tasks using twitter-api-v2.
 * Falls back to mock/trust mode if TWITTER_BEARER_TOKEN is not set.
 */

const { TwitterApi } = require('twitter-api-v2');

let _client = null;

function getClient() {
  if (_client) return _client;
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return null;
  _client = new TwitterApi(token).readOnly;
  return _client;
}

function extractTweetId(url) {
  const m = String(url).match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractUsername(url) {
  const m = String(url).match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function isTweetUrl(url) {
  return /https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i.test(String(url));
}

// ── Retweet ────────────────────────────────────────────────────────────────────
// Checks /2/tweets/:id/retweeted_by — works with bearer token
async function verifyRetweet(tweetId, twitterUsername) {
  const client = getClient();
  if (!client) return { verified: true, note: 'Mock mode — no bearer token' };

  try {
    const clean = String(twitterUsername).replace(/^@/, '').toLowerCase();
    let paginationToken;

    do {
      const params = { max_results: 100 };
      if (paginationToken) params.pagination_token = paginationToken;

      const res = await client.v2.tweetRetweetedBy(tweetId, params);
      const users = res.data || [];

      if (users.some(u => u.username.toLowerCase() === clean)) {
        return { verified: true };
      }
      paginationToken = res.meta?.next_token;
    } while (paginationToken);

    return { verified: false, reason: `@${clean} has not retweeted this tweet yet.` };
  } catch (err) {
    console.error('[TwitterVerify] verifyRetweet error:', err.message);
    return { verified: true, note: 'API error — auto-approved' };
  }
}

// ── Like ───────────────────────────────────────────────────────────────────────
// /2/users/:id/liked_tweets requires user-auth in v2 → trust-based
async function verifyLike(tweetId, twitterUsername) {
  // Bearer token cannot check likes without user OAuth.
  // Return verified = true (trust-based) unless you add user OAuth later.
  return { verified: true, note: 'Like verified (trust-based — Twitter API v2 requires user OAuth for like checks)' };
}

// ── Follow ─────────────────────────────────────────────────────────────────────
// /2/users/:id/following requires user-auth in v2 → trust-based
async function verifyFollow(targetUsername, twitterUsername) {
  return { verified: true, note: 'Follow verified (trust-based — Twitter API v2 requires user OAuth for follow checks)' };
}

// ── Reply / Comment ────────────────────────────────────────────────────────────
// User submits their reply tweet URL. Bot fetches it and checks:
// 1. Author matches twitterUsername
// 2. It's a reply (referenced_tweets has replied_to = originalTweetId)
// 3. Text meets minimum character requirement
async function verifyReply(replyUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(replyUrl)) {
    return { verified: false, reason: 'Invalid tweet URL. Send a valid x.com or twitter.com link.' };
  }

  const client = getClient();
  if (!client) return { verified: true, note: 'Mock mode' };

  const replyId = extractTweetId(replyUrl);
  if (!replyId) return { verified: false, reason: 'Could not extract tweet ID from URL.' };

  try {
    const clean = String(twitterUsername).replace(/^@/, '').toLowerCase();

    const tweetRes = await client.v2.singleTweet(replyId, {
      'tweet.fields': ['author_id', 'referenced_tweets', 'text', 'conversation_id'],
      'expansions': ['author_id'],
      'user.fields': ['username'],
    });

    const tweet = tweetRes.data;
    if (!tweet) return { verified: false, reason: 'Tweet not found or deleted.' };

    // Check author
    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return { verified: false, reason: `This tweet was not posted by @${clean}.` };
    }

    // Check it's a reply to the original tweet
    const refs = tweet.referenced_tweets || [];
    const isReply = refs.some(r => r.type === 'replied_to' && r.id === originalTweetId)
      || tweet.conversation_id === originalTweetId;

    if (!isReply) {
      return { verified: false, reason: 'This tweet is not a reply to the required tweet.' };
    }

    // Check length (strip mentions and URLs)
    const cleanText = tweet.text.replace(/@\w+/g, '').replace(/https?:\/\/\S+/g, '').trim();
    if (cleanText.length < minChars) {
      return { verified: false, reason: `Reply too short — minimum ${minChars} characters required (excluding mentions/links).` };
    }

    // Anti-spam: check for repeated words
    const words = cleanText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    if (Object.values(freq).some(c => c >= 3)) {
      return { verified: false, reason: 'Reply contains too many repeated words. Write something original.' };
    }

    return { verified: true };
  } catch (err) {
    console.error('[TwitterVerify] verifyReply error:', err.message);
    return { verified: true, note: 'API error — auto-approved' };
  }
}

// ── Quote Tweet ────────────────────────────────────────────────────────────────
async function verifyQuote(quoteTweetUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(quoteTweetUrl)) {
    return { verified: false, reason: 'Invalid tweet URL. Send a valid x.com or twitter.com link.' };
  }

  const client = getClient();
  if (!client) return { verified: true, note: 'Mock mode' };

  const quoteId = extractTweetId(quoteTweetUrl);
  if (!quoteId) return { verified: false, reason: 'Could not extract tweet ID from URL.' };

  try {
    const clean = String(twitterUsername).replace(/^@/, '').toLowerCase();

    const tweetRes = await client.v2.singleTweet(quoteId, {
      'tweet.fields': ['author_id', 'referenced_tweets', 'text'],
      'expansions': ['author_id'],
      'user.fields': ['username'],
    });

    const tweet = tweetRes.data;
    if (!tweet) return { verified: false, reason: 'Tweet not found or deleted.' };

    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return { verified: false, reason: `This tweet was not posted by @${clean}.` };
    }

    const refs = tweet.referenced_tweets || [];
    const isQuote = refs.some(r => r.type === 'quoted' && r.id === originalTweetId);
    if (!isQuote) {
      return { verified: false, reason: 'This tweet does not quote the required tweet.' };
    }

    const cleanText = tweet.text.replace(/https?:\/\/\S+/g, '').trim();
    if (cleanText.length < minChars) {
      return { verified: false, reason: `Quote tweet too short — minimum ${minChars} characters required.` };
    }

    const words = cleanText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    if (Object.values(freq).some(c => c >= 3)) {
      return { verified: false, reason: 'Quote tweet contains too many repeated words.' };
    }

    return { verified: true };
  } catch (err) {
    console.error('[TwitterVerify] verifyQuote error:', err.message);
    return { verified: true, note: 'API error — auto-approved' };
  }
}

module.exports = {
  extractTweetId,
  extractUsername,
  isTweetUrl,
  verifyRetweet,
  verifyLike,
  verifyFollow,
  verifyReply,
  verifyQuote,
};
