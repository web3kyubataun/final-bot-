const db = require('../database');
const { escapeMarkdown } = require('../utils/formatter');

async function handleStart(ctx) {
  const userId = ctx.from.id;
  const isPrivate = ctx.chat.type === 'private';

  db.upsertUser(userId, ctx.from.username, ctx.from.first_name);

  if (isPrivate) {
    const name = ctx.from.first_name || 'there';
    await ctx.reply(
      `*Welcome, ${escapeMarkdown(name)}*\n\n` +
      `_Use this bot in your group to participate in raids and earn points\\._\n\n` +
      `*Commands:*\n` +
      `  /leaderboard \\- View the leaderboard\n` +
      `  /raids \\- View active raids\n` +
      `  /mypoints \\- Check your points\n` +
      `  /settwitter \\- Link your Twitter account`,
      { parse_mode: 'MarkdownV2' }
    );
  }
}

async function handleSetTwitter(ctx) {
  const userId = ctx.from.id;
  const isPrivate = ctx.chat.type === 'private';

  if (!isPrivate) {
    const m = await ctx.reply(
      `_Please use /settwitter in a private message with the bot\\._`,
      { parse_mode: 'MarkdownV2', reply_to_message_id: ctx.message.message_id }
    );
    setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 5000);
    return;
  }

  db.setAdminSession(userId, 'waiting_twitter_username', {});
  await ctx.reply(
    `*Link Twitter Account*\n\n_Send your Twitter username to link your account for task verification\\._\n\n` +
    `*Format:* \`@yourusername\`\n\n` +
    `*Example:* \`@johndoe\`\n\n` +
    `_Only the username \\- no spaces, no full URL\\._`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleMyPoints(ctx) {
  const userId = ctx.from.id;
  const isPrivate = ctx.chat.type === 'private';
  const targetChat = isPrivate ? ctx.chat.id : ctx.from.id;

  const user = db.getUserByTelegramId(userId);
  if (!user) {
    return ctx.telegram.sendMessage(targetChat, '_You have not participated in any raids yet\\._', { parse_mode: 'MarkdownV2' });
  }

  const groups = db.getUserGroups(userId);
  if (groups.length === 0) {
    return ctx.telegram.sendMessage(targetChat, '_You have not joined any groups with this bot\\._', { parse_mode: 'MarkdownV2' });
  }

  const lines = groups.map((g) => {
    const pts = db.getUserPoints(user.id, g.id);
    const rank = db.getUserRank(user.id, g.id);
    return (
      `*${escapeMarkdown(g.name || `Group ${g.telegram_id}`)}*\n` +
      `  Points: _${pts?.points || 0}_\n` +
      `  Rank: _${rank?.rank || 'Unranked'}_`
    );
  });

  await ctx.telegram.sendMessage(
    targetChat,
    `*Your Points*\n\n${lines.join('\n\n')}`,
    { parse_mode: 'MarkdownV2' }
  );
}

module.exports = { handleStart, handleSetTwitter, handleMyPoints };
