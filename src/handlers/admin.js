const store = require('../store');
const sheets = require('../services/sheets');
const session = require('../sessions');
const { adminOnly } = require('../middleware/auth');
const {
  approvalKeyboard, adminPanelKeyboard,
  taskDeleteKeyboard, cancelKeyboard,
} = require('../utils/keyboard');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════
//  ADMIN PANEL
// ═══════════════════════════════════════════════

async function handleAdminPanel(ctx) {
  const groupId = ctx.chat?.id?.toString();
  const isCallback = !!ctx.callbackQuery;
  if (isCallback) await ctx.answerCbQuery();

  if (!store.isGroupRegistered(groupId)) {
    const msg = '⚠️ This group is not registered.\nAsk the owner to use /addgroup.';
    return isCallback ? ctx.answerCbQuery(msg, { show_alert: true }) : ctx.replyWithHTML(msg);
  }

  const group = store.getGroup(groupId);
  const pendingCount = Object.values(require('../store').store.submissions)
    .filter(s => s.groupId === groupId && s.status === 'pending').length;
  const taskCount = store.getTasksForGroup(groupId).length;
  const userCount = store.getAllUsers().length;
  const mode = group.accessMode || 'all';

  const header =
    `🛠️ <b>Admin Control Panel</b>\n` +
    `${'─'.repeat(28)}\n` +
    `📊 Tasks: <b>${taskCount}</b>  •  ⏳ Pending: <b>${pendingCount}</b>\n` +
    `👥 Users: <b>${userCount}</b>  •  🔐 Mode: <b>${mode}</b>\n` +
    `${'─'.repeat(28)}\n` +
    `<i>Tap any button below to take action:</i>`;

  if (isCallback) {
    try {
      await ctx.editMessageText(header, { parse_mode: 'HTML', ...adminPanelKeyboard() });
    } catch { }
  } else {
    await ctx.replyWithHTML(header, adminPanelKeyboard());
  }
}

// ═══════════════════════════════════════════════
//  ADMIN SESSION INPUT HANDLER
// ═══════════════════════════════════════════════

