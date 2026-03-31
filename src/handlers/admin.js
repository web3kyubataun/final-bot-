const store = require('../store');
const sheets = require('../services/sheets');
const session = require('../sessions');
const { adminOnly } = require('../middleware/auth');
const {
  approvalKeyboard, adminMainKeyboard, taskDeleteKeyboard,
  topicsSetupKeyboard, groupSelectorKeyboard, cancelKeyboard,
} = require('../utils/keyboard');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════

/** Resolve groupId — from chat (in group) or from saved session/DM */
function resolveGroupId(ctx, savedGroupId) {
  const chatType = ctx.chat?.type;
  if (chatType === 'group' || chatType === 'supergroup') {
    return String(ctx.chat.id);
  }
  return savedGroupId || null;
}

/** Send admin panel — handles both group and DM, and group selection */
async function sendAdminPanel(ctx, groupId, isEdit = false) {
  if (!groupId) {
    // DM with no group context — show group selector
    const groups = store.getGroupsForAdmin(ctx.from.id);
    if (!groups.length) {
      return ctx.replyWithHTML('⚠️ You are not an admin of any registered group.');
    }
    if (groups.length === 1) {
      groupId = groups[0].id;
    } else {
      return ctx.replyWithHTML(
        '📋 <b>Select a group to manage:</b>',
        groupSelectorKeyboard(groups)
      );
    }
  }

  const group = store.getGroup(groupId);
  if (!group) {
    return ctx.reply('⚠️ Group not registered. Owner must /addgroup first.');
  }

  const stats = store.getGroupStats(groupId);
  const name = group.groupName || groupId;

  const text =
    `🛠 <b>Admin Panel</b>  —  ${name}\n` +
    `${'─'.repeat(30)}\n` +
    `🎯 Active: <b>${stats.activeTasks}</b> tasks  ⚡ <b>${stats.activeRaids}</b> raids\n` +
    `⏳ Pending reviews: <b>${stats.pendingSubmissions}</b>\n` +
    `👥 Users: <b>${stats.totalUsers}</b>  •  🔐 Mode: <b>${group.accessMode}</b>\n` +
    `${'─'.repeat(30)}\n` +
    `<i>Tap any section below to take action:</i>`;

  if (isEdit && ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, { parse_mode: 'HTML', ...adminMainKeyboard(name) });
    } catch { }
  }
  return ctx.replyWithHTML(text, adminMainKeyboard(name));
}

// ═══════════════════════════════════════════════
//  ADMIN PANEL COMMAND
// ═══════════════════════════════════════════════

async function handleAdminPanel(ctx) {
  const chatType = ctx.chat?.type;
  const groupId = (chatType === 'group' || chatType === 'supergroup')
    ? String(ctx.chat.id)
    : null;
  await sendAdminPanel(ctx, groupId);
}

// ═══════════════════════════════════════════════
//  ADMIN SESSION INPUT HANDLER (middleware)
// ═══════════════════════════════════════════════

