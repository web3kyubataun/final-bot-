// ─────────────────────────────────────────────────────────────────────────────
//  taskHandler.js  —  Task verification flows
//
//  Rules:
//  - All task interaction happens in DM only
//  - Group "Submit Tasks" button deep-links to bot DM
//  - Twitter: auto-verified via API (follow/like use v1.1; retweet uses v2)
//  - Telegram join: verified via getChatMember
//  - Telegram react/send: user self-reports (mark as done)
// ─────────────────────────────────────────────────────────────────────────────

const db = require('../database');
const tw = require('../utils/twitterVerify');

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
  if (existing && existing.status === 'verified') return ctx.answerCbQuery('You have already completed this task. ✅');

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

  // comment, quote, retweet — URL submission flow (works on Free API tier)
  const urlSubmitTypes = { comment: 'waiting_comment_link', quote: 'waiting_quote_link', retweet: 'waiting_retweet_link' };
  if (urlSubmitTypes[task.type]) {
    db.setAdminSession(dmChatId, urlSubmitTypes[task.type], {
      task_id: task.id,
      raid_id: raid.id,
      min_chars: task.min_chars || 20,
    });
    const keyboard = taskActionKeyboard(task, taskIndex);
    await telegram.sendMessage(
      dmChatId,
      instruction,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard.inline_keyboard?.length ? keyboard : undefined }
    );
    return;
  }

  // follow / like — show instructions + verify button (auto-verified; falls back to trust-based on Free tier)
  const keyboard = taskActionKeyboard(task, taskIndex);
  await telegram.sendMessage(
    dmChatId,
    instruction,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard.inline_keyboard?.length ? keyboard : undefined }
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
      case 'follow': {
        const target = task.target_username || tw.extractUsername(raid.link) || tw.extractUsername(task.task_link);
        result = await tw.verifyFollow(target, user.twitter_username);
        break;
      }
      case 'like': {
        const tweetId = task.tweet_id || tw.extractTweetId(task.task_link) || tw.extractTweetId(raid.link);
        result = await tw.verifyLike(tweetId, user.twitter_username);
        break;
      }
      case 'retweet': {
        const tweetId = task.tweet_id || tw.extractTweetId(task.task_link) || tw.extractTweetId(raid.link);
        result = await tw.verifyRetweet(tweetId, user.twitter_username);
        break;
      }
      default:
        result = { verified: false, reason: 'Unknown task type.' };
    }
  } catch (err) {
    console.error('[TaskHandler] Twitter API error:', err.message);
    result = { verified: false, reason: 'Twitter API error\\. Please try again in a moment\\.' };
  }

  await deliverVerificationResult(telegram, dmChatId, user, task, raid, result);
}