async function handleAdminSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();

  const s = session.getSession(userId);
  if (!s || !s.adminFlow) return next();

  const text = ctx.message.text.trim();
  const groupId = ctx.chat?.id?.toString() || s.groupId;

  // ── Create Task / Raid flow ──────────────────
  if (s.step === 'task_title') {
    session.setSession(userId, { ...s, step: 'task_link', title: text, groupId });
    return ctx.replyWithHTML(
      `✅ Title: <b>${text}</b>\n\nStep 2/3 — Send the <b>task link</b>:`,
      cancelKeyboard()
    );
  }

  if (s.step === 'task_link') {
    session.setSession(userId, { ...s, step: 'task_reward', link: text });
    return ctx.replyWithHTML(
      `✅ Link: ${text}\n\nStep 3/3 — Send the <b>point reward</b> (number):`,
      cancelKeyboard()
    );
  }

  if (s.step === 'task_reward') {
    session.clearSession(userId);
    const reward = parseInt(text) || 0;
    const task = store.createTask(s.groupId, s.title, s.link, reward, s.type);
    const emoji = s.type === 'raid' ? '⚡' : '🎯';

    const msg =
      `${emoji} <b>New ${s.type === 'raid' ? 'Raid' : 'Task'} Created!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `📌 <b>${task.title}</b>\n` +
      `🔗 ${task.link}\n` +
      `💰 Reward: <b>${task.reward} pts</b>\n` +
      `🆔 Task ID: <code>${task.id}</code>\n\n` +
      `<i>Sent to group and all users.</i>`;

    // Post in group
    try {
      await ctx.telegram.sendMessage(s.groupId, msg, {
        parse_mode: 'HTML',
        ...require('../utils/keyboard').taskCardKeyboard(task.id, task.link),
      });
    } catch { await ctx.replyWithHTML(msg); }

    // DM all users
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let dmSent = 0;
    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user.id, msg, {
          parse_mode: 'HTML',
          ...require('../utils/keyboard').taskCardKeyboard(task.id, task.link),
        });
        dmSent++;
      } catch { }
      await delay(50);
    }
    return ctx.replyWithHTML(`✅ Task created & sent to <b>${dmSent}</b> users.`, adminPanelKeyboard());
  }

  // ── Announce flow ────────────────────────────
  if (s.step === 'announce_msg') {
    session.clearSession(userId);
    const msg = `📢 <b>Announcement</b>\n\n${text}`;

    try { await ctx.telegram.sendMessage(s.groupId, msg, { parse_mode: 'HTML' }); } catch { }

    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const user of users) {
      try { await ctx.telegram.sendMessage(user.id, msg, { parse_mode: 'HTML' }); sent++; } catch { }
      await delay(50);
    }
    return ctx.replyWithHTML(`✅ Announced to <b>${sent}</b> users.`, adminPanelKeyboard());
  }

  // ── DM all users (custom message) ────────────
  if (s.step === 'dm_all_msg') {
    session.clearSession(userId);
    const msg = `📨 <b>Message from Admin</b>\n\n${text}`;
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const user of users) {
      try { await ctx.telegram.sendMessage(user.id, msg, { parse_mode: 'HTML' }); sent++; } catch { }
      await delay(50);
    }
    return ctx.replyWithHTML(`✅ DM sent to <b>${sent}</b> users.`, adminPanelKeyboard());
  }

  // ── Ban user flow ────────────────────────────
  if (s.step === 'ban_userid') {
    session.clearSession(userId);
    const targetId = parseInt(text);
    if (!targetId) return ctx.replyWithHTML('❌ Invalid user ID.');
    store.banUser(targetId);
    return ctx.replyWithHTML(`🚫 User <code>${targetId}</code> has been banned.`, adminPanelKeyboard());
  }

  // ── Unban user flow ──────────────────────────
  if (s.step === 'unban_userid') {
    session.clearSession(userId);
    const targetId = parseInt(text);
    if (!targetId) return ctx.replyWithHTML('❌ Invalid user ID.');
    store.unbanUser(targetId);
    return ctx.replyWithHTML(`✅ User <code>${targetId}</code> has been unbanned.`, adminPanelKeyboard());
  }

  // ── Add admin flow ────────────────────────────
  if (s.step === 'add_admin_id') {
    session.clearSession(userId);
    const targetId = parseInt(text);
    if (!targetId) return ctx.replyWithHTML('❌ Invalid user ID.');
    store.addAdmin(s.groupId, targetId);
    return ctx.replyWithHTML(`✅ User <code>${targetId}</code> added as admin.`, adminPanelKeyboard());
  }

  // ── Remove admin flow ─────────────────────────
  if (s.step === 'remove_admin_id') {
    session.clearSession(userId);
    const targetId = parseInt(text);
    if (!targetId) return ctx.replyWithHTML('❌ Invalid user ID.');
    store.removeAdmin(s.groupId, targetId);
    return ctx.replyWithHTML(`✅ User <code>${targetId}</code> removed from admins.`, adminPanelKeyboard());
  }

  // ── Add email flow ────────────────────────────
  if (s.step === 'add_email') {
    session.clearSession(userId);
    const email = text;
    if (!email.includes('@')) return ctx.replyWithHTML('❌ Invalid email.');
    const group = store.getGroup(s.groupId);
    store.addExtraEmail(s.groupId, email);
    if (group?.sheetId && group.sheetId !== 'manual') {
      try {
        await sheets.shareSheet(group.sheetId, email);
        return ctx.replyWithHTML(`✅ <b>${email}</b> added and sheet shared.`, adminPanelKeyboard());
      } catch (e) {
        return ctx.replyWithHTML(`✅ Email saved.\n⚠️ Sheet share failed: ${e.message}`, adminPanelKeyboard());
      }
    }
    return ctx.replyWithHTML(`✅ Email <b>${email}</b> saved.`, adminPanelKeyboard());
  }

  return next();
}

// ═══════════════════════════════════════════════
//  INLINE BUTTON CALLBACKS
// ═══════════════════════════════════════════════

function startFlow(ctx, flowData, promptText) {
  const groupId = ctx.chat?.id?.toString();
  session.setSession(ctx.from.id, { adminFlow: true, groupId, ...flowData });
  return ctx.replyWithHTML(promptText, cancelKeyboard());
}

async function handleApproveCallback(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.');
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`, { show_alert: true });

  store.approveSubmission(subId);
  store.addPoints(sub.userId, sub.points);

  const group = store.getGroup(sub.groupId);
  const user = store.getUser(sub.userId);

  if (group?.sheetId && group.sheetId !== 'manual') {
    try {
      await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'approved');
      if (user) await sheets.upsertUser(group.sheetId, {
        userId: sub.userId, username: sub.username,
        points: user.points, twitter: user.twitter,
        wallet: user.wallet, joinedAt: user.joinedAt,
      });
    } catch (e) { console.error('Sheet error:', e.message); }
  }

  try {
    await ctx.telegram.sendMessage(sub.userId,
      `🎉 <b>Submission Approved!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: <b>${sub.taskTitle}</b>\n` +
      `💰 Points earned: <b>+${sub.points}</b>\n` +
      `🏦 Total points: <b>${user ? user.points : '?'}</b>\n\n` +
      `Keep it up! Check the leaderboard 🏆`,
      { parse_mode: 'HTML' }
    );
  } catch { }

  await ctx.editMessageText(
    `✅ <b>Approved</b>\n👤 @${sub.username} | 🎯 ${sub.taskTitle} | 💰 +${sub.points} pts`,
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery('✅ Approved!');
}

