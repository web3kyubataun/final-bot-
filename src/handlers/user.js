/**
 * user.js -- User-facing handlers
 *
 * Anti-cheat & security rules:
 *   - Twitter handle set ONCE by user; only admin can change it via /settwitter
 *   - Twitter username uniqueness enforced across all users
 *   - Duplicate submissions blocked via hasSubmitted() key per task
 *   - Access modes: 'all' | 'group' (getChatMember check) | 'whitelist' (admin-approved list)
 *
 * Verification flow:
 *   like/follow   -> API check -> trust-based fallback if Free tier
 *   retweet       -> user submits their retweet URL -> API verifies author + referenced tweet
 *   comment/quote -> user submits their tweet URL -> API verifies author + content length + spam
 *   join          -> getChatMember check
 *   react/send    -> trust-based (self-reported)
 *   multi         -> each sub-action verified in sequence
 */

const store   = require('../store');
const sheets  = require('../services/sheets');
const session = require('../sessions');
const config  = require('../config');
const { getBotUsername } = require('../botInfo');
const {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard, oauthConnectKeyboard,
  taskListKeyboard, taskCardKeyboard, taskCardDMKeyboard, cancelKeyboard,
} = require('../utils/keyboard');
const tw = require('../utils/twitterVerify');
const { generateAuthUrl } = require('../oauth/twitterOAuth');
const { getTokens }       = require('../db/sqlite');
const { Markup } = require('telegraf');

const TASK_TYPE_LABELS = {
  follow: 'Follow',  like: 'Like',    retweet: 'Retweet',
  comment: 'Comment', quote: 'Quote Tweet',
  join: 'Join Channel/Group', react: 'React to Message', send: 'Send Message',
};

const delay = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════
//  ACCESS CONTROL CHECK
//  Returns null if allowed, or an error string if denied.
// ═══════════════════════════════════════════════

async function checkTaskAccess(ctx, userId, task) {
  const group = store.getGroup(task.groupId);
  if (!group) return null; // no group data — allow

  const mode = group.accessMode || 'all';

  if (mode === 'whitelist') {
    if (!store.isWhitelisted(task.groupId, userId)) {
      return 'You are not on the whitelist for this group. Contact an admin to be added.';
    }
  }

  if (mode === 'group') {
    // Verify user is a member of the Telegram group
    try {
      const member = await ctx.telegram.getChatMember(task.groupId, userId);
      const ok = ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
      if (!ok) return 'You must be a member of the group to complete tasks. Join the group first.';
    } catch {
      // If bot can't check, allow (non-blocking)
    }
  }

  return null;
}

// ═══════════════════════════════════════════════
//  AUTO-AWARD helper
// ═══════════════════════════════════════════════

