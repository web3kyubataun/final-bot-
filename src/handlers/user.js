const store = require('../store');
const sheets = require('../services/sheets');
const session = require('../sessions');
const {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskListKeyboard, taskCardKeyboard, approvalKeyboard,
} = require('../utils/keyboard');
const { verifyTweet } = require('../utils/twitter');

// ── /start ─────────────────────────────────────────────
async function handleStart(ctx) {
  const user = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);

  await ctx.replyWithHTML(
    `╔══════════════════════╗\n` +
    `     ✨ <b>Welcome Back!</b> ✨\n` +
    `╚══════════════════════╝\n\n` +
    `Hey <b>${ctx.from.first_name}</b>! 👋\n\n` +
    `💰 Your Points: <b>${user.points}</b>\n` +
    `🏆 Earn more by completing tasks & raids!\n\n` +
    `Use the menu below to get started 👇`,
    mainMenuKeyboard()
  );
}

// ── 🎯 Tasks menu ──────────────────────────────────────
async function handleTasksMenu(ctx) {
  const groupId = ctx.chat?.id?.toString() || 'dm';
  const tasks = store.getTasksForGroup(groupId, 'task');

  if (!tasks.length) {
    return ctx.replyWithHTML(
      `🎯 <b>Active Tasks</b>\n\n` +
      `💤 No tasks available right now.\n` +
      `Check back soon — new tasks drop regularly!`
    );
  }

  const kb = taskListKeyboard(tasks);
  await ctx.replyWithHTML(
    `🎯 <b>Active Tasks</b>\n\n` +
    `<i>${tasks.length} task(s) available. Tap one to view details & submit.</i>`,
    kb
  );
}

// ── ⚡ Raids menu ──────────────────────────────────────
async function handleRaidsMenu(ctx) {
  const groupId = ctx.chat?.id?.toString() || 'dm';
  const raids = store.getTasksForGroup(groupId, 'raid');

  if (!raids.length) {
    return ctx.replyWithHTML(
      `⚡ <b>Active Raids</b>\n\n` +
      `💤 No raids running right now.\n` +
      `Stay tuned — raids are posted without warning!`
    );
  }

  const kb = taskListKeyboard(raids);
  await ctx.replyWithHTML(
    `⚡ <b>Active Raids</b>\n\n` +
    `<i>${raids.length} raid(s) active. Tap one to join.</i>`,
    kb
  );
}

// ── View task detail (inline callback) ────────────────
async function handleViewTask(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  await ctx.answerCbQuery();

  const emoji = task.type === 'raid' ? '⚡' : '🎯';
  const userId = ctx.from.id;
  const groupId = task.groupId;
  const alreadyDone = store.hasSubmitted(userId, groupId, taskId);

  await ctx.replyWithHTML(
    `${emoji} <b>${task.title}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `🔗 <b>Link:</b> ${task.link}\n` +
    `💰 <b>Reward:</b> ${task.reward} points\n` +
    `📌 <b>Type:</b> ${task.type.charAt(0).toUpperCase() + task.type.slice(1)}\n` +
    `${'─'.repeat(28)}\n` +
    (alreadyDone
      ? `✅ <i>You have already submitted for this task.</i>`
      : `📤 <i>Tap below to open the link and submit your proof.</i>`),
    alreadyDone ? {} : taskCardKeyboard(task.id, task.link)
  );
}

// ── Initiate proof submission (inline button) ──────────
async function handleDoSubmit(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  const userId = ctx.from.id;
  if (store.hasSubmitted(userId, task.groupId, taskId)) {
    return ctx.answerCbQuery('You already submitted for this task!', { show_alert: true });
  }

  await ctx.answerCbQuery();

  // Start submission flow — wait for next message as proof
  session.setSession(userId, { step: 'awaiting_proof', taskId });

  await ctx.replyWithHTML(
    `📤 <b>Submit Proof</b>\n\n` +
    `Task: <b>${task.title}</b>\n\n` +
    `Please send your <b>proof link</b> now:\n` +
    `<i>(e.g. tweet URL, screenshot link, etc.)</i>`,
    require('../utils/keyboard').cancelKeyboard()
  );
}

// ── 🏆 Leaderboard ─────────────────────────────────────
async function handleLeaderboard(ctx) {
  const top = store.getLeaderboard(10);
  if (!top.length) {
    return ctx.replyWithHTML(`🏆 <b>Leaderboard</b>\n\n<i>No users ranked yet. Be the first!</i>`);
  }

  const medals = ['🥇', '🥈', '🥉'];
  const bar = (pts, max) => {
    const filled = Math.round((pts / max) * 8);
    return '█'.repeat(filled) + '░'.repeat(8 - filled);
  };
  const max = top[0].points || 1;

  const lines = top.map((u, i) => {
    const medal = medals[i] || `  ${i + 1}.`;
    return `${medal} <b>@${u.username}</b>\n     ${bar(u.points, max)} <b>${u.points} pts</b>`;
  });

  await ctx.replyWithHTML(
    `🏆 <b>Leaderboard — Top ${top.length}</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    lines.join('\n\n')
  );
}

