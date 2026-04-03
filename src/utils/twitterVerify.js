/**
 * twitterVerify.js — Automated Twitter/X task verification
 *
 * Follow & Like   → OAuth 1.0a via v1.1 API (requires all 5 Twitter credentials)
 * Retweet         → Bearer token via v2 API
 * Reply/Comment   → Bearer token via v2 API (user submits their tweet URL)
 * Quote Tweet     → Bearer token via v2 API (user submits their tweet URL)
 */

const { TwitterApi } = require('twitter-api-v2');

let _bearerClient = null;
let _userClient   = null;

function getBearerClient() {
  if (_bearerClient) return _bearerClient;
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return null;
  _bearerClient = new TwitterApi(token).readOnly;
  return _bearerClient;
}

function getUserClient() {
  if (_userClient) return _userClient;
  const appKey      = process.env.TWITTER_API_KEY;
  const appSecret   = process.env.TWITTER_API_SECRET;
  const accessToken  = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) return null;
  _userClient = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  return _userClient;
}

function extractTweetId(url) {
  const m = String(url || '').match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractUsername(url) {
  if (!url) return null;
  if (String(url).startsWith('@')) return url.replace(/^@/, '').toLowerCase();
  const m = String(url).match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : String(url).replace(/^@/, '').toLowerCase();
}

function isTweetUrl(url) {
  return /https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i.test(String(url || ''));
}

// ── Follow verification (v1.1 OAuth) ─────────────────────────────────────────
async function verifyFollow(targetUsername, twitterUsername) {
  const client = getUserClient();
  if (!client) {
    return { verified: false, reason: 'Twitter OAuth credentials not configured. Contact an admin.' };
  }

  const cleanTarget = String(targetUsername || '').replace(/^@/, '').toLowerCase();
  const cleanSource = String(twitterUsername || '').replace(/^@/, '').toLowerCase();

  if (!cleanTarget || !cleanSource) {
    return { verified: false, reason: 'Invalid Twitter username.' };
  }

  try {
    const data = await client.v1.get('friendships/show.json', {
      source_screen_name: cleanSource,
      target_screen_name: cleanTarget,
    });
    if (data?.relationship?.source?.following === true) {
      return { verified: true };
    }
    return {
      verified: false,
      reason: `@${cleanSource} is not following @${cleanTarget}. Follow the account then tap Verify again.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyFollow error:', err.message);
    if (err.data?.errors?.[0]?.code === 34) {
      return { verified: false, reason: `Twitter user @${cleanTarget} not found.` };
    }
    if (err.data?.errors?.[0]?.code === 50) {
      return { verified: false, reason: `Your Twitter account @${cleanSource} was not found.` };
    }
    return { verified: false, reason: 'Twitter API error checking follow. Try again in a moment.' };
  }
}

// ── Like verification (v1.1 OAuth) ───────────────────────────────────────────
async function verifyLike(tweetId, twitterUsername) {
  const client = getUserClient();
  if (!client) {
    return { verified: false, reason: 'Twitter OAuth credentials not configured. Contact an admin.' };
  }

  const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();
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
      return { verified: false, reason: 'Could not fetch your liked tweets. Try again.' };
    }
    if (tweets.some(t => String(t.id_str) === String(tweetId))) {
      return { verified: true };
    }
    return {
      verified: false,
      reason: `@${clean} has not liked this tweet (checked last 200 likes). Like the tweet then tap Verify again.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyLike error:', err.message);
    if (err.data?.errors?.[0]?.code === 34) {
      return { verified: false, reason: `Twitter user @${clean} not found.` };
    }
    return { verified: false, reason: 'Twitter API error checking like. Try again in a moment.' };
  }
}

// ── Retweet verification (v2 Bearer) ─────────────────────────────────────────
async function verifyRetweet(tweetId, twitterUsername) {
  const client = getBearerClient();
  if (!client) {
    return { verified: false, reason: 'Twitter Bearer token not configured. Contact an admin.' };
  }

  const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();

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
      reason: `@${clean} has not retweeted this tweet. Retweet it then tap Verify again.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyRetweet error:', err.message);
    return { verified: false, reason: 'Twitter API error checking retweet. Try again in a moment.' };
  }
}

// ── Reply/Comment verification (v2 Bearer) — user submits tweet URL ──────────
async function verifyReply(replyUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(replyUrl)) {
    return { verified: false, reason: 'Invalid tweet URL. Please send a valid x.com or twitter.com link.' };
  }

  const client = getBearerClient();
  if (!client) {
    return { verified: false, reason: 'Twitter Bearer token not configured. Contact an admin.' };
  }

  const replyId = extractTweetId(replyUrl);
  if (!replyId) return { verified: false, reason: 'Could not extract tweet ID from URL.' };

  try {
    const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();

    const tweetRes = await client.v2.singleTweet(replyId, {
      'tweet.fields': ['author_id', 'referenced_tweets', 'text', 'conversation_id'],
      'expansions': ['author_id'],
      'user.fields': ['username'],
    });

    const tweet = tweetRes.data;
    if (!tweet) return { verified: false, reason: 'Tweet not found or deleted.' };

    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return { verified: false, reason: `This tweet was not posted by @${clean}. Submit YOUR reply link.` };
    }

    const refs = tweet.referenced_tweets || [];
    const isReply = refs.some(r => r.type === 'replied_to' && r.id === originalTweetId)
      || tweet.conversation_id === originalTweetId;
    if (!isReply) {
      return { verified: false, reason: 'This tweet is not a reply to the required tweet.' };
    }

    const cleanText = tweet.text
      .replace(/@\w+/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim();
    if (cleanText.length < minChars) {
      return {
        verified: false,
        reason: `Reply too short — minimum ${minChars} characters required (excluding mentions/links). Yours: ${cleanText.length} chars.`,
      };
    }

    const words = cleanText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    if (Object.values(freq).some(c => c >= 3)) {
      return { verified: false, reason: 'Reply contains too many repeated words. Write something original.' };
    }

    return { verified: true };
  } catch (err) {
    console.error('[TwitterVerify] verifyReply error:', err.message);
    return { verified: false, reason: 'Twitter API error. Please try again in a moment.' };
  }
}

// ── Quote Tweet verification (v2 Bearer) — user submits tweet URL ─────────────
async function verifyQuote(quoteTweetUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(quoteTweetUrl)) {
    return { verified: false, reason: 'Invalid tweet URL. Please send a valid x.com or twitter.com link.' };
  }

  const client = getBearerClient();
  if (!client) {
    return { verified: false, reason: 'Twitter Bearer token not configured. Contact an admin.' };
  }

  const quoteId = extractTweetId(quoteTweetUrl);
  if (!quoteId) return { verified: false, reason: 'Could not extract tweet ID from URL.' };

  try {
    const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();

    const tweetRes = await client.v2.singleTweet(quoteId, {
      'tweet.fields': ['author_id', 'referenced_tweets', 'text'],
      'expansions': ['author_id'],
      'user.fields': ['username'],
    });

    const tweet = tweetRes.data;
    if (!tweet) return { verified: false, reason: 'Tweet not found or deleted.' };

    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return { verified: false, reason: `This tweet was not posted by @${clean}. Submit YOUR quote tweet link.` };
    }

    const refs = tweet.referenced_tweets || [];
    if (!refs.some(r => r.type === 'quoted' && r.id === originalTweetId)) {
      return { verified: false, reason: 'This tweet does not quote the required tweet.' };
    }

    const cleanText = tweet.text.replace(/https?:\/\/\S+/g, '').trim();
    if (cleanText.length < minChars) {
      return {
        verified: false,
        reason: `Quote tweet too short — minimum ${minChars} characters required. Yours: ${cleanText.length} chars.`,
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
    return { verified: false, reason: 'Twitter API error. Please try again in a moment.' };
  }
}

module.exports = {
  extractTweetId, extractUsername, isTweetUrl,
  verifyFollow, verifyLike, verifyRetweet, verifyReply, verifyQuote,
};