async function autoAward(ctx, userId, task, proofText) {
  // Final duplicate guard before awarding
  if (store.hasSubmitted(userId, task.groupId, task.id)) {
    return ctx.replyWithHTML('<b>Already Completed</b>\n\nYou have already earned points for this task.');
  }

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
//  /start — handles deep links /start submit_N
// ═══════════════════════════════════════════════

async function handleStart(ctx) {
  const payload = ctx.startPayload;

  if (payload?.startsWith('submit_')) {
    const taskId = parseInt(payload.replace('submit_', ''));
    const task   = store.getTask(taskId);

    if (!task || !task.active) {
      return ctx.replyWithHTML('<b>Task Unavailable</b>\n\nThis task is no longer active or does not exist.');
    }

    // Check raid expiry
    if (task.type === 'raid' && task.expiresAt && new Date(task.expiresAt) < new Date()) {
      return ctx.replyWithHTML('<b>Raid Expired</b>\n\nThis raid has ended.');
    }

    if (store.hasSubmitted(ctx.from.id, task.groupId, taskId)) {
      return ctx.replyWithHTML('<b>Already Done</b>\n\nYou have already completed this task!');
    }

    store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
    return sendTaskCard(ctx, task, true);
  }

  const user = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  await ctx.replyWithHTML(
    `<b>Welcome!</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `Hey <b>${ctx.from.first_name}</b>!\n\n` +
    `Your Points: <b>${user.points}</b>\n` +
    `Complete tasks and raids to earn points and climb the leaderboard!\n\n` +
    `Use the menu below:`,
    mainMenuKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  TASK MENUS
// ═══════════════════════════════════════════════

async function handleTasksMenu(ctx) {
  let tasks = [];
  store.getAllGroups().forEach(g => tasks.push(...store.getTasksForGroup(g.id, 'task')));
  if (!tasks.length) return ctx.replyWithHTML(`<b>Active Tasks</b>\n\n<i>No active tasks right now. Check back soon!</i>`);
  await ctx.replyWithHTML(
    `<b>Active Tasks</b> (${tasks.length})\n\n<i>Tap a task to view details:</i>`,
    taskListKeyboard(tasks)
  );
}

async function handleRaidsMenu(ctx) {
  const now = new Date();
  let raids = [];
  store.getAllGroups().forEach(g => raids.push(...store.getTasksForGroup(g.id, 'raid')));
  if (!raids.length) return ctx.replyWithHTML(`<b>Active Raids</b>\n\n<i>No raids running right now!</i>`);

  const lines = raids.map(r => {
    let timeLeft = '';
    if (r.expiresAt) {
      const ms = new Date(r.expiresAt) - now;
      if (ms > 0) {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        timeLeft = h > 0 ? ` (${h}h ${m}m left)` : ` (${m}m left)`;
      } else {
        timeLeft = ' (expired)';
      }
    }
    return `[Raid] <b>${r.title}</b> — ${r.reward} pts${timeLeft}`;
  }).join('\n');

  await ctx.replyWithHTML(
    `<b>Active Raids</b> (${raids.length})\n${'─'.repeat(28)}\n\n${lines}\n\n<i>Tap a raid to view details:</i>`,
    taskListKeyboard(raids)
  );
}

// ── View task detail ──────────────────────────────────────────────────────────

async function handleViewTask(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  await ctx.answerCbQuery();
  store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);

  const isInGroup = ctx.chat?.type !== 'private';
  const botName   = getBotUsername() || 'MomentumHubBot';
  return sendTaskCard(ctx, task, !isInGroup, isInGroup, botName);
}

// Shared task card sender
async function sendTaskCard(ctx, task, inDM = true, inGroup = false, botName) {
  const userId      = ctx.from.id;
  const alreadyDone = store.hasSubmitted(userId, task.groupId, task.id);
  const typeLabel   = getTaskTypeLabel(task);
  const platLabel   = task.platform === 'telegram' ? 'Telegram' : 'Twitter/X';
  const kind        = task.type === 'raid' ? '[Raid]' : '[Task]';

  // Show time left for raids
  let raidTimer = '';
  if (task.type === 'raid' && task.expiresAt) {
    const ms = new Date(task.expiresAt) - Date.now();
    if (ms > 0) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      raidTimer = `\nExpires in: <b>${h > 0 ? `${h}h ` : ''}${m}m</b>`;
    } else {
      return ctx.replyWithHTML(`<b>Raid Expired</b>\n\nThis raid has ended.`);
    }
  }

  let body =
    `${kind} <b>${task.title}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `Type: <b>${typeLabel}</b>  ${platLabel}\n` +
    (task.link ? `Link: <a href="${task.link}">Open Link</a>\n` : '') +
    `Reward: <b>${task.reward} pts</b>${raidTimer}\n` +
    `${'─'.repeat(28)}\n`;

  if (alreadyDone) {
    body += `<i>Already completed!</i>`;
    return ctx.replyWithHTML(body);
  }

  const taskTypes = getTaskTypes(task);
  if (taskTypes.length > 1) {
    const steps = taskTypes.map((t, i) => `${i + 1}. ${getActionInstruction(t)}`).join('\n');
    body += `<b>Required actions:</b>\n${steps}\n\n<i>Complete all actions, then tap Verify.</i>`;
  } else {
    body += `<i>${getActionInstruction(task.taskType)}</i>`;
  }

  if (inGroup && botName) {
    await ctx.replyWithHTML(body, taskCardDMKeyboard(task.id, task.link, task.buttonLabel, botName));
  } else {
    const primaryType = taskTypes[0] || task.taskType;
    await ctx.replyWithHTML(body, taskCardKeyboard(task.id, task.link, task.buttonLabel, primaryType));
  }
}

function getTaskTypeLabel(task) {
  if (task.taskTypes) {
    try {
      const types = JSON.parse(task.taskTypes);
      return types.map(t => TASK_TYPE_LABELS[t] || t).join(' + ');
    } catch {}
  }
  return TASK_TYPE_LABELS[task.taskType] || task.taskType || '';
}

function getTaskTypes(task) {
  if (task.taskTypes) {
    try { return JSON.parse(task.taskTypes); } catch {}
  }
  return task.taskType ? [task.taskType] : [];
}

function getActionInstruction(taskType) {
  const instructions = {
    like:    'Like the tweet, then tap Verify.',
    retweet: 'Retweet the post, then submit your retweet URL.',
    follow:  'Follow the account, then tap Verify.',
    comment: 'Reply to the tweet with a meaningful comment, then submit your tweet URL.',
    quote:   'Quote tweet with a meaningful comment, then submit your quote tweet URL.',
    join:    'Join the channel/group, then tap Verify.',
    react:   'React to the message, then tap Done.',
    send:    'Send a message in the group, then tap Done.',
  };
  return instructions[taskType] || 'Complete the task, then verify.';
}

// ── "I Did It / Verify / Submit URL" button ───────────────────────────────────

async function handleDoSubmit(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  const userId    = ctx.from.id;
  const isInGroup = ctx.chat?.type !== 'private';

  // Duplicate guard
  if (store.hasSubmitted(userId, task.groupId, taskId)) {
    return ctx.answerCbQuery('Already completed!', { show_alert: true });
  }

  // Active / expiry check
  if (!task.active) {
    return ctx.answerCbQuery('Task no longer active.', { show_alert: true });
  }
  if (task.type === 'raid' && task.expiresAt && new Date(task.expiresAt) < new Date()) {
    return ctx.answerCbQuery('This raid has expired.', { show_alert: true });
  }

  // Force DM if tapped from group
  if (isInGroup) {
    const botName = getBotUsername() || 'MomentumHubBot';
    await ctx.answerCbQuery('Please complete tasks in your private chat with the bot.', { show_alert: true });
    await ctx.reply(
      `Verification must be done in private chat. Tap below to open:`,
      Markup.inlineKeyboard([[Markup.button.url('Open Bot DM', `https://t.me/${botName}?start=submit_${taskId}`)]])
    );
    return;
  }

  await ctx.answerCbQuery();

  store.getOrCreateUser(userId, ctx.from.username || ctx.from.first_name);
  const user = store.getUser(userId);

  // Access control check
  const accessError = await checkTaskAccess(ctx, userId, task);
  if (accessError) {
    return ctx.replyWithHTML(`<b>Access Denied</b>\n\n${accessError}`);
  }

  // Twitter tasks require a linked handle
  if (task.platform === 'twitter' && !user?.twitter) {
    session.setSession(userId, { step: 'awaiting_twitter_for_task', taskId, adminFlow: false });
    return ctx.replyWithHTML(
      `<b>Twitter Handle Required</b>\n` +
      `${'─'.repeat(28)}\n` +
      `This is a Twitter task. Link your Twitter handle first.\n\n` +
      `Send your <b>@handle</b>:\n` +
      `<i>Example: @johndoe</i>\n\n` +
      `<i>You only need to do this once. It cannot be changed after setting.</i>`,
      cancelKeyboard()
    );
  }

  // Multi-action task: route to first pending action
  const taskTypes = getTaskTypes(task);
  if (taskTypes.length > 1) {
    return handleMultiActionSubmit(ctx, userId, task, user, taskTypes);
  }

  return routeTaskAction(ctx, userId, task, user, task.taskType);
}

// ── Multi-action task handler ─────────────────────────────────────────────────

async function handleMultiActionSubmit(ctx, userId, task, user, taskTypes) {
  const s = session.getSession(userId);
  const completedActions = s?.completedActions || [];
  const pendingActions   = taskTypes.filter(t => !completedActions.includes(t));

  if (!pendingActions.length) {
    return autoAward(ctx, userId, task, `multi: ${taskTypes.join('+')}`);
  }

  const nextAction = pendingActions[0];
  session.setSession(userId, {
    ...s,
    step: 'awaiting_multi_action',
    taskId: task.id,
    currentAction: nextAction,
    completedActions,
    taskTypes,
    adminFlow: false,
  });

  const totalDone   = completedActions.length;
  const totalNeeded = taskTypes.length;
  await ctx.replyWithHTML(
    `<b>Action ${totalDone + 1} of ${totalNeeded}: ${TASK_TYPE_LABELS[nextAction] || nextAction}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `${getActionInstruction(nextAction)}\n\n` +
    (task.link ? `Link: <a href="${task.link}">Open Link</a>\n\n` : '') +
    `<i>Progress: ${totalDone}/${totalNeeded} actions done.</i>`,
    taskCardKeyboard(task.id, task.link, task.buttonLabel, nextAction)
  );
}

// ── Route single action ───────────────────────────────────────────────────────

async function routeTaskAction(ctx, userId, task, user, actionType) {
  switch (actionType) {
    case 'comment':
    case 'quote': {
      session.setSession(userId, {
        step: actionType === 'comment' ? 'awaiting_comment_url' : 'awaiting_quote_url',
        taskId: task.id,
        adminFlow: false,
      });
      const label = actionType === 'comment' ? 'reply' : 'quote tweet';
      const minCharsNote = task.minChars > 0
        ? `\n<i>Minimum ${task.minChars} characters required in your ${label}.</i>`
        : '';
      await ctx.replyWithHTML(
        `<b>Submit Your ${actionType === 'comment' ? 'Comment' : 'Quote Tweet'}</b>\n` +
        `${'─'.repeat(28)}\n` +
        `1. Complete the task: <a href="${task.link}">Open Tweet</a>\n` +
        `2. Post your ${label}\n` +
        `3. Copy the URL of YOUR tweet\n` +
        `4. Paste it here${minCharsNote}\n\n` +
        `<i>Example: https://x.com/yourname/status/12345</i>`,
        cancelKeyboard()
      );
      break;
    }

    case 'join': {
      await verifyJoin(ctx, userId, task);
      break;
    }

    case 'like': {
      const tweetId = tw.extractTweetId(task.link);
      if (!tweetId) {
        return ctx.replyWithHTML(
          `<b>Task Error</b>\n\nCould not extract tweet ID from task link. Contact an admin.`
        );
      }
      await ctx.replyWithHTML(`<i>Verifying like via Twitter API...</i>`);
      const likeResult = await tw.verifyLike(tweetId, user.twitter, userId).catch(e => ({
        verified: false, apiError: true,
        reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.',
      }));

      if (likeResult.verified) {
        await completeAction(ctx, userId, task, user, 'like');
      } else if (likeResult.needsOAuth) {
        await ctx.replyWithHTML(
          `<b>Twitter Not Connected</b>\n\n` +
          `${likeResult.reason}\n\n` +
          `Go to <b>Settings → Connect Twitter via OAuth</b> first.`,
          Markup.inlineKeyboard([[Markup.button.callback('⚙️ Open Settings', 'open_settings')]])
        );
      } else if (likeResult.apiError) {
        await ctx.replyWithHTML(
          `<b>Twitter API Error</b>\n\n` +
          `${likeResult.reason}\n\n` +
          `<i>Tap Verify again after 30 seconds.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, 'like')
        );
      } else {
        await ctx.replyWithHTML(
          `<b>Not Verified</b>\n\n${likeResult.reason}\n\n` +
          `<i>Like the tweet on Twitter, then tap Verify again.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, 'like')
        );
      }
      break;
    }

    case 'follow': {
      const targetHandle = tw.extractUsername(task.link);
      if (!targetHandle) {
        return ctx.replyWithHTML(
          `<b>Task Error</b>\n\nCould not extract Twitter username from task link. Contact an admin.`
        );
      }
      await ctx.replyWithHTML(`<i>Verifying follow via Twitter API...</i>`);
      const followResult = await tw.verifyFollow(targetHandle, user.twitter, userId).catch(e => ({
        verified: false, apiError: true,
        reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.',
      }));

      if (followResult.verified) {
        await completeAction(ctx, userId, task, user, 'follow');
      } else if (followResult.needsOAuth) {
        await ctx.replyWithHTML(
          `<b>Twitter Not Connected</b>\n\n` +
          `${followResult.reason}\n\n` +
          `Go to <b>Settings → Connect Twitter via OAuth</b> first.`,
          Markup.inlineKeyboard([[Markup.button.callback('⚙️ Open Settings', 'open_settings')]])
        );
      } else if (followResult.apiError) {
        await ctx.replyWithHTML(
          `<b>Twitter API Error</b>\n\n` +
          `${followResult.reason}\n\n` +
          `<i>Tap Verify again after 30 seconds.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, 'follow')
        );
      } else {
        await ctx.replyWithHTML(
          `<b>Not Verified</b>\n\n${followResult.reason}\n\n` +
          `<i>Follow the account on Twitter, then tap Verify again.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, 'follow')
        );
      }
      break;
    }

    case 'retweet': {
      session.setSession(userId, {
        step: 'awaiting_retweet_url',
        taskId: task.id,
        adminFlow: false,
      });
      await ctx.replyWithHTML(
        `<b>Submit Your Retweet</b>\n` +
        `${'─'.repeat(28)}\n` +
        `1. Retweet this post: <a href="${task.link}">Open Tweet</a>\n` +
        `2. Copy the URL of YOUR retweet\n` +
        `3. Paste it here\n\n` +
        `<i>Example: https://x.com/yourname/status/12345</i>`,
        cancelKeyboard()
      );
      break;
    }

    case 'react':
    case 'send': {
      await completeAction(ctx, userId, task, user, actionType);
      break;
    }

    default:
      await completeAction(ctx, userId, task, user, actionType);
  }
}

