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

// Fallback sheet used when a group has no sheet configured
const FALLBACK_SHEET_ID = '1PI9f0tg6Qe5mGl_FQVfpwfopc1I_PGfGPFK1K1Be01Q';

const TASK_TYPE_LABELS = {
  follow: 'Follow',  like: 'Like',    retweet: 'Retweet',
  comment: 'Comment', quote: 'Quote Tweet',
  join: 'Join Channel/Group', react: 'React to Message', send: 'Send Message',
};

const delay = ms => new Promise(r => setTimeout(r, ms));

/** Format combined type label, e.g. 'retweet,comment' → 'Retweet + Comment' */
function formatTypeLabel(taskType) {
  if (!taskType) return '';
  return taskType.split(',').map(t => TASK_TYPE_LABELS[t.trim()] || t.trim()).join(' + ');
}

/** Return the sheet ID to write to — group sheet if set, otherwise the fallback sheet */
function resolveSheetId(group) {
  if (group?.sheetId && group.sheetId !== 'none') return group.sheetId;
  return FALLBACK_SHEET_ID;
}

// ═══════════════════════════════════════════════
//  SHOW PROFILE (reusable helper for "next step")
// ═══════════════════════════════════════════════

async function showProfile(ctx) {
  const userId = ctx.from.id;
  const user   = store.getUser(userId);
  if (!user) return;

  const top  = store.getLeaderboard(1000);
  const rank = top.findIndex(u => String(u.id) === String(userId)) + 1;
  const twitterStatus = user.twitter
    ? `${user.twitter}${user.twitterLocked ? ' (locked)' : ''}`
    : '<i>Not connected</i>';

  const text =
    `<b>Your Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    `@${user.username}\n` +
    `Points: <b>${user.points}</b>   Rank: <b>#${rank || '—'}</b>\n` +
    `Twitter: ${twitterStatus}\n` +
    `Wallet: ${user.wallet || '<i>Not set</i>'}\n` +
    `Discord: ${user.discord || '<i>Not set</i>'}`;

  await ctx.replyWithHTML(text, profileKeyboard(user.twitterLocked));
}

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
  const sheetId = resolveSheetId(group);

  try {
    await sheets.appendSubmission(sheetId, {
      timestamp: new Date().toISOString(), userId, username,
      twitter: user?.twitter || '',
      task: task.title, proof: proofText || 'verified', status: 'approved', points: task.reward,
    });
  } catch (e) { console.error('[Sheets] appendSubmission:', e.message); }

  // Also sync user row
  try {
    await sheets.upsertUser(sheetId, {
      userId, username, twitter: user?.twitter || '',
      wallet: user?.wallet || '', discord: user?.discord || '',
      points: user?.points || 0,
    });
  } catch (e) { console.error('[Sheets] upsertUser:', e.message); }

  await ctx.replyWithHTML(
    `<b>Task Verified!</b>\n` +
    `${'─'.repeat(28)}\n` +
    `<b>${task.title}</b>\n` +
    `<b>+${task.reward} pts</b> awarded!\n` +
    `Total: <b>${user?.points ?? '?'} pts</b>\n\n` +
    `Keep completing tasks to climb the leaderboard!`
  );

  // Always show profile after task completion
  await showProfile(ctx);
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

  if (!user.twitter) {
    await ctx.replyWithHTML(
      `<b>Connect Your Twitter Account</b>\n\nLink your Twitter to complete Twitter tasks and earn points.`,
      connectTwitterKeyboard()
    );
  }
}

// ═══════════════════════════════════════════════
//  TASKS MENU
// ═══════════════════════════════════════════════