// ─────────────────────────────────────────────
//  Verify button (follow / like / retweet)
// ─────────────────────────────────────────────
async function handleVerifyButton(ctx, taskId) {
  const userId = ctx.from.id;

  if (String(ctx.chat?.id) !== String(userId)) {
    return ctx.answerCbQuery('Please use this in your bot DM.');
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

  if (!task) return ctx.answerCbQuery('Task not found.');
  const raid = db.getRaid(task.raid_id);
  if (!raid || raid.status !== 'active') return ctx.answerCbQuery('Raid no longer active.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing && existing.status === 'verified') return ctx.answerCbQuery('Already verified. ✅');

  if (!user.twitter_username) return ctx.answerCbQuery('Link your Twitter account first.');

  await ctx.answerCbQuery('Verifying…');
  await verifyTwitterTaskNow(ctx.telegram, userId, user, task, raid);
}

// ─────────────────────────────────────────────
//  URL link submission: retweet / quote / comment (DM text input)
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

  db.clearAdminSession(userId);
  await ctx.reply('_Verifying your submission\\.\\.\\._', { parse_mode: 'MarkdownV2' });

  let result;
  const minChars = data.min_chars || task.min_chars || 20;
  const originalTweetId = task.tweet_id || tw.extractTweetId(task.task_link) || tw.extractTweetId(raid.link);

  try {
    if (state === 'waiting_quote_link') {
      result = await tw.verifyQuote(link, originalTweetId, user.twitter_username, minChars);
    } else if (state === 'waiting_retweet_link') {
      result = await tw.verifyRetweetUrl(link, originalTweetId, user.twitter_username);
    } else {
      // waiting_comment_link
      result = await tw.verifyReply(link, originalTweetId, user.twitter_username, minChars);
    }
  } catch (err) {
    console.error('[TaskHandler] Verify error:', err.message);
    result = { verified: false, reason: 'Twitter API error\\. Please try again\\.' };
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

  // DM-only
  if (String(ctx.chat?.id) !== String(userId)) {
    return ctx.answerCbQuery('Please use this in your bot DM.');
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  const raid = db.getRaid(task.raid_id);
  if (!raid || raid.status !== 'active') return ctx.answerCbQuery('Raid no longer active.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing?.status === 'verified') return ctx.answerCbQuery('Already verified! ✅');

  await ctx.answerCbQuery('Verifying…');

  // Parse the channel/group identifier from task_link or details
  const channelId = parseTelegramChannel(task.task_link || task.details);

  if (!channelId) {
    await ctx.telegram.sendMessage(
      userId,
      `⚠️ _No channel configured for this task\\. Contact an admin\\._`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  try {
    const member = await ctx.telegram.getChatMember(channelId, userId);
    const isJoined = ['member', 'administrator', 'creator', 'restricted'].includes(member.status)
      && member.status !== 'kicked'
      && member.status !== 'left';

    if (isJoined) {
      db.upsertTaskSubmission(user.id, taskId, raid.id, 'verified', null);
      await ctx.telegram.sendMessage(
        userId,
        formatVerificationSuccess(formatTaskLabel(task)),
        { parse_mode: 'MarkdownV2' }
      );
      await checkAndAwardRaid(ctx.telegram, userId, user, raid);
    } else {
      await ctx.telegram.sendMessage(
        userId,
        `❌ *Not a Member*\n\n_Join the channel/group first, then tap Verify again\\._`,
        { parse_mode: 'MarkdownV2', reply_markup: telegramTaskActionKeyboard(task) }
      );
    }
  } catch (err) {
    console.error('[TaskHandler] Telegram join verify error:', err.message);

    // Bot is not in the channel — fall back to self-report (trust-based)
    const isBotNotInChannel =
      err.message.includes('bot is not a member') ||
      err.message.includes('CHANNEL_PRIVATE') ||
      err.message.includes('chat not found') ||
      err.message.includes('not enough rights') ||
      err.message.includes('CHANNEL_INVALID') ||
      err.message.includes('Bad Request: member list is inaccessible');

    if (isBotNotInChannel) {
      // We can't verify — trust the user's claim
      db.upsertTaskSubmission(user.id, taskId, raid.id, 'verified', null);
      await ctx.telegram.sendMessage(
        userId,
        `✅ *Join Noted*\n\n_Marked as done\\. Bot cannot verify private channels automatically\\._`,
        { parse_mode: 'MarkdownV2' }
      );
      await checkAndAwardRaid(ctx.telegram, userId, user, raid);
    } else {
      await ctx.telegram.sendMessage(
        userId,
        `_Verification error\\. Please try again in a moment\\._`,
        { parse_mode: 'MarkdownV2' }
      );
    }
  }
}

// ─────────────────────────────────────────────
//  Telegram Mark-as-Done (react / send tasks)
// ─────────────────────────────────────────────
async function handleTelegramTaskDone(ctx, taskId) {
  const userId = ctx.from.id;

  // DM-only
  if (String(ctx.chat?.id) !== String(userId)) {
    return ctx.answerCbQuery('Please use this in your bot DM.');
  }

  const user = db.upsertUser(userId, ctx.from.username, ctx.from.first_name);
  const task = db.getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  const raid = db.getRaid(task.raid_id);
  if (!raid || raid.status !== 'active') return ctx.answerCbQuery('Raid no longer active.');

  const existing = db.getUserTaskSubmission(user.id, taskId);
  if (existing?.status === 'verified') return ctx.answerCbQuery('Already done! ✅');

  await ctx.answerCbQuery();

  db.upsertTaskSubmission(user.id, taskId, raid.id, 'verified', null);

  await ctx.telegram.sendMessage(
    userId,
    formatVerificationSuccess(formatTaskLabel(task)),
    { parse_mode: 'MarkdownV2' }
  );

  await checkAndAwardRaid(ctx.telegram, userId, user, raid);
}

// ─────────────────────────────────────────────
//  Deliver verification result
// ─────────────────────────────────────────────
async function deliverVerificationResult(telegram, dmChatId, user, task, raid, result) {
  const taskLabel = formatTaskLabel(task);

  if (!result.verified) {
    await telegram.sendMessage(
      dmChatId,
      formatVerificationFailed(taskLabel, result.reason),
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  db.upsertTaskSubmission(user.id, task.id, raid.id, 'verified', null);
  await telegram.sendMessage(dmChatId, formatVerificationSuccess(taskLabel), { parse_mode: 'MarkdownV2' });
  await checkAndAwardRaid(telegram, dmChatId, user, raid);
}

// ─────────────────────────────────────────────
//  Check if raid is complete and award points
// ─────────────────────────────────────────────
async function checkAndAwardRaid(telegram, dmChatId, user, raid) {
  const tasks = db.getTasksByRaid(raid.id);
  const submissions = db.getUserRaidSubmissions(user.id, raid.id);
  const doneIds = submissions.filter(s => s.status === 'verified').map(s => s.task_id);

  const allDone = db.checkRaidCompletion(user.id, raid.id);

  if (!allDone) {
    // Show progress — updated task list
    await telegram.sendMessage(
      dmChatId,
      `✅ *Task done\\!* _${doneIds.length} of ${tasks.length} complete\\._\n\n_Complete all tasks to earn your reward\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: raidTaskKeyboard(tasks, doneIds) }
    );
    return;
  }

  // Award points
  const awarded = db.awardRaidPoints(user.id, raid.id, raid.group_id, raid.reward);

  if (awarded) {
    await telegram.sendMessage(
      dmChatId,
      formatRaidComplete(raid, raid.reward),
      { parse_mode: 'MarkdownV2' }
    );
  } else {
    await telegram.sendMessage(
      dmChatId,
      `_You already claimed rewards for this raid\\._`,
      { parse_mode: 'MarkdownV2' }
    );
  }
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

/**
 * Extract a Telegram channel/group identifier from a link or username.
 * Returns @username, @channelname, or a numeric chat ID.
 */
function parseTelegramChannel(input) {
  if (!input) return null;
  const s = String(input).trim();

  // Already a @username
  if (s.startsWith('@')) return s;

  // t.me/channelname or t.me/c/channelId/msgId
  const tme = s.match(/t\.me\/(?:c\/)?([A-Za-z0-9_]+)/i);
  if (tme) return `@${tme[1]}`;

  // Numeric chat ID (e.g., -1001234567890)
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);

  // Plain username without @
  if (/^[A-Za-z0-9_]{3,}$/.test(s)) return `@${s}`;

  return null;
}

/** Get 0-based index of task within its raid's task list */
function getTaskIndex(task, raidId) {
  try {
    const tasks = db.getTasksByRaid(raidId);
    const idx = tasks.findIndex(t => t.id === task.id);
    return idx >= 0 ? idx : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  handleTaskVerify,
  handleVerifyButton,
  handleTelegramTaskDone,
  handleTelegramJoinVerify,
  handleQuoteOrCommentLink,
  handleTwitterUsernameInput,
};