// Called when a single action is verified/completed
async function completeAction(ctx, userId, task, user, actionType) {
  const s = session.getSession(userId);
  const completedActions = s?.completedActions || [];

  // Multi-action task
  if (s?.taskTypes && s.taskTypes.length > 1) {
    const newCompleted = [...completedActions, actionType];
    const remaining    = s.taskTypes.filter(t => !newCompleted.includes(t));
    session.setSession(userId, { ...s, completedActions: newCompleted });

    if (remaining.length > 0) {
      await ctx.replyWithHTML(
        `<b>Action Complete!</b> ${TASK_TYPE_LABELS[actionType] || actionType} done.\n` +
        `<i>${remaining.length} action(s) remaining.</i>`
      );
      const nextAction = remaining[0];
      session.setSession(userId, { ...s, completedActions: newCompleted, currentAction: nextAction });
      await ctx.replyWithHTML(
        `<b>Next: ${TASK_TYPE_LABELS[nextAction] || nextAction}</b>\n` +
        `${'─'.repeat(28)}\n` +
        `${getActionInstruction(nextAction)}\n\n` +
        (task.link ? `Link: <a href="${task.link}">Open Link</a>\n\n` : '') +
        `<i>Progress: ${newCompleted.length}/${s.taskTypes.length} done.</i>`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, nextAction)
      );
      return;
    }

    // All actions done
    session.clearSession(userId);
    return autoAward(ctx, userId, task, `multi: ${s.taskTypes.join('+')}`);
  }

  // Single action
  session.clearSession(userId);
  return autoAward(ctx, userId, task, `${actionType}: ${task.link || 'completed'}`);
}

