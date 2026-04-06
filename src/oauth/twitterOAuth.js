/**
 * twitterOAuth.js — Twitter OAuth 2.0 PKCE flow
 */

const { TwitterApi } = require('twitter-api-v2');
const { saveTokens, saveState, popState } = require('../db/sqlite');
const store = require('../store');

let _bot = null;
function setBotInstance(bot) { _bot = bot; }

function getClient() {
 return new TwitterApi({
 clientId: process.env.TWITTER_CLIENT_ID,
 clientSecret: process.env.TWITTER_CLIENT_SECRET,
 });
}

async function generateAuthUrl(telegramUserId) {
 const client = getClient();
 const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
 process.env.TWITTER_CALLBACK_URL,
 { scope: ['tweet.read', 'users.read', 'follows.read', 'like.read', 'offline.access'] }
 );
 saveState(state, telegramUserId, codeVerifier);
 return url;
}

async function handleCallback(code, state) {
 const row = popState(state);
 if (!row) throw new Error('Invalid or expired OAuth state.');

 const client = getClient();
 const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
 code,
 codeVerifier: row.code_verifier,
 redirectUri: process.env.TWITTER_CALLBACK_URL,
 });

 saveTokens(row.telegram_user_id, accessToken, refreshToken, expiresIn);

 let handle = null;
 try {
 const userClient = new TwitterApi(accessToken);
 const me = await userClient.v2.me({ 'user.fields': ['username'] });
 handle = me?.data?.username?.toLowerCase();

 if (handle) {
 const user = store.getUser(row.telegram_user_id);
 if (user && !user.twitter) {
 const conflict = store.checkTwitterUsernameConflict(handle, row.telegram_user_id);
 if (!conflict) {
 store.setUserField(row.telegram_user_id, 'twitter', handle);
 store.setUserField(row.telegram_user_id, 'twitterLocked', true);
 }
 }
 }

 if (_bot) {
 await _bot.telegram.sendMessage(
 row.telegram_user_id,
` <b>Twitter Connected!</b>\n\n@${handle || 'unknown'} is now linked to your account.\nFollow/Like tasks will now be verified via the real Twitter API.`,
 { parse_mode: 'HTML' }
 );
 }
 } catch (e) {
 console.error('[OAuth] Post-callback auto-fetch failed:', e.message);
 }

 return { telegramUserId: row.telegram_user_id, handle };
}

module.exports = { generateAuthUrl, handleCallback, setBotInstance };
