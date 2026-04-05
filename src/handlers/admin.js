/**
 * admin.js -- Admin panel
 *
 * Wizard order:
 *   Task:  Platform → Actions → Title → Link → [MinChars if comment] → Reward → Create
 *   Raid:  Platform → Actions → Title → Link → [MinChars if comment] → Reward → Duration → Create
 *
 * Commands (DM only, admin only — /commands shows full list):
 *   /admin             Open admin panel
 *   /commands          Show all admin commands
 *   /settwitter        /settwitter <userId> @handle  — force-set a user's Twitter handle
 *   /wladd             /wladd <userId>               — add user to whitelist
 *   /wlremove          /wlremove <userId>            — remove user from whitelist
 */

const store   = require('../store');
const sheets  = require('../services/sheets');
const session = require('../sessions');
const config  = require('../config');
const { isAdminUser, adminOnly } = require('../middleware/auth');
const { getBotUsername } = require('../botInfo');
const {
  approvalKeyboard, adminMainKeyboard, taskDeleteKeyboard,
  topicsSetupKeyboard, groupSelectorKeyboard, cancelKeyboard,
  platformSelectKeyboard, taskTypeKeyboard, twitterMultiActionKeyboard,
  taskCardKeyboard, taskCardDMKeyboard,
} = require('../utils/keyboard');

const delay = ms => new Promise(r => setTimeout(r, ms));

const TASK_TYPE_LABELS = {
  follow: 'Follow', like: 'Like', retweet: 'Retweet',
  comment: 'Comment', quote: 'Quote Tweet',
  join: 'Join Channel/Group', react: 'React to Message', send: 'Send Message',
};

// ─────────────────────────────────────────────────────────────────────────────

function resolveAdminGroup(ctx) {
  const t = ctx.chat?.type;
  if (t === 'group' || t === 'supergroup') return String(ctx.chat.id);
  return store.getAdminContext(ctx.from?.id) || null;
}

async function sendAdminPanel(ctx, groupId, isEdit = false) {
  const userId = ctx.from.id;
  if (!isAdminUser(userId)) return ctx.reply('You are not authorized to use this.');

  if (!groupId) {
    const groups = store.getGroupsForAdmin(userId);
    if (!groups.length) return ctx.replyWithHTML(
      `<b>No registered groups found.</b>\n\n` +
      `You are not an admin of any whitelisted group.\n` +
      `An owner must run /addgroup first, then add you as admin.`
    );
    if (groups.length === 1) {
      groupId = groups[0].id;
      store.setAdminContext(userId, groupId);
    } else {
      return ctx.replyWithHTML(`<b>Select a group to manage:</b>`, groupSelectorKeyboard(groups));
    }
  }

  const group = store.getGroup(groupId);
  if (!group) return ctx.reply('Group not found. Owner must /addgroup first.');
  store.setAdminContext(userId, groupId);
  const stats       = store.getGroupStats(groupId);
  const name        = group.groupName || groupId;
  const adminGroups = store.getGroupsForAdmin(userId);
  const canSwitch   = adminGroups.length > 1;
  const text =
    `<b>Admin Panel</b>\n${'─'.repeat(30)}\n<b>${name}</b>\n${'─'.repeat(30)}\n` +
    `Tasks: <b>${stats.activeTasks}</b>  Raids: <b>${stats.activeRaids}</b>\n` +
    `Users: <b>${stats.totalUsers}</b>  Mode: <b>${group.accessMode}</b>\n${'─'.repeat(30)}\n` +
    (canSwitch ? `<i>Use Switch Group to manage a different group.</i>` : `<i>Tap a section below:</i>`);

  if (isEdit && ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, { parse_mode: 'HTML', ...adminMainKeyboard(name, canSwitch) }); } catch {}
  }
  return ctx.replyWithHTML(text, adminMainKeyboard(name, canSwitch));
}

async function handleAdminPanel(ctx) {
  await sendAdminPanel(ctx, resolveAdminGroup(ctx));
}