// ── Telegram Join verification ────────────────────────────────────────────────

async function verifyJoin(ctx, userId, task) {
  const match     = String(task.link || '').match(/(?:t\.me\/|@)([A-Za-z0-9_]+)/i);
  const channelId = match ? `@${match[1]}` : null;

  if (!channelId) {
    // No channel ID parseable — trust-based
    return completeAction(ctx, userId, task, store.getUser(userId), 'join');
  }

  try {
    const member = await ctx.telegram.getChatMember(channelId, userId);
    const ok = ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
    if (ok) {
      return completeAction(ctx, userId, task, store.getUser(userId), 'join');
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
      `Make sure you have joined, then tap Verify again.`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, task.taskType)
    );
  }
}

// ═══════════════════════════════════════════════
//  SESSION INPUT HANDLER
// ═══════════════════════════════════════════════

async function handleSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();
  const s = session.getSession(userId);
  if (!s || s.adminFlow) return next();
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) { session.clearSession(userId); return next(); }

  // ── Twitter handle (first time, for a task) ───────────────────────────────
  if (s.step === 'awaiting_twitter_for_task') {
    const handle = text.replace('@', '').trim().toLowerCase();
    if (!handle || !/^[A-Za-z0-9_]{1,50}$/.test(handle)) {
      return ctx.replyWithHTML(`<b>Invalid Handle</b>\n\nSend your Twitter username without spaces.\n<i>Example: @johndoe</i>`);
    }

    // Conflict check
    const conflict = store.checkTwitterUsernameConflict(handle, userId);
    if (conflict) {
      return ctx.replyWithHTML(
        `<b>Username Taken</b>\n\n` +
        `<code>@${handle}</code> is already linked to another account.\n\n` +
        `<i>If this is your account, contact an admin.</i>`
      );
    }

    store.setUserField(userId, 'twitter', handle);
    store.setUserField(userId, 'twitterLocked', true);
    const task = store.getTask(s.taskId);
    session.clearSession(userId);
    await ctx.replyWithHTML(`Twitter handle <b>@${handle}</b> saved! This cannot be changed without admin help.`);
    if (task) {
      const user = store.getUser(userId);
      return routeTaskAction(ctx, userId, task, user, task.taskType);
    }
    return;
  }

  // ── Twitter handle (from Settings) ────────────────────────────────────────
  if (s.step === 'awaiting_twitter') {
    const handle = text.replace('@', '').trim().toLowerCase();
    if (!handle || !/^[A-Za-z0-9_]{1,50}$/.test(handle)) {
      return ctx.replyWithHTML(`<b>Invalid Handle</b>\n\nSend just your Twitter username.\n<i>Example: @johndoe</i>`);
    }

    // Conflict check
    const conflict = store.checkTwitterUsernameConflict(handle, userId);
    if (conflict) {
      return ctx.replyWithHTML(
        `<b>Username Taken</b>\n\n` +
        `<code>@${handle}</code> is already linked to another account.\n\n` +
        `<i>If this is your account, contact an admin.</i>`
      );
    }

    store.setUserField(userId, 'twitter', handle);
    store.setUserField(userId, 'twitterLocked', true);
    session.clearSession(userId);
    return ctx.replyWithHTML(
      `Twitter handle <b>@${handle}</b> saved!\n\n<i>This cannot be changed without admin assistance.</i>`
    );
  }

  // ── Wallet ────────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_wallet') {
    store.setUserField(userId, 'wallet', text);
    session.clearSession(userId);
    return ctx.replyWithHTML(`Wallet address saved: <code>${text}</code>`);
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  if (s.step === 'awaiting_discord') {
    store.setUserField(userId, 'discord', text);
    session.clearSession(userId);
    return ctx.replyWithHTML(`Discord username saved: <b>${text}</b>`);
  }

  // ── Retweet URL submission ────────────────────────────────────────────────
  if (s.step === 'awaiting_retweet_url') {
    if (!text.startsWith('http')) {
      return ctx.reply('Please send a valid URL starting with https://');
    }
    const task = store.getTask(s.taskId);
    if (!task) { session.clearSession(userId); return ctx.reply('Task not found.'); }
    const user = store.getUser(userId);
    session.clearSession(userId);

    await ctx.replyWithHTML(`<i>Verifying your retweet via Twitter API...</i>`);
    const result = await tw.verifyRetweetUrl(text, tw.extractTweetId(task.link), user.twitter).catch(() => ({
      verified: false, apiError: true,
      reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.',
    }));

    if (result.verified) {
      return completeAction(ctx, userId, task, user, 'retweet');
    } else if (result.apiError) {
      return ctx.replyWithHTML(
        `<b>Twitter API Error</b>\n\n${result.reason}\n\n` +
        `<i>Tap Verify again after 30 seconds.</i>`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, 'retweet')
      );
    } else {
      return ctx.replyWithHTML(
        `<b>Not Verified</b>\n\n${result.reason}\n\n` +
        `<i>Make sure you retweeted the correct post and send YOUR retweet link.</i>`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, 'retweet')
      );
    }
  }

  // ── Comment / Quote URL submission ────────────────────────────────────────
  if (s.step === 'awaiting_comment_url' || s.step === 'awaiting_quote_url') {
    if (!text.startsWith('http')) return ctx.reply('Please send a valid URL starting with https://');
    const task = store.getTask(s.taskId);
    if (!task) { session.clearSession(userId); return ctx.reply('Task not found.'); }
    const user = store.getUser(userId);
    const isComment = s.step === 'awaiting_comment_url';

    // If minChars > 0, additionally ask for the comment text for verification
    if (isComment && task.minChars > 0) {
      session.setSession(userId, { ...s, step: 'awaiting_comment_text', commentUrl: text });
      return ctx.replyWithHTML(
        `<b>URL Received!</b>\n\nNow paste your <b>comment text</b> so we can verify its length.\n` +
        `<i>Minimum: ${task.minChars} characters.</i>`
      );
    }

    session.clearSession(userId);
    await ctx.replyWithHTML(`<i>Verifying your ${isComment ? 'comment' : 'quote tweet'} via Twitter API...</i>`);

    const apiErrFallback = () => ({
      verified: false, apiError: true,
      reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.',
    });

    const result = isComment
      ? await tw.verifyReply(text, tw.extractTweetId(task.link), user.twitter, task.minChars || 0).catch(apiErrFallback)
      : await tw.verifyQuote(text, tw.extractTweetId(task.link), user.twitter, task.minChars || 0).catch(apiErrFallback);

    const actionKey = isComment ? 'comment' : 'quote';

    if (result.verified) {
      return completeAction(ctx, userId, task, user, actionKey);
    } else if (result.apiError) {
      return ctx.replyWithHTML(
        `<b>Twitter API Error</b>\n\n${result.reason}\n\n` +
        `<i>Tap Verify again after 30 seconds.</i>`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, actionKey)
      );
    } else {
      return ctx.replyWithHTML(
        `<b>Not Verified</b>\n\n${result.reason}`,
        taskCardKeyboard(task.id, task.link, task.buttonLabel, actionKey)
      );
    }
  }

  // ── Comment text verification ─────────────────────────────────────────────
  if (s.step === 'awaiting_comment_text') {
    const task = store.getTask(s.taskId);
    if (!task) { session.clearSession(userId); return ctx.reply('Task not found.'); }
    if (task.minChars > 0 && text.length < task.minChars) {
      return ctx.replyWithHTML(
        `<b>Comment Too Short</b>\n\n` +
        `Your comment has <b>${text.length}</b> characters — minimum is <b>${task.minChars}</b>.\n` +
        `<i>Write a longer reply on Twitter, then submit again.</i>`,
        cancelKeyboard()
      );
    }
    const user = store.getUser(userId);
    session.clearSession(userId);
    return completeAction(ctx, userId, task, user, 'comment');
  }

  return next();
}

