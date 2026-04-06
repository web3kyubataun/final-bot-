/**
 * admin.js — Admin panel
 * Task creation: Platform → TaskType → Title → Link → Reward → TimeLimit(raids)
 *
 * Rules:
 *  - Like and Follow are solo tasks (cannot combine with others)
 *  - Retweet, Comment, Quote can be combined together
 *  - Bot will NOT post to group unless at least one topic is configured
 *  - Raids can have a time limit (1–1440 minutes)
 */
const store   = require('../store');
const sheets  = require('../services/sheets');
const session = require('../sessions');
const config  = require('../config');
const { adminOnly } = require('../middleware/auth');
const { getBotUsername } = require('../botInfo');
const {
  approvalKeyboard, adminMainKeyboard, taskDeleteKeyboard,
  topicsSetupKeyboard, groupSelectorKeyboard, cancelKeyboard,
  platformSelectKeyboard, taskTypeKeyboard, taskCardKeyboard,
} = require('../utils/keyboard');

const SOLO_TASK_TYPES = ['follow', 'like'];

const delay = ms => new Promise(r => setTimeout(r, ms));

const TASK_TYPE_LABELS = {
  follow:'Follow', like:'Like', retweet:'Retweet',
  comment:'Comment', quote:'Quote Tweet',
  join:'Join Channel/Group', react:'React to Message', send:'Send Message',
};

function resolveAdminGroup(ctx) {
  const t = ctx.chat?.type;
  if (t === 'group' || t === 'supergroup') return String(ctx.chat.id);
  return store.getAdminContext(ctx.from?.id) || null;
}

async function sendAdminPanel(ctx, groupId, isEdit=false) {
  const userId = ctx.from.id;
  if (!groupId) {
    const groups = store.getGroupsForAdmin(userId);
    if (!groups.length) return ctx.replyWithHTML(
      `<b>No registered groups found.</b>\n\nYou are not an admin of any whitelisted group.\nAn owner must run /addgroup first, then add you as admin.`
    );
    if (groups.length === 1) { groupId = groups[0].id; store.setAdminContext(userId, groupId); }
    else return ctx.replyWithHTML(`<b>Select a group to manage:</b>`, groupSelectorKeyboard(groups));
  }
  const group = store.getGroup(groupId);
  if (!group) return ctx.reply('Group not found. Owner must /addgroup first.');
  store.setAdminContext(userId, groupId);
  const stats = store.getGroupStats(groupId);
  const name  = group.groupName || groupId;
  const adminGroups = store.getGroupsForAdmin(userId);
  const canSwitch = adminGroups.length > 1;
  const topicsConfigured = store.groupHasTopics(groupId);
  const topicsWarning = topicsConfigured ? '' : '\n<b>Warning:</b> No topics configured — bot will not post in group until topics are set. Use "Setup Topics" below.';
  const text =
    `<b>Admin Panel</b>\n${'─'.repeat(30)}\n<b>${name}</b>\n${'─'.repeat(30)}\n` +
    `Tasks: <b>${stats.activeTasks}</b>   Raids: <b>${stats.activeRaids}</b>\n` +
    `Users: <b>${stats.totalUsers}</b>  |  Mode: <b>${group.accessMode}</b>\n${'─'.repeat(30)}\n` +
    (canSwitch ? `<i>Use Switch Group to manage a different group.</i>` : `<i>Tap a section below:</i>`) +
    topicsWarning;
  if (isEdit && ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, { parse_mode:'HTML', ...adminMainKeyboard(name, canSwitch) }); } catch {}
  }
  return ctx.replyWithHTML(text, adminMainKeyboard(name, canSwitch));
}

async function handleAdminPanel(ctx) {
  await sendAdminPanel(ctx, resolveAdminGroup(ctx));
}

/**
 * Check if a group has topics set before posting. Returns true if safe to post.
 */
function canPostToGroup(groupId) {
  return store.groupHasTopics(groupId);
}

