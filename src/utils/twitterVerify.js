/**
 * twitterVerify.js — Twitter action verification (strict API mode, zero trust fallbacks)
 *
 * All verifications use real Twitter API only.
 * Errors: { verified: false, needsOAuth: true, reason } | { verified: false, apiError: true, reason } | { verified: false, reason }
 */

const { TwitterApi } = require('twitter-api-v2');

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

// ── LIKE — OAuth required ─────────────────────────────────────────────────────

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
    return {
      verified: false,
      reason: 'Like not detected. Like the tweet on Twitter, then tap Verify again.',
    };
  } catch (e) {
    return apiErrorResult(e);
  }
}

// ── FOLLOW — OAuth required ───────────────────────────────────────────────────

async function verifyFollow(targetHandle, twitterUsername, telegramUserId) {
  const client = await getUserTwitterClient(telegramUserId);
  if (!client) {
    return {
      verified: false, needsOAuth: true,
      reason: 'Your Twitter account is not connected. Go to Settings → Connect Twitter via OAuth to enable Follow verification.',
    };
  }
  try {
    const me = await client.v2.me();

    // Look up the target user ID
    const bearer = bearerClient();
    if (!bearer) {
      return { verified: false, apiError: true, reason: 'Twitter Bearer Token not configured.' };
    }
    const targetUser = await bearer.v2.userByUsername(targetHandle);
    if (!targetUser?.data?.id) {
      return { verified: false, reason: `Twitter account @${targetHandle} not found.` };
    }

    const targetId = targetUser.data.id;
    const following = await client.v2.following(me.data.id, { max_results: 1000 });
    const ids = (following.data?.data || []).map(u => u.id);
    if (ids.includes(targetId)) return { verified: true };
    return {
      verified: false,
      reason: `Follow not detected. Follow @${targetHandle} on Twitter, then tap Verify again.`,
    };
  } catch (e) {
    return apiErrorResult(e);
  }
}

// ── RETWEET — OAuth timeline first, bearer fallback ──────────────────────────

async function verifyRetweet(originalTweetId, twitterUsername, telegramUserId) {
  const client = await getUserTwitterClient(telegramUserId);
  if (!client) {
    return {
      verified: false, needsOAuth: true,
      reason: 'Your Twitter account is not connected. Go to Settings → Connect Twitter via OAuth to enable Retweet verification.',
    };
  }

  try {
    const me = await client.v2.me();
    const timeline = await client.v2.userTimeline(me.data.id, {
      max_results: 100,
      'tweet.fields': ['referenced_tweets'],
      expansions: ['referenced_tweets.id'],
    });
    const tweets = timeline.data?.data || [];
    const found = tweets.some(t =>
      (t.referenced_tweets || []).some(
        r => r.type === 'retweeted' && r.id === String(originalTweetId)
      )
    );
    if (found) return { verified: true };
  } catch (e) {
    const status = e?.code || e?.status;
    if (status === 429) return apiErrorResult(e);
    // Fall through to bearer fallback on other errors
  }

  // Bearer token fallback: check retweeted_by
  try {
    const bearer = bearerClient();
    if (!bearer) {
      return { verified: false, reason: 'Retweet not detected. Retweet the post on Twitter, then tap Verify again.' };
    }
    const retweeters = await bearer.v2.tweetRetweetedBy(String(originalTweetId), { max_results: 100 });
    const handles = (retweeters.data?.data || []).map(u => u.username?.toLowerCase());
    if (twitterUsername && handles.includes(twitterUsername.toLowerCase())) return { verified: true };
  } catch {}

  return {
    verified: false,
    reason: 'Retweet not detected. Retweet the post on Twitter, then tap Verify again.',
  };
}

// ── COMMENT (REPLY) — bearer token ───────────────────────────────────────────

