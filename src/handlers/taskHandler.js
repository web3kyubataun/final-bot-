const db = require('../database');
const tw = require('../twitter');
const { formatTaskLabel, formatTaskVerificationResult, escapeMarkdown } = require('../utils/formatter');
const { raidTaskKeyboard } = require('../utils/keyboards');

async function handleTaskVerify(bot, query, taskId) {
  const userId = query.from.id;
  const chatId = query.message.chat.id;

  const user = db.upsertUser(userId, query.from.username, query.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) {
    return bot.answerCallbackQuery(query.id, { text: 'Task not found.', show_alert: true });
  }

  const raid = db.getRaid(task.raid_id);
  if (!raid || raid.status !== 'active') {
    return bot.answerCallbackQuery(query.id, { text: 'This raid is no longer active.', show_alert: true });
  }

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing && existing.status === 'verified') {
    return bot.answerCallbackQuery(query.id, { text: 'You have already completed this task.', show_alert: true });
  }

  await bot.answerCallbackQuery(query.id);

  if (task.platform === 'twitter') {
    await handleTwitterTask(bot, query, user, task, raid, chatId);
  } else if (task.platform === 'telegram') {
    await handleTelegramTask(bot, query, user, task, raid, chatId);
  }
}

async function handleTwitterTask(bot, query, user, task, raid, chatId) {
  if (!user.twitter_username) {
    await bot.sendMessage(
      query.from.id,
      `*Twitter Username Required*\n\n` +
      `To verify Twitter tasks, please provide your Twitter username\\.\n\n` +
      `_Reply with your Twitter username in this exact format:_\n` +
      `\`@yourusername\`\n\n` +
      `*Example:* \`@johndoe\`\n\n` +
      `_Do not include spaces or special characters other than underscores\\._`,
      { parse_mode: 'MarkdownV2' }
    );

    const sessionData = { waiting_twitter: true, pending_task_id: task.id, pending_raid_id: raid.id, pending_chat_id: chatId };
    db.setAdminSession(query.from.id, 'waiting_twitter_username', sessionData);
    return;
  }

  await verifyTwitterTask(bot, query.from.id, user, task, raid, chatId);
}

async function verifyTwitterTask(bot, dmChatId, user, task, raid, groupChatId) {
  const twitterUser = user.twitter_username;
  const taskLabel = formatTaskLabel(task);
  let result;

  try {
    await bot.sendMessage(
      dmChatId,
      `*Verifying Task*\n\n_${escapeMarkdown(taskLabel)}_\n\n_Please wait while we verify via Twitter API\\.\\.\\._`,
      { parse_mode: 'MarkdownV2' }
    );

    switch (task.type) {
      case 'follow':
        result = await tw.verifyFollow(task.target_username, twitterUser);
        break;

      case 'like': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        result = await tw.verifyLike(tweetId, twitterUser);
        break;
      }

      case 'retweet': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        result = await tw.verifyRetweet(tweetId, twitterUser);
        break;
      }

      case 'quote': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        const group = db.getGroupByTelegramId(String(groupChatId));
        const minChars = group?.min_char_limit || 10;
        await bot.sendMessage(
          dmChatId,
          `*Quote Tweet Verification*\n\n` +
          `_Please send the link to your quote tweet\\._\n\n` +
          `Example: \`https://x.com/username/status/1234567890\``,
          { parse_mode: 'MarkdownV2' }
        );
        db.setAdminSession(dmChatId, 'waiting_quote_link', {
          task_id: task.id, raid_id: raid.id, tweet_id: tweetId,
          group_chat_id: groupChatId, min_chars: minChars,
        });
        return;
      }

      case 'comment': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        const group = db.getGroupByTelegramId(String(groupChatId));
        const minChars = group?.min_char_limit || 10;
        await bot.sendMessage(
          dmChatId,
          `*Comment Verification*\n\n` +
          `_Please send the link to your reply/comment on the tweet\\._\n\n` +
          `Example: \`https://x.com/username/status/1234567890\``,
          { parse_mode: 'MarkdownV2' }
        );
        db.setAdminSession(dmChatId, 'waiting_comment_link', {
          task_id: task.id, raid_id: raid.id, tweet_id: tweetId,
          group_chat_id: groupChatId, min_chars: minChars,
        });
        return;
      }

      default:
        result = { success: false, reason: 'Unknown task type.' };
    }
  } catch (err) {
    console.error('[TaskHandler] Twitter verification error:', err);
    result = { success: false, reason: 'Twitter API error. Please try again later.' };
  }

  await sendVerificationResult(bot, dmChatId, user, task, raid, groupChatId, result);
}

