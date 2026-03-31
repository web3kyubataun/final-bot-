const store = require('../store');
const sheets = require('../services/sheets');
const session = require('../sessions');
const {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskListKeyboard, taskCardKeyboard, approvalKeyboard, cancelKeyboard,
} = require('../utils/keyboard');
const { verifyTweet } = require('../utils/twitter');

// ═══════════════════════════════════════════════
//  /start
// ═══════════════════════════════════════════════

async function handleStart(ctx) {
  const user = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  await ctx.replyWithHTML(
    `╔═══════════════════════╗\n` +
    `      ✨ <b>Welcome!</b> ✨\n` +
    `╚═══════════════════════╝\n\n` +
    `Hey <b>${ctx.from.first_name}</b>! 👋\n\n` +
    `💰 Your Points: <b>${user.points}</b>\n` +
    `🏆 Complete tasks & raids to climb the leaderboard!\n\n` +
    `Use the menu below 👇`,
    mainMenuKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  TASKS & RAIDS
// ═══════════════════════════════════════════════

async function handleTasksMenu(ctx) {
  const groupId = ctx.chat?.type !== 'private' ? ctx.chat.id.toString() : null;

  let tasks = [];
  if (groupId) {
    tasks = store.getTasksForGroup(groupId, 'task');
  } else {
    // In DM — show tasks from all groups
    store.getAllGroups().forEach(g => {
      tasks.push(...store.getTasksForGroup(g.id, 'task'));
    });
  }

  if (!tasks.length) {
    return ctx.replyWithHTML(
      `🎯 <b>Active Tasks</b>\n\n` +
      `💤 No active tasks right now.\n` +
      `<i>New tasks are announced in the group. Stay tuned!</i>`
    );
  }

  await ctx.replyWithHTML(
    `🎯 <b>Active Tasks</b> (${tasks.length})\n\n` +
    `<i>Tap a task to view details and submit proof:</i>`,
    taskListKeyboard(tasks)
  );
}

async function handleRaidsMenu(ctx) {
  const groupId = ctx.chat?.type !== 'private' ? ctx.chat.id.toString() : null;

  let raids = [];
  if (groupId) {
    raids = store.getTasksForGroup(groupId, 'raid');
  } else {
    store.getAllGroups().forEach(g => {
      raids.push(...store.getTasksForGroup(g.id, 'raid'));
    });
  }

  if (!raids.length) {
    return ctx.replyWithHTML(
      `⚡ <b>Active Raids</b>\n\n` +
      `💤 No raids running right now.\n` +
      `<i>Raids are posted without warning — check back soon!</i>`
    );
  }

  await ctx.replyWithHTML(
    `⚡ <b>Active Raids</b> (${raids.length})\n\n` +
    `<i>Tap a raid to view details and submit proof:</i>`,
    taskListKeyboard(raids)
  );
}

// View task detail
async function handleViewTask(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const alreadyDone = store.hasSubmitted(userId, task.groupId, taskId);
  const emoji = task.type === 'raid' ? '⚡' : '🎯';

  await ctx.replyWithHTML(
    `${emoji} <b>${task.title}</b>\n` +
    `${'─'.repeat(28)}\n` +
    (task.link ? `🔗 <b>Link:</b> ${task.link}\n` : '') +
    `💰 <b>Reward:</b> <b>${task.reward} points</b>\n` +
    `📌 <b>Type:</b> ${task.type.charAt(0).toUpperCase() + task.type.slice(1)}\n` +
    `${'─'.repeat(28)}\n` +
    (alreadyDone
      ? `✅ <i>Already submitted. Awaiting approval.</i>`
      : `📤 <i>Click below to open the link and submit your proof.</i>`),
    alreadyDone ? {} : taskCardKeyboard(task.id, task.link, task.buttonLabel)
  );
}

// Initiate proof submission (from task card button)
async function handleDoSubmit(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  const userId = ctx.from.id;
  if (store.hasSubmitted(userId, task.groupId, taskId)) {
    return ctx.answerCbQuery('⚠️ You already submitted for this task!', { show_alert: true });
  }
  if (!task.active) {
    return ctx.answerCbQuery('❌ This task is no longer active.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  session.setSession(userId, { step: 'awaiting_proof', taskId });
  await ctx.replyWithHTML(
    `📤 <b>Submit Proof</b>\n\n` +
    `Task: <b>${task.title}</b>\n\n` +
    `Send your <b>proof link</b> now:\n` +
    `<i>Tweet URL, screenshot link, etc.</i>`,
    cancelKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════

async function handleLeaderboard(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const top = store.getLeaderboard(10);

  if (!top.length) {
    return ctx.replyWithHTML(`🏆 <b>Leaderboard</b>\n\n<i>No users ranked yet. Be the first!</i>`);
  }

  const medals = ['🥇', '🥈', '🥉'];
  const maxPts = top[0].points || 1;
  const bar = pts => {
    const f = Math.round((pts / maxPts) * 10);
    return '█'.repeat(f) + '░'.repeat(10 - f);
  };

  const lines = top.map((u, i) =>
    `${medals[i] || `${i + 1}.`} <b>@${u.username}</b>\n` +
    `   <code>${bar(u.points)}</code>  <b>${u.points}</b> pts`
  );

  await ctx.replyWithHTML(
    `🏆 <b>Leaderboard — Top ${top.length}</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    lines.join('\n\n')
  );
}

// ═══════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════

async function handleMyProfile(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const user = store.getUser(userId);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  const top = store.getLeaderboard(1000);
  const rank = top.findIndex(u => String(u.id) === String(userId)) + 1;
  const notifStatus = user.notifications === false ? '🔕 Off' : '🔔 On';

  const text =
    `👤 <b>My Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    `🙍 Username: @${user.username}\n` +
    `💰 Points: <b>${user.points}</b>\n` +
    `🏆 Rank: <b>#${rank || '—'}</b>\n` +
    `🐦 Twitter: ${user.twitter || '<i>Not set</i>'}\n` +
    `👛 Wallet: ${user.wallet || '<i>Not set</i>'}\n` +
    `💬 Discord: ${user.discord || '<i>Not set</i>'}\n` +
    `🔔 Notifications: ${notifStatus}\n` +
    `📅 Joined: ${user.joinedAt?.split('T')[0] || '—'}\n` +
    `${'─'.repeat(28)}\n` +
    `<i>Use buttons below to update your info:</i>`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...profileKeyboard(user) }).catch(async () => {
      await ctx.replyWithHTML(text, profileKeyboard(user));
    });
  } else {
    await ctx.replyWithHTML(text, profileKeyboard(user));
  }
}

// ═══════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════

async function handleSettings(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  await ctx.replyWithHTML(
    `⚙️ <b>Settings</b>\n` +
    `${'─'.repeat(28)}\n` +
    `🐦 Twitter: <b>${user.twitter || 'Not set'}</b>\n` +
    `👛 Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    `💬 Discord: <b>${user.discord || 'Not set'}</b>\n` +
    `🔔 Notifications: <b>${user.notifications === false ? 'Off' : 'On'}</b>`,
    settingsKeyboard(user)
  );
}

// ═══════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════

async function handleHelp(ctx) {
  await ctx.replyWithHTML(
    `❓ <b>How to Use This Bot</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `<b>📱 Bottom Menu</b>\n` +
    `🎯 <b>Tasks</b> — View & submit tasks\n` +
    `⚡ <b>Raids</b> — View & join raids\n` +
    `🏆 <b>Leaderboard</b> — Top earners\n` +
    `👤 <b>My Profile</b> — Your stats & settings\n` +
    `⚙️ <b>Settings</b> — Twitter, Wallet, Discord\n\n` +
    `<b>📤 Submitting Proof</b>\n` +
    `1. Tap 🎯 Tasks or ⚡ Raids\n` +
    `2. Tap a task to open it\n` +
    `3. Click the action link\n` +
    `4. Tap 📤 Submit Proof\n` +
    `5. Send your proof link\n` +
    `6. Wait for admin approval\n\n` +
    `<b>💰 Points</b>\n` +
    `Earned by completing tasks & raids.\n` +
    `Check your rank on the leaderboard!\n\n` +
    `<b>🛠 Admins</b>\n` +
    `Use /admin in your group to manage everything.\n\n` +
    `<b>👑 Owner</b>\n` +
    `/addgroup — Register your group\n` +
    `/ownerhelp — All owner commands`
  );
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

  // ── Proof submission ──────────────────────────
  if (s.step === 'awaiting_proof') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML('❌ Task no longer exists.');
    if (!task.active) return ctx.replyWithHTML('❌ This task is no longer active.');

    const userId2 = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    const groupId = task.groupId;

    if (store.hasSubmitted(userId2, groupId, s.taskId)) {
      return ctx.replyWithHTML('⚠️ You already submitted for this task.');
    }

    // Tweet verification
    if (text.includes('twitter.com') || text.includes('x.com')) {
      const r = await verifyTweet(text);
      if (!r.valid) return ctx.replyWithHTML(`❌ <b>Tweet check failed:</b> ${r.reason}`);
    }

    const sub = store.createSubmission(userId2, username, groupId, s.taskId, task.title, text, task.reward);

    // Log to Google Sheet
    const group = store.getGroup(groupId);
    if (group?.sheetId && group.sheetId !== 'none') {
      try {
        await sheets.appendSubmission(group.sheetId, {
          timestamp: new Date().toISOString(), userId: userId2, username,
          task: task.title, proof: text, status: 'pending', points: task.reward,
        });
      } catch (e) { console.error('Sheet error:', e.message); }
    }

    await ctx.replyWithHTML(
      `✅ <b>Submission Received!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: <b>${task.title}</b>\n` +
      `🔗 Proof: ${text}\n` +
      `💰 Reward: <b>${task.reward} pts</b> (pending)\n\n` +
      `You'll be notified when an admin reviews it.`
    );

    // Notify admins
    const adminMsg =
      `📋 <b>New Submission #${sub.id}</b>\n` +
      `${'─'.repeat(28)}\n` +
      `👤 @${username} (<code>${userId2}</code>)\n` +
      `🎯 Task: <b>${task.title}</b>\n` +
      `🔗 ${text}\n` +
      `💰 <b>${task.reward} pts</b>`;

    const { OWNER_ID } = require('../config');
    const admins = new Set([String(OWNER_ID), ...(group?.admins ? [...group.admins] : [])]);
    for (const adminId of admins) {
      try {
        await ctx.telegram.sendMessage(adminId, adminMsg, {
          parse_mode: 'HTML', ...approvalKeyboard(sub.id),
        });
      } catch { }
    }

    // Also post to submissions topic
    if (group?.topics?.submissions) {
      try {
        await ctx.telegram.sendMessage(groupId, adminMsg, {
          parse_mode: 'HTML',
          message_thread_id: group.topics.submissions,
          ...approvalKeyboard(sub.id),
        });
      } catch { }
    }
    return;
  }

  // ── Twitter ───────────────────────────────────
  if (s.step === 'awaiting_twitter') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.twitter = text;
    return ctx.replyWithHTML(`✅ Twitter updated: <b>${text}</b>`, mainMenuKeyboard());
  }

  // ── Wallet ────────────────────────────────────
  if (s.step === 'awaiting_wallet') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.wallet = text;
    return ctx.replyWithHTML(`✅ Wallet updated:\n<code>${text}</code>`, mainMenuKeyboard());
  }

  // ── Discord ───────────────────────────────────
  if (s.step === 'awaiting_discord') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.discord = text;
    return ctx.replyWithHTML(`✅ Discord updated: <b>${text}</b>`, mainMenuKeyboard());
  }

  return next();
}

