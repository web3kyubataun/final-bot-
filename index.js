require('dotenv').config();
const { initDatabase } = require('./src/database');
const { startBot } = require('./src/bot');
const { startScheduler } = require('./src/scheduler');

async function main() {
  console.log('[Bot] Starting Telegram Raid Bot...');

  initDatabase();
  console.log('[Bot] Database initialized');

  const bot = startBot();
  startScheduler(bot);

  console.log('[Bot] Bot is running');
}

main().catch((err) => {
  console.error('[Bot] Fatal error:', err);
  process.exit(1);
});
