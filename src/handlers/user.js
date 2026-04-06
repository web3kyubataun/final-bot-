/**
 * user.js — User-facing handlers
 *
 * Verify flow:
 *   like/follow   → tap "Verify" → Twitter API check (v1.1 with OAuth)
 *   retweet       → tap "Verify" → Twitter API check (v2 bearer)
 *   comment/quote → user sends tweet URL → API verify (author + content check)
 *   join          → tap "Verify" → getChatMember check
 *   react/send    → tap "Done"   → trust-based (cannot be verified remotely)
 */

const store   = require('../store');
const sheets  = require('../services/sheets');
const session = require('../sessions');
const config  = require('../config');
const { getBotUsername } = require('../botInfo');
const {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskListKeyboard, taskCardKeyboard, taskCardDMKeyboard, cancelKeyboard,
} = require('../utils/keyboard');
const tw = require('../utils/twitterVerify');
const { Markup } = require('telegraf');

const TASK_TYPE_LABELS = {
  follow: 'Follow',  like: 'Like',    retweet: 'Retweet',
  comment: 'Comment', quote: 'Quote Tweet',
  join: 'Join Channel/Group', react: 'React to Message', send: 'Send Message',
};

const delay = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════
//  AUTO-AWARD helper
// ═══════════════════════════════════════════════

async function autoAward(ctx, userId, task, proofText) {
  const username = ctx.from.username || ctx.from.first_name || 'unknown';
  const sub = store.createSubmission(
    userId, username, task.groupId, task.id,
    task.title, proofText || 'auto-verified', task.reward, 'text', null
  );

  store.approveSubmission(sub.id);
  store.addPoints(userId, task.reward);

  const user  = store.getUser(userId);
  const group = store.getGroup(task.groupId);

  // Update Google Sheet
  if (group?.sheetId && group.sheetId !== 'none') {
    try {
      await sheets.appendSubmission(group.sheetId, {
        timestamp: new Date().toISOString(), userId, username,
        task: task.title, proof: proofText || 'verified', status: 'approved', points: task.reward,
      });
    } catch (e) { console.error('[Sheets]', e.message); }
  }

  await ctx.replyWithHTML(
    ` <b>Task Verified!</b>\n` +
    `${'─'.repeat(28)}\n` +
    ` <b>${task.title}</b>\n` +
    ` <b>+${task.reward} pts</b> awarded!\n` +
    ` Total: <b>${user?.points ?? '?'} pts</b>\n\n` +
    `Keep completing tasks to climb the leaderboard! `
  );
}

// ═══════════════════════════════════════════════
//  /start  — also handles deeplinks /start submit_N
// ═══════════════════════════════════════════════