async function handleAdminSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();
  const s = session.getSession(userId);
  if (!s?.adminFlow) return next();
  const text    = ctx.message.text.trim();
  const groupId = s.groupId || store.getAdminContext(userId);
  if (text.startsWith('/')) { session.clearSession(userId); return next(); }

  if (s.step === 'task_title') {
    session.setSession(userId, { ...s, step:'task_link', title:text });
    const typeLabel = TASK_TYPE_LABELS[s.taskType]||s.taskType;
    return ctx.replyWithHTML(
      `Title: <b>${text}</b>\n<i>Platform: ${s.platform==='telegram'?'Telegram':'Twitter/X'} · Type: ${typeLabel}</i>\n\n` +
      `<b>Step 3 / 5</b> — Send the <b>link</b>:\n` +
      (s.platform==='twitter'?`<i>Tweet or profile URL</i>`:`<i>Channel link or @username</i>`),
      cancelKeyboard()
    );
  }

  if (s.step === 'task_link') {
    session.setSession(userId, { ...s, step:'task_reward', link:text==='none'?'':text });
    return ctx.replyWithHTML(`Link saved.\n\n<b>Step 4 / 5</b> — Send the <b>point reward</b>:`, cancelKeyboard());
  }

  if (s.step === 'task_reward') {
    const reward = parseInt(text);
    if (isNaN(reward)||reward<0) return ctx.reply('Enter a valid number (e.g. 100)');
    if (s.taskKind === 'raid') {
      session.setSession(userId, { ...s, step:'task_timelimit', reward });
      return ctx.replyWithHTML(
        `Reward: <b>${reward} pts</b> saved.\n\n<b>Step 5 / 5</b> — Set a <b>time limit</b> for this raid:\n\n` +
        `Send a number of minutes (1–1440), or type <code>none</code> for no limit.\n` +
        `<i>Example: 60 = 1 hour, 1440 = 24 hours</i>`,
        cancelKeyboard()
      );
    }
    // Tasks (non-raid): no time limit step
    await finalizeTaskCreation(ctx, userId, groupId, s, reward, null);
    return;
  }

  if (s.step === 'task_timelimit') {
    let timeLimitMinutes = null;
    if (text.toLowerCase() !== 'none') {
      timeLimitMinutes = parseInt(text);
      if (isNaN(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 1440) {
        return ctx.reply('Please send a number between 1 and 1440, or type "none" for no limit.');
      }
    }
    const reward = s.reward;
    await finalizeTaskCreation(ctx, userId, groupId, s, reward, timeLimitMinutes);
    return;
  }

  if (s.step === 'announce_msg') {
    session.clearSession(userId);
    const group = store.getGroup(groupId);
    if (!canPostToGroup(groupId)) {
      return ctx.replyWithHTML(
        `<b>Cannot Post</b>\n\nNo topics are configured for this group. Set up topics first using "Setup Topics" in the admin panel.`
      );
    }
    const topicId = group?.topics?.announcements || null;
    const msg = `<b>Announcement</b>\n\n${text}`;
    try {
      await ctx.telegram.sendMessage(groupId, msg, {
        parse_mode:'HTML', message_thread_id: topicId || undefined,
      });
      await ctx.replyWithHTML('Announcement sent.');
    } catch(e) { await ctx.reply('Failed to send: ' + e.message); }
    return sendAdminPanel(ctx, groupId);
  }

  if (s.step === 'dm_all_msg') {
    session.clearSession(userId);
    const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
    await ctx.reply(`Sending to ${users.length} users...`);
    let sent = 0, failed = 0;
    for (const u of users) {
      try { await ctx.telegram.sendMessage(u.id, text, { parse_mode:'HTML' }); sent++; }
      catch { failed++; }
      await delay(50);
    }
    await ctx.replyWithHTML(`Done. Sent: <b>${sent}</b>  |  Failed: <b>${failed}</b>`);
    return;
  }

  if (s.step === 'ban_id') {
    session.clearSession(userId);
    const ok = store.banUser(text);
    await ctx.replyWithHTML(ok ? `User <code>${text}</code> banned.` : `User not found: <code>${text}</code>`);
    return;
  }

  if (s.step === 'unban_id') {
    session.clearSession(userId);
    const ok = store.unbanUser(text);
    await ctx.replyWithHTML(ok ? `User <code>${text}</code> unbanned.` : `User not found: <code>${text}</code>`);
    return;
  }

  if (s.step === 'add_admin_id') {
    session.clearSession(userId);
    store.addAdmin(groupId, text);
    await ctx.replyWithHTML(`User <code>${text}</code> added as admin.`);
    return;
  }

  if (s.step === 'rem_admin_id') {
    session.clearSession(userId);
    store.removeAdmin(groupId, text);
    await ctx.replyWithHTML(`User <code>${text}</code> removed from admins.`);
    return;
  }

  if (s.step === 'set_topic_id') {
    session.clearSession(userId);
    const topicId = parseInt(text);
    if (isNaN(topicId)) return ctx.reply('Invalid topic ID.');
    store.setGroupTopic(groupId, s.topicType, topicId);
    await ctx.replyWithHTML(`Topic <b>${s.topicType}</b> set to thread ID <code>${topicId}</code>.`);
    return;
  }

  if (s.step === 'add_email') {
    session.clearSession(userId);
    const group = store.getGroup(groupId);
    if (group && !group.extraEmails.includes(text)) {
      group.extraEmails.push(text);
      if (group.sheetId && group.sheetId !== 'none') {
        try { await sheets.shareSheet(group.sheetId, text); } catch {}
      }
    }
    await ctx.replyWithHTML(`Email <code>${text}</code> added.`);
    return;
  }

  if (s.step === 'set_link') {
    session.clearSession(userId);
    store.setGroupMeta(groupId, { groupLink: text });
    await ctx.replyWithHTML(`Group link set to: ${text}`);
    return;
  }

  if (s.step === 'collect_info_question') {
    // Admin sent the question to ask users
    session.clearSession(userId);
    const question = text;
    const users = store.getAllUsers().filter(u => !u.banned);
    await ctx.reply(`Sending info request to ${users.length} users...`);
    let sent = 0;
    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.id,
          `<b>Information Request from Admin</b>\n\n${question}\n\n<i>Please reply with your answer.</i>`,
          { parse_mode: 'HTML' }
        );
        sent++;
      } catch {}
      await delay(50);
    }
    await ctx.replyWithHTML(`Info request sent to <b>${sent}</b> users.\n\n<i>Replies will be collected automatically when users respond with the keyword:</i> <code>info:</code> <i>followed by their answer.</i>`);
    return;
  }

  return next();
}

