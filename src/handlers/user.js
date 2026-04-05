/**
 * user.js -- User-facing handlers
 *
 * Verify flow:
 *   like/follow   -> tap "Verify" -> Twitter API check
 *   retweet       -> tap "Verify" -> Twitter API check
 *   comment/quote -> user sends tweet URL -> verify
 *   join          -> tap "Verify" -> getChatMember check
 *   react/send    -> tap "Done"   -> trust-based
 *   multi         -> each sub-action verified in sequence
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
//  /start -- also handles deeplinks /start submit_N
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
  const botName   = getBotUsername();
  return sendTaskCard(ctx, task, !isInGroup, isInGroup, botName);
}

// Shared task card sender
async function sendTaskCard(ctx, task, inDM = true, inGroup = false, botName) {
  const userId     = ctx.from.id;
  const alreadyDone = store.hasSubmitted(userId, task.groupId, task.id);
  const typeLabel  = getTaskTypeLabel(task);
  const platLabel  = task.platform === 'telegram' ? 'Telegram' : 'Twitter/X';
  const kind       = task.type === 'raid' ? '[Raid]' : '[Task]';

  let body =
    `${kind} <b>${task.title}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `Type: <b>${typeLabel}</b>  ${platLabel}\n` +
    (task.link ? `Link: <a href="${task.link}">Open Link</a>\n` : '') +
    `Reward: <b>${task.reward} pts</b>\n` +
    `${'─'.repeat(28)}\n`;

  if (alreadyDone) {
    body += `<i>Already completed!</i>`;
    return ctx.replyWithHTML(body);
  }

  // Build instructions
  const taskTypes = getTaskTypes(task);
  if (taskTypes.length > 1) {
    const steps = taskTypes.map((t, i) => `${i+1}. ${getActionInstruction(t)}`).join('\n');
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
    retweet: 'Retweet the post, then tap Verify.',
    follow:  'Follow the account, then tap Verify.',
    comment: 'Reply to the tweet with at least 20 characters, then submit your tweet URL.',
    quote:   'Quote tweet with at least 20 characters, then submit your quote tweet URL.',
    join:    'Join the channel/group, then tap Verify.',
    react:   'React to the message, then tap Done.',
    send:    'Send a message in the group, then tap Done.',
  };
  return instructions[taskType] || 'Complete the task, then verify.';
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

  // Redirect to DM if in group
  if (isInGroup) {
    const botName = getBotUsername();
    await ctx.answerCbQuery('Please complete tasks in your private chat with the bot.', { show_alert: true });
    if (botName) {
      await ctx.reply(
        `Verification must be done in private chat. Tap below to open:`,
        Markup.inlineKeyboard([[Markup.button.url('Open Bot DM', `https://t.me/${botName}?start=submit_${taskId}`)]])
      );
    }
    return;
  }

  await ctx.answerCbQuery();

  store.getOrCreateUser(userId, ctx.from.username || ctx.from.first_name);
  const user = store.getUser(userId);

  // Twitter tasks need a Twitter handle
  if (task.platform === 'twitter' && !user?.twitter) {
    session.setSession(userId, { step: 'awaiting_twitter_for_task', taskId, adminFlow: false });
    return ctx.replyWithHTML(
      `<b>Twitter Handle Required</b>\n` +
      `${'─'.repeat(28)}\n` +
      `This is a Twitter task. Please set your Twitter handle first.\n\n` +
      `Send your <b>@handle</b>:`,
      cancelKeyboard()
    );
  }

  // Multi-action task: route to first pending action
  const taskTypes = getTaskTypes(task);
  if (taskTypes.length > 1) {
    return handleMultiActionSubmit(ctx, userId, task, user, taskTypes);
  }

  // Single action routing
  return routeTaskAction(ctx, userId, task, user, task.taskType);
}

// ── Multi-action task handler ──────────────────────────────────────────────────
async function handleMultiActionSubmit(ctx, userId, task, user, taskTypes) {
  const s = session.getSession(userId);
  const completedActions = s?.completedActions || [];
  const pendingActions = taskTypes.filter(t => !completedActions.includes(t));

  if (!pendingActions.length) {
    // All done
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

  const totalDone = completedActions.length;
  const totalNeeded = taskTypes.length;
  await ctx.replyWithHTML(
    `<b>Task ${totalDone + 1} of ${totalNeeded}: ${TASK_TYPE_LABELS[nextAction] || nextAction}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `${getActionInstruction(nextAction)}\n\n` +
    (task.link ? `Link: <a href="${task.link}">Open Link</a>\n\n` : '') +
    `<i>Progress: ${totalDone}/${totalNeeded} actions done.</i>`,
    taskCardKeyboard(task.id, task.link, task.buttonLabel, nextAction)
  );
}

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
      await ctx.replyWithHTML(
        `<b>Submit Your ${actionType === 'comment' ? 'Comment' : 'Quote Tweet'}</b>\n` +
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
      const fn = actionType === 'like'
        ? () => tw.verifyLike(tw.extractTweetId(task.link), user.twitter)
        : () => tw.verifyFollow(tw.extractUsername(task.link), user.twitter);

      const result = await fn().catch(() => ({
        verified: false,
        reason: 'Twitter API error. Please try again in a moment.',
      }));

      if (result.verified) {
        await completeAction(ctx, userId, task, user, actionType);
      } else {
        await ctx.replyWithHTML(
          `<b>Not Verified</b>\n\n${result.reason}\n\n` +
          `<i>Complete the task first, then tap Verify again.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, actionType)
        );
      }
      break;
    }

    case 'retweet': {
      await ctx.replyWithHTML(`<i>Checking retweet via Twitter API...</i>`);
      const tweetId = tw.extractTweetId(task.link);

      if (!tweetId) {
        await ctx.replyWithHTML(`<b>Invalid Link</b>\n\nCould not extract tweet ID. Contact an admin.`);
        break;
      }

      const result = await tw.verifyRetweet(tweetId, user.twitter).catch(() => ({
        verified: false,
        reason: 'Twitter API error. Please try again in a moment.',
      }));

      if (result.verified) {
        await completeAction(ctx, userId, task, user, actionType);
      } else {
        await ctx.replyWithHTML(
          `<b>Retweet Not Found</b>\n\n${result.reason}\n\n` +
          `<i>Retweet the tweet first, then tap Verify again.</i>`,
          taskCardKeyboard(task.id, task.link, task.buttonLabel, actionType)
        );
      }
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
    const remaining = s.taskTypes.filter(t => !newCompleted.includes(t));
    session.setSession(userId, { ...s, completedActions: newCompleted });

    if (remaining.length > 0) {
      await ctx.replyWithHTML(
        `<b>Action Complete!</b> ${actionType} done.\n` +
        `<i>${remaining.length} action(s) remaining.</i>`
      );
      // Show next action
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

// ── Telegram Join verification ─────────────────────────────────────────────────
async function verifyJoin(ctx, userId, task) {
  const match = String(task.link || '').match(/(?:t\.me\/|@)([A-Za-z0-9_]+)/i);
  const channelId = match ? `@${match[1]}` : null;

  if (!channelId) {
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

  if (s.step === 'awaiting_twitter_for_task') {
    const handle = text.replace('@', '').trim().toLowerCase();
    if (!handle) return ctx.reply('Send your Twitter @handle.');
    store.setUserField(userId, 'twitter', handle);
    const task = store.getTask(s.taskId);
    session.clearSession(userId);
    if (task) {
      await ctx.replyWithHTML(`Twitter handle <b>@${handle}</b> saved!`);
      const user = store.getUser(userId);
      return routeTaskAction(ctx, userId, task, user, task.taskType);
    }
    return ctx.replyWithHTML(`Twitter handle <b>@${handle}</b> saved!`);
  }

  if (s.step === 'awaiting_twitter') {
    const handle = text.replace('@', '').trim().toLowerCase();
    if (!handle) return ctx.reply('Send your Twitter @handle.');
    store.setUserField(userId, 'twitter', handle);
    session.clearSession(userId);
    return ctx.replyWithHTML(`Twitter handle <b>@${handle}</b> saved!`);
  }

  if (s.step === 'awaiting_wallet') {
    store.setUserField(userId, 'wallet', text);
    session.clearSession(userId);
    return ctx.replyWithHTML(`Wallet address saved: <code>${text}</code>`);
  }

  if (s.step === 'awaiting_discord') {
    store.setUserField(userId, 'discord', text);
    session.clearSession(userId);
    return ctx.replyWithHTML(`Discord username saved: <b>${text}</b>`);
  }

  if (s.step === 'awaiting_comment_url' || s.step === 'awaiting_quote_url') {
    if (!text.startsWith('http')) return ctx.reply('Please send a valid URL starting with https://');
    const task = store.getTask(s.taskId);
    if (!task) { session.clearSession(userId); return ctx.reply('Task not found.'); }
    const user = store.getUser(userId);
    session.clearSession(userId);
    return completeAction(ctx, userId, task, user, s.step === 'awaiting_comment_url' ? 'comment' : 'quote');
  }

  return next();
}

// ═══════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════

async function handleLeaderboard(ctx) {
  const groups = store.getAllGroups();
  if (!groups.length) return ctx.replyWithHTML('<b>Leaderboard</b>\n\n<i>No groups set up yet.</i>');
  for (const g of groups) {
    const top = store.getLeaderboard(g.id, 10);
    if (!top.length) continue;
    const lines = top.map((u, i) => {
      const rank = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}th`;
      const name = u.username ? `@${u.username}` : (u.displayName || u.id);
      return `${rank}. ${name} -- ${u.points} pts`;
    }).join('\n');
    await ctx.replyWithHTML(`<b>Leaderboard</b> -- ${g.groupName || g.id}\n${'─'.repeat(28)}\n\n${lines}`);
  }
}

// ═══════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════

async function handleMyProfile(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.replyWithHTML('Please use /start first.');
  let rank = '?';
  const groups = store.getAllGroups();
  for (const g of groups) {
    const lb = store.getLeaderboard(g.id, 100);
    const idx = lb.findIndex(u => String(u.id) === String(ctx.from.id));
    if (idx >= 0) { rank = `#${idx + 1}`; break; }
  }
  const text =
    `<b>Your Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    `Name: <b>${ctx.from.first_name}</b>\n` +
    `Points: <b>${user.points}</b>\n` +
    `Rank: <b>${rank}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `Twitter: <b>${user.twitter || 'Not set'}</b>\n` +
    `Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    `Discord: <b>${user.discord || 'Not set'}</b>`;
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode:'HTML', ...profileKeyboard() }).catch(async () => {
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
    `<b>Settings</b>\n${'─'.repeat(28)}\n` +
    `Twitter: <b>${user.twitter || 'Not set'}</b>\n` +
    `Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    `Discord: <b>${user.discord || 'Not set'}</b>`,
    settingsKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════

async function handleHelp(ctx) {
  await ctx.replyWithHTML(
    `<b>How to Use This Bot</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `<b>Menu</b>\n` +
    `Tasks -- Active Twitter/Telegram tasks\n` +
    `Raids -- Active raid campaigns\n` +
    `Leaderboard -- Top earners\n` +
    `My Profile -- Your stats and rank\n` +
    `Settings -- Twitter, Wallet, Discord\n\n` +
    `<b>How to Complete a Task</b>\n` +
    `1. Tap Tasks or Raids\n` +
    `2. Select a task\n` +
    `3. Complete it (open the link)\n` +
    `4. Tap "I Did It - Verify"\n` +
    `5. Points are awarded after verification!\n\n` +
    `<b>Comment/Quote Tasks</b>\n` +
    `After posting, paste your tweet URL to verify.\n\n` +
    `<b>Twitter Tasks</b>\n` +
    `Go to Settings and set your Twitter @handle first.\n\n` +
    `<b>Multi-Action Tasks</b>\n` +
    `Some tasks require multiple actions. Complete each one to earn points.`
  );
}

// ═══════════════════════════════════════════════
//  SETTINGS BUTTON HANDLERS
// ═══════════════════════════════════════════════

async function handleSetTwitter(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_twitter' });
  await ctx.replyWithHTML(`<b>Set Twitter Handle</b>\n\nSend your Twitter @handle:`, cancelKeyboard());
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
