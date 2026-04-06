const express  = require('express');
const { Telegraf } = require('telegraf');

const config    = require('./config');
const botInfo   = require('./botInfo');
const { userMiddleware } = require('./middleware/auth');
const { startScheduler } = require('./scheduler');
const { setBotInstance } = require('./oauth/twitterOAuth');
const { cleanOldStates } = require('./db/sqlite');
const authCallback = require('./routes/authCallback');

const ownerHandler = require('./handlers/owner');
const groupHandler = require('./handlers/group');
const adminHandler = require('./handlers/admin');
const userHandler  = require('./handlers/user');

// ── Validate required env vars ─────────────────────────────────────────────

if (!config.BOT_TOKEN) {
  console.error('[Fatal] BOT_TOKEN is missing.');
  process.exit(1);
}
if (!config.OWNER_IDS.length) {
  console.error('[Fatal] BOT_OWNER_IDS is missing. Set at least one owner Telegram ID.');
  process.exit(1);
}

// ── Express HTTP server ────────────────────────────────────────────────────

const app = express();

app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.use(authCallback);
app.use((_, res) => res.status(404).send('Not found'));

const PORT = config.PORT;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Express listening on port ${PORT}`);
});

// ── Bot setup ──────────────────────────────────────────────────────────────

const bot = new Telegraf(config.BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (ctx.from) {
    const who  = ctx.from.username ? `@${ctx.from.username}` : `id:${ctx.from.id}`;
    const what = ctx.message?.text?.slice(0, 80) || ctx.callbackQuery?.data || ctx.updateType;
    console.log(`[${new Date().toISOString().slice(0, 19)}] ${who} → ${what}`);
  }
  return next();
});

bot.use(userMiddleware);

// Handler registration order: admin session runs before user session
adminHandler.register(bot);
ownerHandler.register(bot);
groupHandler.register(bot);
userHandler.register(bot);

// Catch-all for unknown commands (DM only)
bot.on('message', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  const text = ctx.message?.text;
  if (!text || !text.startsWith('/')) return;
  await ctx.replyWithHTML(
    `<b>Unknown command</b>: <code>${text.split(' ')[0]}</code>\n\nUse /help to see what's available.`
  );
});

bot.catch((err, ctx) => {
  if (err?.response?.error_code === 403) return;
  if (err?.response?.error_code === 400 && err?.message?.includes('message is not modified')) return;
  console.error(`[Bot Error] [${ctx?.updateType}] ${err.message}`);
  ctx?.reply?.('An error occurred. Please try again.').catch(() => {});
});

// ── Launch with retry (handles 409 on rolling deploys) ────────────────────

async function launchBot(attempt = 1) {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.log('[Bot] Webhook cleared.');
  } catch (e) {
    console.warn('[Bot] Could not clear webhook:', e.message);
  }

  try {
    await bot.launch();
    const me = await bot.telegram.getMe();
    botInfo.setBotUsername(me.username);
    setBotInstance(bot);
    console.log(`[Bot] @${me.username} is online`);
    console.log(`[Bot] Owners: ${config.OWNER_IDS.join(', ')}`);
    startScheduler(bot.telegram);

    // Clean expired OAuth states hourly
    setInterval(() => cleanOldStates(), 60 * 60 * 1000);
  } catch (err) {
    console.error(`[Bot] Launch failed (attempt ${attempt}): ${err.message}`);
    if (attempt < 12) {
      const wait = Math.min(attempt * 5000, 30000);
      console.log(`[Bot] Retrying in ${wait / 1000}s…`);
      setTimeout(() => launchBot(attempt + 1), wait);
    } else {
      console.error('[Bot] Max retries reached. HTTP server still running.');
    }
  }
}

launchBot();

process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
