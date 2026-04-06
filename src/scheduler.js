const cron  = require('node-cron');
const store = require('./store');

function startScheduler(telegram) {
  // Deactivate expired raids every minute
  cron.schedule('* * * * *', () => {
    const count = store.deactivateExpiredRaids();
    if (count > 0) console.log(`[Scheduler] Deactivated ${count} expired raid(s).`);
  });

  // Post daily leaderboard at 00:00 UTC
  cron.schedule('0 0 * * *', async () => {
    console.log('[Scheduler] Posting daily leaderboards...');
    const groups = store.getAllGroups();
    let posted = 0;
    for (const g of groups) {
      const topicId = g.topics?.leaderboard || null;
      if (!topicId) continue;
      const top = store.getLeaderboard(10);
      if (!top.length) continue;
      const rankLabel = (i) => ['1st','2nd','3rd'][i] || `${i+1}th`;
      const lines = top.map((u, i) => {
        const name = u.username ? `@${u.username}` : `id:${u.id}`;
        return `${rankLabel(i)}. ${name} — <b>${u.points} pts</b>`;
      }).join('\n');
      try {
        await telegram.sendMessage(g.id,
          `<b>Daily Leaderboard</b>\n${'─'.repeat(28)}\n\n${lines}`,
          { parse_mode: 'HTML', message_thread_id: topicId }
        );
        posted++;
      } catch (e) {
        console.error(`[Scheduler] Leaderboard post failed for group ${g.id}:`, e.message);
      }
    }
    console.log(`[Scheduler] Leaderboards posted to ${posted} group(s).`);
  }, { timezone: 'UTC' });

  console.log('[Scheduler] Started — raid expiry (every min) + daily leaderboard (00:00 UTC).');
}

module.exports = { startScheduler };
