/**
 * admin.js — Admin panel (step-by-step wizard)
 *
 * Wizard: Platform → Actions → Title → Link → [MinChars] → Reward → [Duration] → Create
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

const STANDALONE = ['like', 'follow'];

function resolveAdminGroup(ctx) {
  const t = ctx.chat?.type;
  if (t === 'group' || t === 'supergroup') return String(ctx.chat.id);
  return store.getAdminContext(ctx.from?.id) || null;
}

function adminGuard(ctx) {
  if (!isAdminUser(ctx.from?.id)) { ctx.answerCbQuery('Not authorized.').catch(() => {}); return false; }
  return true;
}

async function sendAdminPanel(ctx, groupId, isEdit = false) {
  const userId = ctx.from.id;
  if (!isAdminUser(userId)) return ctx.reply('You are not authorized.');

  if (!groupId) {
    const groups = store.getGroupsForAdmin(userId);
    if (!groups.length) return ctx.replyWithHTML(
      `<b>No registered groups found.</b>\n\nYou are not an admin of any whitelisted group.\nAn owner must run /addgroup first, then /addadmin &lt;yourId&gt; &lt;groupId&gt;.`
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
  const stats     = store.getGroupStats(groupId);
  const name      = group.groupName || groupId;
  const adminGrps = store.getGroupsForAdmin(userId);
  const canSwitch = adminGrps.length > 1;
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

// ── Session input handler (runs before all other message handlers) ─────────

async function handleAdminSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();
  const s = session.getSession(userId);
  if (!s?.adminFlow) return next();

  const text    = ctx.message.text.trim();
  const groupId = s.groupId || resolveAdminGroup(ctx);

  // ── Cancel shortcut
  if (text === '/cancel') {
    session.clearSession(userId);
    return ctx.replyWithHTML('Cancelled.');
  }

  // ── changeusertwitter flow ─────────────────────────────────────────────────
  if (s.step === 'changeusertwitter_userId') {
    session.setSession(userId, { ...s, step: 'changeusertwitter_handle', targetUserId: text });
    return ctx.replyWithHTML(
      `<b>Step 2/2</b> — Enter the new Twitter handle:\n<i>Format: @handle or handle (without @)</i>`
    );
  }
  if (s.step === 'changeusertwitter_handle') {
    const targetUserId = s.targetUserId;
    const handle = text.replace(/^@/, '').toLowerCase().trim();
    if (!handle || !/^[a-z0-9_]{1,50}$/i.test(handle)) {
      return ctx.replyWithHTML(`<b>Invalid handle.</b> Use letters, numbers, underscores only. Try again:`);
    }
    const conflict = store.checkTwitterUsernameConflict(handle, targetUserId);
    if (conflict) {
      session.clearSession(userId);
      return ctx.replyWithHTML(
        `<b>Conflict</b>\n\n@${handle} is already linked to user <code>${conflict.id}</code> (@${conflict.username}).\n\nRemove it from that user first.`
      );
    }
    const ok = store.adminSetTwitter(targetUserId, handle);
    session.clearSession(userId);
    if (!ok) return ctx.replyWithHTML(`<b>User not found:</b> <code>${targetUserId}</code>`);
    return ctx.replyWithHTML(
      `<b>Twitter Handle Updated</b>\n\nUser <code>${targetUserId}</code> → @${handle}\n<i>Handle is now locked.</i>`
    );
  }

  // ── wladd flow
  if (s.step === 'wladd_userId') {
    const uid = text.replace('@', '');
    const ok  = store.addToWhitelist(groupId, uid);
    session.clearSession(userId);
    return ctx.replyWithHTML(ok ? `<b>Whitelist</b>\n\n<code>${uid}</code> added.` : `Group not found.`);
  }

  // ── wlremove flow
  if (s.step === 'wlremove_userId') {
    const uid = text.replace('@', '');
    store.removeFromWhitelist(groupId, uid);
    session.clearSession(userId);
    return ctx.replyWithHTML(`<b>Whitelist</b>\n\n<code>${uid}</code> removed.`);
  }

  // ── ban/unban flows
  if (s.step === 'ban_userId') {
    const uid = text.replace('@', '');
    const ok  = store.banUser(uid);
    session.clearSession(userId);
    return ctx.replyWithHTML(ok ? `<b>Banned</b>\n\n<code>${uid}</code>` : `User not found.`);
  }
  if (s.step === 'unban_userId') {
    const uid = text.replace('@', '');
    const ok  = store.unbanUser(uid);
    session.clearSession(userId);
    return ctx.replyWithHTML(ok ? `<b>Unbanned</b>\n\n<code>${uid}</code>` : `User not found.`);
  }

  // ── Topic ID step
  if (s.step === 'set_topic_id') {
    const topicId = parseInt(text);
    if (isNaN(topicId)) return ctx.replyWithHTML(`<b>Invalid thread ID.</b> Send a numeric ID:`);
    store.setGroupTopic(s.groupId || groupId, s.topicType, topicId);
    session.clearSession(userId);
    return ctx.replyWithHTML(`<b>Topic Set</b>\n\n<b>${s.topicType}</b> → thread <code>${topicId}</code>`);
  }

  // ── add_email step
  if (s.step === 'add_email') {
    const email = text.trim();
    const gid   = s.groupId || groupId;
    const g     = store.getGroup(gid);
    if (g?.sheetId && g.sheetId !== 'none') {
      await sheets.shareSheet(g.sheetId, email);
    }
    session.clearSession(userId);
    return ctx.replyWithHTML(`<b>Email Added</b>\n\n<code>${email}</code> has been granted editor access to the sheet.`);
  }

  // ── set_link step
  if (s.step === 'set_link') {
    store.setGroupMeta(s.groupId || groupId, { groupLink: text });
    session.clearSession(userId);
    return ctx.replyWithHTML(`<b>Group Link Set</b>\n\n<code>${text}</code>`);
  }

  // ── announce step
  if (s.step === 'announce_text') {
    const gid      = s.groupId || groupId;
    const g        = store.getGroup(gid);
    const topicId  = g?.topics?.announcements || null;
    try {
      await ctx.telegram.sendMessage(gid, text, { message_thread_id: topicId || undefined });
      session.clearSession(userId);
      return ctx.replyWithHTML(`<b>Announcement sent.</b>`);
    } catch (e) {
      session.clearSession(userId);
      return ctx.replyWithHTML(`<b>Failed:</b> ${e.message}`);
    }
  }

  // ── dm_all step
  if (s.step === 'dm_all_text') {
    const users = store.getAllUsers();
    session.clearSession(userId);
    await ctx.replyWithHTML(`<b>DM All</b> — Sending to ${users.length} users…`);
    let sent = 0, failed = 0;
    for (const u of users) {
      try { await ctx.telegram.sendMessage(u.id, text); sent++; } catch { failed++; }
      await delay(50);
    }
    return ctx.replyWithHTML(`<b>Done</b> — Delivered: ${sent}  Failed: ${failed}`);
  }

  // ── Task wizard flow ──────────────────────────────────────────────────────

  const isTask = ['task', 'raid'].includes(s.taskKind);
  if (!isTask) return next();

  // Step: title
  if (s.step === 'await_title') {
    const isComment = s.taskTypes ? s.taskTypes.includes('comment') : s.taskType === 'comment';
    const isQuote   = s.taskTypes ? s.taskTypes.includes('quote')   : s.taskType === 'quote';
    const stepNum   = s.taskKind === 'raid' ? '4 of 7' : '4 of 6';
    session.setSession(userId, { ...s, step: 'await_link', title: text });
    return ctx.replyWithHTML(
      `Title saved.\n\n<b>Step ${stepNum}</b> — Paste the <b>Twitter/X link</b> (tweet or profile URL):\n<i>Or send "none" to skip.</i>`,
      cancelKeyboard()
    );
  }

  // Step: link
  if (s.step === 'await_link') {
    const link          = text.toLowerCase() === 'none' ? '' : text;
    const hasComment    = s.taskTypes ? s.taskTypes.includes('comment') : s.taskType === 'comment';
    const hasQuote      = s.taskTypes ? s.taskTypes.includes('quote')   : s.taskType === 'quote';
    const needsMinChars = hasComment || hasQuote;
    const stepLabel     = needsMinChars
      ? (s.taskKind === 'raid' ? '5 of 7' : '5 of 6')
      : (s.taskKind === 'raid' ? '5 of 7' : '5 of 6');

    if (needsMinChars) {
      session.setSession(userId, { ...s, step: 'await_min_chars', link });
      return ctx.replyWithHTML(
        `Link saved.\n\n<b>Step ${stepLabel}</b> — Set <b>minimum comment characters</b>:\n<i>Send 0 for no minimum.</i>`,
        cancelKeyboard()
      );
    }

    session.setSession(userId, { ...s, step: 'await_reward', link });
    return ctx.replyWithHTML(
      `Link saved.\n\n<b>Step ${stepLabel}</b> — Set the <b>reward points</b>:`,
      cancelKeyboard()
    );
  }

  // Step: minChars
  if (s.step === 'await_min_chars') {
    const minChars = parseInt(text) || 0;
    const stepNum  = s.taskKind === 'raid' ? '6 of 7' : '6 of 6';
    session.setSession(userId, { ...s, step: 'await_reward', minChars });
    return ctx.replyWithHTML(`<b>Step ${stepNum}</b> — Set the <b>reward points</b>:`, cancelKeyboard());
  }

  // Step: reward
  if (s.step === 'await_reward') {
    const reward = parseInt(text);
    if (isNaN(reward) || reward < 1) return ctx.replyWithHTML(`<b>Invalid.</b> Enter a positive number:`);
    if (s.taskKind === 'raid') {
      session.setSession(userId, { ...s, step: 'await_duration', reward });
      return ctx.replyWithHTML(
        `<b>Step 7 of 7</b> — Set <b>raid duration in minutes</b> (1–1440):\n<i>Example: 60 for 1 hour, 1440 for 24 hours.</i>`,
        cancelKeyboard()
      );
    }
    // Create task immediately
    await createTaskFromSession(ctx, { ...s, reward });
    return;
  }

  // Step: duration (raid only)
  if (s.step === 'await_duration') {
    const dur = parseInt(text);
    if (isNaN(dur) || dur < 1 || dur > 1440) {
      return ctx.replyWithHTML(`<b>Invalid.</b> Enter minutes between 1 and 1440:`);
    }
    await createTaskFromSession(ctx, { ...s, durationMinutes: dur });
    return;
  }

  return next();
}

async function createTaskFromSession(ctx, s) {
  const userId  = ctx.from.id;
  const groupId = s.groupId;

  const taskTypes   = s.taskTypes || null;
  const primaryType = taskTypes?.[0] || s.taskType || 'like';
  const platform    = s.platform || 'twitter';
  const buttonLabel = taskTypes?.length > 1
    ? taskTypes.map(t => TASK_TYPE_LABELS[t] || t).join(' + ')
    : (TASK_TYPE_LABELS[primaryType] || primaryType);

  const task = store.createTask(
    groupId,
    s.title,
    s.link || '',
    s.reward,
    s.taskKind,
    buttonLabel,
    platform,
    primaryType,
    taskTypes,
    s.minChars || 0,
    s.durationMinutes || null
  );

  session.clearSession(userId);

  const typeLabel = taskTypes?.length > 1
    ? taskTypes.map(t => TASK_TYPE_LABELS[t] || t).join(' + ')
    : (TASK_TYPE_LABELS[primaryType] || primaryType);

  const botName = getBotUsername() || 'bot';
  const g = store.getGroup(groupId);

  const summary =
    `<b>${s.taskKind === 'raid' ? '⚡ Raid Created' : '📋 Task Created'}</b>\n${'─'.repeat(26)}\n` +
    `<b>Title:</b> ${s.title}\n` +
    `<b>Type:</b> ${typeLabel}\n` +
    `<b>Reward:</b> ${s.reward} pts\n` +
    (s.link ? `<b>Link:</b> ${s.link}\n` : '') +
    (s.minChars > 0 ? `<b>Min chars:</b> ${s.minChars}\n` : '') +
    (task.expiresAt ? `<b>Expires:</b> ${new Date(task.expiresAt).toUTCString()}\n` : '') +
    `<b>Task ID:</b> ${task.id}`;

  await ctx.replyWithHTML(summary);

  // Post to group
  const topicId = g?.topics?.[s.taskKind === 'raid' ? 'raids' : 'quests'] || null;
  const groupMsg =
    `<b>${s.taskKind === 'raid' ? '⚡ New Raid' : '📋 New Task'}: ${s.title}</b>\n` +
    `Type: ${typeLabel} | Reward: ${s.reward} pts\n` +
    (task.expiresAt ? `Ends: ${new Date(task.expiresAt).toUTCString()}` : '');

  try {
    await ctx.telegram.sendMessage(groupId, groupMsg, {
      parse_mode: 'HTML',
      message_thread_id: topicId || undefined,
      ...taskCardDMKeyboard(task.id, s.link, buttonLabel, botName),
    });
  } catch (e) {
    console.error('[Admin] Failed to post task to group:', e.message);
  }
}

function startFlow(ctx, extra, promptText) {
  const groupId = resolveAdminGroup(ctx);
  const userId  = ctx.from.id;
  session.setSession(userId, { adminFlow: true, groupId, ...extra });
  return ctx.replyWithHTML(promptText, cancelKeyboard());
}

// ── register ──────────────────────────────────────────────────────────────────

function register(bot) {

  bot.use(handleAdminSessionInput);

  // Commands
  bot.command('admin', adminOnly, (ctx) => sendAdminPanel(ctx, resolveAdminGroup(ctx)));

  bot.command('commands', adminOnly, async (ctx) => {
    await ctx.replyWithHTML(
      `<b>Admin Commands</b>\n${'─'.repeat(28)}\n\n` +
      `/admin — Open admin panel\n` +
      `/commands — Show this list\n` +
      `/changeusertwitter &lt;userId&gt; @handle — Override Twitter handle\n` +
      `  <i>Example: /changeusertwitter 123456789 @newhandle</i>\n` +
      `/wladd &lt;userId&gt; — Add to whitelist\n` +
      `/wlremove &lt;userId&gt; — Remove from whitelist`
    );
  });

  bot.command('changeusertwitter', adminOnly, async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length >= 2) {
      const targetUserId = args[0];
      const handle       = args[1].replace(/^@/, '').toLowerCase();
      if (!handle || !/^[a-z0-9_]{1,50}$/i.test(handle)) {
        return ctx.replyWithHTML(`<b>Invalid handle.</b>\n\nUsage: /changeusertwitter &lt;userId&gt; @handle\n<i>Example: /changeusertwitter 123456789 @newhandle</i>`);
      }
      const conflict = store.checkTwitterUsernameConflict(handle, targetUserId);
      if (conflict) {
        return ctx.replyWithHTML(
          `<b>Conflict</b>\n\n@${handle} is already linked to user <code>${conflict.id}</code> (@${conflict.username}).\n\nRemove it from that account first.`
        );
      }
      const ok = store.adminSetTwitter(targetUserId, handle);
      if (!ok) return ctx.replyWithHTML(`<b>User not found:</b> <code>${targetUserId}</code>`);
      return ctx.replyWithHTML(`<b>Twitter Handle Updated</b>\n\nUser <code>${targetUserId}</code> → @${handle}\n<i>Handle is now locked.</i>`);
    }
    // Start wizard
    session.setSession(ctx.from.id, { adminFlow: true, step: 'changeusertwitter_userId' });
    await ctx.replyWithHTML(
      `<b>Change User Twitter Handle</b>\n${'─'.repeat(28)}\n\n` +
      `<b>Usage:</b> /changeusertwitter &lt;userId&gt; @handle\n` +
      `<i>Example: /changeusertwitter 123456789 @newhandle</i>\n\n` +
      `<b>Step 1/2</b> — Send the user's <b>Telegram ID</b>:`,
      cancelKeyboard()
    );
  });

  bot.command('wladd', adminOnly, async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    const groupId = resolveAdminGroup(ctx);
    if (args[0]) {
      const uid = args[0].replace('@', '');
      store.addToWhitelist(groupId, uid);
      return ctx.replyWithHTML(`<b>Whitelist</b>\n\n<code>${uid}</code> added.`);
    }
    startFlow(ctx, { step: 'wladd_userId' }, `<b>WL Add</b>\n\nSend the user's Telegram ID or @username:`);
  });

  bot.command('wlremove', adminOnly, async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    const groupId = resolveAdminGroup(ctx);
    if (args[0]) {
      const uid = args[0].replace('@', '');
      store.removeFromWhitelist(groupId, uid);
      return ctx.replyWithHTML(`<b>Whitelist</b>\n\n<code>${uid}</code> removed.`);
    }
    startFlow(ctx, { step: 'wlremove_userId' }, `<b>WL Remove</b>\n\nSend the user's Telegram ID or @username:`);
  });

  // ── Callback: Group selector ──────────────────────────────────────────────

  bot.action(/^admin_select_group_(.+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = ctx.match[1];
    store.setAdminContext(ctx.from.id, groupId);
    await sendAdminPanel(ctx, groupId, true);
  });

  bot.action('admin_switch_group', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groups = store.getGroupsForAdmin(ctx.from.id);
    await ctx.replyWithHTML(`<b>Select a group:</b>`, groupSelectorKeyboard(groups));
  });

  // ── Task/Raid creation wizard ─────────────────────────────────────────────

  bot.action('admin_create_task', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    session.setSession(ctx.from.id, { adminFlow: true, taskKind: 'task', groupId, step: 'await_platform' });
    await ctx.replyWithHTML(`<b>New Task — Step 1 of 6</b>\n\nSelect the <b>platform</b>:`, platformSelectKeyboard('task'));
  });

  bot.action('admin_create_raid', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    session.setSession(ctx.from.id, { adminFlow: true, taskKind: 'raid', groupId, step: 'await_platform' });
    await ctx.replyWithHTML(`<b>New Raid — Step 1 of 7</b>\n\nSelect the <b>platform</b>:`, platformSelectKeyboard('raid'));
  });

  // Platform selected → show action selector
  bot.action(/^admin_platform_(task|raid)_(twitter|telegram)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const kind     = ctx.match[1];
    const platform = ctx.match[2];
    const s        = session.getSession(ctx.from.id) || {};
    session.setSession(ctx.from.id, { ...s, platform, step: 'await_actions' });

    if (platform === 'twitter') {
      await ctx.replyWithHTML(
        `<b>Step 2 of ${kind === 'raid' ? '7' : '6'}</b> — Select <b>action type</b>:\n\n` +
        `<i>⚠️ Like and Follow must be standalone tasks (cannot be combined).</i>`,
        twitterMultiActionKeyboard({})
      );
    } else {
      // Telegram: single action only
      await ctx.replyWithHTML(
        `<b>Step 2 of ${kind === 'raid' ? '7' : '6'}</b> — Select <b>Telegram action</b>:`,
        taskTypeKeyboard(kind, false)
      );
    }
  });

  // Twitter multi-action toggle
  bot.action(/^admin_ttoggle_(follow|like|retweet|comment|quote)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const key = ctx.match[1];
    const s   = session.getSession(ctx.from.id) || {};
    const sel = s.selectedActions || {};

    // Standalone check
    if (STANDALONE.includes(key) && Object.keys(sel).some(k => k !== key)) {
      return ctx.answerCbQuery('Like and Follow must be standalone. Remove other actions first.', { show_alert: true });
    }
    if (!STANDALONE.includes(key) && Object.keys(sel).some(k => STANDALONE.includes(k))) {
      return ctx.answerCbQuery('Like and Follow must be standalone. Deselect them first.', { show_alert: true });
    }

    if (sel[key]) {
      delete sel[key];
    } else {
      sel[key] = true;
    }

    session.setSession(ctx.from.id, { ...s, selectedActions: sel });
    try {
      await ctx.editMessageReplyMarkup(twitterMultiActionKeyboard(sel).reply_markup);
    } catch {}
  });

  // Twitter multi-action confirm
  bot.action('admin_tconfirm', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const s   = session.getSession(ctx.from.id) || {};
    const sel = s.selectedActions || {};
    const chosen = Object.keys(sel);

    if (!chosen.length) return ctx.answerCbQuery('Select at least one action.', { show_alert: true });

    // Standalone validation at confirm time
    if (chosen.length > 1 && chosen.some(k => STANDALONE.includes(k))) {
      return ctx.answerCbQuery(
        'Like and Follow tasks must be standalone. They cannot be combined with other actions.',
        { show_alert: true }
      );
    }

    session.setSession(ctx.from.id, {
      ...s,
      taskTypes: chosen,
      taskType:  chosen[0],
      step:      'await_title',
    });
    const stepNum = s.taskKind === 'raid' ? '3 of 7' : '3 of 6';
    await ctx.replyWithHTML(
      `Actions: <b>${chosen.map(k => TASK_TYPE_LABELS[k] || k).join(' + ')}</b>\n\n<b>Step ${stepNum}</b> — Enter the task <b>title</b>:`,
      cancelKeyboard()
    );
  });

  // Telegram task type directly selected
  bot.action(/^admin_tasktype_(task|raid)_(join|react|send|like|follow|retweet|comment|quote)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const kind     = ctx.match[1];
    const taskType = ctx.match[2];
    const s        = session.getSession(ctx.from.id) || {};
    session.setSession(ctx.from.id, { ...s, taskType, taskTypes: null, step: 'await_title' });
    const stepNum = kind === 'raid' ? '3 of 7' : '3 of 6';
    await ctx.replyWithHTML(
      `Action: <b>${TASK_TYPE_LABELS[taskType] || taskType}</b>\n\n<b>Step ${stepNum}</b> — Enter the task <b>title</b>:`,
      cancelKeyboard()
    );
  });

  // ── View / delete tasks ───────────────────────────────────────────────────

  bot.action('admin_view_tasks', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    const tasks = store.getTasksForGroup(groupId, 'task');
    const raids = store.getTasksForGroup(groupId, 'raid');
    if (!tasks.length && !raids.length) return ctx.replyWithHTML(`<b>No active tasks or raids.</b>`);
    const formatList = (items, label) => items.length
      ? `<b>${label}</b>\n` + items.map(t => `• [${t.id}] ${t.title} — ${t.reward}pts`).join('\n')
      : '';
    const lines = [formatList(tasks, 'Tasks'), formatList(raids, 'Raids')].filter(Boolean).join('\n\n');
    await ctx.replyWithHTML(lines);
  });

  bot.action('admin_delete_task_menu', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    const tasks = store.getAllTasksForGroup(groupId).filter(t => t.active);
    if (!tasks.length) return ctx.replyWithHTML(`<b>No active tasks to delete.</b>`);
    await ctx.replyWithHTML(`<b>Select a task to delete:</b>`, taskDeleteKeyboard(tasks));
  });

  bot.action(/^del_task_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const taskId = parseInt(ctx.match[1]);
    const ok = store.deactivateTask(taskId);
    await ctx.replyWithHTML(ok ? `<b>Task Deleted</b>\n\nTask #${taskId} has been deactivated.` : `Task not found.`);
  });

  // ── Users management ──────────────────────────────────────────────────────

  bot.action('admin_view_users', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const users = store.getAllUsers().filter(u => !u.banned).slice(0, 20);
    if (!users.length) return ctx.replyWithHTML(`<b>No users yet.</b>`);
    const lines = users.map(u =>
      `• <code>${u.id}</code> @${u.username || '?'} — ${u.points}pts${u.twitter ? ` | @${u.twitter}` : ''}`
    ).join('\n');
    await ctx.replyWithHTML(`<b>Users (first 20)</b>\n\n${lines}`);
  });

  bot.action('admin_ban', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'ban_userId' }, `<b>Ban User</b>\n\nSend the user's Telegram ID:`);
  });

  bot.action('admin_unban', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'unban_userId' }, `<b>Unban User</b>\n\nSend the user's Telegram ID:`);
  });

  bot.action('admin_add_admin', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'wladd_userId' }, `<b>Add Admin</b>\n\nSend the user's Telegram ID to grant admin access:`);
  });

  bot.action('admin_rem_admin', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'wlremove_userId' }, `<b>Remove Admin</b>\n\nSend the user's Telegram ID to revoke admin access:`);
  });

  // ── WL ────────────────────────────────────────────────────────────────────

  bot.action('admin_wl_add', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'wladd_userId' }, `<b>WL Add</b>\n\nSend the user's Telegram ID or @username:`);
  });

  bot.action('admin_wl_remove', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'wlremove_userId' }, `<b>WL Remove</b>\n\nSend the user's Telegram ID or @username:`);
  });

  bot.action('admin_wl_view', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    const g = store.getGroup(groupId);
    const wl = g?.whitelist || [];
    if (!wl.length) return ctx.replyWithHTML(`<b>Whitelist</b>\n\n<i>Empty.</i>`);
    await ctx.replyWithHTML(`<b>Whitelist</b> (${wl.length})\n\n${wl.map(id => `• <code>${id}</code>`).join('\n')}`);
  });

  // ── Access mode ───────────────────────────────────────────────────────────

  bot.action('admin_mode_all', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery('Mode: All');
    store.setAccessMode(resolveAdminGroup(ctx), 'all');
    await ctx.replyWithHTML(`<b>Mode set to: All</b>`);
  });

  bot.action('admin_mode_group', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery('Mode: Group');
    store.setAccessMode(resolveAdminGroup(ctx), 'group');
    await ctx.replyWithHTML(`<b>Mode set to: Group</b>`);
  });

  bot.action('admin_mode_whitelist', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery('Mode: Whitelist');
    store.setAccessMode(resolveAdminGroup(ctx), 'whitelist');
    await ctx.replyWithHTML(`<b>Mode set to: Whitelist</b>`);
  });

  // ── Announce / DM all ─────────────────────────────────────────────────────

  bot.action('admin_announce', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'announce_text' }, `<b>Announce</b>\n\nSend the message to post in the group:`);
  });

  bot.action('admin_dm_all', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'dm_all_text' }, `<b>DM All Users</b>\n\nSend the message to DM to all users:`);
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  bot.action('admin_stats', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const groupId = resolveAdminGroup(ctx);
    if (!groupId) return ctx.reply('No group selected.');
    const s   = store.getGroupStats(groupId);
    const g   = store.getGroup(groupId);
    const wlN = (g?.whitelist || []).length;
    await ctx.replyWithHTML(
      `<b>Stats — ${g?.groupName || groupId}</b>\n${'─'.repeat(28)}\n` +
      `Tasks: ${s.activeTasks}/${s.totalTasks}  Raids: ${s.activeRaids}/${s.totalRaids}\n` +
      `Pending: ${s.pendingSubmissions}  Approved: ${s.approvedSubmissions}\n` +
      `Users: ${s.totalUsers}  Banned: ${s.bannedUsers}\n` +
      `Mode: ${g?.accessMode}  Whitelist: ${wlN} users`
    );
  });

  // ── Topics / link ─────────────────────────────────────────────────────────

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

  bot.action('admin_set_link', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'set_link' }, `<b>Set Group Link</b>\n\nSend the invite link:`);
  });

  bot.action('admin_add_email', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    startFlow(ctx, { step: 'add_email' }, `<b>Add Sheet Email</b>\n\nSend the Gmail address:`);
  });

  bot.action('admin_close', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  // ── Approve / Reject submissions ──────────────────────────────────────────

  bot.action(/^approve_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const subId = parseInt(ctx.match[1]);
    const sub   = store.approveSubmission(subId);
    if (!sub) {
      await ctx.answerCbQuery('Already processed.', { show_alert: false });
      try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
      return;
    }
    await ctx.answerCbQuery('Approved');
    store.addPoints(sub.userId, sub.points);
    store.setUserField(sub.userId, 'tasksCompleted', (store.getUser(sub.userId)?.tasksCompleted || 0) + 1);
    try {
      await ctx.telegram.sendMessage(sub.userId,
        `<b>✅ Submission Approved!</b>\n\n${sub.taskTitle}\n<b>+${sub.points} points</b> added to your account.`,
        { parse_mode: 'HTML' }
      );
    } catch {}
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}

    // Sheets logging
    const task = store.getTask(sub.taskId);
    const user = store.getUser(sub.userId);
    const group = store.getGroup(sub.groupId);
    if (group?.sheetId) {
      sheets.onCompletion(group.sheetId, { user: { ...user, id: sub.userId }, task: task || { id: sub.taskId, title: sub.taskTitle, taskType: '', reward: sub.points }, isRaid: task?.type === 'raid' }).catch(() => {});
    }
  });

  bot.action(/^reject_(\d+)$/, async (ctx) => {
    if (!adminGuard(ctx)) return;
    const subId = parseInt(ctx.match[1]);
    const sub   = store.rejectSubmission(subId);
    if (!sub) {
      await ctx.answerCbQuery('Already processed.', { show_alert: false });
      try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
      return;
    }
    await ctx.answerCbQuery('Rejected');
    try {
      await ctx.telegram.sendMessage(sub.userId,
        `<b>❌ Submission Rejected</b>\n\n${sub.taskTitle}\n\n<i>Contact an admin if you think this was a mistake.</i>`,
        { parse_mode: 'HTML' }
      );
    } catch {}
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  });
}

module.exports = { register };
