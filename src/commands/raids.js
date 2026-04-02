const db = require('../database');
const { formatActiveRaids, escapeMarkdown, formatRaidMessage } = require('../utils/formatter');
const { submitRaidKeyboard, raidTaskKeyboard } = require('../utils/keyboards');

async function handleRaidsCommand(bot, msg) {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';

  if (!isPrivate) {
    const group = db.upsertGroup(String(chatId), msg.chat.title);
    const raids = db.getActiveRaids(group.id);
    const text = formatActiveRaids(raids, msg.chat.title);
    return bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  }

  const userId = msg.from.id;
  const groups = db.getUserGroups(userId);
  if (groups.length === 0) {
    return bot.sendMessage(
      userId,
      `*Active Raids*\n\n_You have not joined any groups with this bot yet\\._`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  for (const group of groups) {
    const raids = db.getActiveRaids(group.id);
    const text = formatActiveRaids(raids, group.name);
    await bot.sendMessage(userId, text, { parse_mode: 'MarkdownV2' });
  }
}

async function handleRaidSubmit(bot, query, raidId) {
  const userId = query.from.id;
  const chatId = query.message?.chat?.id;

  await bot.answerCallbackQuery(query.id);

  const user = db.upsertUser(userId, query.from.username, query.from.first_name);
  const raid = db.getRaid(parseInt(raidId, 10));

  if (!raid || raid.status !== 'active') {
    return bot.sendMessage(
      userId,
      `*Raid Unavailable*\n\n_This raid is no longer active\\._`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  if (chatId) {
    const group = db.upsertGroup(String(chatId), query.message?.chat?.title);
    const userGroup = db.getUserByTelegramId(userId);
    if (userGroup) db.linkUserToGroup(userGroup.id, group.id);
  }

  const tasks = db.getTasksByRaid(raid.id);
  if (tasks.length === 0) {
    return bot.sendMessage(
      userId,
      `*No Tasks*\n\n_This raid has no tasks configured\\. Contact the admin\\._`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  const submissions = db.getUserRaidSubmissions(user.id, raid.id);
  const doneIds = submissions.filter((s) => s.status === 'verified').map((s) => s.task_id);
  const allDone = db.checkRaidCompletion(user.id, raid.id);

  if (allDone) {
    return bot.sendMessage(
      userId,
      `*Already Completed*\n\n_You have already completed this raid and earned_ *${raid.reward} points*\\.`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  await bot.sendMessage(
    userId,
    `*Raid Tasks*\n\n*${escapeMarkdown(raid.title)}*\n_Reward: ${raid.reward} points_\n\n_Tap a task to verify it\\. Complete all tasks to earn your reward\\._`,
    { parse_mode: 'MarkdownV2', reply_markup: raidTaskKeyboard(tasks, doneIds) }
  );
}

module.exports = { handleRaidsCommand, handleRaidSubmit };