async function handleStart(ctx) {
  const payload = ctx.startPayload;

  if (payload?.startsWith('submit_')) {
    const taskId = parseInt(payload.replace('submit_', ''));
    const task   = store.getTask(taskId);

    if (!task || !task.active) {
      return ctx.replyWithHTML(' That task is no longer available.');
    }
    if (store.hasSubmitted(ctx.from.id, task.groupId, taskId)) {
      return ctx.replyWithHTML(' You already completed this task.');
    }

    store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
    return sendTaskCard(ctx, task, true);
  }

  const user = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  await ctx.replyWithHTML(
    ` <b>Welcome!</b> \n` +
    `${'─'.repeat(28)}\n\n` +
    `Hey <b>${ctx.from.first_name}</b>! \n\n` +
    ` Your Points: <b>${user.points}</b>\n` +
    ` Complete tasks & raids to earn points and climb the leaderboard!\n\n` +
    `Use the menu below `,
    mainMenuKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  TASK MENUS
// ═══════════════════════════════════════════════

async function handleTasksMenu(ctx) {
  let tasks = [];
  store.getAllGroups().forEach(g => tasks.push(...store.getTasksForGroup(g.id, 'task')));
  if (!tasks.length) return ctx.replyWithHTML(` <b>Active Tasks</b>\n\n No active tasks right now. Check back soon!`);
  await ctx.replyWithHTML(
    ` <b>Active Tasks</b> (${tasks.length})\n\n<i>Tap a task to view details:</i>`,
    taskListKeyboard(tasks)
  );
}

async function handleRaidsMenu(ctx) {
  let raids = [];
  store.getAllGroups().forEach(g => raids.push(...store.getTasksForGroup(g.id, 'raid')));
  if (!raids.length) return ctx.replyWithHTML(` <b>Active Raids</b>\n\n No raids running right now!`);
  await ctx.replyWithHTML(
    ` <b>Active Raids</b> (${raids.length})\n\n<i>Tap a raid to view details:</i>`,
    taskListKeyboard(raids)
  );
}

// ── View task detail ───────────────────────────────────────────────────────────
async function handleViewTask(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  await ctx.answerCbQuery();
  store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);

  const isInGroup = ctx.chat?.type !== 'private';
  const botName   = getBotUsername();
  return sendTaskCard(ctx, task, !isInGroup, isInGroup, botName);
}

// Shared task card sender
async function sendTaskCard(ctx, task, inDM = true, inGroup = false, botName) {
  const userId     = ctx.from.id;
  const alreadyDone = store.hasSubmitted(userId, task.groupId, task.id);
  const emoji      = task.type === 'raid' ? '' : '';
  const typeLabel  = TASK_TYPE_LABELS[task.taskType] || task.taskType || '';
  const platLabel  = task.platform === 'telegram' ? ' Telegram' : ' Twitter/X';

  let body =
    `${emoji} <b>${task.title}</b>\n` +
    `${'─'.repeat(28)}\n` +
    ` Type: <b>${typeLabel}</b>  ${platLabel}\n` +
    (task.link ? ` <a href="${task.link}">Open Link</a>\n` : '') +
    ` Reward: <b>${task.reward} pts</b>\n` +
    `${'─'.repeat(28)}\n`;

  if (alreadyDone) {
    body += ` <i>Already completed!</i>`;
    return ctx.replyWithHTML(body);
  }

  // Instructions per task type
  const instructions = {
    like:    ` Like the tweet, then tap <b>Verify</b>.`,
    retweet: ` Retweet the post, then tap <b>Verify</b>.`,
    follow:  ` Follow the account, then tap <b>Verify</b>.`,
    comment: ` Reply to the tweet with at least 20 characters.\n\nThen tap <b>Submit My Tweet URL</b> and paste your reply link.`,
    quote:   ` Quote tweet with at least 20 characters.\n\nThen tap <b>Submit My Tweet URL</b> and paste your quote link.`,
    join:    ` Join the channel/group, then tap <b>Verify</b>.`,
    react:   ` React to the message, then tap <b>Done</b>.`,
    send:    ` Send a message in the group, then tap <b>Done</b>.`,
  };
  body += `<i>${instructions[task.taskType] || 'Complete the task, then verify.'}</i>`;

  if (inGroup && botName) {
    await ctx.replyWithHTML(body, taskCardDMKeyboard(task.id, task.link, task.buttonLabel, botName));
  } else {
    await ctx.replyWithHTML(body, taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType));
  }
}

