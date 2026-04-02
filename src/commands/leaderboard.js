const db = require('../database');
const { formatLeaderboard } = require('../utils/formatter');
const { groupSelectKeyboard } = require('../utils/keyboards');

async function handleLeaderboardCommand(bot, msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';

  if (!isPrivate) {
    const group = db.upsertGroup(String(chatId), msg.chat.title);
    db.upsertUser(userId, msg.from.username, msg.from.first_name);

    const entries = db.getLeaderboard(group.id, 10);
    const text = formatLeaderboard(entries, msg.chat.title);
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
    return;
  }

  const groups = db.getUserGroups(userId);
  if (groups.length === 0) {
    return bot.sendMessage(
      userId,
      `*Leaderboard*\n\n_You have not joined any groups with this bot yet\\._\n\n_Add the bot to your group and use /leaderboard there to get started\\._`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  if (groups.length === 1) {
    const entries = db.getLeaderboard(groups[0].id, 10);
    const text = formatLeaderboard(entries, groups[0].name);
    return bot.sendMessage(userId, text, { parse_mode: 'MarkdownV2' });
  }

  await bot.sendMessage(
    userId,
    `*Leaderboard*\n\n_You are in multiple groups\\. Select which group's leaderboard to view:_`,
    { parse_mode: 'MarkdownV2', reply_markup: groupSelectKeyboard(groups) }
  );
}

async function handleLeaderboardGroupSelect(bot, query, groupId) {
  const userId = query.from.id;
  await bot.answerCallbackQuery(query.id);

  const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(parseInt(groupId, 10));
  if (!group) return;

  const entries = db.getLeaderboard(group.id, 10);
  const text = formatLeaderboard(entries, group.name);

  await bot.sendMessage(userId, text, { parse_mode: 'MarkdownV2' });
}

async function postLeaderboardToGroup(bot, group) {
  const entries = db.getLeaderboard(group.id, 10);
  const text = formatLeaderboard(entries, group.name);

  const options = { parse_mode: 'MarkdownV2' };
  if (group.leaderboard_topic_id) {
    options.message_thread_id = group.leaderboard_topic_id;
  }

  try {
    await bot.sendMessage(group.telegram_id, text, options);
  } catch (err) {
    console.error(`[Leaderboard] Failed to post to group ${group.telegram_id}:`, err.message);
  }
}

module.exports = { handleLeaderboardCommand, handleLeaderboardGroupSelect, postLeaderboardToGroup };