// ── 👤 My Profile ──────────────────────────────────────
async function handleMyProfile(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const user = store.getUser(userId);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  const top = store.getLeaderboard(1000);
  const rank = top.findIndex(u => u.id == userId) + 1;
  const notifStatus = user.notifications === false ? '🔕 Off' : '🔔 On';

  const text =
    `👤 <b>My Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    `🙍 <b>Username:</b> @${user.username}\n` +
    `💰 <b>Points:</b> ${user.points}\n` +
    `🏆 <b>Rank:</b> #${rank || '—'}\n` +
    `🐦 <b>Twitter:</b> ${user.twitter || '<i>Not set</i>'}\n` +
    `👛 <b>Wallet:</b> ${user.wallet || '<i>Not set</i>'}\n` +
    `🔔 <b>Notifications:</b> ${notifStatus}\n` +
    `📅 <b>Joined:</b> ${user.joinedAt ? user.joinedAt.split('T')[0] : '—'}\n` +
    `${'─'.repeat(28)}\n` +
    `<i>Use buttons below to update your info.</i>`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...profileKeyboard(user) });
  } else {
    await ctx.replyWithHTML(text, profileKeyboard(user));
  }
}

// ── ⚙️ Settings ────────────────────────────────────────
async function handleSettings(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  await ctx.replyWithHTML(
    `⚙️ <b>Settings</b>\n` +
    `${'─'.repeat(28)}\n` +
    `🔔 Notifications: <b>${user.notifications === false ? 'Off' : 'On'}</b>\n` +
    `🐦 Twitter: <b>${user.twitter || 'Not set'}</b>\n` +
    `👛 Wallet: <b>${user.wallet || 'Not set'}</b>`,
    settingsKeyboard(user)
  );
}

// ── Toggle notifications (inline) ──────────────────────
async function handleToggleNotif(ctx) {
  await ctx.answerCbQuery();
  const user = store.getUser(ctx.from.id);
  if (!user) return;
  user.notifications = user.notifications === false ? true : false;
  const status = user.notifications ? '🔔 On' : '🔕 Off';
  await ctx.answerCbQuery(`Notifications ${status}`, { show_alert: true });
  // Refresh the profile if we're in it
  await handleMyProfile(ctx);
}

// ── Set Twitter (inline flow) ──────────────────────────
async function handleSetTwitterFlow(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_twitter' });
  await ctx.replyWithHTML(
    `🐦 <b>Set Twitter Handle</b>\n\nSend your Twitter username or profile link:`,
    require('../utils/keyboard').cancelKeyboard()
  );
}

// ── Set Wallet (inline flow) ───────────────────────────
async function handleSetWalletFlow(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_wallet' });
  await ctx.replyWithHTML(
    `👛 <b>Set Wallet Address</b>\n\nSend your wallet address:`,
    require('../utils/keyboard').cancelKeyboard()
  );
}

// ── Refresh profile (inline) ───────────────────────────
async function handleRefreshProfile(ctx) {
  await handleMyProfile(ctx);
}

// ── Close a message (inline) ───────────────────────────
async function handleCloseMsg(ctx) {
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
}

// ── Cancel active flow (inline) ────────────────────────
async function handleCancelFlow(ctx) {
  await ctx.answerCbQuery('Cancelled.');
  session.clearSession(ctx.from.id);
  await ctx.deleteMessage().catch(() => {});
}

