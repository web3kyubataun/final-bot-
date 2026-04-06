const db = require('../database');
const { formatLeaderboard } = require('../utils/formatter');
const { groupSelectKeyboard } = require('../utils/keyboards');

async function handleLeaderboardCommand(ctx, forcePrivate = false) {
  const userId = ctx.from.id;
  const isPrivate = forcePrivate || ctx.chat.type === 'private';

  if (!isPrivate) {
    const group = db.upsertGroup(String(ctx.chat.id), ctx.chat.title);
    db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
    const entries = db.getLeaderboard(group.id, 10);
    const text = formatLeaderboard(entries, ctx.chat.title);
    return ctx.reply(text, { parse_mode: 'MarkdownV2' });
  }

  const groups = db.getUserGroups(userId);
  if (groups.length === 0) {
    return ctx.telegram.sendMessage(
      userId,
      `*Leaderboard*\n\n_You have not joined any groups with this bot yet\\._`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  if (groups.length === 1) {
    const entries = db.getLeaderboard(groups[0].id, 10);
    const text = formatLeaderboard(entries, groups[0].name);
    return ctx.telegram.sendMessage(userId, text, { parse_mode: 'MarkdownV2' });
  }

  await ctx.telegram.sendMessage(
    userId,
    `*Leaderboard*\n\n_You are in multiple groups\\. Select which group's leaderboard to view:_`,
    { parse_mode: 'MarkdownV2', reply_markup: groupSelectKeyboard(groups) }
  );
}

async function handleLeaderboardGroupSelect(ctx, groupId) {
  await ctx.answerCbQuery();
  const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(parseInt(groupId, 10));
  if (!group) return;

  const entries = db.getLeaderboard(group.id, 10);
  const text = formatLeaderboard(entries, group.name);
  await ctx.telegram.sendMessage(ctx.from.id, text, { parse_mode: 'MarkdownV2' });
}

async function postLeaderboardToGroup(telegram, group) {
  const entries = db.getLeaderboard(group.id, 10);
  const text = formatLeaderboard(entries, group.name);
  const options = { parse_mode: 'MarkdownV2' };
  if (group.leaderboard_topic_id) options.message_thread_id = group.leaderboard_topic_id;

  try {
    await telegram.sendMessage(group.telegram_id, text, options);
  } catch (err) {
    console.error(`[Leaderboard] Failed to post to group ${group.telegram_id}:`, err.message);
  }
}

module.exports = { handleLeaderboardCommand, handleLeaderboardGroupSelect, postLeaderboardToGroup };
