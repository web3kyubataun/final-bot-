/**
 * twitterOAuth.js — Twitter OAuth 2.0 PKCE flow
 *
 * Required env vars:
 *   TWITTER_CLIENT_ID       — from developer.twitter.com
 *   TWITTER_CLIENT_SECRET   — from developer.twitter.com
 *   TWITTER_CALLBACK_URL    — full callback URL, e.g. https://your-app.railway.app/auth/twitter/callback
 *
 * Flow:
 *   1. generateAuthUrl(telegramUserId) → save PKCE state to DB, return Twitter auth URL
 *   2. User authorizes on Twitter → redirected to TWITTER_CALLBACK_URL?code=...&state=...
 *   3. handleCallback(code, state, bot) → exchange code for tokens, notify user via bot
 *   4. getUserTwitterClient(telegramUserId) → load+refresh tokens, return TwitterApi client
 */

const { TwitterApi } = require('twitter-api-v2');
const crypto         = require('crypto');
const db             = require('../db/sqlite');
const store          = require('../store');

const CLIENT_ID     = process.env.TWITTER_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const CALLBACK_URL  = process.env.TWITTER_CALLBACK_URL;

const SCOPES = ['tweet.read', 'users.read', 'follows.read', 'like.read', 'offline.access'];

function getBaseClient() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET not set');
  }
  return new TwitterApi({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
}

// ── Step 1: Generate auth URL ─────────────────────────────────────────────────

async function generateAuthUrl(telegramUserId) {
  const client = getBaseClient();
  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(CALLBACK_URL, {
    scope: SCOPES,
  });
  db.saveState(state, telegramUserId, codeVerifier);
  return url;
}

// ── Step 2: Handle callback ───────────────────────────────────────────────────

async function handleCallback(code, state, telegramBot) {
  const row = db.popState(state);
  if (!row) {
    console.warn('[OAuth] Unknown or expired state:', state);
    return { ok: false, reason: 'expired' };
  }

  const client = getBaseClient();
  let result;
  try {
    result = await client.loginWithOAuth2({
      code,
      codeVerifier: row.code_verifier,
      redirectUri: CALLBACK_URL,
    });
  } catch (e) {
    console.error('[OAuth] Token exchange failed:', e.message);
    return { ok: false, reason: 'exchange_failed' };
  }

  const { accessToken, refreshToken, expiresIn, client: loggedClient } = result;
  db.saveTokens(row.telegram_user_id, accessToken, refreshToken, expiresIn || 7200);

  // Fetch and store the user's Twitter handle automatically
  let twitterHandle = null;
  try {
    const me = await loggedClient.v2.me({ 'user.fields': ['username'] });
    twitterHandle = me.data?.username?.toLowerCase() || null;
    if (twitterHandle) {
      const existing = store.getUser(row.telegram_user_id);
      // Only set handle if not already set (respect lock)
      if (!existing?.twitter) {
        const conflict = store.checkTwitterUsernameConflict(twitterHandle, row.telegram_user_id);
        if (!conflict) {
          store.setUserField(row.telegram_user_id, 'twitter', twitterHandle);
          store.setUserField(row.telegram_user_id, 'twitterLocked', true);
        }
      }
    }
  } catch (e) {
    console.warn('[OAuth] Could not fetch Twitter handle:', e.message);
  }

  // Notify the user in Telegram
  if (telegramBot) {
    try {
      await telegramBot.telegram.sendMessage(
        row.telegram_user_id,
        `✅ <b>Twitter Connected!</b>\n\n` +
        (twitterHandle ? `Handle: <b>@${twitterHandle}</b>\n` : '') +
        `Your Twitter account is now linked via OAuth.\n` +
        `Follow and Like tasks will now be verified via the Twitter API.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.warn('[OAuth] Could not DM user after connect:', e.message);
    }
  }

  return { ok: true, telegramUserId: row.telegram_user_id };
}

// ── Step 3: Get a ready-to-use client for a user ─────────────────────────────

async function getUserTwitterClient(telegramUserId) {
  const tokens = db.getTokens(telegramUserId);
  if (!tokens) return null;

  const now = Date.now();

  // Token still valid
  if (tokens.expires_at > now) {
    return new TwitterApi(tokens.access_token);
  }

  // Expired — try to refresh
  if (!tokens.refresh_token) {
    db.deleteTokens(telegramUserId);
    return null;
  }

  try {
    const client = getBaseClient();
    const { accessToken, refreshToken, expiresIn } = await client.refreshOAuth2Token(tokens.refresh_token);
    db.saveTokens(telegramUserId, accessToken, refreshToken, expiresIn || 7200);
    return new TwitterApi(accessToken);
  } catch (e) {
    console.warn('[OAuth] Token refresh failed for', telegramUserId, ':', e.message);
    db.deleteTokens(telegramUserId);
    return null;
  }
}

// ── Check if user has connected OAuth ────────────────────────────────────────

function isConnected(telegramUserId) {
  return !!db.getTokens(telegramUserId);
}

function disconnect(telegramUserId) {
  db.deleteTokens(telegramUserId);
}

module.exports = { generateAuthUrl, handleCallback, getUserTwitterClient, isConnected, disconnect };
