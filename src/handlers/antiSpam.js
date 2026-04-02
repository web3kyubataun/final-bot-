const db = require('../database');

const EMOJI_REGEX = /^[\u{1F000}-\\u{1FFFF}\u{2600}-\\u{27FF}\\u{FE00}-\\u{FEFF}\u{200D}\uFE0F\s]*$/u;

function isEmojiOnly(text) {
  return EMOJI_REGEX.test(text.trim());
}

function containsOnlyEmojis(text) {
  const stripped = text.replace(/[\s\​-\u200D\﻿]/g, '');
  if (!stripped) return false;
  const noEmoji = stripped.replace(
    /[\u{1F000}-\u{1FFFF}\u{2600}-\\u{27FF}\\u{FE00}-\\u{FEFF}\u{200D}\uFE0F]/gu,
    ''
  );
  return noEmoji.length === 0;
}

async function checkAntiSpam(bot, msg) {
  if (!msg.text || msg.chat.type === 'private') return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  const group = db.getGroupByTelegramId(String(chatId));
  if (!group) return;

  const minChars = group.min_char_limit || 10;

  if (containsOnlyEmojis(text)) {
    const user = db.upsertUser(userId, msg.from.username, msg.from.first_name);
    db.addWarning(user.id, group.id, 'emoji_only');
    const warns = db.getWarningCount(user.id, group.id);

    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    await bot.sendMessage(
      chatId,
      `*Warning* \\- ${escapeMarkdown(name)}\n\n_Emoji\\-only messages are not allowed in this group\\. Please write a proper reply\\._\n\n_Warning ${warns} received\\._`,
      {
        parse_mode: 'MarkdownV2',
        reply_to_message_id: msg.message_id,
      }
    );
    return;
  }

  const cleanText = text.replace(/[\u{1F000}-\\u{1FFFF}\\u{2600}-\\u{27FF}\\u{FE00}-\\u{FEFF}\u{200D}\uFE0F]/gu, '').trim();

  if (cleanText.length < minChars && cleanText.length > 0) {
    const user = db.upsertUser(userId, msg.from.username, msg.from.first_name);
    db.addWarning(user.id, group.id, 'too_short');
    const warns = db.getWarningCount(user.id, group.id);
    const name = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    await bot.sendMessage(
      chatId,
      `*Warning* \\- ${escapeMarkdown(name)}\n\n_Your message is too short\\. Minimum ${minChars} characters required\\._\n\n_Warning ${warns} received\\._`,
      {
        parse_mode: 'MarkdownV2',
        reply_to_message_id: msg.message_id,
      }
    );
  }
}

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

module.exports = { checkAntiSpam, containsOnlyEmojis };
