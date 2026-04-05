/**
 * admin.js -- Admin panel
 * Task creation: Platform -> TaskType (multi for Twitter) -> Title -> Link -> Reward
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
  platformSelectKeyboard, taskTypeKeyboard, twitterMultiActionKeyboard, taskCardKeyboard,
} = require('../utils/keyboard');

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
  if (!isAdminUser(userId)) {
    return ctx.reply('You are not authorized to use this.');
  }
  if (!groupId) {
    const groups = store.getGroupsForAdmin(userId);
    if (!groups.length) return ctx.replyWithHTML(`<b>No registered groups found.</b>\n\nYou are not an admin of any whitelisted group.\nAn owner must run /addgroup first, then add you as admin.`);
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
  const text =
    `<b>Admin Panel</b>\n${'─'.repeat(30)}\n<b>${name}</b>\n${'─'.repeat(30)}\n` +
    `Tasks: <b>${stats.activeTasks}</b>  Raids: <b>${stats.activeRaids}</b>\n` +
    `Users: <b>${stats.totalUsers}</b>  Mode: <b>${group.accessMode}</b>\n${'─'.repeat(30)}\n` +
    (canSwitch ? `<i>Use Switch Group to manage a different group.</i>` : `<i>Tap a section below:</i>`);
  if (isEdit && ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, { parse_mode:'HTML', ...adminMainKeyboard(name, canSwitch) }); } catch {}
  }
  return ctx.replyWithHTML(text, adminMainKeyboard(name, canSwitch));
}

async function handleAdminPanel(ctx) {
  await sendAdminPanel(ctx, resolveAdminGroup(ctx));
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
    const typeLabel = s.taskTypes
      ? s.taskTypes.map(t => TASK_TYPE_LABELS[t]||t).join(' + ')
      : (TASK_TYPE_LABELS[s.taskType]||s.taskType);
    return ctx.replyWithHTML(
      `Title: <b>${text}</b>\n<i>Platform: ${s.platform==='telegram'?'Telegram':'Twitter/X'} · Type: ${typeLabel}</i>\n\n`+
      `<b>Step 3 / 5</b> -- Send the <b>link</b>:\n`+
      (s.platform==='twitter'?`<i>Tweet or profile URL</i>`:`<i>Channel link or @username</i>`),
      cancelKeyboard()
    );
  }

  if (s.step === 'task_link') {
      const linkVal = text === 'none' ? '' : text;
      const isComment = s.taskTypes ? s.taskTypes.includes('comment') : s.taskType === 'comment';
      if (isComment) {
        session.setSession(userId, { ...s, step: 'task_min_chars', link: linkVal });
        return ctx.replyWithHTML(
          `Link saved.\n\n<b>Step 4 / 6</b> -- Set <b>minimum comment characters</b>:\n` +
          `Send a number (e.g. <code>50</code>) or <code>0</code> to skip the limit.\n` +
          `<i>Users must write at least this many characters in their reply.</i>`,
          cancelKeyboard()
        );
      }
      session.setSession(userId, { ...s, step: 'task_reward', link: linkVal });
      return ctx.replyWithHTML(`Link saved.\n\n<b>Step 4 / 5</b> -- Send the <b>point reward</b>:`, cancelKeyboard());
    }

  if (s.step === 'task_min_chars') {
      const n = parseInt(text);
      const minChars = (!isNaN(n) && n >= 0) ? n : 0;
      session.setSession(userId, { ...s, step: 'task_reward', minChars });
      return ctx.replyWithHTML(`Min characters set to <b>${minChars || 'none'}</b>.\n\n<b>Step 5 / 6</b> -- Send the <b>point reward</b>:`, cancelKeyboard());
    }

      if (s.step === 'task_reward') {
    const reward = parseInt(text);
    if (isNaN(reward)||reward<0) return ctx.reply('Enter a valid number (e.g. 100)');
    session.clearSession(userId);

    // Determine final taskType and label
    let finalTaskType, finalTaskTypes, typeLabel;
    if (s.taskTypes && s.taskTypes.length > 0) {
      finalTaskTypes = s.taskTypes;
      finalTaskType  = s.taskTypes.length === 1 ? s.taskTypes[0] : 'multi';
      typeLabel      = s.taskTypes.map(t => TASK_TYPE_LABELS[t]||t).join(' + ');
    } else {
      finalTaskType  = s.taskType;
      finalTaskTypes = null;
      typeLabel      = TASK_TYPE_LABELS[s.taskType]||s.taskType;
    }

    const platLabel = s.platform==='telegram'?'Telegram':'Twitter/X';
    const btnLabel  = `${platLabel} - ${typeLabel}`;
    const task = store.createTask(groupId, s.title, s.link, reward, s.taskKind, btnLabel, s.platform, finalTaskType, finalTaskTypes, s.minChars || 0);
    const broadcastMsg =
      `<b>New ${s.taskKind==='raid'?'Raid':'Task'}!</b>\n${'─'.repeat(28)}\n`+
      `<b>${task.title}</b>\n${platLabel} - ${typeLabel}\n`+
      (task.link?`Link: ${task.link}\n`:'')+
      `Reward: <b>${task.reward} pts</b>\n\n<i>Complete the task and tap Verify to earn instantly.</i>`;
    const group    = store.getGroup(groupId);
    const topicKey = s.taskKind==='raid'?'raids':'quests';
    const topicId  = group?.topics?.[topicKey]||group?.topics?.notifications||null;
    const botName  = getBotUsername() || 'MomentumHubBot';
    const { taskCardDMKeyboard } = require('../utils/keyboard');
    try {
      await ctx.telegram.sendMessage(groupId, broadcastMsg, {
        parse_mode:'HTML', message_thread_id:topicId||undefined,
        ...taskCardDMKeyboard(task.id, task.link, btnLabel, botName),
      });
    } catch(e) { console.error('[Admin] Group post:', e.message); }
    const users = store.getAllUsers().filter(u=>!u.banned&&u.notifications!==false);
    let dmSent = 0;
    for (const u of users) {
      try { await ctx.telegram.sendMessage(u.id, broadcastMsg, { parse_mode:'HTML', ...taskCardKeyboard(task.id, task.link, btnLabel, finalTaskType) }); dmSent++; } catch {}
      await delay(50);
    }
    await ctx.replyWithHTML(`<b>${s.taskKind==='raid'?'Raid':'Task'} created!</b>\nID: <code>${task.id}</code>  DMs sent: <b>${dmSent}</b>`);
    return sendAdminPanel(ctx, groupId);
  }

  if (s.step==='announce_msg') {
    session.clearSession(userId);
    const group=store.getGroup(groupId); const topicId=group?.topics?.announcements||null;
    const msg=`<b>Announcement</b>\n\n${text}`;
    try { await ctx.telegram.sendMessage(groupId, msg, { parse_mode:'HTML', message_thread_id:topicId||undefined }); } catch(e){console.error(e.message);}
    const users=store.getAllUsers().filter(u=>!u.banned&&u.notifications!==false); let sent=0;
    for (const u of users) { try { await ctx.telegram.sendMessage(u.id, msg, { parse_mode:'HTML' }); sent++; } catch {} await delay(50); }
    await ctx.replyWithHTML(`Announced to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  if (s.step==='dm_all_msg') {
    session.clearSession(userId);
    const msg=`<b>Message from Admin</b>\n\n${text}`;
    const users=store.getAllUsers().filter(u=>!u.banned&&u.notifications!==false); let sent=0;
    for (const u of users) { try { await ctx.telegram.sendMessage(u.id, msg, { parse_mode:'HTML' }); sent++; } catch {} await delay(50); }
    await ctx.replyWithHTML(`DM sent to <b>${sent}</b> users.`);
    return sendAdminPanel(ctx, groupId);
  }

  if (s.step==='ban_id')      { session.clearSession(userId); const ok=store.banUser(text.replace('@','')); await ctx.replyWithHTML(ok?`Banned <code>${text}</code>.`:`User not found.`); return sendAdminPanel(ctx, groupId); }
  if (s.step==='unban_id')    { session.clearSession(userId); const ok=store.unbanUser(text.replace('@','')); await ctx.replyWithHTML(ok?`Unbanned <code>${text}</code>.`:`User not found.`); return sendAdminPanel(ctx, groupId); }
  if (s.step==='add_admin_id'){ session.clearSession(userId); store.addAdmin(groupId, text.replace('@','')); await ctx.replyWithHTML(`<code>${text}</code> added as admin.`); return sendAdminPanel(ctx, groupId); }
  if (s.step==='rem_admin_id'){ session.clearSession(userId); store.removeAdmin(groupId, text.replace('@','')); await ctx.replyWithHTML(`<code>${text}</code> removed from admins.`); return sendAdminPanel(ctx, groupId); }

  if (s.step==='add_email') {
    session.clearSession(userId);
    if (!text.includes('@')||!text.includes('.')) return ctx.reply('Invalid email address.');
    const group=store.getGroup(groupId); if (!group.extraEmails) group.extraEmails=[];
    if (!group.extraEmails.includes(text)) group.extraEmails.push(text);
    if (group.sheetId&&group.sheetId!=='none') { try { await sheets.shareSheet(group.sheetId, text); } catch(e){console.error(e.message);} }
    await ctx.replyWithHTML(`Email <b>${text}</b> added.`);
    return sendAdminPanel(ctx, groupId);
  }

  if (s.step==='set_link') { session.clearSession(userId); store.setGroupMeta(groupId, { groupLink:text }); await ctx.replyWithHTML(`Group link set.`); return sendAdminPanel(ctx, groupId); }

  if (s.step==='set_topic_id') {
    session.clearSession(userId);
    const tid=parseInt(text); if (isNaN(tid)) return ctx.reply('Send a valid topic ID number.');
    store.setGroupTopic(groupId, s.topicType, tid);
    await ctx.replyWithHTML(`Topic <b>${s.topicType}</b> set to <code>${tid}</code>`);
    return sendAdminPanel(ctx, groupId);
  }

  return next();
}

function startFlow(ctx, flowData, prompt) {
  const userId = ctx.from.id;
  if (!isAdminUser(userId)) {
    ctx.answerCbQuery('You are not authorized to use this.', { show_alert: true });
    return;
  }
  const groupId = resolveAdminGroup(ctx);
  session.setSession(userId, { adminFlow:true, groupId, ...flowData });
  return ctx.replyWithHTML(prompt, cancelKeyboard());
}

function adminGuard(ctx) {
  const userId = ctx.from?.id;
  if (!isAdminUser(userId)) {
    ctx.answerCbQuery('You are not authorized to use this.', { show_alert: true });
    return false;
  }
  return true;
}

function register(bot) {
  bot.use(handleAdminSessionInput);
  bot.command('admin', adminOnly, handleAdminPanel);

  bot.action(/^approve_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const subId=parseInt(ctx.match[1]); const sub=store.getSubmission(subId);
    if (!sub||sub.status!=='pending') return ctx.answerCbQuery('Already processed.', { show_alert:true });
    store.approveSubmission(subId); store.addPoints(sub.userId, sub.points);
    await ctx.answerCbQuery('Approved!');
    await ctx.editMessageText?.(`Approved -- @${sub.username} | +${sub.points}pts`, { parse_mode:'HTML' }).catch(()=>{});
    try { await ctx.telegram.sendMessage(sub.userId, `Task approved! +${sub.points} pts for <b>${sub.taskTitle}</b>`, { parse_mode:'HTML' }); } catch {}
  });

  bot.action(/^reject_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const subId=parseInt(ctx.match[1]); const sub=store.getSubmission(subId);
    if (!sub||sub.status!=='pending') return ctx.answerCbQuery('Already processed.', { show_alert:true });
    store.rejectSubmission(subId); await ctx.answerCbQuery('Rejected.');
    await ctx.editMessageText?.(`Rejected -- @${sub.username}`, { parse_mode:'HTML' }).catch(()=>{});
    try { await ctx.telegram.sendMessage(sub.userId, `Submission rejected for <b>${sub.taskTitle}</b>.`, { parse_mode:'HTML' }); } catch {}
  });

  bot.action(/^del_task_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const ok=store.deactivateTask(parseInt(ctx.match[1]));
    await ctx.answerCbQuery(ok?'Deleted':'Not found', { show_alert:!ok });
    if (ok) await ctx.editMessageText(`Task <b>#${ctx.match[1]}</b> deleted.`, { parse_mode:'HTML' }).catch(()=>{});
  });

  bot.action(/^select_group_(.+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery(); store.setAdminContext(ctx.from.id, ctx.match[1]);
    await sendAdminPanel(ctx, ctx.match[1]);
  });

  bot.action('admin_switch_group', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(`<b>Switch Group</b>`, groupSelectorKeyboard(store.getGroupsForAdmin(ctx.from.id)));
  });

  bot.action('back_admin', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery(); await sendAdminPanel(ctx, resolveAdminGroup(ctx), true);
  });

  bot.action('cancel_flow', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.'); session.clearSession(ctx.from.id);
    await ctx.deleteMessage().catch(()=>{});
  });

  ['admin_section_campaigns','admin_section_bc','admin_section_users','admin_section_access','admin_section_setup']
    .forEach(a => bot.action(a, async (ctx) => {
      if (!adminGuard(ctx)) return;
      ctx.answerCbQuery();
    }));

  // ── Create Task / Raid ────────────────────────────────────────────────────────
  bot.action('admin_create_task', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow:true, groupId, taskKind:'task', step:'select_platform' });
    await ctx.replyWithHTML(`<b>Create Task</b>\n\n<b>Step 1 / 5</b> -- Select the <b>platform</b>:`, platformSelectKeyboard('task'));
  });

  bot.action('admin_create_raid', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow:true, groupId, taskKind:'raid', step:'select_platform' });
    await ctx.replyWithHTML(`<b>Create Raid</b>\n\n<b>Step 1 / 5</b> -- Select the <b>platform</b>:`, platformSelectKeyboard('raid'));
  });

  bot.action(/^admin_platform_(task|raid)_(twitter|telegram)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const [,kind,platform] = ctx.match;
    const s = session.getSession(ctx.from.id);
    if (!s) return ctx.reply('Session expired. Run /admin again.');

    if (platform === 'twitter') {
      // Multi-action selection for Twitter
      session.setSession(ctx.from.id, { ...s, platform, step:'select_twitter_actions', selectedActions: {} });
      await ctx.replyWithHTML(
        `Twitter/X selected.\n\n<b>Step 2 / 5</b> -- Select <b>one or more actions</b> (tap to toggle):\n<i>Tap Confirm when done.</i>`,
        twitterMultiActionKeyboard({})
      );
    } else {
      // Telegram: single type selection
      session.setSession(ctx.from.id, { ...s, platform, step:'select_tasktype' });
      await ctx.replyWithHTML(`Telegram selected.\n\n<b>Step 2 / 5</b> -- Select the <b>task type</b>:`, taskTypeKeyboard(kind, platform));
    }
  });

  // Twitter multi-action toggle
  bot.action(/^admin_ttoggle_(follow|like|retweet|comment|quote)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const actionType = ctx.match[1];
    const s = session.getSession(ctx.from.id);
    if (!s || s.step !== 'select_twitter_actions') return ctx.reply('Session expired. Run /admin again.');
    const selected = s.selectedActions || {};
    selected[actionType] = !selected[actionType];
    session.setSession(ctx.from.id, { ...s, selectedActions: selected });
    const selCount = Object.values(selected).filter(Boolean).length;
    await ctx.editMessageText(
      `Twitter/X selected.\n\n<b>Step 2 / 5</b> -- Select <b>one or more actions</b> (tap to toggle):\n<i>${selCount} selected. Tap Confirm when done.</i>`,
      { parse_mode: 'HTML', ...twitterMultiActionKeyboard(selected) }
    ).catch(async () => {
      await ctx.replyWithHTML(
        `Select actions (${selCount} selected):`,
        twitterMultiActionKeyboard(selected)
      );
    });
  });

  // Confirm Twitter multi-action selection
  bot.action('admin_tconfirm', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const s = session.getSession(ctx.from.id);
    if (!s || s.step !== 'select_twitter_actions') return ctx.reply('Session expired. Run /admin again.');
    const selected = s.selectedActions || {};
    const taskTypes = Object.keys(selected).filter(k => selected[k]);
    if (!taskTypes.length) return ctx.answerCbQuery('Select at least one action.', { show_alert: true });
    const typeLabel = taskTypes.map(t => TASK_TYPE_LABELS[t]||t).join(' + ');
    session.setSession(ctx.from.id, { ...s, taskTypes, step:'task_title' });
    await ctx.replyWithHTML(
      `Actions selected: <b>${typeLabel}</b>\n\n<b>Step 3 / 5</b> -- Enter the <b>title</b>:`,
      cancelKeyboard()
    );
  });

  bot.action(/^admin_tasktype_(task|raid)_(\w+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const [,kind,taskType] = ctx.match;
    const s = session.getSession(ctx.from.id);
    if (!s) return ctx.reply('Session expired. Run /admin again.');
    session.setSession(ctx.from.id, { ...s, taskType, step:'task_title' });
    await ctx.replyWithHTML(
      `Type: <b>${TASK_TYPE_LABELS[taskType]||taskType}</b>\n\n<b>Step 3 / 5</b> -- Enter the <b>title</b>:`,
      cancelKeyboard()
    );
  });

  bot.action('admin_view_tasks', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId=resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    const tasks=store.getAllTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('<b>Tasks</b>\n\n<i>No tasks yet.</i>');
    const lines=tasks.map(t=>{
      const tl = t.taskTypes
        ? JSON.parse(t.taskTypes).map(x => TASK_TYPE_LABELS[x]||x).join('+')
        : (TASK_TYPE_LABELS[t.taskType]||t.taskType||'--');
      const pe=t.platform==='telegram'?'Telegram':'Twitter/X';
      const status=t.active?'Active':'Inactive';
      return `[${status}] [<code>${t.id}</code>] ${t.type==='raid'?'[Raid]':'[Task]'} <b>${t.title}</b>\n   ${pe} - ${tl} -- ${t.reward}pts`;
    }).join('\n\n');
    await ctx.replyWithHTML(`<b>All Tasks</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_delete_task_menu', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId=resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    const tasks=store.getTasksForGroup(groupId);
    if (!tasks.length) return ctx.replyWithHTML('<b>Delete Task</b>\n\n<i>No active tasks.</i>');
    await ctx.replyWithHTML('<b>Select task to delete:</b>', taskDeleteKeyboard(tasks));
  });

  bot.action('admin_announce', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step:'announce_msg' }, `<b>Announce</b>\n\nType your announcement:`);
  });
  bot.action('admin_dm_all', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step:'dm_all_msg'   }, `<b>DM All Users</b>\n\nType the message:`);
  });

  bot.action('admin_view_users', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const users=store.getAllUsers().slice(0, 20);
    if (!users.length) return ctx.replyWithHTML('<b>Users</b>\n\n<i>No users yet.</i>');
    const lines=users.map((u,i)=>`${i+1}. @${u.username} (<code>${u.id}</code>) -- ${u.points}pts ${u.banned?'[Banned]':'[Active]'}`).join('\n');
    await ctx.replyWithHTML(`<b>Users (latest 20)</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  bot.action('admin_ban',       async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step:'ban_id'       }, `<b>Ban User</b>\n\nSend the User ID:`); });
  bot.action('admin_unban',     async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step:'unban_id'     }, `<b>Unban User</b>\n\nSend the User ID:`); });
  bot.action('admin_add_admin', async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step:'add_admin_id' }, `<b>Add Admin</b>\n\nSend the User ID:`); });
  bot.action('admin_rem_admin', async (ctx) => { if (!adminGuard(ctx)) return; await ctx.answerCbQuery(); startFlow(ctx, { step:'rem_admin_id' }, `<b>Remove Admin</b>\n\nSend the User ID:`); });

  ['all','group','whitelist'].forEach(mode => {
    bot.action(`admin_mode_${mode}`, async (ctx) => {
      if (!adminGuard(ctx)) return;
      const groupId=resolveAdminGroup(ctx); if (groupId) store.setAccessMode(groupId, mode);
      const labels={all:'Everyone allowed',group:'Group members only',whitelist:'Whitelist only'};
      await ctx.answerCbQuery(`${labels[mode]}`, { show_alert:true });
      await sendAdminPanel(ctx, groupId, true);
    });
  });

  bot.action('admin_setup_topics', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId=resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    await ctx.replyWithHTML(`<b>Setup Forum Topics</b>\n\nSelect a topic type:`, topicsSetupKeyboard());
  });

  bot.action(/^set_topic_(.+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const topicType=ctx.match[1]; const groupId=resolveAdminGroup(ctx);
    session.setSession(ctx.from.id, { adminFlow:true, groupId, step:'set_topic_id', topicType });
    await ctx.replyWithHTML(`<b>Set Topic: ${topicType}</b>\n\nSend the <b>thread ID</b>:`, cancelKeyboard());
  });

  bot.action('admin_add_email', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step:'add_email' }, `<b>Add Sheet Email</b>\n\nSend the Gmail:`);
  });

  bot.action('admin_stats', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId=resolveAdminGroup(ctx); if (!groupId) return ctx.reply('No group selected.');
    const s=store.getGroupStats(groupId); const g=store.getGroup(groupId);
    await ctx.replyWithHTML(
      `<b>Stats -- ${g?.groupName||groupId}</b>\n${'─'.repeat(28)}\n`+
      `Tasks: ${s.activeTasks}/${s.totalTasks}  Raids: ${s.activeRaids}/${s.totalRaids}\n`+
      `Users: ${s.totalUsers}  Banned: ${s.bannedUsers}\nMode: ${g?.accessMode}`
    );
  });

  bot.action('admin_set_link', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step:'set_link' }, `<b>Set Group Link</b>\n\nSend the invite link:`);
  });
  bot.action('admin_close', async (ctx) => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(()=>{}); });
}

module.exports = { register };