async function handleTasksMenu(ctx) {
  const userId = ctx.from.id;
  store.getOrCreateUser(userId, ctx.from.username || ctx.from.first_name);

  const groups   = store.getAllGroups();
  const allTasks = [];
  for (const g of groups) {
    const tasks = store.getTasksForGroup(g.id, 'task');
    allTasks.push(...tasks.filter(t => t.active && !store.hasSubmitted(userId, g.id, t.id)));
  }

  if (!allTasks.length) {
    return ctx.replyWithHTML(`<b>Tasks</b>\n\n<i>No active tasks right now. Check back soon!</i>`);
  }

  await ctx.replyWithHTML(`<b>Active Tasks</b>\n\nSelect a task to view details:`, taskListKeyboard(allTasks));
}

// ═══════════════════════════════════════════════
//  RAIDS MENU
// ═══════════════════════════════════════════════

async function handleRaidsMenu(ctx) {
  const userId = ctx.from.id;
  store.getOrCreateUser(userId, ctx.from.username || ctx.from.first_name);

  const groups    = store.getAllGroups();
  const allRaids  = [];
  for (const g of groups) {
    const raids = store.getTasksForGroup(g.id, 'raid');
    allRaids.push(...raids.filter(r => r.active));
  }

  if (!allRaids.length) {
    return ctx.replyWithHTML(`<b>Raids</b>\n\n<i>No active raids right now. Check back soon!</i>`);
  }

  await ctx.replyWithHTML(`<b>Active Raids</b>\n\nSelect a raid to view details:`, taskListKeyboard(allRaids));
}

// ═══════════════════════════════════════════════
//  VIEW TASK
// ═══════════════════════════════════════════════

async function handleViewTask(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  await ctx.answerCbQuery();
  store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);

  const isInGroup = ctx.chat?.type !== 'private';
  return sendTaskCard(ctx, task, !isInGroup, isInGroup);
}

// Shared task card sender — handles combined task types
async function sendTaskCard(ctx, task, inDM = true, inGroup = false) {
  const userId      = ctx.from.id;
  const alreadyDone = store.hasSubmitted(userId, task.groupId, task.id);
  const typeLabel   = formatTypeLabel(task.taskType);
  const platLabel   = task.platform === 'telegram' ? 'Telegram' : 'Twitter/X';

  // Display time limit in hours for tasks, minutes for raids
  let timeInfo = '';
  if (task.timeLimitMinutes) {
    if (task.type === 'raid') {
      timeInfo = `\nTime Limit: <b>${task.timeLimitMinutes} min</b>`;
    } else {
      const hrs = task.timeLimitMinutes / 60;
      timeInfo = `\nTime Limit: <b>${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hr${hrs !== 1 ? 's' : ''}</b>`;
    }
  }

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

  const types = (task.taskType || '').split(',').map(t => t.trim()).filter(Boolean);
  const instructions = {
    like:    `Like the tweet, then tap <b>Verify</b>.`,
    retweet: `Retweet the post, then submit your retweet URL.`,
    follow:  `Follow the account, then tap <b>Verify</b>.`,
    comment: `Reply to the tweet with at least 20 characters, then submit your reply URL.`,
    quote:   `Quote tweet with at least 20 characters, then submit your quote URL.`,
    join:    `Join the channel/group, then tap <b>Verify</b>.`,
    react:   `React to the message, then tap <b>Done</b>.`,
    send:    `Send a message in the group, then tap <b>Done</b>.`,
  };

  if (types.length > 1) {
    const steps = types.map((t, i) => `${i + 1}. ${instructions[t] || t}`).join('\n');
    body += `<i>Complete all steps:\n${steps}\n\nThen submit your proof URL below.</i>`;
  } else {
    body += `<i>${instructions[types[0]] || 'Complete the task, then verify.'}</i>`;
  }

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

  const userId    = ctx.from.id;
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

  // Combined or single type handling
  const types      = (task.taskType || '').split(',').map(t => t.trim()).filter(Boolean);
  const needsUrl   = types.some(t => ['comment', 'quote', 'retweet'].includes(t));
  const primaryUrl = types.find(t => ['comment', 'quote', 'retweet'].includes(t));

  if (needsUrl) {
    const stepName = primaryUrl === 'comment' ? 'awaiting_comment_url'
                   : primaryUrl === 'quote'   ? 'awaiting_quote_url'
                   : 'awaiting_retweet_url';
    session.setSession(userId, { step: stepName, taskId, adminFlow: false });
    const typeLabel = formatTypeLabel(task.taskType);
    await ctx.replyWithHTML(
      `<b>Submit Your Proof URL</b>\n` +
      `${'─'.repeat(28)}\n` +
      `Task: <b>${typeLabel}</b>\n\n` +
      (task.link ? `1. Open the link: <a href="${task.link}">View Post</a>\n` : '') +
      `2. Complete the task\n` +
      `3. Copy the URL of <b>your tweet</b>\n` +
      `4. Paste it here\n\n` +
      `<i>Example: https://x.com/yourname/status/12345</i>`,
      cancelKeyboard()
    );
    return;
  }

  switch (types[0]) {
    case 'join':  await verifyJoin(ctx, userId, task); break;
    case 'react':
    case 'send':  await autoAward(ctx, userId, task, `${types[0]}-done`); break;
    default:      await autoAward(ctx, userId, task, `${types[0]}-verified`); break;
  }
}