// ═══════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════

async function handleLeaderboard(ctx) {
  const top = store.getLeaderboard(10);  // FIX: was store.getLeaderboard(g.id, 100) — wrong signature
  if (!top.length) {
    return ctx.replyWithHTML('<b>Leaderboard</b>\n\n<i>No points earned yet. Complete tasks to get on the board!</i>');
  }
  const lines = top.map((u, i) => {
    const rank = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
    const name = u.username ? `@${u.username}` : u.id;
    return `${rank}. ${name} — <b>${u.points} pts</b>`;
  }).join('\n');
  await ctx.replyWithHTML(`<b>Leaderboard</b>\n${'─'.repeat(28)}\n\n${lines}`);
}

// ═══════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════

async function handleMyProfile(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  // FIX: getLeaderboard takes (limit) not (groupId, limit)
  const lb  = store.getLeaderboard(100);
  const idx = lb.findIndex(u => String(u.id) === String(ctx.from.id));
  const rank = idx >= 0 ? `#${idx + 1}` : 'Unranked';

  const twitterStatus = user.twitter
    ? `@${user.twitter}${user.twitterLocked ? ' (locked)' : ''}`
    : 'Not set';

  const text =
    `<b>Your Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    `Name: <b>${ctx.from.first_name}</b>\n` +
    `Points: <b>${user.points}</b>\n` +
    `Rank: <b>${rank}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `Twitter: <b>${twitterStatus}</b>\n` +
    `Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    `Discord: <b>${user.discord || 'Not set'}</b>`;

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
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;
  const user   = store.getUser(userId);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  const tokens   = getTokens(userId);
  const hasOAuth = !!(tokens?.access_token);

  const oauthStatus = hasOAuth
    ? `✅ <b>Connected</b> (real API verification active)`
    : `❌ <b>Not connected</b> (trust-based fallback)`;

  await ctx.replyWithHTML(
    `<b>Settings</b>\n${'─'.repeat(28)}\n` +
    `Twitter: <b>${user.twitter ? `@${user.twitter}` : 'Not set'}</b>` +
    `${user.twitterLocked ? ' <i>(locked — contact admin to change)</i>' : ''}\n` +
    `Twitter OAuth: ${oauthStatus}\n` +
    `Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    `Discord: <b>${user.discord || 'Not set'}</b>`,
    settingsKeyboard(hasOAuth)
  );
}

