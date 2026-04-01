const store = require('../store');
const sheets = require('../services/sheets');
const session = require('../sessions');
const config = require('../config');
const { adminOnly, isOwner } = require('../middleware/auth');
const {
  approvalKeyboard, adminMainKeyboard, taskDeleteKeyboard,
  topicsSetupKeyboard, groupSelectorKeyboard, cancelKeyboard, switchGroupKeyboard,
} = require('../utils/keyboard');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════
//  RESOLVE GROUP FOR ADMIN
// ═══════════════════════════════════════════════

/**
 * Get the groupId an admin is currently working with.
 * Priority: group chat context > stored DM context
 */
function resolveAdminGroup(ctx) {
  const chatType = ctx.chat?.type;
  if (chatType === 'group' || chatType === 'supergroup') {
    return String(ctx.chat.id);
  }
  return store.getAdminContext(ctx.from?.id) || null;
}

// ═══════════════════════════════════════════════
//  SEND ADMIN PANEL
// ═══════════════════════════════════════════════

async function sendAdminPanel(ctx, groupId, isEdit = false) {
  const userId = ctx.from.id;

  if (!groupId) {
    const groups = store.getGroupsForAdmin(userId);
    if (!groups.length) {
      return ctx.replyWithHTML(
        `⚠️ <b>No registered groups found.</b>\n\n` +
        `You are not an admin of any whitelisted group.\n` +
        `An owner must run /addgroup first, then add you as admin.`
      );
    }
    if (groups.length === 1) {
      groupId = groups[0].id;
      store.setAdminContext(userId, groupId);
    } else {
      return ctx.replyWithHTML(
        `📋 <b>Select a group to manage:</b>\n` +
        `<i>You are admin of ${groups.length} groups.</i>`,
        groupSelectorKeyboard(groups)
      );
    }
  }

  const group = store.getGroup(groupId);
  if (!group) return ctx.reply('⚠️ Group not found. Owner must /addgroup first.');

  // Save context for DM use
  store.setAdminContext(userId, groupId);

  const stats = store.getGroupStats(groupId);
  const name  = group.groupName || groupId;
  const adminGroups = store.getGroupsForAdmin(userId);
  const canSwitch = adminGroups.length > 1;

  const text =
    `🛠 <b>Admin Panel</b>\n` +
    `${'─'.repeat(30)}\n` +
    `📋 <b>${name}</b>\n` +
    `${'─'.repeat(30)}\n` +
    `🎯 Tasks: <b>${stats.activeTasks}</b> active  ⚡ Raids: <b>${stats.activeRaids}</b> active\n` +
    `⏳ Pending reviews: <b>${stats.pendingSubmissions}</b>\n` +
    `👥 Users: <b>${stats.totalUsers}</b>  •  🔐 Mode: <b>${group.accessMode}</b>\n` +
    `${'─'.repeat(30)}\n` +
    (canSwitch ? `<i>Use 🔄 Switch Group to manage a different group.</i>` : `<i>Tap a section below:</i>`);

  if (isEdit && ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...adminMainKeyboard(name, canSwitch),
      });
    } catch { /* message unchanged — ignore */ }
  }
  return ctx.replyWithHTML(text, adminMainKeyboard(name, canSwitch));
}

// ═══════════════════════════════════════════════
//  /admin COMMAND
// ═══════════════════════════════════════════════

async function handleAdminPanel(ctx) {
  const groupId = resolveAdminGroup(ctx);
  await sendAdminPanel(ctx, groupId);
}

// ═══════════════════════════════════════════════
//  ADMIN SESSION INPUT (middleware runs before all)
// ═══════════════════════════════════════════════

