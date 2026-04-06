/**
 * user.js — User-facing handlers
 */

const store   = require('../store');
const sheets  = require('../services/sheets');
const session = require('../sessions');
const config  = require('../config');
const { getBotUsername } = require('../botInfo');
const {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskListKeyboard, taskCardKeyboard, taskCardDMKeyboard,
  cancelKeyboard, connectTwitterKeyboard,
} = require('../utils/keyboard');
const tw = require('../utils/twitterVerify');
const { Markup } = require('telegraf');

const BOT_DM_LINK = 'https://t.me/MomentumHubBot';

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

  if (group?.sheetId && group.sheetId !== 'none') {
    try {
      await sheets.appendSubmission(group.sheetId, {
        timestamp: new Date().toISOString(), userId, username,
        task: task.title, proof: proofText || 'verified', status: 'approved', points: task.reward,
      });
    } catch (e) { console.error('[Sheets]', e.message); }
  }

  await ctx.replyWithHTML(
    `<b>Task Verified!</b>\n` +
    `${'─'.repeat(28)}\n` +
    `<b>${task.title}</b>\n` +
    `<b>+${task.reward} pts</b> awarded!\n` +
    `Total: <b>${user?.points ?? '?'} pts</b>\n\n` +
    `Keep completing tasks to climb the leaderboard!`
  );
}

// ═══════════════════════════════════════════════
//  /start  — Welcome message + Twitter connect
// ═══════════════════════════════════════════════

async function handleStart(ctx) {
  const payload = ctx.startPayload;

  if (payload?.startsWith('submit_')) {
    const taskId = parseInt(payload.replace('submit_', ''));
    const task   = store.getTask(taskId);
    if (!task || !task.active) {
      return ctx.replyWithHTML('That task is no longer available.');
    }
    if (store.hasSubmitted(ctx.from.id, task.groupId, taskId)) {
      return ctx.replyWithHTML('You already completed this task.');
    }
    store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
    return sendTaskCard(ctx, task, true);
  }

  const user = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  const firstName = ctx.from.first_name || ctx.from.username || 'there';

  const welcomeText =
    `Welcome <b>${firstName}</b>!\n\n` +
    `<b>What We Do:</b>\n` +
    `We connect a powerful network of engaged members who support each other's social media presence across all major platforms including Instagram, TikTok, X, YouTube, LinkedIn, and more. Every like, share, comment, and follow fuels a thriving ecosystem built on mutual growth and real rewards.\n\n` +
    `<b>Why Members Love It:</b>\n` +
    `- Real, active community with no bots, no fake accounts\n` +
    `- Fast payment processing so get paid without the wait\n` +
    `- Dedicated support team available 24/7\n` +
    `- Transparent point tracking dashboard\n` +
    `- Exclusive member-only campaigns with top brands\n\n` +
    `<b>Who It's For:</b>\n` +
    `Whether you're a rising creator or a seasoned influencer, Momentum Hub is your unfair advantage in the attention economy.\n\n` +
    `${'─'.repeat(28)}\n` +
    `Your Points: <b>${user.points}</b>`;

  await ctx.replyWithHTML(welcomeText, mainMenuKeyboard());

  // Show Twitter connect prompt if not yet connected
  if (!user.twitter) {
    await ctx.replyWithHTML(
      `<b>Connect Your Twitter Account</b>\n` +
      `${'─'.repeat(28)}\n\n` +
      `To complete Twitter tasks you need to connect your Twitter account.\n\n` +
      `<b>Important:</b> Your Twitter username <b>cannot be changed</b> once submitted. This can only be corrected by an admin.\n\n` +
      `Tap the button below to connect:`,
      connectTwitterKeyboard()
    );
  }
}

// ═══════════════════════════════════════════════
//  TASK MENUS
// ═══════════════════════════════════════════════

async function handleTasksMenu(ctx) {
  let tasks = [];
  store.getAllGroups().forEach(g => tasks.push(...store.getTasksForGroup(g.id, 'task')));
  if (!tasks.length) return ctx.replyWithHTML(`<b>Active Tasks</b>\n\nNo active tasks right now. Check back soon!`);
  await ctx.replyWithHTML(
    `<b>Active Tasks</b> (${tasks.length})\n\n<i>Tap a task to view details:</i>`,
    taskListKeyboard(tasks)
  );
}