// ── Handle all incoming text for active sessions ────────
async function handleSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();

  const s = session.getSession(userId);
  if (!s || s.adminFlow) return next(); // adminFlow sessions handled by admin handler

  const text = ctx.message.text.trim();

  // ── Awaiting proof for task submission ──
  if (s.step === 'awaiting_proof') {
    session.clearSession(userId);
    const task = store.getTask(s.taskId);
    if (!task) return ctx.replyWithHTML('❌ Task no longer exists.');

    const groupId = task.groupId;
    const username = ctx.from.username || ctx.from.first_name;

    if (store.hasSubmitted(userId, groupId, s.taskId)) {
      return ctx.replyWithHTML('⚠️ You already submitted for this task.');
    }

    // Tweet verification
    if (task.type === 'raid' && (text.includes('twitter.com') || text.includes('x.com'))) {
      await ctx.replyWithHTML('🔍 Verifying tweet...');
      const result = await verifyTweet(text);
      if (!result.valid) {
        return ctx.replyWithHTML(`❌ <b>Tweet verification failed:</b>\n${result.reason}`);
      }
    }

    const sub = store.createSubmission(userId, username, groupId, s.taskId, task.title, text, task.reward);

    // Log to Google Sheet
    const group = store.getGroup(groupId);
    if (group?.sheetId && group.sheetId !== 'manual') {
      try {
        await sheets.appendSubmission(group.sheetId, {
          timestamp: new Date().toISOString(),
          userId, username,
          task: task.title, proof: text,
          status: 'pending', points: task.reward,
        });
      } catch (e) { console.error('Sheet error:', e.message); }
    }

    await ctx.replyWithHTML(
      `✅ <b>Submission Received!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: <b>${task.title}</b>\n` +
      `🔗 Proof: ${text}\n` +
      `💰 Reward: <b>${task.reward} pts</b> (pending approval)\n\n` +
      `You'll be notified once an admin reviews it.`
    );

    // Notify admins
    const adminMsg =
      `📋 <b>New Submission #${sub.id}</b>\n` +
      `${'─'.repeat(28)}\n` +
      `👤 @${username} (${userId})\n` +
      `🎯 Task: <b>${task.title}</b>\n` +
      `🔗 Proof: ${text}\n` +
      `💰 Points: <b>${task.reward}</b>`;

    const { OWNER_ID } = require('../config');
    const admins = new Set([OWNER_ID, ...(group?.admins || [])]);
    for (const adminId of admins) {
      try {
        await ctx.telegram.sendMessage(adminId, adminMsg, {
          parse_mode: 'HTML',
          ...approvalKeyboard(sub.id),
        });
      } catch { }
    }
    return;
  }

  // ── Awaiting twitter ──
  if (s.step === 'awaiting_twitter') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (!user) return next();
    user.twitter = text;
    return ctx.replyWithHTML(`✅ Twitter updated to: <b>${text}</b>`, mainMenuKeyboard());
  }

  // ── Awaiting wallet ──
  if (s.step === 'awaiting_wallet') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (!user) return next();
    user.wallet = text;
    return ctx.replyWithHTML(`✅ Wallet updated to:\n<code>${text}</code>`, mainMenuKeyboard());
  }

  return next();
}

function register(bot) {
  // Session input must come first
  bot.use(handleSessionInput);

  bot.start(handleStart);
  bot.command('leaderboard', handleLeaderboard);
  bot.command('profile', handleMyProfile);

  // Keyboard menu buttons
  bot.hears('🎯 Tasks', handleTasksMenu);
  bot.hears('⚡ Raids', handleRaidsMenu);
  bot.hears('🏆 Leaderboard', handleLeaderboard);
  bot.hears('👤 My Profile', handleMyProfile);
  bot.hears('⚙️ Settings', handleSettings);

  // Profile inline actions
  bot.action('toggle_notif', handleToggleNotif);
  bot.action('set_twitter', handleSetTwitterFlow);
  bot.action('set_wallet', handleSetWalletFlow);
  bot.action('refresh_profile', handleRefreshProfile);
  bot.action('close_msg', handleCloseMsg);
  bot.action('cancel_flow', handleCancelFlow);

  // Task inline actions
  bot.action(/^view_task_(\d+)$/, handleViewTask);
  bot.action(/^do_submit_(\d+)$/, handleDoSubmit);
}

module.exports = { register };
