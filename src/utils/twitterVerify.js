/**
 * twitterVerify.js
 * Auto-verification for Twitter tasks using twitter-api-v2.
 *
 * Uses:
 *  - Bearer token (app-only) for: retweet, reply, quote tweet lookups
 *  - OAuth 1.0a (full user credentials) for: follow & like checks via v1.1 API
 *
 * Required env vars:
 *  TWITTER_BEARER_TOKEN
 *  TWITTER_API_KEY
 *  TWITTER_API_SECRET
 *  TWITTER_ACCESS_TOKEN
 *  TWITTER_ACCESS_TOKEN_SECRET
 */

const { TwitterApi } = require('twitter-api-v2');

let _bearerClient = null;
let _userClient = null;

// App-only bearer client (for v2 endpoints)
function getBearerClient() {
  if (_bearerClient) return _bearerClient;
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return null;
  _bearerClient = new TwitterApi(token).readOnly;
  return _bearerClient;
}

// Full OAuth 1.0a client (for v1.1 endpoints — follow & like checks)
function getUserClient() {
  if (_userClient) return _userClient;
  const appKey    = process.env.TWITTER_API_KEY;
  const appSecret = process.env.TWITTER_API_SECRET;
  const accessToken  = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) return null;
  _userClient = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  return _userClient;
}