async function finalizeTaskCreation(ctx, userId, groupId, s, reward, timeLimitMinutes) {
  session.clearSession(userId);
  const typeLabel = TASK_TYPE_LABELS[s.taskType] || s.taskType;
  const platLabel = s.platform === 'telegram' ? 'Telegram' : 'Twitter/X';
  const btnLabel  = `${platLabel} | ${typeLabel}`;
  const task = store.createTask(
    groupId, s.title, s.link, reward, s.taskKind,
    btnLabel, s.platform, s.taskType, timeLimitMinutes
  );

  const timeLimitText = timeLimitMinutes ? `\nTime Limit: <b>${timeLimitMinutes} min</b>` : '';
  const broadcastMsg =
    `<b>New ${s.taskKind === 'raid' ? 'Raid' : 'Task'}!</b>\n${'─'.repeat(28)}\n` +
    `<b>${task.title}</b>\n${platLabel} | ${typeLabel}\n` +
    (task.link ? `${task.link}\n` : '') +
    `Reward: <b>${task.reward} pts</b>${timeLimitText}\n\n` +
    `<i>Complete the task and tap Verify to earn instantly.</i>`;

  if (canPostToGroup(groupId)) {
    const group    = store.getGroup(groupId);
    const topicKey = s.taskKind === 'raid' ? 'raids' : 'tasks';
    const topicId  = group?.topics?.[topicKey] || group?.topics?.notifications || null;
    try {
      await ctx.telegram.sendMessage(groupId, broadcastMsg, {
        parse_mode:'HTML', message_thread_id: topicId || undefined,
        ...taskCardKeyboard(task.id, task.link, btnLabel, task.taskType),
      });
    } catch(e) { console.error('[Admin] Group post:', e.message); }
  } else {
    await ctx.replyWithHTML(
      `<b>Note:</b> Task created but <b>not posted in the group</b> — no topics are configured yet.\n` +
      `Use "Setup Topics" in the admin panel to configure topics, then re-create the task.`
    );
  }

  // DM all users
  const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
  let dmSent = 0;
  for (const u of users) {
    try {
      await ctx.telegram.sendMessage(u.id, broadcastMsg, {
        parse_mode:'HTML', ...taskCardKeyboard(task.id, task.link, btnLabel, task.taskType),
      });
      dmSent++;
    } catch {}
    await delay(50);
  }

  await ctx.replyWithHTML(
    `<b>${s.taskKind === 'raid' ? 'Raid' : 'Task'} created!</b>\n` +
    `ID: <code>${task.id}</code>  |  DMs sent: <b>${dmSent}</b>` +
    (timeLimitMinutes ? `\nExpires in: <b>${timeLimitMinutes} minutes</b>` : '')
  );
  return sendAdminPanel(ctx, groupId);
}

function startFlow(ctx, sessionData, message) {
  const groupId = resolveAdminGroup(ctx);
  session.setSession(ctx.from.id, { adminFlow:true, groupId, ...sessionData });
  ctx.replyWithHTML(message, cancelKeyboard());
}