async function handleConnectTwitterOAuth(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;

  if (!config.TWITTER_CLIENT_ID || !process.env.TWITTER_CALLBACK_URL) {
    return ctx.replyWithHTML(
      `<b>OAuth Not Configured</b>\n\n` +
      `The bot owner has not set up Twitter OAuth yet.\n` +
      `<i>Contact an admin for assistance.</i>`
    );
  }

  try {
    const url = await generateAuthUrl(userId);
    await ctx.replyWithHTML(
      `<b>Connect Twitter via OAuth</b>\n${'─'.repeat(28)}\n\n` +
      `Tap the button below to authorize on Twitter.\n\n` +
      `<b>What this enables:</b>\n` +
      `• Real-time verification of Likes and Follows\n` +
      `• More accurate anti-cheat checks\n` +
      `• Your Twitter handle is auto-set after authorization\n\n` +
      `<i>You will be redirected back automatically after approving.</i>`,
      oauthConnectKeyboard(url)
    );
  } catch (e) {
    console.error('[OAuth] generateAuthUrl failed:', e.message);
    await ctx.replyWithHTML(
      `<b>OAuth Error</b>\n\nCould not generate authorization link. Please try again later.`
    );
  }
}

// ═══════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════

async function handleHelp(ctx) {
  await ctx.replyWithHTML(
    `<b>How to Use This Bot</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `<b>User Commands</b>\n` +
    `${'─'.repeat(28)}\n` +
    `/start — Register and open the main menu\n` +
    `/help — Show this help message\n` +
    `/profile — View your profile and rank\n` +
    `/leaderboard — View top earners\n\n` +

    `<b>Menu Buttons</b>\n` +
    `Tasks — Browse active Twitter/Telegram tasks\n` +
    `Raids — Time-limited campaigns (beat the clock!)\n` +
    `Leaderboard — See top point earners\n` +
    `My Profile — Your points, rank, and linked accounts\n` +
    `Settings — Manage Twitter, Wallet, Discord, and OAuth\n\n` +

    `<b>How to Complete a Task</b>\n` +
    `1. Tap Tasks or Raids and pick one\n` +
    `2. Complete the action on Twitter/Telegram\n` +
    `3. Tap Verify — points are awarded instantly\n\n` +

    `<b>Twitter OAuth (Required for Like & Follow)</b>\n` +
    `Go to Settings → Connect Twitter via OAuth.\n` +
    `This lets the bot verify your likes and follows via the real Twitter API.\n` +
    `Without it, Like and Follow tasks cannot be completed.\n\n` +

    `<b>Comment / Quote / Retweet Tasks</b>\n` +
    `After posting on Twitter, paste the URL of YOUR tweet to verify.\n` +
    `Example: https://x.com/yourname/status/12345\n\n` +

    `<b>Raids</b>\n` +
    `Time-limited campaigns — complete them before the timer expires!\n\n` +

    `<b>Anti-Cheat Rules</b>\n` +
    `• Twitter handle is locked after first set — contact an admin to change it\n` +
    `• Each task can only be completed once per user\n` +
    `• All Twitter actions are verified via the Twitter API\n\n` +

    `<b>Admin Commands</b> <i>(admin DM only)</i>\n` +
    `${'─'.repeat(28)}\n` +
    `/admin — Open the admin wizard panel\n` +
    `/commands — Show all admin commands\n` +
    `/settwitter &lt;userId&gt; @handle — Force-set a user's Twitter handle\n` +
    `/wladd &lt;userId&gt; — Add user to whitelist\n` +
    `/wlremove &lt;userId&gt; — Remove user from whitelist\n\n` +

    `<b>Owner Commands</b> <i>(owner DM only)</i>\n` +
    `${'─'.repeat(28)}\n` +
    `/addgroup — Register current group (run inside group) or /addgroup &lt;id&gt; &lt;name&gt;\n` +
    `/removegroup — Unregister group (run inside group) or /removegroup &lt;id&gt;\n` +
    `/listgroups — List all registered groups\n` +
    `/setsheet &lt;groupId&gt; &lt;sheetId&gt; — Link a Google Sheet to a group\n` +
    `/broadcast &lt;message&gt; — DM all bot users\n` +
    `/ownerhelp — Show owner commands + service account email`
  );
}

