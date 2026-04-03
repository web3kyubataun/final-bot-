// ─────────────────────────────────────────────────────────────────────────────
//  taskHandler.js  —  Task verification flows
//
//  Rules:
//  - All task interaction happens in DM only
//  - Group "Submit Tasks" button deep-links to bot DM
//  - Twitter: auto-verified via API
//  - Telegram join: verified via getChatMember
//  - Telegram react/send: user self-reports (mark as done)
// ─────────────────────────────────────────────────────────────────────────────

const db = require('../database');
const tw = require('../twitter');
const {
  formatTaskLabel,
  formatTaskInstruction,
  formatVerificationFailed,
  formatVerificationSuccess,
  formatRaidComplete,
  escapeMarkdown,
  divider,
} = require('../utils/formatter');
const { raidTaskKeyboard, taskActionKeyboard, telegramTaskActionKeyboard } = require('../utils/keyboards');

// ─────────────────────────────────────────────
//  Entry: user taps a task button (must be in DM)
// ─────────────────────────────────────────────
async function handleTaskVerify(ctx, taskId) {
  const userId = ctx.from.id;
  const chatId = ctx.chat?.id;

  // Enforce DM-only
  if (String(chatId) !== String(userId)) {
    await ctx.answerCbQuery('Please complete tasks in your bot DM.');
    return;
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

  if (!task) return ctx.answerCbQuery('Task not found.');

  const raid = db.getRaid(task.raid_id);
  if (!raid || raid.status !== 'active') return ctx.answerCbQuery('This raid is no longer active.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing && existing.status === 'verified') return ctx.answerCbQuery('You have already completed this task.');

  await ctx.answerCbQuery();

  if (task.platform === 'telegram') {
    await handleTelegramTaskPrompt(ctx, user, task, raid);
    return;
  }

  // Twitter task — require Twitter username first
  if (!user.twitter_username) {
    db.setAdminSession(userId, 'waiting_twitter_username', {
      pending_task_id: task.id,
      pending_raid_id: raid.id,
    });
    await ctx.telegram.sendMessage(
      userId,
      `*Twitter Account Required*` +
      divider() +
      `_To verify Twitter tasks, link your Twitter username first\\._\n\n` +
      `*Send your Twitter username:*\n` +
      `Format: \`@yourusername\`\n` +
      `Example: \`@johndoe\`\n\n` +
      `_You only need to do this once\\._`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  await initiateTwitterVerification(ctx.telegram, userId, user, task, raid);
}

// ─────────────────────────────────────────────
//  Twitter Task Verification
// ─────────────────────────────────────────────
async function initiateTwitterVerification(telegram, dmChatId, user, task, raid) {
  const taskIndex = getTaskIndex(task, raid.id);
  const instruction = formatTaskInstruction(task, taskIndex);

  if (task.type === 'comment' || task.type === 'quote') {
    // Set session to wait for tweet link submission
    db.setAdminSession(dmChatId, task.type === 'quote' ? 'waiting_quote_link' : 'waiting_comment_link', {
      task_id: task.id,
      raid_id: raid.id,
      min_chars: task.min_chars || 20,
    });

    const keyboard = taskActionKeyboard(task, taskIndex);
    await telegram.sendMessage(
      dmChatId,
      instruction,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined }
    );
    return;
  }

  // follow / like / retweet — show instructions + verify button
  const keyboard = taskActionKeyboard(task, taskIndex);
  await telegram.sendMessage(
    dmChatId,
    instruction,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined }
  );
}

// ─────────────────────────────────────────────
//  Auto-verify via Twitter API
// ─────────────────────────────────────────────
async function verifyTwitterTaskNow(telegram, dmChatId, user, task, raid) {
  await telegram.sendMessage(dmChatId, `_Verifying via Twitter API\\.\\.\\._`, { parse_mode: 'MarkdownV2' });

  let result;
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
      default:
        result = { success: false, reason: 'Unknown task type.' };
    }
  } catch (err) {
    console.error('[TaskHandler] Twitter API error:', err.message);
    result = { success: false, reason: 'Twitter API error\\. Please try again in a moment\\.' };
  }

  await deliverVerificationResult(telegram, dmChatId, user, task, raid, result);
}