async function handleTelegramTask(bot, query, user, task, raid, chatId) {
  const taskLabel = formatTaskLabel(task);

  if (task.type === 'join') {
    const keyboard = {
      inline_keyboard: [[
        { text: 'I have joined', callback_data: `task:tg_done:${task.id}` },
      ]],
    };
    await bot.sendMessage(
      query.from.id,
      `*Telegram Task*\n\n*Join:* _${escapeMarkdown(task.details || 'the group/channel')}_\n\n` +
      `_After joining, tap the button below\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard }
    );
    return;
  }

  if (task.type === 'react') {
    const keyboard = {
      inline_keyboard: [[
        { text: 'I have reacted', callback_data: `task:tg_done:${task.id}` },
      ]],
    };
    await bot.sendMessage(
      query.from.id,
      `*Telegram Task*\n\n*React to message:* _${escapeMarkdown(task.details || 'the specified message')}_\n\n` +
      `_After reacting, tap the button below\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard }
    );
    return;
  }

  if (task.type === 'send') {
    const keyboard = {
      inline_keyboard: [[
        { text: 'I have sent the message', callback_data: `task:tg_done:${task.id}` },
      ]],
    };
    await bot.sendMessage(
      query.from.id,
      `*Telegram Task*\n\n*Send message in:* _${escapeMarkdown(task.details || 'the group')}_\n\n` +
      `_After sending, tap the button below\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard }
    );
    return;
  }

  await sendVerificationResult(bot, query.from.id, user, task, raid, chatId, { success: true });
}

async function handleTelegramTaskDone(bot, query, taskId) {
  const userId = query.from.id;
  const user = db.upsertUser(userId, query.from.username, query.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return bot.answerCallbackQuery(query.id, { text: 'Task not found.', show_alert: true });

  const raid = db.getRaid(task.raid_id);
  if (!raid) return bot.answerCallbackQuery(query.id, { text: 'Raid not found.', show_alert: true });

  await bot.answerCallbackQuery(query.id);

  const group = db.getGroupByTelegramId(String(query.message?.chat?.id)) ||
    db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(raid.group_id);

  await sendVerificationResult(bot, userId, user, task, raid, group?.telegram_id, { success: true });
}

async function sendVerificationResult(bot, dmChatId, user, task, raid, groupChatId, result) {
  const taskLabel = formatTaskLabel(task);
  const msg = formatTaskVerificationResult(taskLabel, result.success, result.reason);

  await bot.sendMessage(dmChatId, msg, { parse_mode: 'MarkdownV2' });

  if (!result.success) return;

  db.upsertTaskSubmission(user.id, task.id, raid.id, 'verified', null);

  const allDone = db.checkRaidCompletion(user.id, raid.id);
  if (allDone) {
    const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(raid.group_id);
    const awarded = db.awardRaidPoints(user.id, raid.id, raid.group_id, raid.reward);

    if (awarded && group) {
      await bot.sendMessage(
        dmChatId,
        `*Raid Complete*\n\n` +
        `*Task:* _${escapeMarkdown(raid.title)}_\n` +
        `*Reward:* _${raid.reward} points earned_\n\n` +
        `_Well done\\! Keep completing raids to climb the leaderboard\\._`,
        { parse_mode: 'MarkdownV2' }
      );

      if (groupChatId) {
        const name = user.username ? `@${user.username}` : (user.first_name || 'A user');
        await bot.sendMessage(
          groupChatId,
          `*Raid Completed*\n\n_${escapeMarkdown(name)} has completed the raid_ *${escapeMarkdown(raid.title)}* _and earned_ *${raid.reward} points*\\.`,
          { parse_mode: 'MarkdownV2' }
        ).catch(() => {});
      }
    } else if (!awarded) {
      await bot.sendMessage(
        dmChatId,
        `_You have already received points for this raid\\._`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    return;
  }

  const allTasks = db.getTasksByRaid(raid.id);
  const submissions = db.getUserRaidSubmissions(user.id, raid.id);
  const doneIds = submissions.filter((s) => s.status === 'verified').map((s) => s.task_id);
  const remaining = allTasks.filter((t) => !doneIds.includes(t.id));

  if (remaining.length > 0) {
    await bot.sendMessage(
      dmChatId,
      `*Progress Updated*\n\n_${remaining.length} task(s) remaining to complete this raid\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: raidTaskKeyboard(allTasks, doneIds) }
    );
  }
}