// ═══════════════════════════════════════════════
//  SETTINGS BUTTON HANDLERS
// ═══════════════════════════════════════════════

async function handleSetTwitter(ctx) {
  await ctx.answerCbQuery();
  const user = store.getUser(ctx.from.id);

  // Lock: if already set, block user from changing
  if (user?.twitter) {
    return ctx.replyWithHTML(
      `<b>Twitter Already Linked</b>\n\n` +
      `Your Twitter handle is <b>@${user.twitter}</b>.\n\n` +
      `<i>To change it, contact an admin. Your handle is locked to prevent cheating.</i>`
    );
  }

  session.setSession(ctx.from.id, { step: 'awaiting_twitter' });
  await ctx.replyWithHTML(
    `<b>Set Twitter Handle</b>\n\n` +
    `Send your Twitter @handle:\n` +
    `<i>Example: @johndoe</i>\n\n` +
    `<i>This can only be set once. Contact an admin if you need to change it.</i>`,
    cancelKeyboard()
  );
}

async function handleSetWallet(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_wallet' });
  await ctx.replyWithHTML(`<b>Set Wallet</b>\n\nSend your wallet address:`, cancelKeyboard());
}

async function handleSetDiscord(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_discord' });
  await ctx.replyWithHTML(`<b>Set Discord</b>\n\nSend your Discord username:`, cancelKeyboard());
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

  bot.hears('Tasks',       handleTasksMenu);
  bot.hears('Raids',       handleRaidsMenu);
  bot.hears('Leaderboard', handleLeaderboard);
  bot.hears('My Profile',  handleMyProfile);
  bot.hears('Settings',    handleSettings);
  bot.hears('Help',        handleHelp);

  bot.action('set_twitter',           handleSetTwitter);
  bot.action('connect_twitter_oauth', handleConnectTwitterOAuth);
  bot.action('open_settings',         async ctx => { await ctx.answerCbQuery(); return handleSettings(ctx); });
  bot.action('set_wallet',            handleSetWallet);
  bot.action('set_discord',           handleSetDiscord);
  bot.action('refresh_profile',       ctx => handleMyProfile(ctx));
  bot.action('close_msg',             async ctx => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(() => {}); });
  bot.action('cancel_flow',           handleCancelFlow);

  bot.action(/^view_task_(\d+)$/, handleViewTask);
  bot.action(/^do_submit_(\d+)$/, handleDoSubmit);
}

module.exports = { register };
