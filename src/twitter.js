const { TwitterApi } = require('twitter-api-v2');

let client;

function getTwitterClient() {
  if (!client) {
    if (!process.env.TWITTER_BEARER_TOKEN) {
      throw new Error('TWITTER_BEARER_TOKEN is not set in environment variables.');
    }
    client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    });
  }
  return client;
}

function extractTweetId(link) {
  const match = link.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

function extractTwitterUsername(link) {
  const match = link.match(/twitter\.com\/([^\/\?]+)|x\.com\/([^\/\?]+)/);
  return match ? (match[1] || match[2]) : null;
}

async function getUserIdByUsername(username) {
  const c = getTwitterClient();
  const clean = username.replace(/^@/, '');
  try {
    const user = await c.v2.userByUsername(clean);
    return user?.data?.id || null;
  } catch {
    return null;
  }
}

async function verifyFollow(targetUsername, userTwitterUsername) {
  try {
    const c = getTwitterClient();
    const targetClean = targetUsername.replace(/^@/, '');
    const userClean = userTwitterUsername.replace(/^@/, '');

    const [targetUser, verifierUser] = await Promise.all([
      c.v2.userByUsername(targetClean),
      c.v2.userByUsername(userClean),
    ]);

    if (!targetUser?.data?.id || !verifierUser?.data?.id) {
      return { success: false, reason: 'Could not find one or both Twitter accounts.' };
    }

    const following = await c.v2.following(verifierUser.data.id, { max_results: 1000 });
    const followingIds = (following?.data || []).map((u) => u.id);

    if (followingIds.includes(targetUser.data.id)) {
      return { success: true };
    }

    let nextToken = following?.meta?.next_token;
    while (nextToken) {
      const next = await c.v2.following(verifierUser.data.id, { max_results: 1000, pagination_token: nextToken });
      const ids = (next?.data || []).map((u) => u.id);
      if (ids.includes(targetUser.data.id)) return { success: true };
      nextToken = next?.meta?.next_token;
    }

    return { success: false, reason: `You have not followed @${targetClean}.` };
  } catch (err) {
    console.error('[Twitter] verifyFollow error:', err.message);
    return { success: false, reason: 'Twitter API error during follow verification.' };
  }
}

async function verifyLike(tweetId, userTwitterUsername) {
  try {
    const c = getTwitterClient();
    const userClean = userTwitterUsername.replace(/^@/, '');
    const user = await c.v2.userByUsername(userClean);
    if (!user?.data?.id) return { success: false, reason: 'Could not find your Twitter account.' };

    const likedTweets = await c.v2.userLikedTweets(user.data.id, { max_results: 100 });
    const liked = (likedTweets?.data || []).some((t) => t.id === tweetId);
    if (liked) return { success: true };

    let nextToken = likedTweets?.meta?.next_token;
    while (nextToken) {
      const next = await c.v2.userLikedTweets(user.data.id, { max_results: 100, pagination_token: nextToken });
      if ((next?.data || []).some((t) => t.id === tweetId)) return { success: true };
      nextToken = next?.meta?.next_token;
    }

    return { success: false, reason: 'Could not verify your like on this tweet.' };
  } catch (err) {
    console.error('[Twitter] verifyLike error:', err.message);
    return { success: false, reason: 'Twitter API error during like verification.' };
  }
}

async function verifyRetweet(tweetId, userTwitterUsername) {
  try {
    const c = getTwitterClient();
    const userClean = userTwitterUsername.replace(/^@/, '');
    const user = await c.v2.userByUsername(userClean);
    if (!user?.data?.id) return { success: false, reason: 'Could not find your Twitter account.' };

    const retweeters = await c.v2.tweetRetweetedBy(tweetId, { max_results: 100 });
    const retweeted = (retweeters?.data || []).some((u) => u.id === user.data.id);
    if (retweeted) return { success: true };

    let nextToken = retweeters?.meta?.next_token;
    while (nextToken) {
      const next = await c.v2.tweetRetweetedBy(tweetId, { max_results: 100, pagination_token: nextToken });
      if ((next?.data || []).some((u) => u.id === user.data.id)) return { success: true };
      nextToken = next?.meta?.next_token;
    }

    return { success: false, reason: 'Could not verify your retweet.' };
  } catch (err) {
    console.error('[Twitter] verifyRetweet error:', err.message);
    return { success: false, reason: 'Twitter API error during retweet verification.' };
  }
}

async function verifyQuoteTweet(quoteTweetLink, originalTweetId, userTwitterUsername, minChars = 10) {
  try {
    const c = getTwitterClient();
    const quoteTweetId = extractTweetId(quoteTweetLink);
    if (!quoteTweetId) return { success: false, reason: 'Invalid quote tweet link provided.' };

    const userClean = userTwitterUsername.replace(/^@/, '');
    const [tweet, user] = await Promise.all([
      c.v2.singleTweet(quoteTweetId, { 'tweet.fields': ['author_id', 'referenced_tweets', 'text'] }),
      c.v2.userByUsername(userClean),
    ]);

    if (!tweet?.data) return { success: false, reason: 'Could not find the quote tweet.' };
    if (!user?.data?.id) return { success: false, reason: 'Could not find your Twitter account.' };

    if (tweet.data.author_id !== user.data.id) {
      return { success: false, reason: 'This quote tweet was not posted by your account.' };
    }

    const refs = tweet.data.referenced_tweets || [];
    const isQuote = refs.some((r) => r.type === 'quoted' && r.id === originalTweetId);
    if (!isQuote) {
      return { success: false, reason: 'This tweet does not quote the required tweet.' };
    }

    const tweetText = tweet.data.text || '';
    const cleanText = tweetText.replace(/https?:\/\/\S+/g, '').trim();

    if (cleanText.length < minChars) {
      return { success: false, reason: `Quote tweet is too short. Minimum ${minChars} characters required (excluding links).` };
    }

    const words = cleanText.toLowerCase().split(/\s+/);
    const wordCounts = {};
    for (const word of words) {
      if (word.length > 3) wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
    const hasSpam = Object.values(wordCounts).some((c) => c >= 3);
    if (hasSpam) {
      return { success: false, reason: 'Quote tweet contains too many repeated words. Please write an original comment.' };
    }

    return { success: true };
  } catch (err) {
    console.error('[Twitter] verifyQuoteTweet error:', err.message);
    return { success: false, reason: 'Twitter API error during quote tweet verification.' };
  }
}

async function verifyComment(commentLink, originalTweetId, userTwitterUsername, minChars = 10) {
  try {
    const c = getTwitterClient();
    const commentId = extractTweetId(commentLink);
    if (!commentId) return { success: false, reason: 'Invalid comment link provided.' };

    const userClean = userTwitterUsername.replace(/^@/, '');
    const [comment, user] = await Promise.all([
      c.v2.singleTweet(commentId, { 'tweet.fields': ['author_id', 'referenced_tweets', 'text', 'conversation_id'] }),
      c.v2.userByUsername(userClean),
    ]);

    if (!comment?.data) return { success: false, reason: 'Could not find the comment/reply.' };
    if (!user?.data?.id) return { success: false, reason: 'Could not find your Twitter account.' };

    if (comment.data.author_id !== user.data.id) {
      return { success: false, reason: 'This comment was not posted by your account.' };
    }

    const refs = comment.data.referenced_tweets || [];
    const isReply = refs.some((r) => r.type === 'replied_to') || comment.data.conversation_id === originalTweetId;
    if (!isReply) {
      return { success: false, reason: 'This tweet is not a reply to the required tweet.' };
    }

    const tweetText = comment.data.text || '';
    const cleanText = tweetText.replace(/@\w+/g, '').replace(/https?:\/\/\S+/g, '').trim();

    if (cleanText.length < minChars) {
      return { success: false, reason: `Comment is too short. Minimum ${minChars} characters required (excluding mentions and links).` };
    }

    const words = cleanText.toLowerCase().split(/\s+/);
    const wordCounts = {};
    for (const word of words) {
      if (word.length > 3) wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
    const hasSpam = Object.values(wordCounts).some((c) => c >= 3);
    if (hasSpam) {
      return { success: false, reason: 'Comment contains too many repeated words. Please write an original comment.' };
    }

    return { success: true };
  } catch (err) {
    console.error('[Twitter] verifyComment error:', err.message);
    return { success: false, reason: 'Twitter API error during comment verification.' };
  }
}

module.exports = {
  extractTweetId,
  extractTwitterUsername,
  getUserIdByUsername,
  verifyFollow,
  verifyLike,
  verifyRetweet,
  verifyQuoteTweet,
  verifyComment,
};