async function handleAdminSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();

  const s = session.getSession(userId);
  if (!s?.adminFlow) return next();

  const text = ctx.message.text.trim();
  const groupId = s.groupId;

  // ── CREATE TASK / RAID — Step 1: title ───────────────
  if (s.step === 'task_title') {
    session.setSession(userId, { ...s, step: 'task_link', title: text });
    return ctx.replyWithHTML(
      `✅ Title saved: <b>${text}</b>\n\n` +
      `<b>Step 2 of 4</b> — Send the <b>task link/URL</b>:\n<i>(type "none" if no link)</i>`,
      cancelKeyboard()
    );
  }

  // ── Step 2: link ─────────────────────────────────────
  if (s.step === 'task_link') {
    session.setSession(userId, { ...s, step: 'task_reward', link: text === 'none' ? '' : text });
    return ctx.replyWithHTML(
      `✅ Link saved.\n\n<b>Step 3 of 4</b> — Send the <b>point reward</b> (number):`,
      cancelKeyboard()
    );
  }

  // ── Step 3: reward ────────────────────────────────────
  if (s.step === 'task_reward') {
    const reward = parseInt(text);
    if (isNaN(reward) || reward < 0) return ctx.reply('❌ Please send a valid number (e.g. 100)');
    session.setSession(userId, { ...s, step: 'task_button', reward });
    return ctx.replyWithHTML(
      `✅ Reward: <b>${reward} pts</b>\n\n` +
      `<b>Step 4 of 4</b> — Send a <b>button label</b> for users:\n` +
      `<i>Example: "Like & Retweet"\nType "none" to skip</i>`,
      cancelKeyboard()
    );
  }

  // ── Step 4: button label → create task ───────────────
  if (s.step === 'task_button') {
    session.clearSession(userId);
    const btnLabel = text === 'none' ? null : text;
    const task = store.createTask(groupId, s.title, s.link, s.reward, s.type, btnLabel);
    const emoji = s.type === 'raid' ? '⚡' : '🎯';
    const { taskCardKeyboard } = require('../utils/keyboard');

    const broadcastMsg =
      `${emoji} <b>New ${s.type === 'raid' ? 'Raid' : 'Task'} Alert!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `📌 <b>${task.title}</b>\n` +
      (task.link ? `🔗 ${task.link}\n` : '') +
      `💰 Reward: <b>${task.reward} points</b>\n\n` +
      `<i>Tap the button below to complete & submit proof.</i>`;

    // Post to group (optionally in notifications/quests/raids topic)
    const group = store.getGroup(groupId);
    const topicKey = s.type === 'raid' ? 'raids' : 'quests';
    const topicId = group?.topics?.[topicKey] || group?.topics?.notifications || null;

    try {
      await ctx.telegram.sendMessage(groupId, broadcastMsg, {
        parse_mode: 'HTML',
        message_thread_id: topicId || undefined,
        ...taskCardKeyboard(task.id, task.link, btnLabel),
      });
    } catch (e) {
      console.error('Group post error:', e.message);
    }

    // Also post to notifications topic if different from task topic
    if (topicId && group?.topics?.notifications && topicId !== group.topics.notifications) {
      try {
        await ctx.telegram.sendMessage(groupId, broadcastMsg, {
          parse_mode: 'HTML',
          message_thread_id: group.topics.notifications,
          ...taskCardKeyboard(task.id, task.link, btnLabel),
        });
      } catch { }
    }

    // DM all users
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let dmSent = 0;
    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user.id, broadcastMsg, {
          parse_mode: 'HTML',
          ...taskCardKeyboard(task.id, task.link, btnLabel),
        });
        dmSent++;
      } catch { }
      await delay(50);
    }

    await ctx.replyWithHTML(
      `✅ <b>${s.type === 'raid' ? 'Raid' : 'Task'} created & sent!</b>\n` +
      `🆔 ID: <code>${task.id}</code>  •  📬 DMs sent: <b>${dmSent}</b>`
    );
    return sendAdminPanel(ctx, groupId);
  }

  // ── ANNOUNCE ─────────────────────────────────────────
  if (s.step === 'announce_msg') {
    session.clearSession(userId);
    const group = store.getGroup(groupId);
    const topicId = group?.topics?.announcements || null;
    const msg = `📢 <b>Announcement</b>\n\n${text}`;

    try {
      await ctx.telegram.sendMessage(groupId, msg, {
        parse_mode: 'HTML',
        message_thread_id: topicId || undefined,
      });
    } catch (e) { console.error('Announce group error:', e.message); }

    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const user of users) {
      try { await ctx.telegram.sendMessage(user.id, msg, { parse_mode: 'HTML' }); sent++; } catch { }
      await delay(50);
    }
    await ctx.replyWithHTML(`✅ Announced to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── DM ALL ────────────────────────────────────────────
  if (s.step === 'dm_all_msg') {
    session.clearSession(userId);
    const msg = `📨 <b>Message from Admin</b>\n\n${text}`;
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const user of users) {
      try { await ctx.telegram.sendMessage(user.id, msg, { parse_mode: 'HTML' }); sent++; } catch { }
      await delay(50);
    }
    await ctx.replyWithHTML(`✅ DM sent to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── BAN ───────────────────────────────────────────────
  if (s.step === 'ban_id') {
    session.clearSession(userId);
    const targetId = text.replace('@', '');
    const ok = store.banUser(targetId);
    const msg = ok
      ? `🚫 User <code>${targetId}</code> has been banned.`
      : `⚠️ User <code>${targetId}</code> not found. They may not have used the bot yet.`;
    await ctx.replyWithHTML(msg);
    return sendAdminPanel(ctx, groupId);
  }

  // ── UNBAN ─────────────────────────────────────────────
  if (s.step === 'unban_id') {
    session.clearSession(userId);
    const targetId = text.replace('@', '');
    const ok = store.unbanUser(targetId);
    await ctx.replyWithHTML(ok
      ? `✅ User <code>${targetId}</code> has been unbanned.`
      : `⚠️ User <code>${targetId}</code> not found.`
    );
    return sendAdminPanel(ctx, groupId);
  }

  // ── ADD ADMIN ─────────────────────────────────────────
  if (s.step === 'add_admin_id') {
    session.clearSession(userId);
    const targetId = text.replace('@', '');
    store.addAdmin(groupId, targetId);
    await ctx.replyWithHTML(`✅ <code>${targetId}</code> added as admin.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── REMOVE ADMIN ──────────────────────────────────────
  if (s.step === 'rem_admin_id') {
    session.clearSession(userId);
    const targetId = text.replace('@', '');
    store.removeAdmin(groupId, targetId);
    await ctx.replyWithHTML(`✅ <code>${targetId}</code> removed from admins.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── ADD EMAIL ─────────────────────────────────────────
  if (s.step === 'add_email') {
    session.clearSession(userId);
    if (!text.includes('@')) return ctx.reply('❌ Invalid email address.');
    const group = store.getGroup(groupId);
    if (!group.extraEmails) group.extraEmails = [];
    if (!group.extraEmails.includes(text)) group.extraEmails.push(text);
    if (group.sheetId && group.sheetId !== 'none') {
      try { await sheets.shareSheet(group.sheetId, text); } catch (e) { console.error(e.message); }
    }
    await ctx.replyWithHTML(`✅ Email <b>${text}</b> added${group.sheetId !== 'none' ? ' and sheet shared' : ''}.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── SET GROUP LINK ────────────────────────────────────
  if (s.step === 'set_link') {
    session.clearSession(userId);
    store.setGroupMeta(groupId, { groupLink: text });
    await ctx.replyWithHTML(`✅ Group link set to: ${text}`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── SET TOPIC (from admin panel) ──────────────────────
  if (s.step === 'set_topic_id') {
    session.clearSession(userId);
    const topicId = parseInt(text);
    if (isNaN(topicId)) return ctx.reply('❌ Please send a valid topic ID number.');
    store.setGroupTopic(groupId, s.topicType, topicId);
    await ctx.replyWithHTML(`✅ Topic <b>${s.topicType}</b> set to <code>${topicId}</code>.`);
    return sendAdminPanel(ctx, groupId);
  }

  return next();
}

// ═══════════════════════════════════════════════
//  APPROVAL / REJECTION
// ═══════════════════════════════════════════════

async function handleApprove(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.', { show_alert: true });
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`, { show_alert: true });

  store.approveSubmission(subId);
  store.addPoints(sub.userId, sub.points);

  const user = store.getUser(sub.userId);
  const group = store.getGroup(sub.groupId);

  // Update sheet
  if (group?.sheetId && group.sheetId !== 'none') {
    try {
      await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'approved');
      if (user) await sheets.upsertUser(group.sheetId, {
        userId: sub.userId, username: sub.username,
        points: user.points, twitter: user.twitter,
        wallet: user.wallet, joinedAt: user.joinedAt,
      });
    } catch (e) { console.error('Sheet error:', e.message); }
  }

  // Notify user
  try {
    await ctx.telegram.sendMessage(sub.userId,
      `🎉 <b>Submission Approved!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: <b>${sub.taskTitle}</b>\n` +
      `💰 Points earned: <b>+${sub.points}</b>\n` +
      `🏦 Total: <b>${user?.points ?? '?'}</b>\n\n` +
      `Keep completing tasks! 🚀`,
      { parse_mode: 'HTML' }
    );
  } catch { }

  // Notify in submissions topic
  if (group?.sheetId) {
    const topicId = group.topics?.submissions;
    if (topicId) {
      try {
        await ctx.telegram.sendMessage(sub.groupId,
          `✅ <b>Submission Approved</b>\n👤 @${sub.username} | 🎯 ${sub.taskTitle} | +${sub.points}pts`,
          { parse_mode: 'HTML', message_thread_id: topicId }
        );
      } catch { }
    }
  }

  await ctx.editMessageText(
    `✅ <b>Approved</b> — @${sub.username} | ${sub.taskTitle} | +${sub.points}pts`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
  await ctx.answerCbQuery('✅ Approved!');
}

async function handleReject(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.', { show_alert: true });
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`, { show_alert: true });

  store.rejectSubmission(subId);

  const group = store.getGroup(sub.groupId);
  if (group?.sheetId && group.sheetId !== 'none') {
    try { await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'rejected'); } catch { }
  }

  try {
    await ctx.telegram.sendMessage(sub.userId,
      `❌ <b>Submission Rejected</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: ${sub.taskTitle}\n\n` +
      `Please review the requirements and try again.`,
      { parse_mode: 'HTML' }
    );
  } catch { }

  await ctx.editMessageText(
    `❌ <b>Rejected</b> — @${sub.username} | ${sub.taskTitle}`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
  await ctx.answerCbQuery('❌ Rejected.');
}

// ═══════════════════════════════════════════════
//  INLINE BUTTON HANDLERS
// ═══════════════════════════════════════════════

function startFlow(ctx, flowData, prompt) {
  const chatType = ctx.chat?.type;
  const groupId = (chatType === 'group' || chatType === 'supergroup')
    ? String(ctx.chat.id)
    : null;
  session.setSession(ctx.from.id, { adminFlow: true, groupId, ...flowData });
  return ctx.replyWithHTML(prompt, cancelKeyboard());
}

async function showSubmissions(ctx, status) {
  await ctx.answerCbQuery();
  const chatType = ctx.chat?.type;
  const groupId = (chatType === 'group' || chatType === 'supergroup')
    ? String(ctx.chat.id) : null;
  if (!groupId) return ctx.reply('Open the admin panel from inside your group.');

  const subs = store.getSubmissionsForGroup(groupId, status);
  if (!subs.length) {
    return ctx.replyWithHTML(`📬 <b>${status.charAt(0).toUpperCase() + status.slice(1)} Submissions</b>\n\n<i>None found.</i>`);
  }

  await ctx.replyWithHTML(
    `📬 <b>${status.charAt(0).toUpperCase() + status.slice(1)} Submissions</b> (${subs.length})\n` +
    `<i>Showing up to 10 most recent:</i>`
  );

  for (const sub of subs.slice(-10).reverse()) {
    await ctx.replyWithHTML(
      `<b>#${sub.id}</b> — @${sub.username} (<code>${sub.userId}</code>)\n` +
      `🎯 ${sub.taskTitle}\n🔗 ${sub.proof}\n💰 ${sub.points}pts  •  ${sub.createdAt.split('T')[0]}`,
      status === 'pending' ? approvalKeyboard(sub.id) : {}
    );
  }
}

function register(bot) {
  // Session input must come first
  bot.use(handleAdminSessionInput);

  // /admin command
  bot.command('admin', adminOnly, handleAdminPanel);

  // Approval/rejection (sent to admin DM — no adminOnly needed here)
  bot.action(/^approve_(\d+)$/, handleApprove);
  bot.action(/^reject_(\d+)$/, handleReject);

  // Delete task
  bot.action(/^del_task_(\d+)$/, async (ctx) => {
    const taskId = parseInt(ctx.match[1]);
    const ok = store.deactivateTask(taskId);
    await ctx.answerCbQuery(ok ? '🗑 Task deleted' : 'Not found');
    if (ok) await ctx.editMessageText(`🗑 Task <b>#${taskId}</b> deleted.`, { parse_mode: 'HTML' }).catch(() => {});
  });

  // Group selector
  bot.action(/^select_group_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = ctx.match[1];
    await sendAdminPanel(ctx, groupId);
  });

  // Back to admin panel
  bot.action('back_admin', async (ctx) => {
    await ctx.answerCbQuery();
    const chatType = ctx.chat?.type;
    const groupId = (chatType === 'group' || chatType === 'supergroup') ? String(ctx.chat.id) : null;
    await sendAdminPanel(ctx, groupId, true);
  });

  // Cancel flow
  bot.action('cancel_flow', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.');
    session.clearSession(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
  });

  // Section headers (noop)
  ['admin_section_campaigns', 'admin_section_subs', 'admin_section_bc',
   'admin_section_users', 'admin_section_access', 'admin_section_setup'].forEach(action => {
    bot.action(action, ctx => ctx.answerCbQuery());
  });

  // ── Campaigns ─────────────────────────────────────────
  bot.action('admin_create_task', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'task_title', type: 'task' },
      `📝 <b>Create Task</b>\n\n<b>Step 1 of 4</b> — Send the <b>task title</b>:`);
  });

  bot.action('admin_create_raid', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'task_title', type: 'raid' },
      `⚡ <b>Create Raid</b>\n\n<b>Step 1 of 4</b> — Send the <b>raid title</b>:`);
  });

  bot.action('admin_view_tasks', async (ctx) => {
    await ctx.answerCbQuery();
    const chatType = ctx.chat?.type;
    const groupId = (chatType === 'group' || chatType === 'supergroup') ? String(ctx.chat.id) : null;
    if (!groupId) return ctx.reply('Use from inside your group.');
    const tasks = store.getAllTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('📊 <b>Tasks</b>\n\n<i>No tasks yet.</i>');
    const lines = tasks.map(t =>
      `${t.active ? '🟢' : '🔴'} [<code>${t.id}</code>] ${t.type === 'raid' ? '⚡' : '🎯'} <b>${t.title}</b> — ${t.reward}pts`
    ).join('\n');
    await ctx.replyWithHTML(`📊 <b>All Tasks</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_delete_task_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const chatType = ctx.chat?.type;
    const groupId = (chatType === 'group' || chatType === 'supergroup') ? String(ctx.chat.id) : null;
    if (!groupId) return ctx.reply('Use from inside your group.');
    const tasks = store.getTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('🗑 <b>Delete Task</b>\n\n<i>No active tasks.</i>');
    await ctx.replyWithHTML('🗑 <b>Select a task to delete:</b>', taskDeleteKeyboard(tasks));
  });

  // ── Submissions ───────────────────────────────────────
  bot.action('admin_subs_pending', ctx => showSubmissions(ctx, 'pending'));
  bot.action('admin_subs_approved', ctx => showSubmissions(ctx, 'approved'));
  bot.action('admin_subs_rejected', ctx => showSubmissions(ctx, 'rejected'));

  // ── Broadcast ─────────────────────────────────────────
  bot.action('admin_announce', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'announce_msg' },
      `📣 <b>Announce to Group + All Users</b>\n\nType your announcement message:`);
  });

  bot.action('admin_dm_all', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'dm_all_msg' },
      `📨 <b>DM All Users</b>\n\nType the message to send:`);
  });

  // ── Users ─────────────────────────────────────────────
  bot.action('admin_view_users', async (ctx) => {
    await ctx.answerCbQuery();
    const users = store.getAllUsers().slice(0, 20);
    if (!users.length) return ctx.replyWithHTML('👥 <b>Users</b>\n\n<i>No users yet.</i>');
    const lines = users.map((u, i) =>
      `${i + 1}. @${u.username} (<code>${u.id}</code>)\n` +
      `   💰 ${u.points}pts  ${u.banned ? '🚫 Banned' : '✅ Active'}`
    ).join('\n\n');
    await ctx.replyWithHTML(`👥 <b>Users (latest 20)</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_ban', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'ban_id' },
      `🚫 <b>Ban User</b>\n\nSend the <b>User ID</b> to ban:\n<i>Forward a message from the user to @userinfobot to get their ID.</i>`);
  });

  bot.action('admin_unban', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'unban_id' }, `✅ <b>Unban User</b>\n\nSend the <b>User ID</b> to unban:`);
  });

  bot.action('admin_add_admin', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'add_admin_id' }, `➕ <b>Add Admin</b>\n\nSend the <b>User ID</b> to promote:`);
  });

  bot.action('admin_rem_admin', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'rem_admin_id' }, `➖ <b>Remove Admin</b>\n\nSend the <b>User ID</b> to demote:`);
  });

  // ── Access control ────────────────────────────────────
  bot.action('admin_mode_all', async (ctx) => {
    const groupId = ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null;
    if (groupId) store.setAccessMode(groupId, 'all');
    await ctx.answerCbQuery('✅ All users allowed', { show_alert: true });
    await sendAdminPanel(ctx, groupId, true);
  });

  bot.action('admin_mode_group', async (ctx) => {
    const groupId = ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null;
    if (groupId) store.setAccessMode(groupId, 'group');
    await ctx.answerCbQuery('✅ Group members only', { show_alert: true });
    await sendAdminPanel(ctx, groupId, true);
  });

  bot.action('admin_mode_whitelist', async (ctx) => {
    const groupId = ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null;
    if (groupId) store.setAccessMode(groupId, 'whitelist');
    await ctx.answerCbQuery('✅ Whitelist mode on', { show_alert: true });
    await sendAdminPanel(ctx, groupId, true);
  });

  // ── Setup & Settings ──────────────────────────────────
  bot.action('admin_setup_topics', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null;
    if (!groupId) return ctx.reply('Use from inside your group.');
    await ctx.replyWithHTML(
      `📌 <b>Setup Forum Topics</b>\n\n` +
      `Select a topic type to assign a thread ID.\n` +
      `<i>Or run /autotopics to auto-create all topics.</i>`,
      topicsSetupKeyboard(groupId)
    );
  });

  bot.action(/^set_topic_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicType = ctx.match[1];
    const groupId = ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null;
    await startFlow(ctx, { step: 'set_topic_id', topicType, groupId: groupId || undefined },
      `📌 <b>Set Topic: ${topicType}</b>\n\nSend the <b>thread ID</b> for this topic:\n<i>Right-click topic → Copy Link → last number is the ID</i>`
    );
  });

  bot.action('admin_add_email', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'add_email' },
      `📧 <b>Add Sheet Email</b>\n\nSend the Gmail address to share the Google Sheet with:`);
  });

  bot.action('admin_stats', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null;
    if (!groupId) return ctx.reply('Use from inside your group.');
    const s = store.getGroupStats(groupId);
    const group = store.getGroup(groupId);
    await ctx.replyWithHTML(
      `📊 <b>Group Statistics</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Active Tasks: <b>${s.activeTasks}</b> / ${s.totalTasks}\n` +
      `⚡ Active Raids: <b>${s.activeRaids}</b> / ${s.totalRaids}\n` +
      `⏳ Pending: <b>${s.pendingSubmissions}</b>\n` +
      `✅ Approved: <b>${s.approvedSubmissions}</b>\n` +
      `❌ Rejected: <b>${s.rejectedSubmissions}</b>\n` +
      `👥 Total Users: <b>${s.totalUsers}</b>\n` +
      `🚫 Banned: <b>${s.bannedUsers}</b>\n` +
      `🔐 Mode: <b>${group?.accessMode}</b>`
    );
  });

  bot.action('admin_set_link', async (ctx) => {
    await ctx.answerCbQuery();
    await startFlow(ctx, { step: 'set_link' },
      `🔗 <b>Set Group Link</b>\n\nSend the invite link (e.g. https://t.me/yourgroup):`);
  });

  bot.action('admin_close', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  });
}

module.exports = { register };