function register(bot) {
  bot.command('admin', adminOnly, handleAdminPanel);
  bot.on('message', handleAdminSessionInput);

  bot.action(/^del_task_(\d+)$/, async (ctx) => {
    const ok = store.deactivateTask(parseInt(ctx.match[1]));
    await ctx.answerCbQuery(ok ? 'Deleted' : 'Not found', { show_alert: !ok });
    if (ok) await ctx.editMessageText(`Task <b>#${ctx.match[1]}</b> deleted.`, { parse_mode:'HTML' }).catch(()=>{});
  });

  bot.action(/^select_group_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery(); store.setAdminContext(ctx.from.id, ctx.match[1]);
    await sendAdminPanel(ctx, ctx.match[1]);
  });

  bot.action('admin_switch_group', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(`<b>Switch Group</b>`, groupSelectorKeyboard(store.getGroupsForAdmin(ctx.from.id)));
  });

  bot.action('back_admin', async (ctx) => { await ctx.answerCbQuery(); await sendAdminPanel(ctx, resolveAdminGroup(ctx), true); });

  bot.action('cancel_flow', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.'); session.clearSession(ctx.from.id);
    await ctx.deleteMessage().catch(()=>{});
  });

  ['admin_section_campaigns','admin_section_bc','admin_section_users','admin_section_access','admin_section_setup']
    .forEach(a => bot.action(a, ctx => ctx.answerCbQuery()));

  bot.action('admin_create_task', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow:true, groupId, taskKind:'task', step:'select_platform' });
    await ctx.replyWithHTML(`<b>Create Task</b>\n\n<b>Step 1 / 5</b> — Select the <b>platform</b>:`, platformSelectKeyboard('task'));
  });

  bot.action('admin_create_raid', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow:true, groupId, taskKind:'raid', step:'select_platform' });
    await ctx.replyWithHTML(`<b>Create Raid</b>\n\n<b>Step 1 / 5</b> — Select the <b>platform</b>:`, platformSelectKeyboard('raid'));
  });

  bot.action(/^admin_platform_(task|raid)_(twitter|telegram)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [,kind,platform] = ctx.match;
    const s = session.getSession(ctx.from.id);
    if (!s) return ctx.reply('Session expired. Run /admin again.');
    session.setSession(ctx.from.id, { ...s, platform, step:'select_tasktype' });
    const platLabel = platform==='telegram'?'Telegram':'Twitter/X';
    await ctx.replyWithHTML(
      `${platLabel} selected.\n\n<b>Step 2 / 5</b> — Select the <b>task type</b>:\n\n` +
      (kind === 'raid'
        ? `<i>Note: Follow and Like are solo tasks (cannot combine). Retweet, Comment, and Quote can be combined.</i>`
        : `<i>Select one task type.</i>`),
      taskTypeKeyboard(kind, platform)
    );
  });

  bot.action(/^admin_tasktype_(task|raid)_(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [,kind,taskType] = ctx.match;
    const s = session.getSession(ctx.from.id);
    if (!s) return ctx.reply('Session expired. Run /admin again.');

    // Validate solo constraint
    if (SOLO_TASK_TYPES.includes(taskType)) {
      // Solo task: cannot combine — proceed directly
      session.setSession(ctx.from.id, { ...s, taskType, step:'task_title' });
      return ctx.replyWithHTML(
        `Type: <b>${TASK_TYPE_LABELS[taskType]}</b> (solo task — cannot combine)\n\n` +
        `<b>Step 3 / 5</b> — Enter the <b>title</b>:`,
        cancelKeyboard()
      );
    }

    session.setSession(ctx.from.id, { ...s, taskType, step:'task_title' });
    await ctx.replyWithHTML(
      `Type: <b>${TASK_TYPE_LABELS[taskType]||taskType}</b>\n\n<b>Step 3 / 5</b> — Enter the <b>title</b>:`,
      cancelKeyboard()
    );
  });

  bot.action('admin_view_tasks', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    const tasks = store.getAllTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('<b>Tasks</b>\n\n<i>No tasks yet.</i>');
    const lines = tasks.map(t => {
      const tl = TASK_TYPE_LABELS[t.taskType] || t.taskType || '—';
      const pe = t.platform === 'telegram' ? 'Telegram' : 'Twitter';
      const exp = t.expiresAt ? ` | Expires: ${new Date(t.expiresAt).toLocaleTimeString()}` : '';
      return `${t.active ? 'Active' : 'Inactive'} [<code>${t.id}</code>] ${t.type === 'raid' ? 'RAID' : 'TASK'} <b>${t.title}</b>\n   ${pe} | ${tl} — ${t.reward}pts${exp}`;
    }).join('\n\n');
    await ctx.replyWithHTML(`<b>All Tasks</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_delete_task_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    const tasks = store.getTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('<b>Delete Task</b>\n\n<i>No active tasks.</i>');
    await ctx.replyWithHTML('<b>Select task to delete:</b>', taskDeleteKeyboard(tasks));
  });

  bot.action('admin_announce', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step:'announce_msg' }, `<b>Announce</b>\n\nType your announcement:`);
  });

  bot.action('admin_dm_all', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step:'dm_all_msg' }, `<b>DM All Users</b>\n\nType the message:`);
  });

  bot.action('admin_view_users', async (ctx) => {
    await ctx.answerCbQuery();
    const users = store.getAllUsers().slice(0, 20);
    if (!users.length) return ctx.replyWithHTML('<b>Users</b>\n\n<i>No users yet.</i>');
    const lines = users.map((u, i) =>
      `${i+1}. @${u.username} (<code>${u.id}</code>) — ${u.points}pts${u.banned ? ' [BANNED]' : ''}\n` +
      `   Twitter: ${u.twitter || 'not set'}${u.twitterLocked ? ' (locked)' : ''}`
    ).join('\n\n');
    await ctx.replyWithHTML(`<b>Users (latest 20)</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_collect_info', async (ctx) => {
    await ctx.answerCbQuery();
    startFlow(ctx, { step:'collect_info_question' },
      `<b>Collect Info from Users</b>\n\n` +
      `Send the question or message you want to broadcast to all users to collect information.\n\n` +
      `<i>Example: Please share your email address for our records.</i>`
    );
  });

  bot.action('admin_ban',       async (ctx) => { await ctx.answerCbQuery(); startFlow(ctx, { step:'ban_id'       }, `<b>Ban User</b>\n\nSend the User ID:`); });
  bot.action('admin_unban',     async (ctx) => { await ctx.answerCbQuery(); startFlow(ctx, { step:'unban_id'     }, `<b>Unban User</b>\n\nSend the User ID:`); });
  bot.action('admin_add_admin', async (ctx) => { await ctx.answerCbQuery(); startFlow(ctx, { step:'add_admin_id' }, `<b>Add Admin</b>\n\nSend the User ID:`); });
  bot.action('admin_rem_admin', async (ctx) => { await ctx.answerCbQuery(); startFlow(ctx, { step:'rem_admin_id' }, `<b>Remove Admin</b>\n\nSend the User ID:`); });

  ['all','group','whitelist'].forEach(mode => {
    bot.action(`admin_mode_${mode}`, async (ctx) => {
      const groupId = resolveAdminGroup(ctx); if (groupId) store.setAccessMode(groupId, mode);
      const labels = { all:'Everyone allowed', group:'Group members only', whitelist:'Whitelist only' };
      await ctx.answerCbQuery(`${labels[mode]}`, { show_alert:true });
      await sendAdminPanel(ctx, groupId, true);
    });
  });

  bot.action('admin_setup_topics', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    await ctx.replyWithHTML(`<b>Setup Forum Topics</b>\n\nSelect a topic type to configure:`, topicsSetupKeyboard());
  });

  bot.action(/^set_topic_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const topicType = ctx.match[1]; const groupId = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow:true, groupId, step:'set_topic_id', topicType });
    await ctx.replyWithHTML(`<b>Set Topic: ${topicType}</b>\n\nSend the <b>thread ID</b>:`, cancelKeyboard());
  });

  bot.action('admin_add_email', async (ctx) => { await ctx.answerCbQuery(); startFlow(ctx, { step:'add_email' }, `<b>Add Sheet Email</b>\n\nSend the Gmail:`); });

  bot.action('admin_stats', async (ctx) => {
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    const s = store.getGroupStats(groupId); const g = store.getGroup(groupId);
    const topicsSet = Object.entries(g?.topics || {}).filter(([,v]) => v).map(([k]) => k).join(', ') || 'None';
    await ctx.replyWithHTML(
      `<b>Stats — ${g?.groupName||groupId}</b>\n${'─'.repeat(28)}\n` +
      `Tasks: ${s.activeTasks}/${s.totalTasks}   Raids: ${s.activeRaids}/${s.totalRaids}\n` +
      `Users: ${s.totalUsers}   Banned: ${s.bannedUsers}\n` +
      `Mode: ${g?.accessMode}\n` +
      `Topics configured: ${topicsSet}`
    );
  });

  bot.action('admin_set_link', async (ctx) => { await ctx.answerCbQuery(); startFlow(ctx, { step:'set_link' }, `<b>Set Group Link</b>\n\nSend the invite link:`); });
  bot.action('admin_close',    async (ctx) => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(()=>{}); });
  bot.action('noop',           async (ctx) => { await ctx.answerCbQuery(); });
}

module.exports = { register };