async function handleQuoteOrCommentLink(bot, msg, session) {
  const { state, data } = session;
  const userId = msg.from.id;
  const link = msg.text?.trim();

  if (!link || !link.match(/https?:\/\/(www\.)?(twitter|x)\.com\//i)) {
    await bot.sendMessage(
      userId,
      `_Invalid link\\. Please send a valid Twitter/X post link\\._\n\nExample: \`https://x.com/username/status/1234567890\``,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const user = db.upsertUser(userId, msg.from.username, msg.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(data.task_id);
  const raid = db.getRaid(data.raid_id);
  if (!task || !raid) return;

  let result;
  if (state === 'waiting_quote_link') {
    result = await tw.verifyQuoteTweet(link, data.tweet_id, user.twitter_username, data.min_chars || 10);
  } else {
    result = await tw.verifyComment(link, data.tweet_id, user.twitter_username, data.min_chars || 10);
  }

  db.clearAdminSession(userId);
  await sendVerificationResult(bot, userId, user, task, raid, data.group_chat_id, result);
}

async function handleTwitterUsernameInput(bot, msg, session) {
  const userId = msg.from.id;
  const input = msg.text?.trim();

  if (!input || !input.match(/^@?[A-Za-z0-9_]{1,50}$/)) {
    await bot.sendMessage(
      userId,
      `_Invalid Twitter username\\. Please enter just your username without spaces or special characters\\._\n\nExample: \`@johndoe\``,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const clean = input.replace(/^@/, '');
  db.setUserTwitterUsername(userId, clean);

  const user = db.upsertUser(userId, msg.from.username, msg.from.first_name);
  user.twitter_username = clean;

  await bot.sendMessage(
    userId,
    `*Twitter Account Linked*\n\n_Username set to_ \`@${clean}\`\n\n_Now verifying your task\\.\\.\\._`,
    { parse_mode: 'MarkdownV2' }
  );

  const { pending_task_id, pending_raid_id, pending_chat_id } = session.data || {};
  if (pending_task_id && pending_raid_id) {
    db.clearAdminSession(userId);
    const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(pending_task_id);
    const raid = db.getRaid(pending_raid_id);
    if (task && raid) {
      await verifyTwitterTask(bot, userId, user, task, raid, pending_chat_id);
    }
  } else {
    db.clearAdminSession(userId);
  }
}

module.exports = {
  handleTaskVerify,
  handleTelegramTaskDone,
  handleQuoteOrCommentLink,
  handleTwitterUsernameInput,
  verifyTwitterTask,
  sendVerificationResult,
};