async function handleAdminSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  // Only process text messages for admin flows
  if (!userId || !ctx.message?.text) return next();

  const s = session.getSession(userId);
  if (!s?.adminFlow) return next();

  const text    = ctx.message.text.trim();
  const groupId = s.groupId || store.getAdminContext(userId);

  // If text looks like a command, cancel the flow and let the command through
  if (text.startsWith('/')) {
    session.clearSession(userId);
    return next();
  }

  // ── TASK / RAID STEPS ─────────────────────────────────
  if (s.step === 'task_title') {
    session.setSession(userId, { ...s, step: 'task_link', title: text });
    return ctx.replyWithHTML(
      `✅ Title: <b>${text}</b>\n\n` +
      `<b>Step 2 / 4</b> — Send the <b>URL/link</b> for this task:\n<i>(type "none" if no link)</i>`,
      cancelKeyboard()
    );
  }

  if (s.step === 'task_link') {
    session.setSession(userId, { ...s, step: 'task_reward', link: text === 'none' ? '' : text });
    return ctx.replyWithHTML(
      `✅ Link saved.\n\n<b>Step 3 / 4</b> — Send the <b>point reward</b> (e.g. 100):`,
      cancelKeyboard()
    );
  }

  if (s.step === 'task_reward') {
    const reward = parseInt(text);
    if (isNaN(reward) || reward < 0) return ctx.reply('❌ Enter a valid number (e.g. 100)');
    session.setSession(userId, { ...s, step: 'task_button', reward });
    return ctx.replyWithHTML(
      `✅ Reward: <b>${reward} pts</b>\n\n` +
      `<b>Step 4 / 4</b> — Send a <b>button label</b> (e.g. "Like & Retweet"):\n<i>Type "none" to skip</i>`,
      cancelKeyboard()
    );
  }

  if (s.step === 'task_button') {
    session.clearSession(userId);
    const btnLabel = text === 'none' ? null : text;
    const task = store.createTask(groupId, s.title, s.link, s.reward, s.type, btnLabel);

    const { taskCardKeyboard } = require('../utils/keyboard');
    const emoji = s.type === 'raid' ? '⚡' : '🎯';
    const broadcastMsg =
      `${emoji} <b>New ${s.type === 'raid' ? 'Raid' : 'Task'}!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `📌 <b>${task.title}</b>\n` +
      (task.link ? `🔗 ${task.link}\n` : '') +
      `💰 Reward: <b>${task.reward} pts</b>\n\n` +
      `<i>Tap Submit to complete & earn points.</i>`;

    // Post in group (correct topic)
    const group = store.getGroup(groupId);
    const topicKey = s.type === 'raid' ? 'raids' : 'quests';
    const topicId  = group?.topics?.[topicKey] || group?.topics?.notifications || null;

    try {
      await ctx.telegram.sendMessage(groupId, broadcastMsg, {
        parse_mode: 'HTML',
        message_thread_id: topicId || undefined,
        ...taskCardKeyboard(task.id, task.link, btnLabel),
      });
    } catch (e) { console.error('Group post error:', e.message); }

    // Separate notification topic post
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
    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.id, broadcastMsg, {
          parse_mode: 'HTML',
          ...taskCardKeyboard(task.id, task.link, btnLabel),
        });
        dmSent++;
      } catch { }
      await delay(50);
    }

    await ctx.replyWithHTML(
      `✅ <b>${s.type === 'raid' ? 'Raid' : 'Task'} created!</b>\n` +
      `🆔 ID: <code>${task.id}</code>  •  DMs: <b>${dmSent}</b>`
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
    } catch (e) { console.error('Announce error:', e.message); }
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const u of users) {
      try { await ctx.telegram.sendMessage(u.id, msg, { parse_mode: 'HTML' }); sent++; } catch { }
      await delay(50);
    }
    await ctx.replyWithHTML(`✅ Announced to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── DM ALL ─────────────────────────────────────────────
  if (s.step === 'dm_all_msg') {
    session.clearSession(userId);
    const msg = `📨 <b>Message from Admin</b>\n\n${text}`;
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const u of users) {
      try { await ctx.telegram.sendMessage(u.id, msg, { parse_mode: 'HTML' }); sent++; } catch { }
      await delay(50);
    }
    await ctx.replyWithHTML(`✅ DM sent to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── BAN ───────────────────────────────────────────────
  if (s.step === 'ban_id') {
    session.clearSession(userId);
    const tid = text.replace('@', '');
    const ok  = store.banUser(tid);
    await ctx.replyWithHTML(ok
      ? `🚫 User <code>${tid}</code> banned.`
      : `⚠️ User <code>${tid}</code> not found. They haven't used the bot yet.`
    );
    return sendAdminPanel(ctx, groupId);
  }

  // ── UNBAN ─────────────────────────────────────────────
  if (s.step === 'unban_id') {
    session.clearSession(userId);
    const tid = text.replace('@', '');
    const ok  = store.unbanUser(tid);
    await ctx.replyWithHTML(ok
      ? `✅ User <code>${tid}</code> unbanned.`
      : `⚠️ User <code>${tid}</code> not found.`
    );
    return sendAdminPanel(ctx, groupId);
  }

  // ── ADD ADMIN ─────────────────────────────────────────
  if (s.step === 'add_admin_id') {
    session.clearSession(userId);
    const tid = text.replace('@', '');
    store.addAdmin(groupId, tid);
    await ctx.replyWithHTML(`✅ <code>${tid}</code> added as admin.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── REMOVE ADMIN ──────────────────────────────────────
  if (s.step === 'rem_admin_id') {
    session.clearSession(userId);
    const tid = text.replace('@', '');
    store.removeAdmin(groupId, tid);
    await ctx.replyWithHTML(`✅ <code>${tid}</code> removed from admins.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── ADD EMAIL ─────────────────────────────────────────
  if (s.step === 'add_email') {
    session.clearSession(userId);
    if (!text.includes('@') || !text.includes('.')) return ctx.reply('❌ Invalid email format.');
    const group = store.getGroup(groupId);
    if (!group.extraEmails) group.extraEmails = [];
    if (!group.extraEmails.includes(text)) group.extraEmails.push(text);
    if (group.sheetId && group.sheetId !== 'none') {
      try { await sheets.shareSheet(group.sheetId, text); } catch (e) { console.error(e.message); }
    }
    await ctx.replyWithHTML(`✅ Email <b>${text}</b> added${group.sheetId !== 'none' ? ' & sheet shared' : ''}.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── SET GROUP LINK ────────────────────────────────────
  if (s.step === 'set_link') {
    session.clearSession(userId);
    store.setGroupMeta(groupId, { groupLink: text });
    await ctx.replyWithHTML(`✅ Group link set: ${text}`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── SET TOPIC ID ──────────────────────────────────────
  if (s.step === 'set_topic_id') {
    session.clearSession(userId);
    const tid = parseInt(text);
    if (isNaN(tid)) return ctx.reply('❌ Please send a valid topic ID number.');
    store.setGroupTopic(groupId, s.topicType, tid);
    await ctx.replyWithHTML(`✅ Topic <b>${s.topicType}</b> → <code>${tid}</code>`);
    return sendAdminPanel(ctx, groupId);
  }

  return next();
}

// ═══════════════════════════════════════════════
//  APPROVAL / REJECTION  (works from DM — no groupId needed)
// ═══════════════════════════════════════════════

async function handleApprove(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub   = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.', { show_alert: true });
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`, { show_alert: true });

  store.approveSubmission(subId);
  store.addPoints(sub.userId, sub.points);

  const user  = store.getUser(sub.userId);
  const group = store.getGroup(sub.groupId);

  // Update Google Sheet (skip for photo proofs)
  if (group?.sheetId && group.sheetId !== 'none' && sub.proofType !== 'photo') {
    try {
      await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'approved');
      if (user) await sheets.upsertUser(group.sheetId, {
        userId: sub.userId, username: sub.username,
        points: user.points, twitter: user.twitter,
        wallet: user.wallet, joinedAt: user.joinedAt,
      });
    } catch (e) { console.error('Sheet update error:', e.message); }
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

  // Post to submissions topic
  const topicId = group?.topics?.submissions;
  if (topicId) {
    try {
      await ctx.telegram.sendMessage(sub.groupId,
        `✅ Approved — @${sub.username} | ${sub.taskTitle} | +${sub.points}pts`,
        { parse_mode: 'HTML', message_thread_id: topicId }
      );
    } catch { }
  }

  await ctx.editMessageCaption?.(`✅ Approved — @${sub.username} | ${sub.taskTitle} | +${sub.points}pts`).catch(() => {});
  await ctx.editMessageText?.(
    `✅ <b>Approved</b> — @${sub.username} | ${sub.taskTitle} | +${sub.points}pts`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
  await ctx.answerCbQuery('✅ Approved!');
}

async function handleReject(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub   = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.', { show_alert: true });
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`, { show_alert: true });

  store.rejectSubmission(subId);

  const group = store.getGroup(sub.groupId);
  if (group?.sheetId && group.sheetId !== 'none' && sub.proofType !== 'photo') {
    try { await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'rejected'); } catch { }
  }

  try {
    await ctx.telegram.sendMessage(sub.userId,
      `❌ <b>Submission Rejected</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: ${sub.taskTitle}\n\n` +
      `Please review the requirements and resubmit.`,
      { parse_mode: 'HTML' }
    );
  } catch { }

  await ctx.editMessageCaption?.(`❌ Rejected — @${sub.username} | ${sub.taskTitle}`).catch(() => {});
  await ctx.editMessageText?.(
    `❌ <b>Rejected</b> — @${sub.username} | ${sub.taskTitle}`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
  await ctx.answerCbQuery('❌ Rejected.');
}

// ═══════════════════════════════════════════════
//  INLINE HELPERS
// ═══════════════════════════════════════════════

function startFlow(ctx, flowData, prompt) {
  const groupId = resolveAdminGroup(ctx);
  session.setSession(ctx.from.id, { adminFlow: true, groupId, ...flowData });
  return ctx.replyWithHTML(prompt, cancelKeyboard());
}

async function showSubmissions(ctx, status) {
  await ctx.answerCbQuery();
  const groupId = resolveAdminGroup(ctx);
  if (!groupId) return ctx.reply('⚠️ No group selected. Open /admin first.');

  const subs = store.getSubmissionsForGroup(groupId, status);
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  if (!subs.length) {
    return ctx.replyWithHTML(`📬 <b>${label} Submissions</b>\n\n<i>None found.</i>`);
  }

  await ctx.replyWithHTML(
    `📬 <b>${label} Submissions</b> (${subs.length})\n` +
    `<i>Latest ${Math.min(subs.length, 10)} shown:</i>`
  );

  for (const sub of subs.slice(-10).reverse()) {
    const isPhoto = sub.proofType === 'photo';
    const caption =
      `<b>#${sub.id}</b> — @${sub.username} (<code>${sub.userId}</code>)\n` +
      `🎯 ${sub.taskTitle}\n` +
      (isPhoto ? `📸 Photo proof\n` : `🔗 ${sub.proof}\n`) +
      `💰 ${sub.points}pts  •  ${sub.createdAt.split('T')[0]}`;

    if (isPhoto && sub.proofFileId && status === 'pending') {
      try {
        await ctx.telegram.sendPhoto(ctx.chat.id, sub.proofFileId, {
          caption,
          parse_mode: 'HTML',
          ...approvalKeyboard(sub.id),
        });
      } catch {
        await ctx.replyWithHTML(caption, status === 'pending' ? approvalKeyboard(sub.id) : {});
      }
    } else {
      await ctx.replyWithHTML(caption, status === 'pending' ? approvalKeyboard(sub.id) : {});
    }
  }
}

// ═══════════════════════════════════════════════
//  REGISTER
// ═══════════════════════════════════════════════

function register(bot) {
  bot.use(handleAdminSessionInput);

  bot.command('admin', adminOnly, handleAdminPanel);

  bot.action(/^approve_(\d+)$/, handleApprove);
  bot.action(/^reject_(\d+)$/, handleReject);

  bot.action(/^del_task_(\d+)$/, async (ctx) => {
    const ok = store.deactivateTask(parseInt(ctx.match[1]));
    await ctx.answerCbQuery(ok ? '🗑 Deleted' : '⚠️ Not found', { show_alert: !ok });
    if (ok) await ctx.editMessageText(`🗑 Task <b>#${ctx.match[1]}</b> deleted.`, { parse_mode: 'HTML' }).catch(() => {});
  });

  // Group selector (DM with multiple groups)
  bot.action(/^select_group_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = ctx.match[1];
    store.setAdminContext(ctx.from.id, groupId);
    await sendAdminPanel(ctx, groupId);
  });

  // Switch group button
  bot.action('admin_switch_group', async (ctx) => {
    await ctx.answerCbQuery();
    const groups = store.getGroupsForAdmin(ctx.from.id);
    await ctx.replyWithHTML(
      `🔄 <b>Switch Group</b>\n\n<i>Select a group to manage:</i>`,
      groupSelectorKeyboard(groups)
    );
  });

  bot.action('back_admin', async (ctx) => {
    await ctx.answerCbQuery();
    await sendAdminPanel(ctx, resolveAdminGroup(ctx), true);
  });

  bot.action('cancel_flow', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.');
    session.clearSession(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
  });

  // Section header noops
  ['admin_section_campaigns','admin_section_subs','admin_section_bc',
   'admin_section_users','admin_section_access','admin_section_setup'
  ].forEach(a => bot.action(a, ctx => ctx.answerCbQuery()));

  // ── Campaigns ──────────────────────────────────────────
  bot.action('admin_create_task', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'task_title', type: 'task' },
      `📝 <b>Create Task</b>\n\n<b>Step 1 / 4</b> — Enter the task <b>title</b>:`);
  });

  bot.action('admin_create_raid', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'task_title', type: 'raid' },
      `⚡ <b>Create Raid</b>\n\n<b>Step 1 / 4</b> — Enter the raid <b>title</b>:`);
  });

  bot.action('admin_view_tasks', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('⚠️ No group selected. Open /admin first.');
    const tasks = store.getAllTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('📊 <b>Tasks</b>\n\n<i>No tasks yet.</i>');
    const lines = tasks.map(t =>
      `${t.active ? '🟢' : '🔴'} [<code>${t.id}</code>] ${t.type === 'raid' ? '⚡' : '🎯'} <b>${t.title}</b> — ${t.reward}pts`
    ).join('\n');
    await ctx.replyWithHTML(`📊 <b>All Tasks</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_delete_task_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('⚠️ No group selected. Open /admin first.');
    const tasks = store.getTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('🗑 <b>Delete Task</b>\n\n<i>No active tasks.</i>');
    await ctx.replyWithHTML('🗑 <b>Select task to delete:</b>', taskDeleteKeyboard(tasks));
  });

  // ── Submissions ─────────────────────────────────────────
  bot.action('admin_subs_pending',  ctx => showSubmissions(ctx, 'pending'));
  bot.action('admin_subs_approved', ctx => showSubmissions(ctx, 'approved'));
  bot.action('admin_subs_rejected', ctx => showSubmissions(ctx, 'rejected'));

  // ── Broadcast ────────────────────────────────────────────
  bot.action('admin_announce', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'announce_msg' },
      `📣 <b>Announce</b>\n\nType your announcement message:\n<i>Sent to group + DMed to all users</i>`);
  });

  bot.action('admin_dm_all', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'dm_all_msg' },
      `📨 <b>DM All Users</b>\n\nType the message to send:`);
  });

  // ── Users ────────────────────────────────────────────────
  bot.action('admin_view_users', async (ctx) => {
    await ctx.answerCbQuery();
    const users = store.getAllUsers().slice(0, 20);
    if (!users.length) return ctx.replyWithHTML('👥 <b>Users</b>\n\n<i>No users yet.</i>');
    const lines = users.map((u, i) =>
      `${i + 1}. @${u.username} (<code>${u.id}</code>) — ${u.points}pts ${u.banned ? '🚫' : '✅'}`
    ).join('\n');
    await ctx.replyWithHTML(`👥 <b>Users (latest 20)</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_ban', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'ban_id' },
      `🚫 <b>Ban User</b>\n\nSend the <b>User ID</b>:\n<i>Forward their message to @userinfobot to get the ID</i>`);
  });

  bot.action('admin_unban', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'unban_id' }, `✅ <b>Unban User</b>\n\nSend the <b>User ID</b>:`);
  });

  bot.action('admin_add_admin', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'add_admin_id' }, `➕ <b>Add Admin</b>\n\nSend the <b>User ID</b>:`);
  });

  bot.action('admin_rem_admin', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'rem_admin_id' }, `➖ <b>Remove Admin</b>\n\nSend the <b>User ID</b>:`);
  });

  // ── Access control ────────────────────────────────────────
  ['all','group','whitelist'].forEach(mode => {
    bot.action(`admin_mode_${mode}`, async (ctx) => {
      const groupId = resolveAdminGroup(ctx);
      if (groupId) store.setAccessMode(groupId, mode);
      const labels = { all: 'Everyone allowed', group: 'Group members only', whitelist: 'Whitelist only' };
      await ctx.answerCbQuery(`✅ ${labels[mode]}`, { show_alert: true });
      await sendAdminPanel(ctx, groupId, true);
    });
  });

  // ── Setup & Settings ──────────────────────────────────────
  bot.action('admin_setup_topics', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('⚠️ No group selected.');
    await ctx.replyWithHTML(
      `📌 <b>Setup Forum Topics</b>\n\n` +
      `Select a topic type to assign a thread ID.\n` +
      `<i>Use /settopic &lt;type&gt; &lt;id&gt; in the group as an alternative.</i>`,
      topicsSetupKeyboard(groupId)
    );
  });

  bot.action(/^set_topic_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicType = ctx.match[1];
    const groupId   = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow: true, groupId, step: 'set_topic_id', topicType });
    await ctx.replyWithHTML(
      `📌 <b>Set Topic: ${topicType}</b>\n\n` +
      `Send the <b>thread ID</b>:\n` +
      `<i>Right-click topic → Copy Link → last number in URL</i>`,
      cancelKeyboard()
    );
  });

  bot.action('admin_add_email', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'add_email' },
      `📧 <b>Add Sheet Email</b>\n\nSend the Gmail to share the sheet with:`);
  });

  bot.action('admin_stats', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('⚠️ No group selected.');
    const s = store.getGroupStats(groupId);
    const g = store.getGroup(groupId);
    await ctx.replyWithHTML(
      `📊 <b>Stats — ${g?.groupName || groupId}</b>\n${'─'.repeat(28)}\n` +
      `🎯 Tasks: ${s.activeTasks}/${s.totalTasks}  ⚡ Raids: ${s.activeRaids}/${s.totalRaids}\n` +
      `⏳ Pending: ${s.pendingSubmissions}  ✅ Approved: ${s.approvedSubmissions}  ❌ Rejected: ${s.rejectedSubmissions}\n` +
      `👥 Users: ${s.totalUsers}  🚫 Banned: ${s.bannedUsers}\n🔐 Mode: ${g?.accessMode}`
    );
  });

  bot.action('admin_set_link', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'set_link' },
      `🔗 <b>Set Group Link</b>\n\nSend the invite link (e.g. https://t.me/yourgroup):`);
  });

  bot.action('admin_close', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  });
}

module.exports = { register };
