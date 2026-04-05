/**
   * leaderboard.js — wraps the store-based leaderboard for /leaderboard command.
   */
  const store = require('../store');

  async function handleLeaderboardCommand(ctx) {
    const top = store.getLeaderboard(10);
    if (!top.length) {
      return ctx.replyWithHTML('<b>Leaderboard</b>\n\n<i>No points earned yet. Complete tasks to get on the board!</i>');
    }
    const lines = top.map((u, i) => {
      const rank = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
      const name = u.username ? `@${u.username}` : u.id;
      return `${rank}. ${name} — ${u.points} pts`;
    }).join('\n');
    return ctx.replyWithHTML(`<b>Leaderboard</b>\n${'─'.repeat(28)}\n\n${lines}`);
  }

  module.exports = { handleLeaderboardCommand };
  