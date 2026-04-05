/**
 * authCallback.js — Express route for Twitter OAuth 2.0 callback
 *
 * Mounts at: GET /auth/twitter/callback
 * Twitter redirects here after user authorization with ?code=...&state=...
 */

const express = require('express');
const router  = express.Router();

let _bot = null;
function setBotInstance(bot) { _bot = bot; }

const { handleCallback } = require('../oauth/twitterOAuth');

router.get('/auth/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.warn('[OAuth callback] User denied access:', error);
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>❌ Authorization Denied</h2>
        <p>You cancelled the Twitter authorization.<br>You can try again from the bot.</p>
      </body></html>
    `);
  }

  if (!code || !state) {
    return res.status(400).send('Bad request: missing code or state');
  }

  const result = await handleCallback(code, state, _bot);

  if (!result.ok) {
    const msg = result.reason === 'expired'
      ? 'This link has expired or was already used. Please request a new one from the bot.'
      : 'Something went wrong during authorization. Please try again from the bot.';
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>⚠️ Authorization Failed</h2>
        <p>${msg}</p>
      </body></html>
    `);
  }

  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>✅ Twitter Connected!</h2>
      <p>Your Twitter account has been linked successfully.<br>
      You can close this page and return to the bot.</p>
    </body></html>
  `);
});

module.exports = { router, setBotInstance };