async function handleRejectCallback(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.');
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`, { show_alert: true });

  store.rejectSubmission(subId);

  const group = store.getGroup(sub.groupId);
  if (group?.sheetId && group.sheetId !== 'manual') {
    try { await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'rejected'); } catch { }
  }

  try {
    await ctx.telegram.sendMessage(sub.userId,
      `❌ <b>Submission Rejected</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: ${sub.taskTitle}\n\n` +
      `Please re-read the task requirements and try again.`,
      { parse_mode: 'HTML' }
    );
  } catch { }

  await ctx.editMessageText(
    `❌ <b>Rejected</b>\n👤 @${sub.username} | 🎯 ${sub.taskTitle}`,
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery('❌ Rejected.');
}

async function handleViewSubmissions(ctx, filter = 'pending') {
  const isCallback = !!ctx.callbackQuery;
  if (isCallback) await ctx.answerCbQuery();

  const groupId = ctx.chat?.id?.toString();
  const subs = Object.values(require('../store').store.submissions)
    .filter(s => s.groupId === groupId && s.status === filter);

  if (!subs.length) {
    return ctx.replyWithHTML(
      `📬 <b>Submissions — ${filter.charAt(0).toUpperCase() + filter.slice(1)}</b>\n\n` +
      `<i>No ${filter} submissions.</i>`
    );
  }

  await ctx.replyWithHTML(
    `📬 <b>${filter.charAt(0).toUpperCase() + filter.slice(1)} Submissions</b> (${subs.length} total)\n` +
    `${'─'.repeat(28)}\n<i>Showing up to 10:</i>`
  );

  for (const sub of subs.slice(0, 10)) {
    await ctx.replyWithHTML(
      `📋 <b>#${sub.id}</b> — @${sub.username} (<code>${sub.userId}</code>)\n` +
      `🎯 <b>${sub.taskTitle}</b>\n` +
      `🔗 ${sub.proof}\n` +
      `💰 ${sub.points} pts  •  📅 ${sub.createdAt.split('T')[0]}`,
      filter === 'pending' ? approvalKeyboard(sub.id) : {}
    );
  }
}

async function handleViewTasks(ctx) {
  await ctx.answerCbQuery();
  const groupId = ctx.chat?.id?.toString();
  const tasks = store.getTasksForGroup(groupId);

  if (!tasks.length) {
    return ctx.replyWithHTML(`📊 <b>All Tasks</b>\n\n<i>No tasks created yet.</i>`);
  }

  const lines = tasks.map(t =>
    `${t.type === 'raid' ? '⚡' : '🎯'} [<code>${t.id}</code>] <b>${t.title}</b>\n` +
    `   💰 ${t.reward} pts  •  🔗 ${t.link}`
  ).join('\n\n');

  await ctx.replyWithHTML(`📊 <b>All Tasks</b> (${tasks.length})\n${'─'.repeat(28)}\n\n${lines}`);
}

async function handleDeleteTaskMenu(ctx) {
  await ctx.answerCbQuery();
  const groupId = ctx.chat?.id?.toString();
  const tasks = store.getTasksForGroup(groupId);

  if (!tasks.length) {
    return ctx.replyWithHTML(`🗑️ <b>Delete Task</b>\n\n<i>No tasks to delete.</i>`);
  }

  await ctx.replyWithHTML(
    `🗑️ <b>Delete Task</b>\n<i>Select a task to remove it:</i>`,
    taskDeleteKeyboard(tasks)
  );
}

async function handleDeleteTask(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');
  task.active = false;
  await ctx.answerCbQuery('Task deleted.');
  await ctx.editMessageText(
    `🗑️ Task <b>[${taskId}] ${task.title}</b> has been deleted.`,
    { parse_mode: 'HTML' }
  );
}

