/**
 * twitterVerify.js — Twitter action verification (strict API mode)
 *
 * Retweet  → API-based: OAuth timeline check first, then bearer retweetedBy fallback
 * Like     → API-based: OAuth userLikedTweets
 * Follow   → API-based: OAuth userFollowing
 * Comment  → URL-based: bearer token fetches the reply tweet and checks it's a reply to the CORRECT tweet
 * Quote    → URL-based: bearer token fetches the quote tweet and checks it quotes the CORRECT tweet
 *
 * Error types returned:
 *   { verified: true }                           — success
 *   { verified: false, needsOAuth: true, reason } — user has no OAuth token
 *   { verified: false, apiError: true, reason }   — Twitter API error / rate limit
 *   { verified: false, reason }                   — task not completed
 */

const { TwitterApi } = require('twitter-api-v2');

const TWITTER_URL_RE = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i;

// ── URL / handle utilities ────────────────────────────────────────────────────

function extractTweetId(url) {
  if (!url) return null;
  const m = String(url).match(/\/status\/(\d+)/i);
  return m ? m[1] : null;
}

function extractUsername(url) {
  if (!url) return null;
  const s = String(url).trim().replace(/^@/, '');
  if (/^[A-Za-z0-9_]{1,50}$/.test(s)) return s.toLowerCase();
  const m = s.match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// ── Standardised API-error result ────────────────────────────────────────────

function apiErrorResult(e) {
  const status = e?.code || e?.status || e?.data?.status;
  if (status === 429) {
    return {
      verified: false, apiError: true,
      reason: 'Twitter API rate limit reached. Please wait 30 seconds and try again.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      verified: false, apiError: true,
      reason: 'Twitter API authorisation error. Please reconnect your Twitter account via Settings → Connect Twitter via OAuth.',
    };
  }
  return {
    verified: false, apiError: true,
    reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.',
  };
}

// ── Client helpers ────────────────────────────────────────────────────────────

async function getUserTwitterClient(telegramUserId) {
  try {
    const { getTokens, saveTokens } = require('../db/sqlite');
    const tokens = getTokens(telegramUserId);
    if (!tokens?.access_token) return null;

    if (tokens.expires_at && Date.now() > tokens.expires_at) {
      if (!tokens.refresh_token) return null;
      const refreshClient = new TwitterApi({
        clientId:     process.env.TWITTER_CLIENT_ID,
        clientSecret: process.env.TWITTER_CLIENT_SECRET,
      });
      const { accessToken, refreshToken, expiresIn } =
        await refreshClient.refreshOAuth2Token(tokens.refresh_token);
      saveTokens(telegramUserId, accessToken, refreshToken, expiresIn);
      return new TwitterApi(accessToken);
    }

    return new TwitterApi(tokens.access_token);
  } catch {
    return null;
  }
}

function bearerClient() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  return token ? new TwitterApi(token) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIKE — OAuth required
// ═══════════════════════════════════════════════════════════════════════════════

async function verifyLike(tweetId, twitterUsername, telegramUserId) {
  const client = await getUserTwitterClient(telegramUserId);
  if (!client) {
    return {
      verified: false, needsOAuth: true,
      reason: 'Your Twitter account is not connected. Go to Settings → Connect Twitter via OAuth to enable Like verification.',
    };
  }
  try {
    const me    = await client.v2.me();
    const likes = await client.v2.userLikedTweets(me.data.id, { max_results: 100 });
    const ids   = (likes.data?.data || []).map(t => t.id);
    if (ids.includes(String(tweetId))) return { verified: true };
    return { verified: false, reason: 'Like not detected. Like the tweet on Twitter first, then tap Verify again.' };
  } catch (e) {
    return apiErrorResult(e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FOLLOW — OAuth required
// ═══════════════════════════════════════════════════════════════════════════════

async function verifyFollow(targetUsername, twitterUsername, telegramUserId) {
  const client = await getUserTwitterClient(telegramUserId);
  if (!client) {
    return {
      verified: false, needsOAuth: true,
      reason: 'Your Twitter account is not connected. Go to Settings → Connect Twitter via OAuth to enable Follow verification.',
    };
  }
  try {
    const me     = await client.v2.me();
    const target = await client.v2.userByUsername(targetUsername);
    if (!target?.data?.id) {
      return { verified: false, reason: 'Target account not found on Twitter.' };
    }
    const following = await client.v2.following(me.data.id, { max_results: 1000 });
    const ids = (following.data?.data || []).map(u => u.id);
    if (ids.includes(target.data.id)) return { verified: true };
    return { verified: false, reason: `Follow not detected. Follow @${targetUsername} on Twitter first, then tap Verify again.` };
  } catch (e) {
    return apiErrorResult(e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RETWEET — No URL needed. API checks directly.
//
//  Strategy:
//    1. If user has OAuth token → scan their recent 100 tweets for a RT of originalTweetId
//    2. If no OAuth token but bearer available → call retweetedBy on the original tweet
//    3. If neither → needsOAuth error
// ═══════════════════════════════════════════════════════════════════════════════

async function verifyRetweet(originalTweetId, twitterUsername, telegramUserId) {
  if (!originalTweetId) {
    return { verified: false, apiError: true, reason: 'Task is missing a tweet ID. Contact an admin.' };
  }

  // Strategy 1: OAuth timeline scan
  const userClient = await getUserTwitterClient(telegramUserId);
  if (userClient) {
    try {
      const me       = await userClient.v2.me();
      const timeline = await userClient.v2.userTimeline(me.data.id, {
        'tweet.fields': ['referenced_tweets'],
        max_results:    100,
        exclude:        ['replies'],
      });
      const tweets = timeline.data?.data || [];
      const found  = tweets.some(t =>
        (t.referenced_tweets || []).some(r => r.type === 'retweeted' && r.id === originalTweetId)
      );
      if (found) return { verified: true };
      return {
        verified: false,
        reason: 'Retweet not found in your recent tweets. Retweet the post first, then tap Verify again.',
      };
    } catch (e) {
      return apiErrorResult(e);
    }
  }

  // Strategy 2: Bearer token retweetedBy check
  const bearer = bearerClient();
  if (bearer) {
    try {
      const retweetedBy = await bearer.v2.tweetRetweetedBy(originalTweetId, { max_results: 100 });
      const usernames = (retweetedBy.data?.data || []).map(u => u.username.toLowerCase());
      if (twitterUsername && usernames.includes(twitterUsername.toLowerCase())) {
        return { verified: true };
      }
      return {
        verified: false,
        reason: twitterUsername
          ? 'Retweet not detected. Retweet the post first, then tap Verify again.'
          : 'Could not verify — your Twitter handle is not linked. Go to Settings first.',
      };
    } catch (e) {
      return apiErrorResult(e);
    }
  }

  // Strategy 3: nothing available
  return {
    verified: false, needsOAuth: true,
    reason: 'Your Twitter account is not connected. Go to Settings → Connect Twitter via OAuth to enable Retweet verification.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMENT (reply) — User submits the URL of their reply tweet
//
//  Checks:
//    - URL is a valid Twitter link
//    - The tweet is a reply (type === 'replied_to')
//    - The reply is to the CORRECT tweet (r.id === originalTweetId)
//    - The author is the correct user (username match)
//    - minChars length check on the tweet text
// ═══════════════════════════════════════════════════════════════════════════════

async function verifyReply(commentUrl, originalTweetId, twitterUsername, minChars) {
  if (!TWITTER_URL_RE.test(commentUrl)) {
    return { verified: false, reason: 'Invalid URL. Please submit a Twitter/X link.' };
  }
  const commentId = extractTweetId(commentUrl);
  if (!commentId) {
    return { verified: false, reason: 'Could not extract tweet ID from your URL.' };
  }

  const client = bearerClient();
  if (!client) {
    return {
      verified: false, apiError: true,
      reason: 'Twitter Bearer Token not configured on the bot. Please contact an admin.',
    };
  }

  try {
    const tweet = await client.v2.singleTweet(commentId, {
      'tweet.fields': ['referenced_tweets', 'text', 'author_id'],
      expansions:     ['author_id'],
    });
    if (!tweet?.data) {
      return { verified: false, reason: 'Tweet not found. Make sure the URL is your reply URL, not the original tweet.' };
    }

    const refs    = tweet.data.referenced_tweets || [];
    const isReply = refs.some(r => r.type === 'replied_to');
    if (!isReply) {
      return { verified: false, reason: 'This tweet is not a reply. Post a reply to the task tweet, then submit its URL.' };
    }

    // ✅ Check it's a reply to the CORRECT tweet
    if (originalTweetId) {
      const repliesToCorrect = refs.some(r => r.type === 'replied_to' && r.id === originalTweetId);
      if (!repliesToCorrect) {
        return { verified: false, reason: 'This reply is not to the correct tweet. Make sure you replied to the task tweet.' };
      }
    }

    // ✅ Author check
    if (twitterUsername) {
      const author = tweet.includes?.users?.[0];
      if (author && author.username.toLowerCase() !== twitterUsername.toLowerCase()) {
        return { verified: false, reason: 'This reply does not belong to your Twitter account (@' + twitterUsername + ').' };
      }
    }

    // ✅ Minimum chars check
    const bodyText = (tweet.data.text || '').replace(/^@\S+\s*/g, '').trim();
    if (minChars > 0 && bodyText.length < minChars) {
      return {
        verified: false,
        reason: `Reply too short — minimum ${minChars} characters required (yours: ${bodyText.length} after @mention). Write a longer reply on Twitter, then submit its URL again.`,
      };
    }

    return { verified: true };
  } catch (e) {
    return apiErrorResult(e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  QUOTE — User submits the URL of their quote tweet
//
//  Checks:
//    - URL is a valid Twitter link
//    - The tweet is a quote (type === 'quoted')
//    - The quote references the CORRECT tweet (r.id === originalTweetId)
//    - Author check
//    - minChars check
// ═══════════════════════════════════════════════════════════════════════════════

async function verifyQuote(quoteUrl, originalTweetId, twitterUsername, minChars) {
  if (!TWITTER_URL_RE.test(quoteUrl)) {
    return { verified: false, reason: 'Invalid URL. Please submit a Twitter/X link.' };
  }
  const quoteId = extractTweetId(quoteUrl);
  if (!quoteId) {
    return { verified: false, reason: 'Could not extract tweet ID from your URL.' };
  }

  const client = bearerClient();
  if (!client) {
    return {
      verified: false, apiError: true,
      reason: 'Twitter Bearer Token not configured on the bot. Please contact an admin.',
    };
  }

  try {
    const tweet = await client.v2.singleTweet(quoteId, {
      'tweet.fields': ['referenced_tweets', 'text', 'author_id'],
      expansions:     ['author_id'],
    });
    if (!tweet?.data) {
      return { verified: false, reason: 'Tweet not found. Make sure the URL is your quote tweet URL.' };
    }

    const refs    = tweet.data.referenced_tweets || [];
    const isQuote = refs.some(r => r.type === 'quoted');
    if (!isQuote) {
      return { verified: false, reason: 'This tweet is not a quote tweet. Post a quote tweet, then submit its URL.' };
    }

    // ✅ Check it quotes the CORRECT tweet
    if (originalTweetId) {
      const quotesCorrect = refs.some(r => r.type === 'quoted' && r.id === originalTweetId);
      if (!quotesCorrect) {
        return { verified: false, reason: 'This quote tweet does not quote the correct post. Make sure you quoted the task tweet.' };
      }
    }

    // ✅ Author check
    if (twitterUsername) {
      const author = tweet.includes?.users?.[0];
      if (author && author.username.toLowerCase() !== twitterUsername.toLowerCase()) {
        return { verified: false, reason: 'This quote tweet does not belong to your Twitter account (@' + twitterUsername + ').' };
      }
    }

    // ✅ Minimum chars check
    if (minChars > 0 && tweet.data.text.length < minChars) {
      return {
        verified: false,
        reason: `Quote tweet too short — minimum ${minChars} characters required (yours: ${tweet.data.text.length}). Edit or repost with more text, then submit its URL again.`,
      };
    }

    return { verified: true };
  } catch (e) {
    return apiErrorResult(e);
  }
}

module.exports = {
  extractTweetId,
  extractUsername,
  verifyLike,
  verifyFollow,
  verifyRetweet,   // renamed from verifyRetweetUrl — no URL needed
  verifyReply,
  verifyQuote,
};