function extractTweetId(url) {
  const m = String(url).match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractUsername(url) {
  // Handle plain @username or full profile URLs
  if (String(url).startsWith('@')) return url.replace(/^@/, '').toLowerCase();
  const m = String(url).match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : String(url).replace(/^@/, '').toLowerCase();
}

function isTweetUrl(url) {
  return /https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i.test(String(url));
}

// ── Follow ─────────────────────────────────────────────────────────────────────
// Uses v1.1 GET friendships/show — works with OAuth 1.0a app credentials.
// This correctly tells if sourceUser follows targetUser using app-level credentials.
async function verifyFollow(targetUsername, twitterUsername) {
  const client = getUserClient();
  if (!client) {
    console.warn('[TwitterVerify] No OAuth credentials — cannot verify follow.');
    return { verified: false, reason: 'Twitter verification is not configured. Contact an admin.' };
  }

  const cleanSource = String(twitterUsername).replace(/^@/, '').toLowerCase();
  const cleanTarget = String(targetUsername).replace(/^@/, '').toLowerCase();

  if (!cleanSource || !cleanTarget) {
    return { verified: false, reason: 'Invalid Twitter username provided.' };
  }

  try {
    const data = await client.v1.get('friendships/show.json', {
      source_screen_name: cleanSource,
      target_screen_name: cleanTarget,
    });

    const following = data?.relationship?.source?.following;

    if (following === true) {
      return { verified: true };
    }

    return {
      verified: false,
      reason: `@${cleanSource} is not following @${cleanTarget}. Follow the account first, then tap Verify.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyFollow error:', err.message);

    if (err.code === 34 || err.data?.errors?.[0]?.code === 34) {
      return { verified: false, reason: `Twitter user @${cleanTarget} not found. Check the username and try again.` };
    }
    if (err.code === 50 || err.data?.errors?.[0]?.code === 50) {
      return { verified: false, reason: `Twitter user @${cleanSource} not found. Check your linked username.` };
    }

    return { verified: false, reason: 'Could not verify follow status. Twitter API error. Please try again in a moment.' };
  }
}

// ── Like ───────────────────────────────────────────────────────────────────────
// Uses v1.1 GET favorites/list — works with OAuth 1.0a app credentials.
// Returns the last 200 likes for the given screen_name.
async function verifyLike(tweetId, twitterUsername) {
  const client = getUserClient();
  if (!client) {
    console.warn('[TwitterVerify] No OAuth credentials — cannot verify like.');
    return { verified: false, reason: 'Twitter verification is not configured. Contact an admin.' };
  }

  const clean = String(twitterUsername).replace(/^@/, '').toLowerCase();

  if (!clean || !tweetId) {
    return { verified: false, reason: 'Missing tweet ID or username.' };
  }

  try {
    const tweets = await client.v1.get('favorites/list.json', {
      screen_name: clean,
      count: 200,
      tweet_mode: 'compat',
    });

    if (!Array.isArray(tweets)) {
      return { verified: false, reason: 'Could not fetch liked tweets. Please try again.' };
    }

    const liked = tweets.some(t => String(t.id_str) === String(tweetId));

    if (liked) {
      return { verified: true };
    }

    return {
      verified: false,
      reason: `@${clean} has not liked this tweet (checked last 200 likes). Like the tweet first, then tap Verify.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyLike error:', err.message);

    if (err.code === 34 || err.data?.errors?.[0]?.code === 34) {
      return { verified: false, reason: `Twitter user @${clean} not found. Check your linked username.` };
    }

    return { verified: false, reason: 'Could not verify like. Twitter API error. Please try again in a moment.' };
  }
}

// ── Retweet ────────────────────────────────────────────────────────────────────
// Uses v2 GET /2/tweets/:id/retweeted_by — works with bearer token.
async function verifyRetweet(tweetId, twitterUsername) {
  const client = getBearerClient();
  if (!client) {
    return { verified: false, reason: 'Twitter verification is not configured. Contact an admin.' };
  }

  const clean = String(twitterUsername).replace(/^@/, '').toLowerCase();

  try {
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

    return {
      verified: false,
      reason: `@${clean} has not retweeted this tweet yet. Retweet it first, then tap Verify.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyRetweet error:', err.message);
    return { verified: false, reason: 'Could not verify retweet. Twitter API error. Please try again in a moment.' };
  }
}

// ── Reply / Comment ────────────────────────────────────────────────────────────
// User submits their reply tweet URL. Bot fetches it and checks:
// 1. Author matches twitterUsername
// 2. It's a reply to the originalTweetId
// 3. Text meets minimum character requirement
// 4. No spam (repeated words)
async function verifyReply(replyUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(replyUrl)) {
    return { verified: false, reason: 'Invalid tweet URL. Send a valid x.com or twitter.com link.' };
  }

  const client = getBearerClient();
  if (!client) {
    return { verified: false, reason: 'Twitter verification is not configured. Contact an admin.' };
  }

  const replyId = extractTweetId(replyUrl);
  if (!replyId) {
    return { verified: false, reason: 'Could not extract tweet ID from URL.' };
  }

  try {
    const clean = String(twitterUsername).replace(/^@/, '').toLowerCase();

    const tweetRes = await client.v2.singleTweet(replyId, {
      'tweet.fields': ['author_id', 'referenced_tweets', 'text', 'conversation_id'],
      'expansions': ['author_id'],
      'user.fields': ['username'],
    });

    const tweet = tweetRes.data;
    if (!tweet) {
      return { verified: false, reason: 'Tweet not found or deleted.' };
    }

    // Check author
    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return { verified: false, reason: `This tweet was not posted by @${clean}. Send the link to YOUR reply.` };
    }

    // Check it's a reply to the original tweet
    const refs = tweet.referenced_tweets || [];
    const isReply = refs.some(r => r.type === 'replied_to' && r.id === originalTweetId)
      || tweet.conversation_id === originalTweetId;

    if (!isReply) {
      return { verified: false, reason: 'This tweet is not a reply to the required tweet.' };
    }

    // Check minimum length (strip mentions and URLs)
    const cleanText = tweet.text
      .replace(/@\w+/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim();

    if (cleanText.length < minChars) {
      return {
        verified: false,
        reason: `Reply too short — minimum ${minChars} characters required (excluding mentions/links). Current: ${cleanText.length} chars.`,
      };
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
    return { verified: false, reason: 'Could not verify reply. Twitter API error. Please try again in a moment.' };
  }
}

// ── Quote Tweet ────────────────────────────────────────────────────────────────
async function verifyQuote(quoteTweetUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(quoteTweetUrl)) {
    return { verified: false, reason: 'Invalid tweet URL. Send a valid x.com or twitter.com link.' };
  }

  const client = getBearerClient();
  if (!client) {
    return { verified: false, reason: 'Twitter verification is not configured. Contact an admin.' };
  }

  const quoteId = extractTweetId(quoteTweetUrl);
  if (!quoteId) {
    return { verified: false, reason: 'Could not extract tweet ID from URL.' };
  }

  try {
    const clean = String(twitterUsername).replace(/^@/, '').toLowerCase();

    const tweetRes = await client.v2.singleTweet(quoteId, {
      'tweet.fields': ['author_id', 'referenced_tweets', 'text'],
      'expansions': ['author_id'],
      'user.fields': ['username'],
    });

    const tweet = tweetRes.data;
    if (!tweet) {
      return { verified: false, reason: 'Tweet not found or deleted.' };
    }

    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return { verified: false, reason: `This tweet was not posted by @${clean}. Send the link to YOUR quote tweet.` };
    }

    const refs = tweet.referenced_tweets || [];
    const isQuote = refs.some(r => r.type === 'quoted' && r.id === originalTweetId);
    if (!isQuote) {
      return { verified: false, reason: 'This tweet does not quote the required tweet.' };
    }

    const cleanText = tweet.text.replace(/https?:\/\/\S+/g, '').trim();
    if (cleanText.length < minChars) {
      return {
        verified: false,
        reason: `Quote tweet too short — minimum ${minChars} characters required. Current: ${cleanText.length} chars.`,
      };
    }

    const words = cleanText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    if (Object.values(freq).some(c => c >= 3)) {
      return { verified: false, reason: 'Quote tweet contains too many repeated words. Write something original.' };
    }

    return { verified: true };
  } catch (err) {
    console.error('[TwitterVerify] verifyQuote error:', err.message);
    return { verified: false, reason: 'Could not verify quote tweet. Twitter API error. Please try again in a moment.' };
  }
}

module.exports = {
  extractTweetId,
  extractUsername,
  isTweetUrl,
  verifyFollow,
  verifyLike,
  verifyRetweet,
  verifyReply,
  verifyQuote,
};