async function handleRaidsMenu(ctx) {
  let raids = [];
  store.getAllGroups().forEach(g => raids.push(...store.getTasksForGroup(g.id, 'raid')));
  if (!raids.length) return ctx.replyWithHTML(`<b>Active Raids</b>\n\nNo raids running right now!`);
  await ctx.replyWithHTML(
    `<b>Active Raids</b> (${raids.length})\n\n<i>Tap a raid to view details:</i>`,
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
  return sendTaskCard(ctx, task, !isInGroup, isInGroup);
}

// Shared task card sender
async function sendTaskCard(ctx, task, inDM = true, inGroup = false) {
  const userId     = ctx.from.id;
  const alreadyDone = store.hasSubmitted(userId, task.groupId, task.id);
  const typeLabel  = TASK_TYPE_LABELS[task.taskType] || task.taskType || '';
  const platLabel  = task.platform === 'telegram' ? 'Telegram' : 'Twitter/X';
  const timeInfo   = task.timeLimitMinutes ? `\nTime Limit: <b>${task.timeLimitMinutes} min</b>` : '';

  let body =
    `<b>${task.title}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `Type: <b>${typeLabel}</b>  |  ${platLabel}\n` +
    (task.link ? `<a href="${task.link}">Open Link</a>\n` : '') +
    `Reward: <b>${task.reward} pts</b>${timeInfo}\n` +
    `${'─'.repeat(28)}\n`;

  if (alreadyDone) {
    body += `<i>Already completed!</i>`;
    return ctx.replyWithHTML(body);
  }

  const instructions = {
    like:    `Like the tweet, then tap <b>Verify</b>.`,
    retweet: `Retweet the post, then tap <b>Verify</b>.`,
    follow:  `Follow the account, then tap <b>Verify</b>.`,
    comment: `Reply to the tweet with at least 20 characters.\n\nThen tap <b>Submit My Tweet URL</b> and paste your reply link.`,
    quote:   `Quote tweet with at least 20 characters.\n\nThen tap <b>Submit My Tweet URL</b> and paste your quote link.`,
    join:    `Join the channel/group, then tap <b>Verify</b>.`,
    react:   `React to the message, then tap <b>Done</b>.`,
    send:    `Send a message in the group, then tap <b>Done</b>.`,
  };
  body += `<i>${instructions[task.taskType] || 'Complete the task, then verify.'}</i>`;

  if (inGroup) {
    await ctx.replyWithHTML(body, taskCardDMKeyboard(task.id, task.link, task.buttonLabel));
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
    return ctx.answerCbQuery('Already completed!', { show_alert: true });
  }
  if (!task.active) {
    return ctx.answerCbQuery('Task no longer active.', { show_alert: true });
  }

  // Always redirect to DM if in group
  if (isInGroup) {
    await ctx.answerCbQuery('Open DM to verify', { show_alert: true });
    await ctx.reply(
      `Verification must be done in private DM. Tap below:`,
      Markup.inlineKeyboard([[Markup.button.url('Verify in DM', `${BOT_DM_LINK}?start=submit_${taskId}`)]])
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
      `<b>Twitter Account Required</b>\n` +
      `${'─'.repeat(28)}\n` +
      `This is a Twitter task. Please connect your Twitter account first.\n\n` +
      `<b>Note:</b> Once set, your username cannot be changed (admin only).\n\n` +
      `Send your <b>@username</b>:`,
      cancelKeyboard()
    );
  }

  switch (task.taskType) {
    case 'comment':
    case 'quote': {
      session.setSession(userId, {
        step: task.taskType === 'comment' ? 'awaiting_comment_url' : 'awaiting_quote_url',
        taskId, adminFlow: false,
      });
      const label = task.taskType === 'comment' ? 'reply' : 'quote tweet';
      await ctx.replyWithHTML(
        `<b>Submit Your ${task.taskType === 'comment' ? 'Comment' : 'Quote Tweet'}</b>\n` +
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

    case 'join': {
      await verifyJoin(ctx, userId, task);
      break;
    }

    case 'like':
    case 'follow': {
      await ctx.replyWithHTML(`<i>Verifying via Twitter API...</i>`);
      const fn = task.taskType === 'like'
        ? () => tw.verifyLike(tw.extractTweetId(task.link), user.twitter)
        : () => tw.verifyFollow(tw.extractUsername(task.link), user.twitter);

      const result = await fn().catch(() => ({
        verified: false, reason: 'Twitter API error. Please try again in a moment.',
      }));

      if (result.verified) {
        await autoAward(ctx, userId, task, `${task.taskType}: ${task.link}`);
      } else {
        await ctx.replyWithHTML(
          `<b>Not Verified</b>\n\n${result.reason}\n\n` +
          `<i>Complete the task first, then tap Verify again.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
        );
      }
      break;
    }

    case 'retweet': {
      await ctx.replyWithHTML(`<i>Checking retweet via Twitter API...</i>`);
      const tweetId = tw.extractTweetId(task.link);

      if (!tweetId) {
        await ctx.replyWithHTML(`<b>Invalid Link</b>\n\nCould not extract tweet ID from the task link. Contact an admin.`);
        break;
      }

      const result = await tw.verifyRetweet(tweetId, user.twitter).catch(() => ({
        verified: false, reason: 'Twitter API error. Please try again in a moment.',
      }));

      if (result.verified) {
        await autoAward(ctx, userId, task, `retweet: ${task.link}`);
      } else {
        await ctx.replyWithHTML(
          `<b>Not Verified</b>\n\n${result.reason}\n\n` +
          `<i>Make sure you retweeted first, then tap Verify.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
        );
      }
      break;
    }

    case 'react':
    case 'send': {
      await autoAward(ctx, userId, task, `${task.taskType} completed`);
      break;
    }

    default:
      await ctx.replyWithHTML(`Unknown task type. Contact an admin.`);
  }
}

// ── Join verification ──────────────────────────────────────────────────────────
async function verifyJoin(ctx, userId, task) {
  if (!task.link) {
    return autoAward(ctx, userId, task, 'join completed');
  }

  let channelId = task.link.trim();
  const tme = channelId.match(/t\.me\/(?:c\/)?([A-Za-z0-9_]+)/i);
  if (tme) channelId = `@${tme[1]}`;
  else if (/^-?\d+$/.test(channelId)) channelId = parseInt(channelId, 10);
  else if (!channelId.startsWith('@')) channelId = `@${channelId}`;

  if (!channelId) {
    return autoAward(ctx, userId, task, 'join completed');
  }

  try {
    const member = await ctx.telegram.getChatMember(channelId, userId);
    const ok = ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
    if (ok) {
      return autoAward(ctx, userId, task, `joined ${channelId}`);
    } else {
      await ctx.replyWithHTML(
        `<b>Not a Member</b>\n\n` +
        `You have not joined <b>${channelId}</b> yet.\n\n` +
        `<a href="${task.link}">Join here</a>, then tap Verify again.`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
      );
    }
  } catch {
    await ctx.replyWithHTML(
      `<b>Could Not Verify</b>\n\n` +
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
  if (!top.length) return ctx.replyWithHTML(`<b>Leaderboard</b>\n\n<i>No users ranked yet. Be the first!</i>`);

  const medals = ['1.', '2.', '3.'];
  const maxPts = top[0].points || 1;
  const bar    = pts => { const f = Math.round((pts / maxPts) * 10); return '|'.repeat(f) + '.'.repeat(10 - f); };
  const lines  = top.map((u, i) =>
    `${medals[i] || `${i + 1}.`} <b>@${u.username}</b>\n   <code>${bar(u.points)}</code>  <b>${u.points}</b> pts`
  );
  await ctx.replyWithHTML(`<b>Leaderboard — Top ${top.length}</b>\n${'─'.repeat(28)}\n\n${lines.join('\n\n')}`);
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
  const twitterStatus = user.twitter
    ? `${user.twitter}${user.twitterLocked ? ' (locked)' : ''}`
    : '<i>Not connected</i>';

  const text =
    `<b>My Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    `@${user.username}\n` +
    `Points: <b>${user.points}</b>   Rank: <b>#${rank || '—'}</b>\n` +
    `Twitter: ${twitterStatus}\n` +
    `Wallet: ${user.wallet || '<i>Not set</i>'}\n` +
    `Discord: ${user.discord || '<i>Not set</i>'}\n` +
    `${'─'.repeat(28)}`;

  const kb = profileKeyboard(user.twitterLocked);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }).catch(async () => {
      await ctx.replyWithHTML(text, kb);
    });
  } else {
    await ctx.replyWithHTML(text, kb);
  }
}

