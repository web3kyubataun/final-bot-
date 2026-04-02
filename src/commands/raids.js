const db = require('../database');
const { formatActiveRaids, escapeMarkdown } = require('../utils/formatter');
const { submitRaidKeyboard, raidTaskKeyboard } = require('../utils/keyboards');

async function handleRaidsCommand(ctx) {
  const isPrivate = ctx.chat.type === 'private';
  const userId = ctx.from.id;

  if (!isPrivate) {
    const group = db.upsertGroup(String(ctx.chat.id), ctx.chat.title);
    const raids = db.getActiveRaids(group.id);
    const text = formatActiveRaids(raids, ctx.chat.title);
    return ctx.reply(text, { parse_mode: 'MarkdownV2' });
  }

  const groups = db.getUserGroups(userId);
  if (groups.length === 0) {
    return ctx.telegram.sendMessage(
      userId,
      `*Active Raids*\n\n_You have not joined any groups with this bot yet\\._`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  for (const group of groups) {
    const raids = db.getActiveRaids(group.id);
    const text = formatActiveRaids(raids, group.name);
    await ctx.telegram.sendMessage(userId, text, { parse_mode: 'MarkdownV2' });
  }
}

async function handleRaidSubmit(ctx, raidId) {
  const userId = ctx.from.id;
  const chatId = ctx.chat?.id;

  await ctx.answerCbQuery();

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const raid = db.getRaid(parseInt(raidId, 10));

  if (!raid || raid.status !== 'active') {
    return ctx.telegram.sendMessage(userId, `*Raid Unavailable*\n\n_This raid is no longer active\\._`, { parse_mode: 'MarkdownV2' });
  }

  if (chatId && String(chatId) !== String(userId)) {
    const group = db.upsertGroup(String(chatId), ctx.chat?.title);
    db.linkUserToGroup(user.id, group.id);
  }

  const tasks = db.getTasksByRaid(raid.id);
  if (tasks.length === 0) {
    return ctx.telegram.sendMessage(userId, `*No Tasks*\n\n_This raid has no tasks configured\\._`, { parse_mode: 'MarkdownV2' });
  }

  const allDone = db.checkRaidCompletion(user.id, raid.id);
  if (allDone) {
    return ctx.telegram.sendMessage(
      userId,
      `*Already Completed*\n\n_You have already completed this raid and earned_ *${raid.reward} points*\\.`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  const submissions = db.getUserRaidSubmissions(user.id, raid.id);
  const doneIds = submissions.filter((s) => s.status === 'verified').map((s) => s.task_id);

  await ctx.telegram.sendMessage(
    userId,
    `*Raid Tasks*\n\n*${escapeMarkdown(raid.title)}*\n_Reward: ${raid.reward} points_\n\n_Tap a task to verify it\\. Complete all tasks to earn your reward\\._`,
    { parse_mode: 'MarkdownV2', reply_markup: raidTaskKeyboard(tasks, doneIds) }
  );
}

module.exports = { handleRaidsCommand, handleRaidSubmit };
