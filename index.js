require('dotenv').config();
const { createBot } = require('./src/bot');
const { startScheduler } = require('./src/scheduler');

async function main() {
  const bot = await createBot();
  if (!bot) process.exit(1);

  // ── 409 Conflict fix ──────────────────────────────────────────────────────
  // Clears any lingering webhook before starting polling.
  // This prevents "409: Conflict: terminated by other getUpdates request"
  // when a previous Railway deployment is still trying to poll.
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.log('[Bot] Webhook cleared — starting polling.');
  } catch (err) {
    console.warn('[Bot] Could not clear webhook (may be fine):', err.message);
  }

  bot.launch();

  startScheduler(bot);

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