// ── Telegram join verification ─────────────────────────────────────────────────
async function verifyJoin(ctx, userId, task) {
  const channelId = task.link || null;
  if (!channelId) {
    return ctx.replyWithHTML(`<b>Error</b>\n\nNo channel configured for this task. Contact an admin.`);
  }
  try {
    const member   = await ctx.telegram.getChatMember(channelId, userId);
    const isJoined = ['member', 'administrator', 'creator', 'restricted'].includes(member.status)
      && member.status !== 'kicked' && member.status !== 'left';

    if (isJoined) {
      await autoAward(ctx, userId, task, 'join-verified');
    } else {
      await ctx.replyWithHTML(
        `<b>Not a Member Yet</b>\n\nJoin the channel/group first, then tap Verify again.`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
      );
    }
  } catch (err) {
    const trustBased =
      err.message.includes('bot is not a member') ||
      err.message.includes('CHANNEL_PRIVATE') ||
      err.message.includes('chat not found') ||
      err.message.includes('not enough rights') ||
      err.message.includes('member list is inaccessible');

    if (trustBased) {
      await autoAward(ctx, userId, task, 'join-trust');
    } else {
      await ctx.replyWithHTML(`<i>Verification error. Please try again in a moment.</i>`);
    }
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

// ── Set Twitter ─────────────────────────────────────────────────────────────────
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
//  GUIDE / HELP
// ═══════════════════════════════════════════════

async function handleGuide(ctx) {
  await ctx.replyWithHTML(
    `<b>Momentum Hub Bot — Complete Guide</b>\n` +
    `${'─'.repeat(32)}\n\n` +
    `<b>Menu Buttons:</b>\n` +
    `<b>Tasks</b> — View and complete active Twitter/Telegram tasks\n` +
    `<b>Raids</b> — View and join active raid campaigns\n` +
    `<b>Leaderboard</b> — See the top point earners\n` +
    `<b>My Profile</b> — View your stats, points, rank and connected accounts\n` +
    `<b>Settings</b> — Connect wallet, Discord, and Twitter account\n` +
    `<b>Help</b> — Show this guide\n\n` +
    `<b>How to Complete a Task:</b>\n` +
    `1. Tap Tasks or Raids\n` +
    `2. Select a task from the list\n` +
    `3. Open the link and complete the action\n` +
    `4. Tap the verify button in your DM\n` +
    `5. Points are awarded automatically!\n\n` +
    `<b>Comment / Quote / Retweet Tasks:</b>\n` +
    `Submit the URL of your tweet after completing the action.\n\n` +
    `<b>Combined Tasks:</b>\n` +
    `Some tasks require multiple actions (e.g. Retweet + Comment). Complete all steps, then submit your proof URL.\n\n` +
    `<b>Info Requests:</b>\n` +
    `When an admin sends you a question, simply reply — it is recorded automatically.`
  );
}

async function handleHelp(ctx) { return handleGuide(ctx); }

// ═══════════════════════════════════════════════
//  SESSION INPUT HANDLER
// ═══════════════════════════════════════════════

async function handleSessionInput(ctx, next) {
  if (ctx.chat?.type !== 'private') return next();
  if (!ctx.message?.text) return next();

  const userId = ctx.from.id;
  const text   = ctx.message.text.trim();
  const s      = session.getSession(userId);

  if (!s || s.adminFlow) return next();

  // ── Collect Info Answer ───────────────────────────────────────────────────────
  if (s.step === 'collect_info_answer') {
    session.clearSession(userId);
    const question = s.question || 'Admin question';
    const answer   = text;
    const username = ctx.from.username || ctx.from.first_name || 'unknown';
    const user     = store.getUser(userId);

    store.setCollectedInfo(userId, question, answer);

    // Write to sheets — deduplicate sheet IDs so we don't double-write
    const groups     = store.getAllGroups();
    const sheetsSeen = new Set();
    for (const g of groups) {
      const sid = resolveSheetId(g);
      if (sheetsSeen.has(sid)) continue;
      sheetsSeen.add(sid);
      try {
        await sheets.appendCollectedInfo(sid, {
          userId, username, twitter: user?.twitter || '', question, answer,
        });
      } catch (e) { console.error('[Sheets] CollectedInfo:', e.message); }
    }
    // If no groups exist at all, write to fallback
    if (groups.length === 0) {
      try {
        await sheets.appendCollectedInfo(FALLBACK_SHEET_ID, {
          userId, username, twitter: user?.twitter || '', question, answer,
        });
      } catch (e) { console.error('[Sheets] CollectedInfo fallback:', e.message); }
    }

    await ctx.replyWithHTML(
      `<b>Answer Received!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `<b>Question:</b> ${question}\n` +
      `<b>Your Answer:</b> ${answer}\n\n` +
      `<i>Thank you! Your response has been recorded.</i>`
    );
    await showProfile(ctx);
    return;
  }

  // ── Twitter for task ──────────────────────────────────────────────────────────
  if (s.step === 'awaiting_twitter_for_task') {
    const handle = text.startsWith('@') ? text : `@${text}`;
    const clean  = handle.replace('@', '').toLowerCase().trim();
    const ok = store.setUserTwitter(userId, clean);
    if (!ok) {
      return ctx.replyWithHTML(`Your Twitter is already locked. Contact an admin to change it.`);
    }
    session.clearSession(userId);
    await ctx.replyWithHTML(`<b>Twitter Connected!</b> <b>${handle}</b> linked.\n\nNow tap the task button again to continue.`);
    return;
  }

  // ── Twitter handle ────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_twitter') {
    session.clearSession(userId);
    const handle = text.startsWith('@') ? text : `@${text}`;
    const clean  = handle.replace('@', '').toLowerCase().trim();
    const ok = store.setUserTwitter(userId, clean);
    if (!ok) {
      return ctx.replyWithHTML(
        `<b>Twitter Locked</b>\n\nYour Twitter account is already set and locked. Contact an admin to change it.`
      );
    }

    // Sync to sheets
    const user     = store.getUser(userId);
    const username = ctx.from.username || ctx.from.first_name || 'unknown';
    const groups   = store.getAllGroups();
    const seen     = new Set();
    for (const g of groups) {
      const sid = resolveSheetId(g);
      if (seen.has(sid)) continue;
      seen.add(sid);
      try {
        await sheets.upsertUser(sid, {
          userId, username, twitter: clean,
          wallet: user?.wallet || '', discord: user?.discord || '', points: user?.points || 0,
        });
      } catch {}
    }
    if (groups.length === 0) {
      try {
        await sheets.upsertUser(FALLBACK_SHEET_ID, {
          userId, username: ctx.from.username || '', twitter: clean,
          wallet: '', discord: '', points: 0,
        });
      } catch {}
    }

    await ctx.replyWithHTML(`<b>Twitter Connected!</b>\n\n<b>${handle}</b> linked to your account.`);
    await showProfile(ctx);
    return;
  }

  // ── Comment URL ───────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_comment_url') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML('Task no longer exists.');

    if (!tw.isTweetUrl(text)) {
      return ctx.replyWithHTML('Invalid URL. Send your reply tweet link (x.com or twitter.com).');
    }

    await ctx.replyWithHTML('<i>Verifying comment...</i>');
    const user       = store.getUser(userId);
    const originalId = tw.extractTweetId(task.link);

    const result = await tw.verifyComment(text, originalId, user?.twitter, task.min_chars || 20).catch(() => ({
      verified: false, reason: 'Twitter API error. Please try again in a moment.',
    }));

    if (result.verified) {
      await autoAward(ctx, userId, task, text);
    } else {
      await ctx.replyWithHTML(`<b>Not Verified</b>\n\n${result.reason}`);
    }
    return;
  }

  // ── Retweet URL ───────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_retweet_url') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML('Task no longer exists.');

    if (!tw.isTweetUrl(text)) {
      return ctx.replyWithHTML('Invalid URL. Send your retweet link (x.com or twitter.com).');
    }

    await autoAward(ctx, userId, task, text);
    return;
  }

  // ── Quote URL ─────────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_quote_url') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML('Task no longer exists.');

    if (!tw.isTweetUrl(text)) {
      return ctx.replyWithHTML('Invalid URL. Send your quote tweet link (x.com or twitter.com).');
    }

    await ctx.replyWithHTML('<i>Verifying quote tweet...</i>');
    const user       = store.getUser(userId);
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
    const user     = store.getUser(userId);
    const username = ctx.from.username || ctx.from.first_name || 'unknown';
    if (user) user.wallet = text;

    // Sync to sheets
    const groups = store.getAllGroups();
    const seen   = new Set();
    for (const g of groups) {
      const sid = resolveSheetId(g);
      if (seen.has(sid)) continue;
      seen.add(sid);
      try {
        await sheets.upsertUser(sid, {
          userId, username, twitter: user?.twitter || '',
          wallet: text, discord: user?.discord || '', points: user?.points || 0,
        });
      } catch {}
    }
    if (groups.length === 0) {
      try {
        await sheets.upsertUser(FALLBACK_SHEET_ID, {
          userId, username, twitter: user?.twitter || '',
          wallet: text, discord: '', points: user?.points || 0,
        });
      } catch {}
    }

    await ctx.replyWithHTML(`<b>Wallet Saved!</b>\n\n<code>${text}</code>`);
    await showProfile(ctx);
    return;
  }

  // ── Discord ────────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_discord') {
    session.clearSession(userId);
    const user     = store.getUser(userId);
    const username = ctx.from.username || ctx.from.first_name || 'unknown';
    if (user) user.discord = text;

    // Sync to sheets
    const groups = store.getAllGroups();
    const seen   = new Set();
    for (const g of groups) {
      const sid = resolveSheetId(g);
      if (seen.has(sid)) continue;
      seen.add(sid);
      try {
        await sheets.upsertUser(sid, {
          userId, username, twitter: user?.twitter || '',
          wallet: user?.wallet || '', discord: text, points: user?.points || 0,
        });
      } catch {}
    }
    if (groups.length === 0) {
      try {
        await sheets.upsertUser(FALLBACK_SHEET_ID, {
          userId, username, twitter: user?.twitter || '',
          wallet: user?.wallet || '', discord: text, points: user?.points || 0,
        });
      } catch {}
    }

    await ctx.replyWithHTML(`<b>Discord Saved!</b>\n\n<code>${text}</code>`);
    await showProfile(ctx);
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