// ── "I Did It / Verify / Submit URL" button ────────────────────────────────────
async function handleDoSubmit(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  const userId = ctx.from.id;
  const isInGroup = ctx.chat?.type !== 'private';

  if (store.hasSubmitted(userId, task.groupId, taskId)) {
    return ctx.answerCbQuery(' Already completed!', { show_alert: true });
  }
  if (!task.active) {
    return ctx.answerCbQuery(' Task no longer active.', { show_alert: true });
  }

  // Redirect to DM if in group
  if (isInGroup) {
    await ctx.answerCbQuery(' Open DM to verify →', { show_alert: true });
    const botName = getBotUsername();
    await ctx.reply(
      ` Verification must be done in private DM. Tap below:`,
      Markup.inlineKeyboard([[Markup.button.url(' Verify in DM', `https://t.me/${botName}?start=submit_${taskId}`)]])
    );
    return;
  }

  await ctx.answerCbQuery();

  store.getOrCreateUser(userId, ctx.from.username || ctx.from.first_name);
  const user = store.getUser(userId);

  // Twitter tasks need a Twitter handle
  if (task.platform === 'twitter' && !user?.twitter) {
    session.setSession(userId, { step: 'awaiting_twitter_for_task', taskId, adminFlow: false });
    return ctx.replyWithHTML(
      ` <b>Twitter Handle Required</b>\n` +
      `${'─'.repeat(28)}\n` +
      `This is a Twitter task. Please set your Twitter handle first.\n\n` +
      `Send your <b>@handle</b>:`,
      cancelKeyboard()
    );
  }

  // Route by task type
  switch (task.taskType) {
    // ── Comment / Quote: ask user for their tweet URL ──────────────────────────
    case 'comment':
    case 'quote': {
      session.setSession(userId, {
        step: task.taskType === 'comment' ? 'awaiting_comment_url' : 'awaiting_quote_url',
        taskId,
        adminFlow: false,
      });
      const label = task.taskType === 'comment' ? 'reply' : 'quote tweet';
      await ctx.replyWithHTML(
        ` <b>Submit Your ${task.taskType === 'comment' ? 'Comment' : 'Quote Tweet'}</b>\n` +
        `${'─'.repeat(28)}\n` +
        `1. Complete the task: <a href="${task.link}">Open Tweet</a>\n` +
        `2. Post your ${label}\n` +
        `3. Copy the URL of YOUR tweet\n` +
        `4. Paste it here\n\n` +
        `<i>Example: https://x.com/yourname/status/12345</i>`,
        cancelKeyboard()
      );
      break;
    }

    // ── Join: verify via getChatMember ─────────────────────────────────────────
    case 'join': {
      await verifyJoin(ctx, userId, task);
      break;
    }

    // ── Like / Follow: Twitter API verification ────────────────────────────────
    case 'like':
    case 'follow': {
      await ctx.replyWithHTML(`<i>Verifying via Twitter API...</i>`);
      const fn = task.taskType === 'like'
        ? () => tw.verifyLike(tw.extractTweetId(task.link), user.twitter)
        : () => tw.verifyFollow(tw.extractUsername(task.link), user.twitter);

      // FIXED: do not auto-approve on API error — return failure with a retry message
      const result = await fn().catch(() => ({
        verified: false,
        reason: 'Twitter API error. Please try again in a moment.',
      }));

      if (result.verified) {
        await autoAward(ctx, userId, task, `${task.taskType}: ${task.link}`);
      } else {
        await ctx.replyWithHTML(
          ` <b>Not Verified</b>\n\n${result.reason}\n\n` +
          `<i>Complete the task first, then tap Verify again.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
        );
      }
      break;
    }

    // ── Retweet: check via Twitter API ────────────────────────────────────────
    case 'retweet': {
      await ctx.replyWithHTML(`<i>Checking retweet via Twitter API...</i>`);
      const tweetId = tw.extractTweetId(task.link);

      // FIXED: do not auto-approve if tweet ID missing or API error
      if (!tweetId) {
        await ctx.replyWithHTML(
          ` <b>Invalid Link</b>\n\nCould not extract tweet ID from the task link. Contact an admin.`
        );
        break;
      }

      const result = await tw.verifyRetweet(tweetId, user.twitter).catch(() => ({
        verified: false,
        reason: 'Twitter API error. Please try again in a moment.',
      }));

      if (result.verified) {
        await autoAward(ctx, userId, task, `retweet: ${task.link}`);
      } else {
        await ctx.replyWithHTML(
          ` <b>Retweet Not Found</b>\n\n${result.reason}\n\n` +
          `<i>Retweet the tweet first, then tap Verify again.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
        );
      }
      break;
    }

    // ── Telegram react / send: trust-based (cannot be verified remotely) ───────
    case 'react':
    case 'send': {
      await autoAward(ctx, userId, task, `${task.taskType} completed`);
      break;
    }

    default:
      await autoAward(ctx, userId, task, 'completed');
  }
}

// ── Telegram Join verification ─────────────────────────────────────────────────
async function verifyJoin(ctx, userId, task) {
  const match = String(task.link || '').match(/(?:t\.me\/|@)([A-Za-z0-9_]+)/i);
  const channelId = match ? `@${match[1]}` : null;

  if (!channelId) {
    // No channel link stored — trust-based
    return autoAward(ctx, userId, task, 'join completed');
  }

  try {
    const member = await ctx.telegram.getChatMember(channelId, userId);
    const ok = ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
    if (ok) {
      return autoAward(ctx, userId, task, `joined ${channelId}`);
    } else {
      await ctx.replyWithHTML(
        ` <b>Not a Member</b>\n\n` +
        `You have not joined <b>${channelId}</b> yet.\n\n` +
        `<a href="${task.link}">Join here</a>, then tap Verify again.`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
      );
    }
  } catch {
    // FIXED: bot is not in the channel — do not auto-award, tell user to try again
    await ctx.replyWithHTML(
      ` <b>Could Not Verify</b>\n\n` +
      `The bot could not confirm your membership in <b>${channelId}</b>.\n\n` +
      `Make sure you have joined, then tap Verify again. If the problem persists, contact an admin.`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
    );
  }
}

// ═══════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════