// ═══════════════════════════════════════════════
//  INLINE CALLBACKS
// ═══════════════════════════════════════════════

async function handleToggleNotif(ctx) {
  await ctx.answerCbQuery();
  const user = store.getUser(ctx.from.id);
  if (!user) return;
  user.notifications = user.notifications === false ? true : false;
  await ctx.answerCbQuery(user.notifications ? '🔔 Notifications on' : '🔕 Notifications off', { show_alert: true });
  await handleMyProfile(ctx);
}

async function handleSetTwitter(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_twitter' });
  await ctx.replyWithHTML(`🐦 <b>Set Twitter</b>\n\nSend your Twitter @handle or profile link:`, cancelKeyboard());
}

async function handleSetWallet(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_wallet' });
  await ctx.replyWithHTML(`👛 <b>Set Wallet Address</b>\n\nSend your wallet address:`, cancelKeyboard());
}

async function handleSetDiscord(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_discord' });
  await ctx.replyWithHTML(`💬 <b>Set Discord</b>\n\nSend your Discord username:`, cancelKeyboard());
}

async function handleRefreshProfile(ctx) {
  await handleMyProfile(ctx);
}

async function handleCloseMsg(ctx) {
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
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
  bot.use(handleSessionInput);

  bot.start(handleStart);
  bot.command('leaderboard', handleLeaderboard);
  bot.command('profile', handleMyProfile);
  bot.command('help', handleHelp);

  // Menu keyboard buttons
  bot.hears('🎯 Tasks', handleTasksMenu);
  bot.hears('⚡ Raids', handleRaidsMenu);
  bot.hears('🏆 Leaderboard', handleLeaderboard);
  bot.hears('👤 My Profile', handleMyProfile);
  bot.hears('⚙️ Settings', handleSettings);
  bot.hears('❓ Help', handleHelp);

  // Profile/settings inline
  bot.action('toggle_notif', handleToggleNotif);
  bot.action('set_twitter', handleSetTwitter);
  bot.action('set_wallet', handleSetWallet);
  bot.action('set_discord', handleSetDiscord);
  bot.action('refresh_profile', handleRefreshProfile);
  bot.action('close_msg', handleCloseMsg);
  bot.action('cancel_flow', handleCancelFlow);

  // Task inline
  bot.action(/^view_task_(\d+)$/, handleViewTask);
  bot.action(/^do_submit_(\d+)$/, handleDoSubmit);
}

module.exports = { register };