// ─────────────────────────────────────────────────────────────────────────────
//  SESSION INPUT HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleAdminSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();
  const s = session.getSession(userId);
  if (!s?.adminFlow) return next();
  const text    = ctx.message.text.trim();
  const groupId = s.groupId || store.getAdminContext(userId);
  if (text.startsWith('/')) { session.clearSession(userId); return next(); }

  // ── Step: Title ──────────────────────────────────────────────────────────
  if (s.step === 'task_title') {
    session.setSession(userId, { ...s, step: 'task_link', title: text });
    const typeLabel = s.taskTypes
      ? s.taskTypes.map(t => TASK_TYPE_LABELS[t] || t).join(' + ')
      : (TASK_TYPE_LABELS[s.taskType] || s.taskType);
    return ctx.replyWithHTML(
      `Title: <b>${text}</b>\n<i>Platform: ${s.platform === 'telegram' ? 'Telegram' : 'Twitter/X'} · Type: ${typeLabel}</i>\n\n` +
      `<b>Step 4 of ${s.taskKind === 'raid' ? '6' : '5'}</b> — Send the <b>link</b>:\n` +
      (s.platform === 'twitter' ? `<i>Tweet or profile URL</i>` : `<i>Channel link or @username</i>`),
      cancelKeyboard()
    );
  }

  // ── Step: Link ───────────────────────────────────────────────────────────
  if (s.step === 'task_link') {
    const linkVal  = text === 'none' ? '' : text;
    const isComment = s.taskTypes ? s.taskTypes.includes('comment') : s.taskType === 'comment';
    if (isComment) {
      session.setSession(userId, { ...s, step: 'task_min_chars', link: linkVal });
      return ctx.replyWithHTML(
        `Link saved.\n\n<b>Step 5 of ${s.taskKind === 'raid' ? '7' : '6'}</b> — Set <b>minimum comment characters</b>:\n` +
        `Send a number (e.g. <code>50</code>) or <code>0</code> for no limit.\n` +
        `<i>Users must write at least this many characters in their reply.</i>`,
        cancelKeyboard()
      );
    }
    session.setSession(userId, { ...s, step: 'task_reward', link: linkVal });
    return ctx.replyWithHTML(
      `Link saved.\n\n<b>Step 5 of ${s.taskKind === 'raid' ? '6' : '5'}</b> — Send the <b>point reward</b>:`,
      cancelKeyboard()
    );
  }

  // ── Step: MinChars ───────────────────────────────────────────────────────
  if (s.step === 'task_min_chars') {
    const n       = parseInt(text);
    const minChars = (!isNaN(n) && n >= 0) ? n : 0;
    session.setSession(userId, { ...s, step: 'task_reward', minChars });
    return ctx.replyWithHTML(
      `Min characters: <b>${minChars || 'none'}</b>\n\n` +
      `<b>Step 6 of ${s.taskKind === 'raid' ? '7' : '6'}</b> — Send the <b>point reward</b>:`,
      cancelKeyboard()
    );
  }

  // ── Step: Reward ─────────────────────────────────────────────────────────
  if (s.step === 'task_reward') {
    const reward = parseInt(text);
    if (isNaN(reward) || reward < 0) return ctx.reply('Enter a valid number (e.g. 100)');

    // For RAIDS: add duration step
    if (s.taskKind === 'raid') {
      session.setSession(userId, { ...s, step: 'task_duration', reward });
      return ctx.replyWithHTML(
        `Reward: <b>${reward} pts</b>\n\n` +
        `<b>Final step — Raid Duration</b>\n` +
        `How long should this raid run? Send minutes (<b>1 – 1440</b>).\n\n` +
        `Examples:\n` +
        `<code>30</code>  = 30 minutes\n` +
        `<code>60</code>  = 1 hour\n` +
        `<code>360</code> = 6 hours\n` +
        `<code>1440</code> = 24 hours (max)`,
        cancelKeyboard()
      );
    }

    // For TASKS: create immediately
    return finishCreateTask(ctx, userId, groupId, s, reward, null);
  }

  // ── Step: Duration (raids only) ──────────────────────────────────────────
  if (s.step === 'task_duration') {
    const mins = parseInt(text);
    if (isNaN(mins) || mins < 1 || mins > 1440) {
      return ctx.reply('Please send a number between 1 and 1440 minutes.');
    }
    return finishCreateTask(ctx, userId, groupId, s, s.reward, mins);
  }

  // ── Step: Announce ───────────────────────────────────────────────────────
  if (s.step === 'announce_msg') {
    session.clearSession(userId);
    const group   = store.getGroup(groupId);
    const topicId = group?.topics?.announcements || null;
    const msg     = `<b>Announcement</b>\n\n${text}`;
    try { await ctx.telegram.sendMessage(groupId, msg, { parse_mode: 'HTML', message_thread_id: topicId || undefined }); } catch (e) { console.error(e.message); }
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const u of users) { try { await ctx.telegram.sendMessage(u.id, msg, { parse_mode: 'HTML' }); sent++; } catch {} await delay(50); }
    await ctx.replyWithHTML(`Announced to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── Step: DM All ─────────────────────────────────────────────────────────
  if (s.step === 'dm_all_msg') {
    session.clearSession(userId);
    const msg   = `<b>Message from Admin</b>\n\n${text}`;
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    let sent = 0;
    for (const u of users) { try { await ctx.telegram.sendMessage(u.id, msg, { parse_mode: 'HTML' }); sent++; } catch {} await delay(50); }
    await ctx.replyWithHTML(`DM sent to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── Steps: User management ───────────────────────────────────────────────
  if (s.step === 'ban_id') {
    session.clearSession(userId);
    const ok = store.banUser(text.replace('@', ''));
    await ctx.replyWithHTML(ok ? `Banned <code>${text}</code>.` : `User not found.`);
    return sendAdminPanel(ctx, groupId);
  }
  if (s.step === 'unban_id') {
    session.clearSession(userId);
    const ok = store.unbanUser(text.replace('@', ''));
    await ctx.replyWithHTML(ok ? `Unbanned <code>${text}</code>.` : `User not found.`);
    return sendAdminPanel(ctx, groupId);
  }
  if (s.step === 'add_admin_id') {
    session.clearSession(userId);
    store.addAdmin(groupId, text.replace('@', ''));
    await ctx.replyWithHTML(`<code>${text}</code> added as admin.`);
    return sendAdminPanel(ctx, groupId);
  }
  if (s.step === 'rem_admin_id') {
    session.clearSession(userId);
    store.removeAdmin(groupId, text.replace('@', ''));
    await ctx.replyWithHTML(`<code>${text}</code> removed from admins.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── Steps: Whitelist ─────────────────────────────────────────────────────
  if (s.step === 'whitelist_add_id') {
    session.clearSession(userId);
    const uid = text.replace('@', '').trim();
    store.addToWhitelist(groupId, uid);
    await ctx.replyWithHTML(`<code>${uid}</code> added to whitelist.`);
    return sendAdminPanel(ctx, groupId);
  }
  if (s.step === 'whitelist_remove_id') {
    session.clearSession(userId);
    const uid = text.replace('@', '').trim();
    store.removeFromWhitelist(groupId, uid);
    await ctx.replyWithHTML(`<code>${uid}</code> removed from whitelist.`);
    return sendAdminPanel(ctx, groupId);
  }

  // ── Steps: Setup ─────────────────────────────────────────────────────────
  if (s.step === 'add_email') {
    session.clearSession(userId);
    if (!text.includes('@') || !text.includes('.')) return ctx.reply('Invalid email address.');
    const group = store.getGroup(groupId);
    if (!group.extraEmails) group.extraEmails = [];
    if (!group.extraEmails.includes(text)) group.extraEmails.push(text);
    if (group.sheetId && group.sheetId !== 'none') {
      try { await sheets.shareSheet(group.sheetId, text); } catch (e) { console.error(e.message); }
    }
    await ctx.replyWithHTML(`Email <b>${text}</b> added.`);
    return sendAdminPanel(ctx, groupId);
  }

  if (s.step === 'set_link') {
    session.clearSession(userId);
    store.setGroupMeta(groupId, { groupLink: text });
    await ctx.replyWithHTML(`Group link set.`);
    return sendAdminPanel(ctx, groupId);
  }

  if (s.step === 'set_topic_id') {
    session.clearSession(userId);
    const tid = parseInt(text);
    if (isNaN(tid)) return ctx.reply('Send a valid topic ID number.');
    store.setGroupTopic(groupId, s.topicType, tid);
    await ctx.replyWithHTML(`Topic <b>${s.topicType}</b> set to <code>${tid}</code>`);
    return sendAdminPanel(ctx, groupId);
  }

  return next();
}

// ── Create task / raid (shared finisher) ─────────────────────────────────────

async function finishCreateTask(ctx, userId, groupId, s, reward, durationMinutes) {
  session.clearSession(userId);

  let finalTaskType, finalTaskTypes, typeLabel;
  if (s.taskTypes && s.taskTypes.length > 0) {
    finalTaskTypes = s.taskTypes;
    finalTaskType  = s.taskTypes.length === 1 ? s.taskTypes[0] : 'multi';
    typeLabel      = s.taskTypes.map(t => TASK_TYPE_LABELS[t] || t).join(' + ');
  } else {
    finalTaskType  = s.taskType;
    finalTaskTypes = null;
    typeLabel      = TASK_TYPE_LABELS[s.taskType] || s.taskType;
  }

  const platLabel = s.platform === 'telegram' ? 'Telegram' : 'Twitter/X';
  const btnLabel  = `${platLabel} — ${typeLabel}`;
  const task      = store.createTask(
    groupId, s.title, s.link, reward, s.taskKind,
    btnLabel, s.platform, finalTaskType, finalTaskTypes,
    s.minChars || 0, durationMinutes
  );

  // Build broadcast message
  let raidTimerText = '';
  if (task.type === 'raid' && task.expiresAt) {
    const ms    = new Date(task.expiresAt) - Date.now();
    const hours = Math.floor(ms / 3600000);
    const mins  = Math.floor((ms % 3600000) / 60000);
    raidTimerText = `\n⏱ Expires in: <b>${hours > 0 ? `${hours}h ` : ''}${mins}m</b>`;
  }

  const broadcastMsg =
    `<b>New ${task.type === 'raid' ? '⚡ Raid' : '📋 Task'}!</b>\n${'─'.repeat(28)}\n` +
    `<b>${task.title}</b>\n${platLabel} — ${typeLabel}${raidTimerText}\n` +
    (task.link ? `Link: ${task.link}\n` : '') +
    `Reward: <b>${task.reward} pts</b>\n\n` +
    `<i>Complete the task and tap Verify to earn instantly.</i>`;

  const group    = store.getGroup(groupId);
  const topicKey = task.type === 'raid' ? 'raids' : 'quests';
  const topicId  = group?.topics?.[topicKey] || group?.topics?.notifications || null;
  const botName  = getBotUsername() || 'MomentumHubBot';

  // Post to group channel
  try {
    await ctx.telegram.sendMessage(groupId, broadcastMsg, {
      parse_mode: 'HTML',
      message_thread_id: topicId || undefined,
      ...taskCardDMKeyboard(task.id, task.link, btnLabel, botName),
    });
  } catch (e) { console.error('[Admin] Group post failed:', e.message); }

  // DM all active users
  const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
  let dmSent = 0;
  for (const u of users) {
    try {
      await ctx.telegram.sendMessage(
        u.id, broadcastMsg,
        { parse_mode: 'HTML', ...taskCardKeyboard(task.id, task.link, btnLabel, finalTaskType) }
      );
      dmSent++;
    } catch {}
    await delay(50);
  }

  await ctx.replyWithHTML(
    `<b>${task.type === 'raid' ? 'Raid' : 'Task'} Created!</b>\n` +
    `ID: <code>${task.id}</code>  DMs sent: <b>${dmSent}</b>` +
    (task.expiresAt ? `\nExpires: <b>${new Date(task.expiresAt).toUTCString()}</b>` : '')
  );
  return sendAdminPanel(ctx, groupId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function startFlow(ctx, flowData, prompt) {
  const userId = ctx.from.id;
  if (!isAdminUser(userId)) {
    ctx.answerCbQuery('You are not authorized.', { show_alert: true });
    return;
  }
  const groupId = resolveAdminGroup(ctx);
  session.setSession(userId, { adminFlow: true, groupId, ...flowData });
  return ctx.replyWithHTML(prompt, cancelKeyboard());
}

function adminGuard(ctx) {
  const userId = ctx.from?.id;
  if (!isAdminUser(userId)) {
    ctx.answerCbQuery('You are not authorized.', { show_alert: true });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  REGISTER
// ─────────────────────────────────────────────────────────────────────────────

function register(bot) {
  bot.use(handleAdminSessionInput);

  // ── Commands ───────────────────────────────────────────────────────────────
  bot.command('admin', adminOnly, handleAdminPanel);

  // /commands — DM only, admin only — lists all admin commands
  bot.command('commands', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.deleteMessage().catch(() => {});
    }
    if (!isAdminUser(ctx.from.id)) return;
    await ctx.replyWithHTML(
      `<b>Admin Commands</b>\n${'─'.repeat(28)}\n\n` +
      `<b>Panel</b>\n` +
      `/admin — Open admin panel\n` +
      `/commands — Show this list (DM only)\n\n` +
      `<b>User Management</b>\n` +
      `/settwitter &lt;userId&gt; @handle — Force-set a user's Twitter handle\n` +
      `/wladd &lt;userId&gt; — Add user to group whitelist\n` +
      `/wlremove &lt;userId&gt; — Remove user from whitelist\n\n` +
      `<b>Notes</b>\n` +
      `• User IDs are numeric Telegram user IDs\n` +
      `• To find a user ID, use /admin → Users\n` +
      `• Whitelist applies only when group access mode is set to Whitelist\n\n` +
      `<i>All admin actions are also accessible via the /admin panel.</i>`
    );
  });

  // /settwitter <userId> @handle — admin override for locked Twitter handles
  bot.command('settwitter', async (ctx) => {
    if (!isAdminUser(ctx.from.id)) return;
    const args      = ctx.message.text.split(' ').slice(1);
    const targetId  = args[0]?.trim();
    const newHandle = args[1]?.replace('@', '').toLowerCase().trim();

    if (!targetId || !newHandle) {
      return ctx.replyWithHTML(
        `<b>Usage:</b> /settwitter &lt;userId&gt; @handle\n\n` +
        `<i>Example: /settwitter 123456789 @johndoe</i>`
      );
    }
    if (!/^[A-Za-z0-9_]{1,50}$/.test(newHandle)) {
      return ctx.replyWithHTML(`<b>Invalid Twitter handle.</b> Only letters, numbers, and underscores allowed.`);
    }

    // Check conflict
    const conflict = store.checkTwitterUsernameConflict(newHandle, targetId);
    if (conflict && String(conflict.id) !== String(targetId)) {
      return ctx.replyWithHTML(
        `<b>Handle Taken</b>\n\n` +
        `@${newHandle} is already linked to user <code>${conflict.id}</code> (@${conflict.username}).\n\n` +
        `Remove it from that user first if this is a different person.`
      );
    }

    const ok = store.adminSetTwitter(targetId, newHandle);
    if (!ok) return ctx.replyWithHTML(`<b>User not found.</b> ID: <code>${targetId}</code>`);
    await ctx.replyWithHTML(
      `<b>Twitter Updated</b>\n\n` +
      `User <code>${targetId}</code> → <b>@${newHandle}</b>\n` +
      `<i>Handle is now locked.</i>`
    );
  });

  // /wladd <userId> — add to whitelist (requires group context)
  bot.command('wladd', async (ctx) => {
    if (!isAdminUser(ctx.from.id)) return;
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group context. Use /admin first to select a group.');
    const uid = ctx.message.text.split(' ')[1]?.trim();
    if (!uid) return ctx.replyWithHTML(`<b>Usage:</b> /wladd &lt;userId&gt;`);
    store.addToWhitelist(groupId, uid.replace('@', ''));
    await ctx.replyWithHTML(`<code>${uid}</code> added to whitelist for group <code>${groupId}</code>.`);
  });

  // /wlremove <userId>
  bot.command('wlremove', async (ctx) => {
    if (!isAdminUser(ctx.from.id)) return;
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group context. Use /admin first to select a group.');
    const uid = ctx.message.text.split(' ')[1]?.trim();
    if (!uid) return ctx.replyWithHTML(`<b>Usage:</b> /wlremove &lt;userId&gt;`);
    store.removeFromWhitelist(groupId, uid.replace('@', ''));
    await ctx.replyWithHTML(`<code>${uid}</code> removed from whitelist.`);
  });

  // ── Submission approval / rejection ───────────────────────────────────────
  bot.action(/^approve_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const subId = parseInt(ctx.match[1]);
    const sub   = store.getSubmission(subId);
    if (!sub || sub.status !== 'pending') return ctx.answerCbQuery('Already processed.', { show_alert: true });
    store.approveSubmission(subId);
    store.addPoints(sub.userId, sub.points);
    await ctx.answerCbQuery('Approved!');
    await ctx.editMessageText(`✅ Approved — @${sub.username} | +${sub.points}pts`, { parse_mode: 'HTML' }).catch(() => {});
    try { await ctx.telegram.sendMessage(sub.userId, `Task approved! +${sub.points} pts for <b>${sub.taskTitle}</b>`, { parse_mode: 'HTML' }); } catch {}
  });

  bot.action(/^reject_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const subId = parseInt(ctx.match[1]);
    const sub   = store.getSubmission(subId);
    if (!sub || sub.status !== 'pending') return ctx.answerCbQuery('Already processed.', { show_alert: true });
    store.rejectSubmission(subId);
    await ctx.answerCbQuery('Rejected.');
    await ctx.editMessageText(`❌ Rejected — @${sub.username}`, { parse_mode: 'HTML' }).catch(() => {});
    try { await ctx.telegram.sendMessage(sub.userId, `Submission rejected for <b>${sub.taskTitle}</b>.`, { parse_mode: 'HTML' }); } catch {}
  });

  // ── Task management ────────────────────────────────────────────────────────
  bot.action(/^del_task_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const ok = store.deactivateTask(parseInt(ctx.match[1]));
    await ctx.answerCbQuery(ok ? 'Deleted' : 'Not found', { show_alert: !ok });
    if (ok) await ctx.editMessageText(`Task <b>#${ctx.match[1]}</b> deleted.`, { parse_mode: 'HTML' }).catch(() => {});
  });

  // ── Group switching ────────────────────────────────────────────────────────
  bot.action(/^select_group_(.+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    store.setAdminContext(ctx.from.id, ctx.match[1]);
    await sendAdminPanel(ctx, ctx.match[1]);
  });

  bot.action('admin_switch_group', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(`<b>Switch Group</b>`, groupSelectorKeyboard(store.getGroupsForAdmin(ctx.from.id)));
  });

  bot.action('back_admin', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    await sendAdminPanel(ctx, resolveAdminGroup(ctx), true);
  });

  bot.action('cancel_flow', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.');
    session.clearSession(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
  });

  ['admin_section_campaigns', 'admin_section_bc', 'admin_section_users', 'admin_section_access', 'admin_section_setup']
    .forEach(a => bot.action(a, async (ctx) => { if (!adminGuard(ctx)) return; ctx.answerCbQuery(); }));

  // ── Create Task / Raid wizard ──────────────────────────────────────────────
  bot.action('admin_create_task', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow: true, groupId, taskKind: 'task', step: 'select_platform' });
    await ctx.replyWithHTML(`<b>Create Task</b>\n\n<b>Step 1 of 5</b> — Select the <b>platform</b>:`, platformSelectKeyboard('task'));
  });

  bot.action('admin_create_raid', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow: true, groupId, taskKind: 'raid', step: 'select_platform' });
    await ctx.replyWithHTML(`<b>Create Raid</b>\n\n<b>Step 1 of 6</b> — Select the <b>platform</b>:`, platformSelectKeyboard('raid'));
  });

  bot.action(/^admin_platform_(task|raid)_(twitter|telegram)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const [, kind, platform] = ctx.match;
    const s = session.getSession(ctx.from.id);
    if (!s) return ctx.reply('Session expired. Run /admin again.');
    const total = kind === 'raid' ? '6' : '5';
    if (platform === 'twitter') {
      session.setSession(ctx.from.id, { ...s, platform, step: 'select_twitter_actions', selectedActions: {} });
      await ctx.replyWithHTML(
        `Twitter/X selected.\n\n<b>Step 2 of ${total}</b> — Select <b>one or more actions</b> (tap to toggle):\n<i>Tap Confirm when done.</i>`,
        twitterMultiActionKeyboard({})
      );
    } else {
      session.setSession(ctx.from.id, { ...s, platform, step: 'select_tasktype' });
      await ctx.replyWithHTML(`Telegram selected.\n\n<b>Step 2 of ${total}</b> — Select the <b>task type</b>:`, taskTypeKeyboard(kind, platform));
    }
  });

  // Twitter multi-action toggle
  bot.action(/^admin_ttoggle_(follow|like|retweet|comment|quote)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const actionType = ctx.match[1];
    const s = session.getSession(ctx.from.id);
    if (!s || s.step !== 'select_twitter_actions') return ctx.reply('Session expired.');
    const selected = { ...s.selectedActions };
    selected[actionType] = !selected[actionType];
    session.setSession(ctx.from.id, { ...s, selectedActions: selected });
    const selCount = Object.values(selected).filter(Boolean).length;
    await ctx.editMessageText(
      `Twitter/X selected.\n\n<b>Step 2</b> — Select <b>one or more actions</b> (tap to toggle):\n<i>${selCount} selected. Tap Confirm when done.</i>`,
      { parse_mode: 'HTML', ...twitterMultiActionKeyboard(selected) }
    ).catch(async () => {
      await ctx.replyWithHTML(`Select actions (${selCount} selected):`, twitterMultiActionKeyboard(selected));
    });
  });

  // Confirm Twitter multi-action
  bot.action('admin_tconfirm', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const s = session.getSession(ctx.from.id);
    if (!s || s.step !== 'select_twitter_actions') return ctx.reply('Session expired.');
    const selected  = s.selectedActions || {};
    const taskTypes = Object.keys(selected).filter(k => selected[k]);
    if (!taskTypes.length) return ctx.answerCbQuery('Select at least one action.', { show_alert: true });
    const typeLabel = taskTypes.map(t => TASK_TYPE_LABELS[t] || t).join(' + ');
    const total     = s.taskKind === 'raid' ? '6' : '5';
    session.setSession(ctx.from.id, { ...s, taskTypes, step: 'task_title' });
    await ctx.replyWithHTML(
      `Actions: <b>${typeLabel}</b>\n\n<b>Step 3 of ${total}</b> — Enter the <b>title</b>:`,
      cancelKeyboard()
    );
  });

  bot.action(/^admin_tasktype_(task|raid)_(\w+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const [, kind, taskType] = ctx.match;
    const s = session.getSession(ctx.from.id);
    if (!s) return ctx.reply('Session expired.');
    const total = kind === 'raid' ? '6' : '5';
    session.setSession(ctx.from.id, { ...s, taskType, step: 'task_title' });
    await ctx.replyWithHTML(
      `Type: <b>${TASK_TYPE_LABELS[taskType] || taskType}</b>\n\n<b>Step 3 of ${total}</b> — Enter the <b>title</b>:`,
      cancelKeyboard()
    );
  });

  // ── View / Delete tasks ────────────────────────────────────────────────────
  bot.action('admin_view_tasks', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    const tasks = store.getAllTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('<b>Tasks</b>\n\n<i>No tasks yet.</i>');
    const now = new Date().toISOString();
    const lines = tasks.map(t => {
      const tl = t.taskTypes
        ? JSON.parse(t.taskTypes).map(x => TASK_TYPE_LABELS[x] || x).join('+')
        : (TASK_TYPE_LABELS[t.taskType] || t.taskType || '--');
      const pe     = t.platform === 'telegram' ? 'TG' : 'TW';
      const status = t.active ? (t.expiresAt && t.expiresAt < now ? 'Expired' : 'Active') : 'Inactive';
      const timer  = t.expiresAt && t.active && t.expiresAt > now
        ? ` (${Math.floor((new Date(t.expiresAt) - Date.now()) / 60000)}m left)` : '';
      return `[${status}] [<code>${t.id}</code>] ${t.type === 'raid' ? '[Raid]' : '[Task]'} <b>${t.title}</b>\n   ${pe} · ${tl} · ${t.reward}pts${timer}`;
    }).join('\n\n');
    await ctx.replyWithHTML(`<b>All Tasks</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_delete_task_menu', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    const tasks = store.getTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('<b>Delete Task</b>\n\n<i>No active tasks.</i>');
    await ctx.replyWithHTML('<b>Select task to delete:</b>', taskDeleteKeyboard(tasks));
  });

  // ── Broadcast ──────────────────────────────────────────────────────────────
  bot.action('admin_announce', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'announce_msg' }, `<b>Announce</b>\n\nType your announcement:`);
  });

  bot.action('admin_dm_all', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'dm_all_msg' }, `<b>DM All Users</b>\n\nType the message:`);
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  bot.action('admin_view_users', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const users = store.getAllUsers().slice(0, 20);
    if (!users.length) return ctx.replyWithHTML('<b>Users</b>\n\n<i>No users yet.</i>');
    const lines = users.map((u, i) =>
      `${i + 1}. @${u.username} (<code>${u.id}</code>) — ${u.points}pts${u.banned ? ' [Banned]' : ''}`
    ).join('\n');
    await ctx.replyWithHTML(`<b>Users (latest 20)</b>\n${'─'.repeat(28)}\n\n${lines}\n\n<i>/settwitter to update a user's Twitter handle</i>`);
  });

  bot.action('admin_ban',       async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step: 'ban_id'       }, `<b>Ban User</b>\n\nSend the User ID:`); });
  bot.action('admin_unban',     async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step: 'unban_id'     }, `<b>Unban User</b>\n\nSend the User ID:`); });
  bot.action('admin_add_admin', async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step: 'add_admin_id' }, `<b>Add Admin</b>\n\nSend the User ID:`); });
  bot.action('admin_rem_admin', async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step: 'rem_admin_id' }, `<b>Remove Admin</b>\n\nSend the User ID:`); });

  // ── Whitelist management ───────────────────────────────────────────────────
  bot.action('admin_wl_add', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'whitelist_add_id' }, `<b>Add to Whitelist</b>\n\nSend the User ID to whitelist:`);
  });

  bot.action('admin_wl_remove', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'whitelist_remove_id' }, `<b>Remove from Whitelist</b>\n\nSend the User ID to remove:`);
  });

  bot.action('admin_wl_view', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    const group   = store.getGroup(groupId);
    if (!group) return ctx.reply('No group selected.');
    const wl = group.whitelist ? [...group.whitelist] : [];
    if (!wl.length) {
      return ctx.replyWithHTML(
        `<b>Whitelist — ${group.groupName || groupId}</b>\n\n<i>Empty.</i>\n\n` +
        `Use <b>admin_wl_add</b> button or <code>/wladd &lt;userId&gt;</code> to add users.`
      );
    }
    const lines = wl.map((uid, i) => {
      const u = store.getUser(uid);
      return `${i + 1}. <code>${uid}</code>${u ? ` — @${u.username}` : ''}`;
    }).join('\n');
    await ctx.replyWithHTML(
      `<b>Whitelist — ${group.groupName || groupId}</b> (${wl.length})\n${'─'.repeat(28)}\n\n${lines}`
    );
  });

  // ── Access mode ────────────────────────────────────────────────────────────
  ['all', 'group', 'whitelist'].forEach(mode => {
    bot.action(`admin_mode_${mode}`, async (ctx) => {
      if (!adminGuard(ctx)) return;
      const groupId = resolveAdminGroup(ctx);
      if (groupId) store.setAccessMode(groupId, mode);
      const labels = { all: 'Everyone allowed', group: 'Group members only', whitelist: 'Whitelist only' };
      await ctx.answerCbQuery(labels[mode], { show_alert: true });
      await sendAdminPanel(ctx, groupId, true);
    });
  });

  // ── Setup ──────────────────────────────────────────────────────────────────
  bot.action('admin_setup_topics', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    await ctx.replyWithHTML(`<b>Setup Forum Topics</b>\n\nSelect a topic type:`, topicsSetupKeyboard());
  });

  bot.action(/^set_topic_(.+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const topicType = ctx.match[1];
    const groupId   = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow: true, groupId, step: 'set_topic_id', topicType });
    await ctx.replyWithHTML(`<b>Set Topic: ${topicType}</b>\n\nSend the <b>thread ID</b>:`, cancelKeyboard());
  });

  bot.action('admin_add_email', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'add_email' }, `<b>Add Sheet Email</b>\n\nSend the Gmail address:`);
  });

  bot.action('admin_stats', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    const s = store.getGroupStats(groupId);
    const g = store.getGroup(groupId);
    const wlCount = g?.whitelist ? g.whitelist.size : 0;
    await ctx.replyWithHTML(
      `<b>Stats — ${g?.groupName || groupId}</b>\n${'─'.repeat(28)}\n` +
      `Tasks: ${s.activeTasks}/${s.totalTasks}  Raids: ${s.activeRaids}/${s.totalRaids}\n` +
      `Pending: ${s.pendingSubmissions}  Approved: ${s.approvedSubmissions}\n` +
      `Users: ${s.totalUsers}  Banned: ${s.bannedUsers}\n` +
      `Mode: ${g?.accessMode}  Whitelist: ${wlCount} users`
    );
  });

  bot.action('admin_set_link', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'set_link' }, `<b>Set Group Link</b>\n\nSend the invite link:`);
  });

  bot.action('admin_close', async (ctx) => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(() => {}); });
}

module.exports = { register };
