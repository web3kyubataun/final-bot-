/**
 * twitterVerify.js — Twitter action verification
 *
 * Verification strategy:
 *   - If user has OAuth tokens stored → use real API calls
 *   - If no tokens / API error → trust-based fallback (returns verified: true with trustBased flag)
 *   - Bearer token (TWITTER_BEARER_TOKEN) used for read-only checks (retweet/comment/quote URL verification)
 */

const { TwitterApi } = require('twitter-api-v2');

const TWITTER_URL_RE = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i;

// ── URL utilities ─────────────────────────────────────────────────────────────

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

// ── OAuth client helper ───────────────────────────────────────────────────────

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
      const { accessToken, refreshToken, expiresIn } = await refreshClient.refreshOAuth2Token(tokens.refresh_token);
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
  if (!token) return null;
  return new TwitterApi(token);
}

// ── verifyLike ────────────────────────────────────────────────────────────────

async function verifyLike(tweetId, twitterUsername, telegramUserId) {
  try {
    const client = await getUserTwitterClient(telegramUserId);
    if (!client) return { verified: true, trustBased: true };

    const me = await client.v2.me();
    const likes = await client.v2.userLikedTweets(me.data.id, { max_results: 100 });
    const ids = (likes.data?.data || []).map(t => t.id);
    return { verified: ids.includes(String(tweetId)) };
  } catch {
    return { verified: true, trustBased: true };
  }
}

// ── verifyFollow ──────────────────────────────────────────────────────────────

async function verifyFollow(targetUsername, twitterUsername, telegramUserId) {
  try {
    const client = await getUserTwitterClient(telegramUserId);
    if (!client) return { verified: true, trustBased: true };

    const me     = await client.v2.me();
    const target = await client.v2.userByUsername(targetUsername);
    if (!target?.data?.id) return { verified: false, reason: 'Target account not found on Twitter.' };

    const following = await client.v2.following(me.data.id, { max_results: 1000 });
    const ids = (following.data?.data || []).map(u => u.id);
    return { verified: ids.includes(target.data.id) };
  } catch {
    return { verified: true, trustBased: true };
  }
}

// ── verifyRetweetUrl ──────────────────────────────────────────────────────────

async function verifyRetweetUrl(retweetUrl, originalTweetId, twitterUsername) {
  try {
    if (!TWITTER_URL_RE.test(retweetUrl)) {
      return { verified: false, reason: 'Invalid URL. Please submit a Twitter/X link.' };
    }
    const retweetId = extractTweetId(retweetUrl);
    if (!retweetId) return { verified: false, reason: 'Could not extract tweet ID from your URL.' };

    const client = bearerClient();
    if (!client) return { verified: true, trustBased: true };

    const tweet = await client.v2.singleTweet(retweetId, {
      'tweet.fields': ['referenced_tweets', 'author_id'],
      expansions:     ['author_id'],
    });
    if (!tweet?.data) return { verified: false, reason: 'Tweet not found.' };

    const refs      = tweet.data.referenced_tweets || [];
    const isRetweet = refs.some(r => r.type === 'retweeted' && r.id === originalTweetId);
    if (!isRetweet) {
      return { verified: false, reason: 'This is not a retweet of the correct post.' };
    }

    if (twitterUsername) {
      const author = tweet.includes?.users?.[0];
      if (author && author.username.toLowerCase() !== twitterUsername.toLowerCase()) {
        return { verified: false, reason: 'This retweet does not belong to your Twitter account.' };
      }
    }

    return { verified: true };
  } catch {
    return { verified: true, trustBased: true };
  }
}

// ── verifyReply (comment) ─────────────────────────────────────────────────────

async function verifyReply(commentUrl, originalTweetId, twitterUsername, minChars) {
  try {
    if (!TWITTER_URL_RE.test(commentUrl)) {
      return { verified: false, reason: 'Invalid URL. Please submit a Twitter/X link.' };
    }
    const commentId = extractTweetId(commentUrl);
    if (!commentId) return { verified: false, reason: 'Could not extract tweet ID from your URL.' };

    const client = bearerClient();
    if (!client) return { verified: true, trustBased: true };

    const tweet = await client.v2.singleTweet(commentId, {
      'tweet.fields': ['referenced_tweets', 'text', 'author_id'],
      expansions:     ['author_id'],
    });
    if (!tweet?.data) return { verified: false, reason: 'Tweet not found.' };

    const refs    = tweet.data.referenced_tweets || [];
    const isReply = refs.some(r => r.type === 'replied_to');
    if (!isReply) {
      return { verified: false, reason: 'This does not appear to be a reply/comment.' };
    }

    if (minChars > 0 && tweet.data.text.length < minChars) {
      return { verified: false, reason: `Comment too short — minimum ${minChars} characters required.` };
    }

    if (twitterUsername) {
      const author = tweet.includes?.users?.[0];
      if (author && author.username.toLowerCase() !== twitterUsername.toLowerCase()) {
        return { verified: false, reason: 'This comment does not belong to your Twitter account.' };
      }
    }

    return { verified: true };
  } catch {
    return { verified: true, trustBased: true };
  }
}

// ── verifyQuote ───────────────────────────────────────────────────────────────

async function verifyQuote(quoteUrl, originalTweetId, twitterUsername, minChars) {
  try {
    if (!TWITTER_URL_RE.test(quoteUrl)) {
      return { verified: false, reason: 'Invalid URL. Please submit a Twitter/X link.' };
    }
    const quoteId = extractTweetId(quoteUrl);
    if (!quoteId) return { verified: false, reason: 'Could not extract tweet ID from your URL.' };

    const client = bearerClient();
    if (!client) return { verified: true, trustBased: true };

    const tweet = await client.v2.singleTweet(quoteId, {
      'tweet.fields': ['referenced_tweets', 'text', 'author_id'],
      expansions:     ['author_id'],
    });
    if (!tweet?.data) return { verified: false, reason: 'Tweet not found.' };

    const refs    = tweet.data.referenced_tweets || [];
    const isQuote = refs.some(r => r.type === 'quoted');
    if (!isQuote) {
      return { verified: false, reason: 'This does not appear to be a quote tweet.' };
    }

    if (minChars > 0 && tweet.data.text.length < minChars) {
      return { verified: false, reason: `Quote tweet too short — minimum ${minChars} characters required.` };
    }

    if (twitterUsername) {
      const author = tweet.includes?.users?.[0];
      if (author && author.username.toLowerCase() !== twitterUsername.toLowerCase()) {
        return { verified: false, reason: 'This quote tweet does not belong to your Twitter account.' };
      }
    }

    return { verified: true };
  } catch {
    return { verified: true, trustBased: true };
  }
}

module.exports = {
  extractTweetId,
  extractUsername,
  verifyLike,
  verifyFollow,
  verifyRetweetUrl,
  verifyReply,
  verifyQuote,
};
