require('dotenv').config();
const { Telegraf } = require('telegraf');
const config = require('./config');
const { userMiddleware } = require('./middleware/auth');

const ownerHandler  = require('./handlers/owner');
const groupHandler  = require('./handlers/group');
const adminHandler  = require('./handlers/admin');
const userHandler   = require('./handlers/user');

if (!config.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is not set in .env');
  process.exit(1);
}
if (!config.OWNER_ID) {
  console.error('❌ OWNER_ID (BOT_OWNER_ID) is not set in .env');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// ── Global Middleware ───────────────────────────────────
bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  if (ctx.from) {
    const who = ctx.from.username ? `@${ctx.from.username}` : ctx.from.id;
    const what = ctx.message?.text || ctx.callbackQuery?.data || ctx.updateType;
    console.log(`[${new Date().toISOString().split('.')[0]}] ${who} → ${what} (${ms}ms)`);
  }
});

bot.use(userMiddleware);

// ── Handler Registration (ORDER MATTERS) ────────────────
// 1. Admin session + admin callbacks come BEFORE user session
//    so that admin flows are not intercepted by user handler
adminHandler.register(bot);

// 2. Owner commands
ownerHandler.register(bot);

// 3. Group setup commands
groupHandler.register(bot);

// 4. User commands & session (last, catches fallthrough)
userHandler.register(bot);

// ── Catch-all for unrecognised messages ─────────────────
bot.on('message', async (ctx, next) => {
  // Only respond in private chats to unknown messages
  if (ctx.chat?.type !== 'private') return next();
  const text = ctx.message?.text;
  if (!text) return next();
  if (text.startsWith('/')) {
    await ctx.reply('❓ Unknown command. Use /help to see available commands.');
  }
});

// ── Error Handler ───────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`❌ Error handling ${ctx.updateType}:`, err.message);
  if (err.response?.error_code === 403) return; // bot blocked by user
  ctx.reply('⚠️ An error occurred. Please try again.').catch(() => {});
});

// ── Launch ───────────────────────────────────────────────
bot.launch()
  .then(() => {
    console.log('🚀 Bot is running in polling mode');
    console.log(`👑 Owner ID: ${config.OWNER_ID}`);
    console.log(`⚙️  Environment: ${process.env.NODE_ENV || 'development'}`);
  })
  .catch(err => {
    console.error('❌ Failed to launch bot:', err.message);
    process.exit(1);
  });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
