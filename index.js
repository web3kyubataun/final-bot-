require('dotenv').config();
const { Telegraf } = require('telegraf');
const { initDatabase } = require('./src/database');
const { registerHandlers } = require('./src/bot');
const { startScheduler } = require('./src/scheduler');

async function main() {
  if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not set in environment variables.');
  }

  console.log('[Bot] Starting Telegram Raid Bot...');

  initDatabase();
  console.log('[Bot] Database initialized');

  const bot = new Telegraf(process.env.BOT_TOKEN);

  registerHandlers(bot);
  startScheduler(bot.telegram);

  bot.catch((err, ctx) => {
    console.error('[Bot] Error:', err.message, '| Update:', ctx?.updateType);
  });

  await bot.launch();
  console.log('[Bot] Bot is running');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error('[Bot] Fatal error:', err);
  process.exit(1);
});
