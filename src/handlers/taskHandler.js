const db = require('../database');
const tw = require('../twitter');
const { formatTaskLabel, formatTaskVerificationResult, escapeMarkdown } = require('../utils/formatter');
const { raidTaskKeyboard } = require('../utils/keyboards');

async function handleTaskVerify(ctx, taskId) {
  const userId = ctx.from.id;
  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

  if (!task) return ctx.answerCbQuery('Task not found.');

  const raid = db.getRaid(task.raid_id);
  if (!raid || raid.status !== 'active') return ctx.answerCbQuery('This raid is no longer active.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing && existing.status === 'verified') return ctx.answerCbQuery('You have already completed this task.');

  await ctx.answerCbQuery();

  if (task.platform === 'twitter') {
    await handleTwitterTask(ctx, user, task, raid);
  } else {
    await handleTelegramTask(ctx, user, task, raid);
  }
}

async function handleTwitterTask(ctx, user, task, raid) {
  const userId = ctx.from.id;

  if (!user.twitter_username) {
    db.setAdminSession(userId, 'waiting_twitter_username', {
      pending_task_id: task.id,
      pending_raid_id: raid.id,
      pending_chat_id: ctx.chat?.id,
    });
    await ctx.telegram.sendMessage(
      userId,
      `*Twitter Username Required*\n\n` +
      `_To verify Twitter tasks, please provide your Twitter username\\._\n\n` +
      `*Format:* \`@yourusername\`\n\n` +
      `*Example:* \`@johndoe\`\n\n` +
      `_Only the username \\- no spaces, no URL\\._`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  await verifyTwitterTask(ctx.telegram, userId, user, task, raid, ctx.chat?.id);
}

async function verifyTwitterTask(telegram, dmChatId, user, task, raid, groupChatId) {
  const taskLabel = formatTaskLabel(task);
  let result;

  await telegram.sendMessage(
    dmChatId,
    `*Verifying Task*\n\n_${escapeMarkdown(taskLabel)}_\n\n_Please wait while we verify via Twitter API\\.\\.\\._`,
    { parse_mode: 'MarkdownV2' }
  );

  try {
    switch (task.type) {
      case 'follow':
        result = await tw.verifyFollow(task.target_username, user.twitter_username);
        break;
      case 'like': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        result = await tw.verifyLike(tweetId, user.twitter_username);
        break;
      }
      case 'retweet': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        result = await tw.verifyRetweet(tweetId, user.twitter_username);
        break;
      }
      case 'quote': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        const group = db.getGroupByTelegramId(String(groupChatId));
        const minChars = group?.min_char_limit || 10;
        db.setAdminSession(dmChatId, 'waiting_quote_link', {
          task_id: task.id, raid_id: raid.id, tweet_id: tweetId,
          group_chat_id: groupChatId, min_chars: minChars,
        });
        await telegram.sendMessage(
          dmChatId,
          `*Quote Tweet Verification*\n\n_Send the link to your quote tweet\\._\n\nExample: \`https://x.com/username/status/1234567890\``,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      case 'comment': {
        const tweetId = task.tweet_id || tw.extractTweetId(raid.link);
        const group = db.getGroupByTelegramId(String(groupChatId));
        const minChars = group?.min_char_limit || 10;
        db.setAdminSession(dmChatId, 'waiting_comment_link', {
          task_id: task.id, raid_id: raid.id, tweet_id: tweetId,
          group_chat_id: groupChatId, min_chars: minChars,
        });
        await telegram.sendMessage(
          dmChatId,
          `*Comment Verification*\n\n_Send the link to your reply on the tweet\\._\n\nExample: \`https://x.com/username/status/1234567890\``,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      default:
        result = { success: false, reason: 'Unknown task type.' };
    }
  } catch (err) {
    console.error('[TaskHandler] Twitter error:', err.message);
    result = { success: false, reason: 'Twitter API error. Please try again later.' };
  }

  await sendVerificationResult(telegram, dmChatId, user, task, raid, groupChatId, result);
}

async function handleTelegramTask(ctx, user, task, raid) {
  const userId = ctx.from.id;
  const groupChatId = ctx.chat?.id;

  const prompts = {
    join: `*Telegram Task*\n\n*Join:* _${escapeMarkdown(task.details || 'the group/channel')}_\n\n_After joining, tap the button below\\._`,
    react: `*Telegram Task*\n\n*React to:* _${escapeMarkdown(task.details || 'the specified message')}_\n\n_After reacting, tap the button below\\._`,
    send: `*Telegram Task*\n\n*Send message in:* _${escapeMarkdown(task.details || 'the group')}_\n\n_After sending, tap the button below\\._`,
  };

  const keyboard = {
    inline_keyboard: [[{ text: 'Done', callback_data: `task:tg_done:${task.id}` }]],
  };

  await ctx.telegram.sendMessage(
    userId,
    prompts[task.type] || `*Telegram Task*\n\n_Complete the task and tap Done\\._`,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard }
  );
}

async function handleTelegramTaskDone(ctx, taskId) {
  const userId = ctx.from.id;
  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  const raid = db.getRaid(task.raid_id);
  if (!raid) return ctx.answerCbQuery('Raid not found.');

  await ctx.answerCbQuery();

  const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(raid.group_id);
  await sendVerificationResult(ctx.telegram, userId, user, task, raid, group?.telegram_id, { success: true });
}

async function handleQuoteOrCommentLink(ctx, session) {
  const userId = ctx.from.id;
  const link = ctx.message?.text?.trim();
  const { state, data } = session;

  if (!link || !link.match(/https?:\/\/(www\.)?(twitter|x)\.com\//i)) {
    await ctx.reply(
      `_Invalid link\\. Please send a valid Twitter/X post link\\._\n\nExample: \`https://x.com/username/status/1234567890\``,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
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
  await sendVerificationResult(ctx.telegram, userId, user, task, raid, data.group_chat_id, result);
}

async function handleTwitterUsernameInput(ctx) {
  const userId = ctx.from.id;
  const input = ctx.message?.text?.trim();

  if (!input || !input.match(/^@?[A-Za-z0-9_]{1,50}$/)) {
    await ctx.reply(
      `_Invalid Twitter username\\. Enter just your username without spaces\\._\n\nExample: \`@johndoe\``,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const clean = input.replace(/^@/, '');
  db.setUserTwitterUsername(userId, clean);

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  user.twitter_username = clean;

  await ctx.reply(
    `*Twitter Account Linked*\n\n_Username set to_ \`@${clean}\`\n\n_Now verifying your task\\.\\.\\._`,
    { parse_mode: 'MarkdownV2' }
  );

  const session = db.getAdminSession(userId);
  const { pending_task_id, pending_raid_id, pending_chat_id } = session?.data || {};

  db.clearAdminSession(userId);

  if (pending_task_id && pending_raid_id) {
    const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(pending_task_id);
    const raid = db.getRaid(pending_raid_id);
    if (task && raid) {
      await verifyTwitterTask(ctx.telegram, userId, user, task, raid, pending_chat_id);
    }
  }
}

async function sendVerificationResult(telegram, dmChatId, user, task, raid, groupChatId, result) {
  const taskLabel = formatTaskLabel(task);
  const msg = formatTaskVerificationResult(taskLabel, result.success, result.reason);

  await telegram.sendMessage(dmChatId, msg, { parse_mode: 'MarkdownV2' });
  if (!result.success) return;

  db.upsertTaskSubmission(user.id, task.id, raid.id, 'verified', null);

  const allDone = db.checkRaidCompletion(user.id, raid.id);
  if (allDone) {
    const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(raid.group_id);
    const awarded = db.awardRaidPoints(user.id, raid.id, raid.group_id, raid.reward);

    if (awarded) {
      await telegram.sendMessage(
        dmChatId,
        `*Raid Complete*\n\n*Task:* _${escapeMarkdown(raid.title)}_\n*Reward:* _${raid.reward} points earned_\n\n_Well done\\! Keep completing raids to climb the leaderboard\\._`,
        { parse_mode: 'MarkdownV2' }
      );
      if (groupChatId) {
        const name = user.username ? `@${user.username}` : (user.first_name || 'A user');
        await telegram.sendMessage(
          groupChatId,
          `*Raid Completed*\n\n_${escapeMarkdown(name)} has completed_ *${escapeMarkdown(raid.title)}* _and earned_ *${raid.reward} points*\\.`,
          { parse_mode: 'MarkdownV2' }
        ).catch(() => {});
      }
    } else {
      await telegram.sendMessage(dmChatId, `_You have already received points for this raid\\._`, { parse_mode: 'MarkdownV2' });
    }
    return;
  }

  const allTasks = db.getTasksByRaid(raid.id);
  const submissions = db.getUserRaidSubmissions(user.id, raid.id);
  const doneIds = submissions.filter((s) => s.status === 'verified').map((s) => s.task_id);
  const remaining = allTasks.filter((t) => !doneIds.includes(t.id));

  if (remaining.length > 0) {
    await telegram.sendMessage(
      dmChatId,
      `*Progress Updated*\n\n_${remaining.length} task(s) remaining to complete this raid\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: raidTaskKeyboard(allTasks, doneIds) }
    );
  }
}

module.exports = {
  handleTaskVerify,
  handleTelegramTaskDone,
  handleQuoteOrCommentLink,
  handleTwitterUsernameInput,
};