async function handleLeaderboard(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const top = store.getLeaderboard(10);
  if (!top.length) return ctx.replyWithHTML(` <b>Leaderboard</b>\n\n<i>No users ranked yet. Be the first!</i>`);

  const medals  = ['', '', ''];
  const maxPts  = top[0].points || 1;
  const bar     = pts => { const f = Math.round((pts / maxPts) * 10); return '█'.repeat(f) + '░'.repeat(10 - f); };
  const lines   = top.map((u, i) =>
    `${medals[i] || `${i + 1}.`} <b>@${u.username}</b>\n   <code>${bar(u.points)}</code>  <b>${u.points}</b> pts`
  );
  await ctx.replyWithHTML(` <b>Leaderboard — Top ${top.length}</b>\n${'─'.repeat(28)}\n\n${lines.join('\n\n')}`);
}

// ═══════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════

async function handleMyProfile(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const user   = store.getUser(userId);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  const top  = store.getLeaderboard(1000);
  const rank = top.findIndex(u => String(u.id) === String(userId)) + 1;

  const text =
    ` <b>My Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    ` @${user.username}\n` +
    ` Points: <b>${user.points}</b>   Rank: <b>#${rank || '—'}</b>\n` +
    ` Twitter: ${user.twitter || '<i>Not set</i>'}\n` +
    ` Wallet: ${user.wallet || '<i>Not set</i>'}\n` +
    ` Discord: ${user.discord || '<i>Not set</i>'}\n` +
    `${'─'.repeat(28)}`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...profileKeyboard() }).catch(async () => {
      await ctx.replyWithHTML(text, profileKeyboard());
    });
  } else {
    await ctx.replyWithHTML(text, profileKeyboard());
  }
}

// ═══════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════

async function handleSettings(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.replyWithHTML('Please use /start first.');
  await ctx.replyWithHTML(
    ` <b>Settings</b>\n${'─'.repeat(28)}\n` +
    ` Twitter: <b>${user.twitter || 'Not set'}</b>\n` +
    ` Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    ` Discord: <b>${user.discord || 'Not set'}</b>`,
    settingsKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════

async function handleHelp(ctx) {
  await ctx.replyWithHTML(
    ` <b>How to Use This Bot</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `<b> Menu</b>\n` +
    ` <b>Tasks</b> — Active Twitter/Telegram tasks\n` +
    ` <b>Raids</b> — Active raid campaigns\n` +
    ` <b>Leaderboard</b> — Top earners\n` +
    ` <b>My Profile</b> — Your stats & rank\n` +
    ` <b>Settings</b> — Twitter, Wallet, Discord\n\n` +
    `<b> How to Complete a Task</b>\n` +
    `1. Tap  Tasks or  Raids\n` +
    `2. Select a task\n` +
    `3. Complete it (open the link)\n` +
    `4. Tap <b> I Did It — Verify</b>\n` +
    `5. The bot checks via Twitter API and awards points!\n\n` +
    `<b> Comment/Quote Tasks</b>\n` +
    `After posting, paste your tweet URL to verify.\n\n` +
    `<b> Twitter Tasks</b>\n` +
    `Go to Settings and set your Twitter @handle first.\n\n` +
    `<b> Points</b>\n` +
    `Awarded automatically after successful API verification.`
  );
}

// ═══════════════════════════════════════════════
//  SESSION INPUT HANDLER
// ═══════════════════════════════════════════════