// ═══════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════

async function handleSettings(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.replyWithHTML('Please use /start first.');
  const twitterStatus = user.twitter
    ? `${user.twitter} (locked — contact admin to change)`
    : 'Not connected';
  await ctx.replyWithHTML(
    `<b>Settings</b>\n${'─'.repeat(28)}\n` +
    `Twitter: <b>${twitterStatus}</b>\n` +
    `Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    `Discord: <b>${user.discord || 'Not set'}</b>`,
    settingsKeyboard(user.twitterLocked)
  );
}

// ── Set Twitter (locked after first set) ────────────────────────────────────────
async function handleSetTwitter(ctx) {
  await ctx.answerCbQuery();
  const user = store.getUser(ctx.from.id);
  if (user?.twitterLocked) {
    return ctx.replyWithHTML(
      `<b>Twitter Account Locked</b>\n\n` +
      `Your Twitter account <b>${user.twitter}</b> is already connected and cannot be changed.\n\n` +
      `To change it, please contact an admin.`
    );
  }
  session.setSession(ctx.from.id, { step: 'awaiting_twitter', adminFlow: false });
  await ctx.replyWithHTML(
    `<b>Connect Twitter Account</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `<b>Warning:</b> Once you submit your Twitter username, it <b>cannot be changed</b>. Only an admin can update it later.\n\n` +
    `Send your Twitter <b>@username</b>:\n` +
    `<i>Example: @johndoe</i>`,
    cancelKeyboard()
  );
}