async function verifyReply(replyTweetUrl, originalTweetId, twitterUsername, minChars) {
  const tweetId = extractTweetId(replyTweetUrl);
  if (!tweetId) {
    return { verified: false, reason: 'Invalid reply tweet URL. Paste the URL of YOUR reply tweet.' };
  }

  const bearer = bearerClient();
  if (!bearer) {
    return { verified: false, apiError: true, reason: 'Twitter Bearer Token not configured on this bot.' };
  }

  try {
    const tweet = await bearer.v2.singleTweet(tweetId, {
      'tweet.fields': ['referenced_tweets', 'text', 'author_id'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });

    if (!tweet?.data) {
      return { verified: false, reason: 'Tweet not found. Make sure the URL is your reply tweet URL.' };
    }

    const refs = tweet.data.referenced_tweets || [];
    const isReply = refs.some(r => r.type === 'replied_to');
    if (!isReply) {
      return { verified: false, reason: 'This tweet is not a reply. Post a reply to the task tweet, then submit its URL.' };
    }

    // Must reply to the CORRECT tweet
    if (originalTweetId) {
      const repliesToCorrect = refs.some(r => r.type === 'replied_to' && r.id === String(originalTweetId));
      if (!repliesToCorrect) {
        return { verified: false, reason: 'This reply is not a reply to the correct tweet. Make sure you replied to the task tweet.' };
      }
    }

    // Author must match — look up by author_id, not by array index
    if (twitterUsername) {
      const authorId = tweet.data.author_id;
      const author   = (tweet.includes?.users || []).find(u => u.id === authorId);
      if (author && author.username.toLowerCase() !== twitterUsername.toLowerCase()) {
        return { verified: false, reason: `This reply does not belong to your Twitter account (@${twitterUsername}).` };
      }
    }

    // Min chars — strip the leading @mention before counting
    if (minChars > 0) {
      const bodyText = tweet.data.text.replace(/^@\w+\s*/, '').trim();
      if (bodyText.length < minChars) {
        return {
          verified: false,
          reason: `Reply too short — minimum ${minChars} characters required (yours: ${bodyText.length}). Edit or repost with more text, then submit its URL again.`,
        };
      }
    }

    return { verified: true };
  } catch (e) {
    return apiErrorResult(e);
  }
}

// ── QUOTE TWEET — bearer token ────────────────────────────────────────────────

async function verifyQuote(quoteTweetUrl, originalTweetId, twitterUsername, minChars) {
  const tweetId = extractTweetId(quoteTweetUrl);
  if (!tweetId) {
    return { verified: false, reason: 'Invalid quote tweet URL. Paste the URL of YOUR quote tweet.' };
  }

  const bearer = bearerClient();
  if (!bearer) {
    return { verified: false, apiError: true, reason: 'Twitter Bearer Token not configured on this bot.' };
  }

  try {
    const tweet = await bearer.v2.singleTweet(tweetId, {
      'tweet.fields': ['referenced_tweets', 'text', 'author_id'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });

    if (!tweet?.data) {
      return { verified: false, reason: 'Tweet not found. Make sure the URL is your quote tweet URL.' };
    }

    const refs = tweet.data.referenced_tweets || [];
    const isQuote = refs.some(r => r.type === 'quoted');
    if (!isQuote) {
      return { verified: false, reason: 'This tweet is not a quote tweet. Post a quote tweet, then submit its URL.' };
    }

    // Must quote the CORRECT tweet
    if (originalTweetId) {
      const quotesCorrect = refs.some(r => r.type === 'quoted' && r.id === String(originalTweetId));
      if (!quotesCorrect) {
        return { verified: false, reason: 'This quote tweet does not quote the correct post. Make sure you quoted the task tweet.' };
      }
    }

    // Author must match — look up by author_id, not by array index
    if (twitterUsername) {
      const authorId = tweet.data.author_id;
      const author   = (tweet.includes?.users || []).find(u => u.id === authorId);
      if (author && author.username.toLowerCase() !== twitterUsername.toLowerCase()) {
        return { verified: false, reason: `This quote tweet does not belong to your Twitter account (@${twitterUsername}).` };
      }
    }

    // Min chars
    if (minChars > 0 && tweet.data.text.length < minChars) {
      return {
        verified: false,
        reason: `Quote tweet too short — minimum ${minChars} characters required (yours: ${tweet.data.text.length}). Repost with more text, then submit its URL again.`,
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
  verifyRetweet,
  verifyReply,
  verifyQuote,
};
