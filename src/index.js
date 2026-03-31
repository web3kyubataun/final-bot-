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
  await ctx.reply(
    `📖 <b>Command Reference</b>\n\n` +
    `<b>👤 User Commands</b>\n` +
    `/start — Start the bot\n` +
    `/submit &lt;taskId&gt; &lt;proof&gt; — Submit task proof\n` +
    `/leaderboard — View top users\n` +
    `/profile — Your stats\n` +
    `/settwitter &lt;handle&gt; — Set your Twitter\n` +
    `/setwallet &lt;address&gt; — Set your wallet\n` +
    `/notifications on|off — Toggle DMs\n\n` +
    `<b>🛠️ Admin Commands</b>\n` +
    `/admin — Open admin panel\n` +
    `/createtask Title | Link | Reward\n` +
    `/createraid Title | Link | Reward\n` +
    `/announce &lt;message&gt;\n` +
    `/viewsubmissions — Pending submissions\n` +
    `/addadmin &lt;userId&gt;\n` +
    `/removeadmin &lt;userId&gt;\n` +
    `/ban &lt;userId&gt; | /unban &lt;userId&gt;\n` +
    `/setmode all|group|whitelist\n` +
    `/addemail &lt;gmail&gt;\n\n` +
    `<b>👑 Owner Commands</b>\n` +
    `/addgroup &lt;groupId&gt; — Register a group\n` +
    `/broadcast &lt;message&gt; — Message all users`,
    { parse_mode: 'HTML' }
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