async function handleManageUsers(ctx) {
  await ctx.answerCbQuery();
  const users = store.getAllUsers().slice(0, 20);
  if (!users.length) return ctx.replyWithHTML(`👥 <b>Users</b>\n\n<i>No users yet.</i>`);

  const lines = users.map((u, i) =>
    `${i + 1}. @${u.username} (<code>${u.id}</code>)\n` +
    `   💰 ${u.points} pts  ${u.banned ? '🚫 Banned' : '✅ Active'}`
  ).join('\n\n');

  await ctx.replyWithHTML(`👥 <b>Users</b> (top 20)\n${'─'.repeat(28)}\n\n${lines}`);
}

function register(bot) {
  // Admin session input middleware
  bot.use(handleAdminSessionInput);

  // /admin command
  bot.command('admin', adminOnly, handleAdminPanel);

  // Approval callbacks (no adminOnly needed — sent directly to admin DM)
  bot.action(/^approve_(\d+)$/, handleApproveCallback);
  bot.action(/^reject_(\d+)$/, handleRejectCallback);

  // Delete task callback
  bot.action(/^del_task_(\d+)$/, handleDeleteTask);

  // Cancel any flow
  bot.action('cancel_flow', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.');
    session.clearSession(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
  });

  // Back to admin panel
  bot.action('back_admin', handleAdminPanel);

  // Noop (section headers)
  bot.action('noop', (ctx) => ctx.answerCbQuery());

  // ── Campaign buttons ──────────────────────────
  bot.action('admin_create_task', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'task_title', type: 'task' },
      `📝 <b>Create Task — Step 1/3</b>\n\nSend the <b>task title</b>:`);
  });

  bot.action('admin_create_raid', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'task_title', type: 'raid' },
      `⚡ <b>Create Raid — Step 1/3</b>\n\nSend the <b>raid title</b>:`);
  });

  bot.action('admin_view_tasks', handleViewTasks);
  bot.action('admin_delete_task', handleDeleteTaskMenu);

  // ── Submission buttons ────────────────────────
  bot.action('admin_view_submissions', async (ctx) => await handleViewSubmissions(ctx, 'pending'));
  bot.action('admin_view_approved', async (ctx) => await handleViewSubmissions(ctx, 'approved'));
  bot.action('admin_view_rejected', async (ctx) => await handleViewSubmissions(ctx, 'rejected'));

  // ── Broadcast buttons ─────────────────────────
  bot.action('admin_announce', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'announce_msg' },
      `📣 <b>Group Announcement</b>\n\nType your announcement message:`);
  });

  bot.action('admin_dm_all', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'dm_all_msg' },
      `📨 <b>DM All Users</b>\n\nType the message to send to all users:`);
  });

  // ── User management buttons ───────────────────
  bot.action('admin_manage_users', handleManageUsers);

  bot.action('admin_ban_user', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'ban_userid' },
      `🚫 <b>Ban User</b>\n\nSend the <b>User ID</b> to ban:\n<i>(forward a message from the user to see their ID)</i>`);
  });

  bot.action('admin_unban_user', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'unban_userid' },
      `✅ <b>Unban User</b>\n\nSend the <b>User ID</b> to unban:`);
  });

  bot.action('admin_add_admin', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'add_admin_id' },
      `➕ <b>Add Admin</b>\n\nSend the <b>User ID</b> to promote to admin:`);
  });

  bot.action('admin_remove_admin', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'remove_admin_id' },
      `➖ <b>Remove Admin</b>\n\nSend the <b>User ID</b> to demote:`);
  });

  // ── Access control buttons ────────────────────
  bot.action('admin_mode_all', async (ctx) => {
    const groupId = ctx.chat?.id?.toString();
    store.setAccessMode(groupId, 'all');
    await ctx.answerCbQuery('✅ Mode set to: All Users', { show_alert: true });
    await handleAdminPanel(ctx);
  });

  bot.action('admin_mode_group', async (ctx) => {
    const groupId = ctx.chat?.id?.toString();
    store.setAccessMode(groupId, 'group');
    await ctx.answerCbQuery('✅ Mode set to: Group Members Only', { show_alert: true });
    await handleAdminPanel(ctx);
  });

  bot.action('admin_mode_whitelist', async (ctx) => {
    const groupId = ctx.chat?.id?.toString();
    store.setAccessMode(groupId, 'whitelist');
    await ctx.answerCbQuery('✅ Mode set to: Whitelist Only', { show_alert: true });
    await handleAdminPanel(ctx);
  });

  // ── Google Sheets button ──────────────────────
  bot.action('admin_add_email', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'add_email' },
      `📧 <b>Add Sheet Email</b>\n\nSend the Gmail address to share the Google Sheet with:`);
  });

  // ── Close button ─────────────────────────────
  bot.action('admin_close', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  });
}

module.exports = { register };