async function handleSetWallet(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_wallet', adminFlow: false });
  await ctx.replyWithHTML(`<b>Set Wallet</b>\n\nSend your wallet address:`, cancelKeyboard());
}

async function handleSetDiscord(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_discord', adminFlow: false });
  await ctx.replyWithHTML(`<b>Set Discord</b>\n\nSend your Discord username:`, cancelKeyboard());
}

async function handleCancelFlow(ctx) {
  await ctx.answerCbQuery('Cancelled.');
  session.clearSession(ctx.from.id);
  await ctx.deleteMessage().catch(() => {});
}

// ═══════════════════════════════════════════════
//  GUIDE
// ═══════════════════════════════════════════════

async function handleGuide(ctx) {
  await ctx.replyWithHTML(
    `<b>Momentum Hub Bot — Complete Guide</b>\n` +
    `${'─'.repeat(32)}\n\n` +
    `<b>Menu Buttons:</b>\n` +
    `<b>Tasks</b> — View and complete active Twitter/Telegram tasks\n` +
    `<b>Raids</b> — View and join active raid campaigns (multiple tasks bundled)\n` +
    `<b>Leaderboard</b> — See the top point earners\n` +
    `<b>My Profile</b> — View your stats, points, rank and connected accounts\n` +
    `<b>Settings</b> — Connect wallet, Discord, and Twitter account\n` +
    `<b>Help</b> — Show this guide\n\n` +
    `<b>User Commands:</b>\n` +
    `/start — Start the bot and see the welcome message\n` +
    `/profile — View your profile\n` +
    `/leaderboard — View the top leaderboard\n` +
    `/help — Show this guide\n` +
    `/guide — Show this guide\n\n` +
    `<b>How to Complete a Task:</b>\n` +
    `1. Tap Tasks or Raids\n` +
    `2. Select a task from the list\n` +
    `3. Open the link and complete the action\n` +
    `4. Tap "I Did It — Verify" (in your DM)\n` +
    `5. Points are awarded automatically!\n\n` +
    `<b>Comment / Quote Tasks:</b>\n` +
    `After posting your reply or quote tweet, paste your tweet URL to verify.\n\n` +
    `<b>Twitter Tasks:</b>\n` +
    `Connect your Twitter account via Settings. Your username is permanent once set — only an admin can change it.\n\n` +
    `<b>Group Tasks:</b>\n` +
    `When completing tasks from a group, tap "Submit in DM" to verify in private.\n\n` +
    `<b>Points:</b>\n` +
    `Points are awarded instantly after successful verification.\n\n` +
    `<b>Admin Commands (for group admins):</b>\n` +
    `/admin — Open the admin panel\n\n` +
    `<b>Owner Commands:</b>\n` +
    `/addgroup — Register a group\n` +
    `/removegroup — Unregister a group\n` +
    `/listgroups — List registered groups\n` +
    `/addadmin — Add a group admin\n` +
    `/removeadmin — Remove a group admin\n` +
    `/setsheet — Link a Google Sheet\n` +
    `/broadcast — DM all users\n` +
    `/changeusertwitter — Change a user's Twitter username\n` +
    `   Example: <code>/changeusertwitter 123456789 @newhandle</code>\n` +
    `/ownerhelp — Full owner command reference`
  );
}

