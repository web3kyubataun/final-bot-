const cron = require('node-cron');
const db = require('./database');
const { postLeaderboardToGroup } = require('./commands/leaderboard');

function startScheduler(bot) {
  // Post leaderboard to all groups every 24 hours at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    console.log('[Scheduler] Posting daily leaderboards...');
    try {
      const groups = db.getDb().prepare('SELECT * FROM groups WHERE leaderboard_topic_id IS NOT NULL').all();
      for (const group of groups) {
        await postLeaderboardToGroup(bot, group);
      }
      console.log(`[Scheduler] Leaderboards posted to ${groups.length} group(s).`);
    } catch (err) {
      console.error('[Scheduler] Error posting leaderboards:', err.message);
    }
  }, { timezone: 'UTC' });

  console.log('[Scheduler] Daily leaderboard scheduler started (00:00 UTC)');
}

module.exports = { startScheduler };