async function handleSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const s = session.getSession(userId);
  if (!s || s.adminFlow) return next();

  const hasText  = !!ctx.message?.text;
  const hasPhoto = !!(ctx.message?.photo?.length);

  if (!hasText && !hasPhoto) return next();

  const text = ctx.message?.text?.trim() || '';
  if (text.startsWith('/')) { session.clearSession(userId); return next(); }

  // ── Twitter handle required before task ────────────────────────────────────
  if (s.step === 'awaiting_twitter_for_task') {
    session.clearSession(userId);
    if (!text.match(/^@?[A-Za-z0-9_]{1,50}$/)) {
      return ctx.replyWithHTML(' Invalid handle. Example: <code>@johndoe</code>');
    }
    const clean = text.startsWith('@') ? text : `@${text}`;
    const user  = store.getUser(userId);
    if (user) user.twitter = clean;

    await ctx.replyWithHTML(` Twitter set: <b>${clean}</b>\n\nTap the task again to verify.`);
    return;
  }

  // ── Comment URL submission ─────────────────────────────────────────────────
  if (s.step === 'awaiting_comment_url') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML(' Task no longer exists.');

    if (!tw.isTweetUrl(text)) {
      return ctx.replyWithHTML(' Invalid URL. Send your reply tweet link (x.com or twitter.com).');
    }

    await ctx.replyWithHTML('<i>Verifying reply...</i>');
    const user = store.getUser(userId);
    const originalId = tw.extractTweetId(task.link);

    // FIXED: do not auto-approve on API error
    const result = await tw.verifyReply(text, originalId, user?.twitter, 20).catch(() => ({
      verified: false,
      reason: 'Twitter API error. Please try again in a moment.',
    }));

    if (result.verified) {
      await autoAward(ctx, userId, task, text);
    } else {
      await ctx.replyWithHTML(` <b>Not Verified</b>\n\n${result.reason}`);
    }
    return;
  }

  // ── Quote URL submission ───────────────────────────────────────────────────
  if (s.step === 'awaiting_quote_url') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML(' Task no longer exists.');

    if (!tw.isTweetUrl(text)) {
      return ctx.replyWithHTML(' Invalid URL. Send your quote tweet link (x.com or twitter.com).');
    }

    await ctx.replyWithHTML('<i>Verifying quote tweet...</i>');
    const user = store.getUser(userId);
    const originalId = tw.extractTweetId(task.link);

    // FIXED: do not auto-approve on API error
    const result = await tw.verifyQuote(text, originalId, user?.twitter, 20).catch(() => ({
      verified: false,
      reason: 'Twitter API error. Please try again in a moment.',
    }));

    if (result.verified) {
      await autoAward(ctx, userId, task, text);
    } else {
      await ctx.replyWithHTML(` <b>Not Verified</b>\n\n${result.reason}`);
    }
    return;
  }

  // ── Settings flows ─────────────────────────────────────────────────────────
  if (s.step === 'awaiting_twitter') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.twitter = text.startsWith('@') ? text : `@${text}`;
    return ctx.replyWithHTML(` Twitter set: <b>${user.twitter}</b>`, mainMenuKeyboard());
  }

  if (s.step === 'awaiting_wallet') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.wallet = text;
    return ctx.replyWithHTML(` Wallet updated:\n<code>${text}</code>`, mainMenuKeyboard());
  }

  if (s.step === 'awaiting_discord') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.discord = text;
    return ctx.replyWithHTML(` Discord set: <b>${text}</b>`, mainMenuKeyboard());
  }

  return next();
}

// ═══════════════════════════════════════════════
//  INLINE CALLBACKS
// ═══════════════════════════════════════════════

async function handleSetTwitter(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_twitter' });
  await ctx.replyWithHTML(` <b>Set Twitter Handle</b>\n\nSend your @handle:`, cancelKeyboard());
}

async function handleSetWallet(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_wallet' });
  await ctx.replyWithHTML(` <b>Set Wallet</b>\n\nSend your wallet address:`, cancelKeyboard());
}

async function handleSetDiscord(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_discord' });
  await ctx.replyWithHTML(` <b>Set Discord</b>\n\nSend your Discord username:`, cancelKeyboard());
}

async function handleCancelFlow(ctx) {
  await ctx.answerCbQuery('Cancelled.');
  session.clearSession(ctx.from.id);
  await ctx.deleteMessage().catch(() => {});
}

// ═══════════════════════════════════════════════
//  REGISTER
// ═══════════════════════════════════════════════

function register(bot) {
  bot.on(['message'], handleSessionInput);

  bot.start(handleStart);
  bot.command('leaderboard', handleLeaderboard);
  bot.command('profile',     handleMyProfile);
  bot.command('help',        handleHelp);

  bot.hears(' Tasks',       handleTasksMenu);
  bot.hears(' Raids',       handleRaidsMenu);
  bot.hears(' Leaderboard', handleLeaderboard);
  bot.hears(' My Profile',  handleMyProfile);
  bot.hears(' Settings',    handleSettings);
  bot.hears(' Help',        handleHelp);

  bot.action('set_twitter',     handleSetTwitter);
  bot.action('set_wallet',      handleSetWallet);
  bot.action('set_discord',     handleSetDiscord);
  bot.action('refresh_profile', ctx => handleMyProfile(ctx));
  bot.action('close_msg',       async ctx => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(() => {}); });
  bot.action('cancel_flow',     handleCancelFlow);

  bot.action(/^view_task_(\d+)$/, handleViewTask);
  bot.action(/^do_submit_(\d+)$/, handleDoSubmit);
}

module.exports = { register };