// ─────────────────────────────────────────────
//  Verify button (follow / like / retweet)
// ─────────────────────────────────────────────
async function handleVerifyButton(ctx, taskId) {
  const userId = ctx.from.id;

  // Enforce DM-only
  if (String(ctx.chat?.id) !== String(userId)) {
    return ctx.answerCbQuery('Please use this in your bot DM.');
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

  if (!task) return ctx.answerCbQuery('Task not found.');
  const raid = db.getRaid(task.raid_id);
  if (!raid || raid.status !== 'active') return ctx.answerCbQuery('Raid no longer active.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing && existing.status === 'verified') return ctx.answerCbQuery('Already verified.');

  if (!user.twitter_username) return ctx.answerCbQuery('Link your Twitter account first.');

  await ctx.answerCbQuery('Verifying…');
  await verifyTwitterTaskNow(ctx.telegram, userId, user, task, raid);
}

// ─────────────────────────────────────────────
//  Quote / Comment link submission (DM text input)
// ─────────────────────────────────────────────
async function handleQuoteOrCommentLink(ctx, session) {
  const userId = ctx.from.id;
  const link = ctx.message?.text?.trim();
  const { state, data } = session;

  if (!link || !link.match(/https?:\/\/(www\.)?(twitter|x)\.com\//i)) {
    await ctx.reply(
      `_Invalid link\\. Send a valid Twitter/X post URL\\._\n\nExample: \`https://x\\.com/username/status/1234567890\``,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(data.task_id);
  const raid = db.getRaid(data.raid_id);
  if (!task || !raid) {
    await ctx.reply('_Task or raid not found\\._', { parse_mode: 'MarkdownV2' });
    return;
  }

  // Anti-spam: minimum characters check (done inside tw.verifyComment / tw.verifyQuoteTweet)
  db.clearAdminSession(userId);
  await ctx.reply('_Verifying your submission\\.\\.\\._', { parse_mode: 'MarkdownV2' });

  let result;
  const minChars = data.min_chars || task.min_chars || 20;
  const tweetId = task.tweet_id || tw.extractTweetId(raid.link);

  try {
    if (state === 'waiting_quote_link') {
      result = await tw.verifyQuoteTweet(link, tweetId, user.twitter_username, minChars);
    } else {
      result = await tw.verifyComment(link, tweetId, user.twitter_username, minChars);
    }
  } catch (err) {
    console.error('[TaskHandler] Verify error:', err.message);
    result = { success: false, reason: 'Twitter API error\\. Please try again\\.' };
  }

  await deliverVerificationResult(ctx.telegram, userId, user, task, raid, result);
}

// ─────────────────────────────────────────────
//  Twitter Username Input
// ─────────────────────────────────────────────
async function handleTwitterUsernameInput(ctx) {
  const userId = ctx.from.id;
  const input = ctx.message?.text?.trim();

  if (!input || !input.match(/^@?[A-Za-z0-9_]{1,50}$/)) {
    await ctx.reply(
      `_Invalid Twitter username\\. Enter just your handle without spaces or URL\\._\n\nExample: \`@johndoe\``,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const clean = input.replace(/^@/, '').toLowerCase();

  // Check for duplicate Twitter username across Telegram accounts
  const conflict = db.checkTwitterUsernameConflict(clean, userId);
  if (conflict) {
    await ctx.reply(
      `*Username Already Registered*\n\n` +
      `_The Twitter username_ \`@${escapeMarkdown(clean)}\` _is already linked to another Telegram account\\._\n\n` +
      `_If this is your account, contact an admin\\._`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  db.setUserTwitterUsername(userId, clean);

  await ctx.reply(
    `✅ *Twitter Linked*\n\n_Account set to_ \`@${escapeMarkdown(clean)}\`\n\n_Now verifying your task\\.\\.\\._`,
    { parse_mode: 'MarkdownV2' }
  );

  const session = db.getAdminSession(userId);
  const { pending_task_id, pending_raid_id } = session?.data || {};
  db.clearAdminSession(userId);

  if (pending_task_id && pending_raid_id) {
    const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(pending_task_id);
    const raid = db.getRaid(pending_raid_id);
    const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
    user.twitter_username = clean;

    if (task && raid) {
      await initiateTwitterVerification(ctx.telegram, userId, user, task, raid);
    }
  }
}

// ─────────────────────────────────────────────
//  Telegram Task Prompt
// ─────────────────────────────────────────────
async function handleTelegramTaskPrompt(ctx, user, task, raid) {
  const userId = ctx.from.id;
  const taskIndex = getTaskIndex(task, raid.id);
  const instruction = formatTaskInstruction(task, taskIndex);
  const keyboard = telegramTaskActionKeyboard(task);

  await ctx.telegram.sendMessage(
    userId,
    instruction,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard }
  );
}

// ─────────────────────────────────────────────
//  Telegram Join Verification (getChatMember)
// ─────────────────────────────────────────────
async function handleTelegramJoinVerify(ctx, taskId) {
  const userId = ctx.from.id;

  // DM-only check
  if (String(ctx.chat?.id) !== String(userId)) {
    return ctx.answerCbQuery('Please use this in your bot DM.');
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  const raid = db.getRaid(task.raid_id);
  if (!raid) return ctx.answerCbQuery('Raid not found.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing && existing.status === 'verified') {
    return ctx.answerCbQuery('Already verified.');
  }

  await ctx.answerCbQuery('Checking membership…');

  let result = { success: false, reason: 'Could not verify membership.' };

  if (task.target_username) {
    try {
      // target_username stores the channel @username (without @)
      const channelId = `@${task.target_username}`;
      const member = await ctx.telegram.getChatMember(channelId, userId);
      const validStatuses = ['creator', 'administrator', 'member', 'restricted'];

      if (validStatuses.includes(member.status)) {
        result = { success: true };
      } else {
        result = { success: false, reason: `You have not joined @${escapeMarkdown(task.target_username)}\\. Join first, then tap Verify again\\.` };
      }
    } catch (err) {
      console.error('[TaskHandler] getChatMember error:', err.message);
      // If bot can't check (not in channel), fall back to self-report
      result = { success: true };
    }
  } else {
    // No target configured — accept on trust
    result = { success: true };
  }

  await deliverVerificationResult(ctx.telegram, userId, user, task, raid, result);
}

// ─────────────────────────────────────────────
//  Telegram "Mark as Done" button (react / send)
// ─────────────────────────────────────────────
async function handleTelegramTaskDone(ctx, taskId) {
  const userId = ctx.from.id;

  if (String(ctx.chat?.id) !== String(userId)) {
    return ctx.answerCbQuery('Please use this in your bot DM.');
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  const raid = db.getRaid(task.raid_id);
  if (!raid) return ctx.answerCbQuery('Raid not found.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing && existing.status === 'verified') {
    return ctx.answerCbQuery('Already completed.');
  }

  await ctx.answerCbQuery();
  await deliverVerificationResult(ctx.telegram, userId, user, task, raid, { success: true });
}

// ─────────────────────────────────────────────
//  Deliver Result & Progress
// ─────────────────────────────────────────────
async function deliverVerificationResult(telegram, dmChatId, user, task, raid, result) {
  const taskLabel = formatTaskLabel(task);

  if (!result.success) {
    await telegram.sendMessage(
      dmChatId,
      formatVerificationFailed(taskLabel, result.reason),
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  // Mark verified
  db.upsertTaskSubmission(user.id, task.id, raid.id, 'verified', null);

  await telegram.sendMessage(
    dmChatId,
    formatVerificationSuccess(taskLabel),
    { parse_mode: 'MarkdownV2' }
  );

  // Check if all tasks done
  const allDone = db.checkRaidCompletion(user.id, raid.id);

  if (allDone) {
    const awarded = db.awardRaidPoints(user.id, raid.id, raid.group_id, raid.reward);

    if (awarded) {
      await telegram.sendMessage(
        dmChatId,
        formatRaidComplete(raid, raid.reward),
        { parse_mode: 'MarkdownV2' }
      );

      // Sync to Google Sheets
      try {
        const sheetsSync = require('../utils/sheetsSync');
        await sheetsSync.syncUserData(user, raid, raid.reward);
      } catch (_) {}

      // Post completion notice to group
      try {
        const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(raid.group_id);
        if (group?.telegram_id) {
          const name = user.username ? `@${user.username}` : (user.first_name || 'A user');
          const opts = { parse_mode: 'MarkdownV2' };
          if (group.leaderboard_topic_id) opts.message_thread_id = group.leaderboard_topic_id;
          await telegram.sendMessage(
            group.telegram_id,
            `🎉 *Raid Completed*\n\n_${escapeMarkdown(name)} completed_ *${escapeMarkdown(raid.title)}* _and earned_ *${raid.reward} pts*\\.`,
            opts
          ).catch(() => {});
        }
      } catch (_) {}
    } else {
      await telegram.sendMessage(
        dmChatId,
        `_You have already received points for this raid\\._`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    return;
  }

  // Show remaining tasks
  const allTasks = db.getTasksByRaid(raid.id);
  const submissions = db.getUserRaidSubmissions(user.id, raid.id);
  const doneIds = submissions.filter((s) => s.status === 'verified').map((s) => s.task_id);
  const remaining = allTasks.filter((t) => !doneIds.includes(t.id));

  if (remaining.length > 0) {
    await telegram.sendMessage(
      dmChatId,
      `*Progress*\n\n_${remaining.length} task\\(s\\) remaining to complete this raid\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: raidTaskKeyboard(allTasks, doneIds) }
    );
  }
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function getTaskIndex(task, raidId) {
  const tasks = db.getTasksByRaid(raidId);
  return tasks.findIndex((t) => t.id === task.id);
}

module.exports = {
  handleTaskVerify,
  handleVerifyButton,
  handleTelegramTaskDone,
  handleTelegramJoinVerify,
  handleQuoteOrCommentLink,
  handleTwitterUsernameInput,
};
