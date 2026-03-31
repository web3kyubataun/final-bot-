require('dotenv').config();
const { Telegraf } = require('telegraf');
const config = require('./config');
const { userMiddleware } = require('./middleware/auth');

// Handlers
const ownerHandler = require('./handlers/owner');
const adminHandler = require('./handlers/admin');
const userHandler = require('./handlers/user');

if (!config.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// ── Global Middleware ───────────────────────────────────
bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  if (ctx.from) {
    console.log(`[${new Date().toISOString()}] ${ctx.updateType} from ${ctx.from.id} (@${ctx.from.username}) — ${ms}ms`);
  }
});

bot.use(userMiddleware);

// ── /help ───────────────────────────────────────────────
bot.command('help', async (ctx) => {
  await ctx.replyWithHTML(
    `📖 <b>How to Use This Bot</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `<b>👤 For Users</b>\n` +
    `Everything is in the <b>bottom menu buttons</b>:\n` +
    `• 🎯 <b>Tasks</b> — View & submit tasks\n` +
    `• ⚡ <b>Raids</b> — View & join raids\n` +
    `• 🏆 <b>Leaderboard</b> — See top earners\n` +
    `• 👤 <b>My Profile</b> — Points, rank & settings\n` +
    `• ⚙️ <b>Settings</b> — Twitter, wallet, notifications\n\n` +
    `<b>🛠️ For Admins</b>\n` +
    `Use <b>/admin</b> to open the full admin panel.\n` +
    `All actions are available as buttons — no commands needed!\n\n` +
    `<b>👑 For Owner Only</b>\n` +
    `/addgroup &lt;groupId&gt; — Register a group\n` +
    `/broadcast &lt;message&gt; — DM all users\n\n` +
    `<i>Tip: If you don't see the menu buttons, tap the keyboard icon next to the message bar.</i>`
  );
});

// ── Register Handlers ───────────────────────────────────
ownerHandler.register(bot);
adminHandler.register(bot);
userHandler.register(bot);

// ── Error Handler ───────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`❌ Error for ${ctx.updateType}:`, err);
  ctx.reply('⚠️ An error occurred. Please try again.').catch(() => {});
});

// ── Launch ───────────────────────────────────────────────
bot.launch()
  .then(() => {
    console.log('🚀 Bot is running in polling mode...');
    console.log(`🤖 Owner ID: ${config.OWNER_ID}`);
  })
  .catch(err => {
    console.error('❌ Failed to launch bot:', err.message);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
