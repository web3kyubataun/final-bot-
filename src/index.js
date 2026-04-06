require('dotenv').config();
const { Telegraf } = require('telegraf');
const config    = require('./config');
const botInfo   = require('./botInfo');
const { userMiddleware, isOwner } = require('./middleware/auth');

const ownerHandler = require('./handlers/owner');
const groupHandler = require('./handlers/group');
const adminHandler = require('./handlers/admin');
const userHandler  = require('./handlers/user');

if (!config.BOT_TOKEN) {
  console.error(' BOT_TOKEN is missing from .env');
  process.exit(1);
}
if (!config.OWNER_IDS.length) {
  console.error(' BOT_OWNER_IDS (or BOT_OWNER_ID) is missing from .env');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// ── Request logger ──────────────────────────────────────
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const who  = ctx.from.username ? `@${ctx.from.username}` : `id:${ctx.from.id}`;
    const what = ctx.message?.text?.slice(0, 50) || ctx.callbackQuery?.data || ctx.updateType;
    console.log(`[${new Date().toISOString().slice(0, 19)}] ${who} → ${what}`);
  }
  return next();
});

// ── User registration & ban check ───────────────────────
bot.use(userMiddleware);

// ── Handler registration (ORDER MATTERS) ───────────────
// 1. Admin session handler + admin panel (before user session)
adminHandler.register(bot);

// 2. Owner-only commands
ownerHandler.register(bot);

// 3. Group setup commands
groupHandler.register(bot);

// 4. User commands + session (last — catches remaining input)
userHandler.register(bot);

// ── Invalid command handler (private chat) ───────────────
bot.on('message', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  const text = ctx.message?.text;
  if (!text) return;

  if (text.startsWith('/')) {
    // Unknown command
    await ctx.replyWithHTML(
      ` <b>Unknown command</b>: <code>${text.split(' ')[0]}</code>\n\n` +
      `Use /help to see what's available.`
    );
  }
  // Non-command stray text in DM — ignore silently (session handler already handled it)
});

// ── Error handler ────────────────────────────────────────
bot.catch((err, ctx) => {
  if (err?.response?.error_code === 403) return; // user blocked bot
  if (err?.response?.error_code === 400 && err?.message?.includes('message is not modified')) return;
  console.error(` [${ctx.updateType}] ${err.message}`);
  ctx.reply(' An error occurred. Please try again.').catch(() => {});
});

// ── Launch ───────────────────────────────────────────────
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

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