// ═══════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════

async function handleHelp(ctx) {
  await handleGuide(ctx);
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

  // ── Twitter handle (first-time connect — locked after) ──────────────────────
  if (s.step === 'awaiting_twitter' || s.step === 'awaiting_twitter_for_task') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user?.twitterLocked) {
      return ctx.replyWithHTML(
        `<b>Already Locked</b>\n\nYour Twitter is already set to <b>${user.twitter}</b>. Contact an admin to change it.`
      );
    }
    if (!text.match(/^@?[A-Za-z0-9_]{1,50}$/)) {
      return ctx.replyWithHTML('Invalid handle. Example: <code>@johndoe</code>');
    }
    const clean = text.startsWith('@') ? text : `@${text}`;
    const success = store.setUserTwitter(userId, clean);
    if (!success) {
      return ctx.replyWithHTML(`<b>Already Set</b>\n\nYour Twitter is locked. Contact an admin to change it.`);
    }

    // Sync to Google Sheet
    const groups = store.getAllGroups();
    for (const g of groups) {
      if (g.sheetId && g.sheetId !== 'none') {
        try {
          await sheets.upsertUser(g.sheetId, {
            userId, username: store.getUser(userId)?.username || 'unknown',
            twitter: clean, wallet: null, discord: null, points: 0,
          });
        } catch {}
      }
    }

    await ctx.replyWithHTML(
      `<b>Twitter Connected!</b>\n\n` +
      `Account: <b>${clean}</b>\n\n` +
      `<i>This is now permanently linked to your profile. Contact an admin if you need to change it.</i>`
    );
    return;
  }

  // ── Comment URL submission ─────────────────────────────────────────────────
  if (s.step === 'awaiting_comment_url') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML('Task no longer exists.');

    if (!tw.isTweetUrl(text)) {
      return ctx.replyWithHTML('Invalid URL. Send your reply tweet link (x.com or twitter.com).');
    }

    await ctx.replyWithHTML('<i>Verifying reply...</i>');
    const user = store.getUser(userId);
    const originalId = tw.extractTweetId(task.link);

    const result = await tw.verifyReply(text, originalId, user?.twitter, 20).catch(() => ({
      verified: false, reason: 'Twitter API error. Please try again in a moment.',
    }));

    if (result.verified) {
      await autoAward(ctx, userId, task, text);
    } else {
      await ctx.replyWithHTML(`<b>Not Verified</b>\n\n${result.reason}`);
    }
    return;
  }

  // ── Quote URL submission ───────────────────────────────────────────────────
  if (s.step === 'awaiting_quote_url') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML('Task no longer exists.');

    if (!tw.isTweetUrl(text)) {
      return ctx.replyWithHTML('Invalid URL. Send your quote tweet link (x.com or twitter.com).');
    }

    await ctx.replyWithHTML('<i>Verifying quote tweet...</i>');
    const user = store.getUser(userId);
    const originalId = tw.extractTweetId(task.link);

    const result = await tw.verifyQuote(text, originalId, user?.twitter, 20).catch(() => ({
      verified: false, reason: 'Twitter API error. Please try again in a moment.',
    }));

    if (result.verified) {
      await autoAward(ctx, userId, task, text);
    } else {
      await ctx.replyWithHTML(`<b>Not Verified</b>\n\n${result.reason}`);
    }
    return;
  }

  // ── Wallet ─────────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_wallet') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.wallet = text;
    await ctx.replyWithHTML(`<b>Wallet Saved!</b>\n\n<code>${text}</code>`);
    return;
  }

  // ── Discord ────────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_discord') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.discord = text;
    await ctx.replyWithHTML(`<b>Discord Saved!</b>\n\n<code>${text}</code>`);
    return;
  }

  return next();
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
  bot.command('guide',       handleGuide);

  bot.hears('Tasks',       handleTasksMenu);
  bot.hears('Raids',       handleRaidsMenu);
  bot.hears('Leaderboard', handleLeaderboard);
  bot.hears('My Profile',  handleMyProfile);
  bot.hears('Settings',    handleSettings);
  bot.hears('Help',        handleHelp);

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
