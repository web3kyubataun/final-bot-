/**
 * twitterVerify.js — Twitter/X task verification
 *
 * All calls use the Bearer token (v2 API only — no v1.1).
 *
 * What works on each plan:
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Task type │ Free tier          │ Basic ($100/mo)             │
 * ├──────────────────────────────────────────────────────────────┤
 * │ Reply     │  auto (tweet lookup)  │  auto                │
 * │ Quote     │  auto (tweet lookup)  │  auto                │
 * │ Retweet   │  auto (tweet lookup)  │  auto                │
 * │ Like      │   trust-based fallback │  auto (liked_tweets)│
 * │ Follow    │   trust-based fallback │  auto (following)   │
 * └──────────────────────────────────────────────────────────────┘
 *
 * For Retweet: user submits their retweet URL (same flow as reply/quote).
 * For Like/Follow on Free tier: auto-verified (trust-based) when API is unavailable.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTweetId(url) {
  const m = String(url || '').match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractUsername(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (s.startsWith('@')) return s.replace(/^@/, '').toLowerCase();
  const m = s.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i);
  if (m) return m[1].toLowerCase();
  // Assume plain username
  return s.replace(/^@/, '').toLowerCase();
}

function isTweetUrl(url) {
  return /https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i.test(String(url || ''));
}

function cleanText(text) {
  return text
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function spamCheck(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.values(freq).some(c => c >= 3);
}

// ── Tweet lookup (works on Free tier) ────────────────────────────────────────

async function fetchTweet(tweetId) {
  const client = getClient();
  if (!client) throw new Error('TWITTER_BEARER_TOKEN not set.');
  return client.v2.singleTweet(tweetId, {
    'tweet.fields': ['author_id', 'referenced_tweets', 'text', 'conversation_id'],
    'expansions':   ['author_id'],
    'user.fields':  ['username'],
  });
}

// ── Follow verification ───────────────────────────────────────────────────────
// Uses v2 following endpoint (requires Basic tier).
// Falls back to trust-based on Free tier so the bot still functions.
async function verifyFollow(targetUsername, twitterUsername) {
  const client = getClient();
  if (!client) {
    return { verified: false, reason: 'TWITTER_BEARER_TOKEN not configured. Contact an admin.' };
  }

  const cleanSource = String(twitterUsername || '').replace(/^@/, '').toLowerCase();
  const cleanTarget = String(targetUsername  || '').replace(/^@/, '').toLowerCase();

  if (!cleanSource || !cleanTarget) {
    return { verified: false, reason: 'Missing Twitter username.' };
  }

  try {
    // Resolve source user ID
    const sourceRes = await client.v2.userByUsername(cleanSource);
    if (!sourceRes.data) {
      return { verified: false, reason: `Twitter user @${cleanSource} not found. Check your username.` };
    }

    // Resolve target user ID
    const targetRes = await client.v2.userByUsername(cleanTarget);
    if (!targetRes.data) {
      return { verified: false, reason: `Target account @${cleanTarget} not found.` };
    }
    const targetId = targetRes.data.id;

    // Paginate through following list
    let paginationToken;
    do {
      const params = { max_results: 1000 };
      if (paginationToken) params.pagination_token = paginationToken;

      const res = await client.v2.following(sourceRes.data.id, params);
      const users = res.data || [];
      if (users.some(u => u.id === targetId)) return { verified: true };
      paginationToken = res.meta?.next_token;
    } while (paginationToken);

    return {
      verified: false,
      reason: `@${cleanSource} is not following @${cleanTarget}. Follow the account, then tap Verify again.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyFollow error:', err.code, err.message);

    // Free tier / insufficient plan — trust the user's claim
    if (isFreeApiError(err)) {
      console.warn('[TwitterVerify] Follow API requires Basic tier — using trust-based fallback.');
      return {
        verified: true,
        trustBased: true,
        note: 'Auto-verified (trust-based) — Follow API requires Basic tier.',
      };
    }

    return { verified: false, reason: 'Twitter API error checking follow. Try again in a moment.' };
  }
}

// ── Like verification ─────────────────────────────────────────────────────────
// Uses v2 liked_tweets endpoint (requires Basic tier).
// Falls back to trust-based on Free tier.
async function verifyLike(tweetId, twitterUsername) {
  const client = getClient();
  if (!client) {
    return { verified: false, reason: 'TWITTER_BEARER_TOKEN not configured. Contact an admin.' };
  }

  const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();
  if (!clean || !tweetId) {
    return { verified: false, reason: 'Missing tweet ID or username.' };
  }

  try {
    // Resolve user ID
    const userRes = await client.v2.userByUsername(clean);
    if (!userRes.data) {
      return { verified: false, reason: `Twitter user @${clean} not found. Check your username.` };
    }

    // Paginate liked tweets
    let paginationToken;
    do {
      const params = { max_results: 100 };
      if (paginationToken) params.pagination_token = paginationToken;

      const res = await client.v2.userLikedTweets(userRes.data.id, params);
      const tweets = res.data || [];
      if (tweets.some(t => t.id === String(tweetId))) return { verified: true };
      paginationToken = res.meta?.next_token;
    } while (paginationToken);

    return {
      verified: false,
      reason: `@${clean} has not liked this tweet. Like it, then tap Verify again.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyLike error:', err.code, err.message);

    // Free tier / insufficient plan — trust the user's claim
    if (isFreeApiError(err)) {
      console.warn('[TwitterVerify] Like API requires Basic tier — using trust-based fallback.');
      return {
        verified: true,
        trustBased: true,
        note: 'Auto-verified (trust-based) — Like API requires Basic tier.',
      };
    }

    return { verified: false, reason: 'Twitter API error checking like. Try again in a moment.' };
  }
}

// ── Retweet verification ──────────────────────────────────────────────────────
// User submits their OWN retweet URL.
// Verified via GET /2/tweets/:id (works on Free tier).
async function verifyRetweetUrl(retweetUrl, originalTweetId, twitterUsername) {
  if (!isTweetUrl(retweetUrl)) {
    return {
      verified: false,
      reason: 'Please send a valid x.com or twitter.com link to YOUR retweet.',
    };
  }

  const rtId = extractTweetId(retweetUrl);
  if (!rtId) return { verified: false, reason: 'Could not extract tweet ID from URL.' };

  const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();

  try {
    const tweetRes = await fetchTweet(rtId);
    const tweet = tweetRes.data;
    if (!tweet) return { verified: false, reason: 'Tweet not found or was deleted.' };

    // Verify author
    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return {
        verified: false,
        reason: `This tweet belongs to @${author?.username || '?'}, not @${clean}. Send YOUR retweet link.`,
      };
    }

    // Verify it's a retweet of the original
    const refs = tweet.referenced_tweets || [];
    if (!refs.some(r => r.type === 'retweeted' && r.id === String(originalTweetId))) {
      return {
        verified: false,
        reason: 'This is not a retweet of the required tweet. Retweet the correct post and send its link.',
      };
    }

    return { verified: true };
  } catch (err) {
    console.error('[TwitterVerify] verifyRetweetUrl error:', err.message);
    return { verified: false, reason: 'Twitter API error. Please try again in a moment.' };
  }
}

// Legacy alias — API-based retweet check (requires Basic tier)
async function verifyRetweet(tweetId, twitterUsername) {
  const client = getClient();
  if (!client) {
    return { verified: false, reason: 'TWITTER_BEARER_TOKEN not configured.' };
  }
  const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();
  try {
    let paginationToken;
    do {
      const params = { max_results: 100 };
      if (paginationToken) params.pagination_token = paginationToken;
      const res = await client.v2.tweetRetweetedBy(tweetId, params);
      const users = res.data || [];
      if (users.some(u => u.username.toLowerCase() === clean)) return { verified: true };
      paginationToken = res.meta?.next_token;
    } while (paginationToken);
    return {
      verified: false,
      reason: `@${clean} has not retweeted this tweet. Retweet it and try again.`,
    };
  } catch (err) {
    console.error('[TwitterVerify] verifyRetweet error:', err.code, err.message);
    if (isFreeApiError(err)) {
      console.warn('[TwitterVerify] retweeted_by requires Basic — using trust-based fallback.');
      return { verified: true, trustBased: true, note: 'Auto-verified (trust-based) — retweeted_by requires Basic tier.' };
    }
    return { verified: false, reason: 'Twitter API error checking retweet. Try again in a moment.' };
  }
}

// ── Reply / Comment verification ──────────────────────────────────────────────
// User submits their reply URL. Verified via GET /2/tweets/:id (Free tier OK).
async function verifyReply(replyUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(replyUrl)) {
    return { verified: false, reason: 'Please send a valid x.com or twitter.com link to YOUR reply tweet.' };
  }

  const replyId = extractTweetId(replyUrl);
  if (!replyId) return { verified: false, reason: 'Could not extract tweet ID from URL.' };

  const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();

  try {
    const tweetRes = await fetchTweet(replyId);
    const tweet = tweetRes.data;
    if (!tweet) return { verified: false, reason: 'Tweet not found or was deleted.' };

    // Check author
    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return {
        verified: false,
        reason: `This tweet belongs to @${author?.username || '?'}, not @${clean}. Send YOUR reply link.`,
      };
    }

    // Check it's actually a reply to the original tweet
    const refs = tweet.referenced_tweets || [];
    const isReply = refs.some(r => r.type === 'replied_to' && r.id === String(originalTweetId))
      || tweet.conversation_id === String(originalTweetId);

    if (!isReply) {
      return { verified: false, reason: 'This is not a reply to the required tweet.' };
    }

    // Content quality checks
    const body = cleanText(tweet.text);
    if (body.length < minChars) {
      return {
        verified: false,
        reason: `Reply too short — need at least ${minChars} characters (excluding mentions/links). Yours: ${body.length} chars.`,
      };
    }
    if (spamCheck(body)) {
      return { verified: false, reason: 'Reply contains too many repeated words. Write something original.' };
    }

    return { verified: true };
  } catch (err) {
    console.error('[TwitterVerify] verifyReply error:', err.message);
    return { verified: false, reason: 'Twitter API error. Please try again in a moment.' };
  }
}

// ── Quote Tweet verification ──────────────────────────────────────────────────
// User submits their quote tweet URL. Verified via GET /2/tweets/:id (Free tier OK).
async function verifyQuote(quoteTweetUrl, originalTweetId, twitterUsername, minChars = 20) {
  if (!isTweetUrl(quoteTweetUrl)) {
    return { verified: false, reason: 'Please send a valid x.com or twitter.com link to YOUR quote tweet.' };
  }

  const quoteId = extractTweetId(quoteTweetUrl);
  if (!quoteId) return { verified: false, reason: 'Could not extract tweet ID from URL.' };

  const clean = String(twitterUsername || '').replace(/^@/, '').toLowerCase();

  try {
    const tweetRes = await fetchTweet(quoteId);
    const tweet = tweetRes.data;
    if (!tweet) return { verified: false, reason: 'Tweet not found or was deleted.' };

    // Check author
    const author = tweetRes.includes?.users?.find(u => u.id === tweet.author_id);
    if (!author || author.username.toLowerCase() !== clean) {
      return {
        verified: false,
        reason: `This tweet belongs to @${author?.username || '?'}, not @${clean}. Send YOUR quote tweet link.`,
      };
    }

    // Check it quotes the original
    const refs = tweet.referenced_tweets || [];
    if (!refs.some(r => r.type === 'quoted' && r.id === String(originalTweetId))) {
      return { verified: false, reason: 'This tweet does not quote the required tweet.' };
    }

    // Content quality checks
    const body = cleanText(tweet.text);
    if (body.length < minChars) {
      return {
        verified: false,
        reason: `Quote too short — need at least ${minChars} characters (excluding links). Yours: ${body.length} chars.`,
      };
    }
    if (spamCheck(body)) {
      return { verified: false, reason: 'Quote contains too many repeated words. Write something original.' };
    }

    return { verified: true };
  } catch (err) {
    console.error('[TwitterVerify] verifyQuote error:', err.message);
    return { verified: false, reason: 'Twitter API error. Please try again in a moment.' };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when the error is a plan/tier restriction (code 403 or 453) */
function isFreeApiError(err) {
  const code = err.code || err.data?.status || err.response?.data?.status;
  const errCode = err.data?.errors?.[0]?.code || err.errors?.[0]?.code;
  return (
    code === 403 || code === '403' ||
    errCode === 453 || errCode === 403 ||
    String(err.message).includes('453') ||
    String(err.message).includes('subset of X API V2')
  );
}

module.exports = {
  extractTweetId,
  extractUsername,
  isTweetUrl,
  verifyFollow,
  verifyLike,
  verifyRetweet,
  verifyRetweetUrl,
  verifyReply,
  verifyQuote,
};
