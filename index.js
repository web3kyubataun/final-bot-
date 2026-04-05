require('dotenv').config();
const { Telegraf } = require('telegraf');
const config    = require('./config');
const botInfo   = require('./botInfo');
const { userMiddleware } = require('./middleware/auth');

const ownerHandler = require('./handlers/owner');
const groupHandler = require('./handlers/group');
const adminHandler = require('./handlers/admin');
const userHandler  = require('./handlers/user');

if (!config.BOT_TOKEN) {
  console.error(' BOT_TOKEN is missing from environment variables');
  process.exit(1);
}
if (!config.OWNER_IDS.length) {
  console.error(' BOT_OWNER_IDS (or BOT_OWNER_ID / OWNER_ID) is missing from environment variables');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (ctx.from) {
    const who  = ctx.from.username ? `@${ctx.from.username}` : `id:${ctx.from.id}`;
    const what = ctx.message?.text?.slice(0, 60) || ctx.callbackQuery?.data || ctx.updateType;
    console.log(`[${new Date().toISOString().slice(0, 19)}] ${who} → ${what}`);
  }
  return next();
});

bot.use(userMiddleware);

adminHandler.register(bot);
ownerHandler.register(bot);
groupHandler.register(bot);
userHandler.register(bot);

bot.on('message', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  const text = ctx.message?.text;
  if (!text || !text.startsWith('/')) return;
  await ctx.replyWithHTML(
    ` <b>Unknown command</b>: <code>${text.split(' ')[0]}</code>\n\nUse the menu to navigate.`
  );
});

bot.catch((err, ctx) => {
  if (err?.response?.error_code === 403) return;
  if (err?.response?.error_code === 400 && err?.message?.includes('message is not modified')) return;
  console.error(` [${ctx?.updateType}] ${err.message}`);
  ctx?.reply(' An error occurred. Please try again.').catch(() => {});
});

async function launch() {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.log('[Bot] Webhook cleared.');
  } catch (e) {
    console.warn('[Bot] Could not clear webhook:', e.message);
  }

  bot.launch()
    .then(async () => {
      const me = await bot.telegram.getMe();
      botInfo.setBotUsername(me.username);
      console.log(` @${me.username} is running (polling)`);
      console.log(` Owners: ${config.OWNER_IDS.join(', ')}`);
    })
    .catch(err => {
      console.error(' Failed to launch:', err.message);
      process.exit(1);
    });
}

launch();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
