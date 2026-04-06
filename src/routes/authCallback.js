/**
 * authCallback.js — Express route for Twitter OAuth 2.0 callback
 */

const express  = require('express');
const { handleCallback } = require('../oauth/twitterOAuth');

const router = express.Router();

router.get('/auth/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[OAuth Callback] Twitter returned error:', error);
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>❌ Authorization Failed</h2>
        <p>${error}</p>
        <p>Please close this window and try again in the bot.</p>
      </body></html>
    `);
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter.');
  }

  try {
    await handleCallback(code, state);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>✅ Twitter Connected!</h2>
        <p>Your account is now linked. You can close this window and return to the bot.</p>
      </body></html>
    `);
  } catch (e) {
    console.error('[OAuth Callback] Error:', e.message);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>❌ Connection Failed</h2>
        <p>${e.message}</p>
        <p>Please close this window and try again in the bot.</p>
      </body></html>
    `);
  }
});

module.exports = router;
