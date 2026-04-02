const db = require('../database');
const { escapeMarkdown } = require('../utils/formatter');

function containsOnlyEmojis(text) {
  const cleaned = text.replace(/\s/g, '');
  if (!cleaned) return false;
  // Remove all emoji characters and check if anything is left
  const noEmoji = cleaned.replace(
    /[\\u{1F000}-\\u{1FFFF}\u{2600}-\\u{27FF}\\u{FE00}-\\u{FEFF}\u{200D}\uFE0F\u{1F300}-\\u{1F9FF}\\u{2700}-\u{27BF}]/gu,
    ''
  );
  return noEmoji.length === 0;
}

async function checkAntiSpam(ctx) {
  if (!ctx.message?.text || ctx.chat.type === 'private') return;

  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const text = ctx.message.text;

  const group = db.getGroupByTelegramId(String(chatId));
  if (!group) return;

  const minChars = group.min_char_limit || 10;
  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const name = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'User');

  if (containsOnlyEmojis(text)) {
    db.addWarning(user.id, group.id, 'emoji_only');
    const warns = db.getWarningCount(user.id, group.id);
    await ctx.telegram.sendMessage(
      chatId,
      `*Warning* \\- ${escapeMarkdown(name)}\n\n_Emoji\\-only messages are not allowed here\\. Please write a proper reply\\._\n\n_Warning ${warns} received\\._`,
      { parse_mode: 'MarkdownV2', reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  const cleanText = text
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\\u{27FF}\\u{FE00}-\\u{FEFF}\u{200D}\uFE0F\u{1F300}-\u{1F9FF}\u{2700}-\\u{27BF}]/gu, '')
    .trim();

  if (cleanText.length > 0 && cleanText.length < minChars) {
    db.addWarning(user.id, group.id, 'too_short');
    const warns = db.getWarningCount(user.id, group.id);
    await ctx.telegram.sendMessage(
      chatId,
      `*Warning* \\- ${escapeMarkdown(name)}\n\n_Your message is too short\\. Minimum ${minChars} characters required\\._\n\n_Warning ${warns} received\\._`,
      { parse_mode: 'MarkdownV2', reply_to_message_id: ctx.message.message_id }
    );
  }
}

module.exports = { checkAntiSpam, containsOnlyEmojis };
