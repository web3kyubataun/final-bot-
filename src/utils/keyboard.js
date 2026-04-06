const { Markup } = require('telegraf');

// ═══════════════════════════════════════════════
//  USER KEYBOARDS
// ═══════════════════════════════════════════════

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['🎯 Tasks', '⚡ Raids'],
    ['🏆 Leaderboard', '👤 My Profile'],
    ['⚙️ Settings', '❓ Help'],
  ]).resize();
}

function profileKeyboard(user) {
  const notifBtn = user?.notifications === false ? '🔔 Enable Notifs' : '🔕 Disable Notifs';
  return Markup.inlineKeyboard([
    [Markup.button.callback('🐦 Twitter', 'set_twitter'), Markup.button.callback('👛 Wallet', 'set_wallet')],
    [Markup.button.callback('💬 Discord', 'set_discord'), Markup.button.callback(notifBtn, 'toggle_notif')],
    [Markup.button.callback('🔄 Refresh', 'refresh_profile'), Markup.button.callback('✖️ Close', 'close_msg')],
  ]);
}

function settingsKeyboard(user) {
  const notifBtn = user?.notifications === false ? '🔔 Enable Notifs' : '🔕 Disable Notifs';
  return Markup.inlineKeyboard([
    [Markup.button.callback('🐦 Set Twitter', 'set_twitter'), Markup.button.callback('👛 Set Wallet', 'set_wallet')],
    [Markup.button.callback('💬 Set Discord', 'set_discord')],
    [Markup.button.callback(notifBtn, 'toggle_notif')],
    [Markup.button.callback('✖️ Close', 'close_msg')],
  ]);
}

/** Task card shown IN DM — has open link + submit button */
function taskCardKeyboard(taskId, taskLink, btnLabel) {
  const rows = [];
  if (taskLink) rows.push([Markup.button.url(`🔗 ${btnLabel || 'Open Link'}`, taskLink)]);
  rows.push([Markup.button.callback('📤 Submit Proof', `do_submit_${taskId}`)]);
  return Markup.inlineKeyboard(rows);
}

/** Task card shown IN GROUP — open link + "Submit in DM" URL button */
function taskCardDMKeyboard(taskId, taskLink, btnLabel, botUsername) {
  const rows = [];
  if (taskLink) rows.push([Markup.button.url(`🔗 ${btnLabel || 'Open Link'}`, taskLink)]);
  rows.push([
    Markup.button.url(
      '📬 Submit in DM',
      `https://t.me/${botUsername}?start=submit_${taskId}`
    )
  ]);
  return Markup.inlineKeyboard(rows);
}

function taskListKeyboard(tasks) {
  if (!tasks.length) return null;
  return Markup.inlineKeyboard(
    tasks.map(t => [Markup.button.callback(
      `${t.type === 'raid' ? '⚡' : '🎯'} ${t.title}  ·  +${t.reward}pts`,
      `view_task_${t.id}`
    )])
  );
}

function approvalKeyboard(subId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅  Approve', `approve_${subId}`), Markup.button.callback('❌  Reject', `reject_${subId}`)],
  ]);
}

function cancelKeyboard(label = '❌ Cancel') {
  return Markup.inlineKeyboard([[Markup.button.callback(label, 'cancel_flow')]]);
}

// ═══════════════════════════════════════════════
//  ADMIN KEYBOARDS  (RoseBot-style)
// ═══════════════════════════════════════════════

function adminMainKeyboard(groupName, canSwitch = false) {
  const kb = [
    // ── Campaigns ───────────────────────────────────────
    [Markup.button.callback('▸ CAMPAIGNS', 'admin_section_campaigns')],
    [Markup.button.callback('📝 Create Task', 'admin_create_task'), Markup.button.callback('⚡ Create Raid', 'admin_create_raid')],
    [Markup.button.callback('📊 View Tasks', 'admin_view_tasks'), Markup.button.callback('🗑 Delete Task', 'admin_delete_task_menu')],

    // ── Submissions ──────────────────────────────────────
    [Markup.button.callback('▸ SUBMISSIONS', 'admin_section_subs')],
    [Markup.button.callback('⏳ Pending', 'admin_subs_pending'), Markup.button.callback('✅ Approved', 'admin_subs_approved'), Markup.button.callback('❌ Rejected', 'admin_subs_rejected')],

    // ── Broadcast ────────────────────────────────────────
    [Markup.button.callback('▸ BROADCAST', 'admin_section_bc')],
    [Markup.button.callback('📣 Announce', 'admin_announce'), Markup.button.callback('📨 DM All', 'admin_dm_all')],

    // ── Users ────────────────────────────────────────────
    [Markup.button.callback('▸ USERS', 'admin_section_users')],
    [Markup.button.callback('👥 View Users', 'admin_view_users'), Markup.button.callback('🚫 Ban', 'admin_ban'), Markup.button.callback('✅ Unban', 'admin_unban')],
    [Markup.button.callback('➕ Add Admin', 'admin_add_admin'), Markup.button.callback('➖ Remove Admin', 'admin_rem_admin')],

    // ── Access control ────────────────────────────────────
    [Markup.button.callback('▸ ACCESS CONTROL', 'admin_section_access')],
    [Markup.button.callback('🌐 All', 'admin_mode_all'), Markup.button.callback('👥 Group Only', 'admin_mode_group'), Markup.button.callback('📋 Whitelist', 'admin_mode_whitelist')],

    // ── Setup ─────────────────────────────────────────────
    [Markup.button.callback('▸ SETUP & SETTINGS', 'admin_section_setup')],
    [Markup.button.callback('📌 Topics', 'admin_setup_topics'), Markup.button.callback('📧 Add Email', 'admin_add_email')],
    [Markup.button.callback('📊 Stats', 'admin_stats'), Markup.button.callback('🔗 Set Link', 'admin_set_link')],
  ];

  // Switch group + close
  if (canSwitch) {
    kb.push([Markup.button.callback('🔄 Switch Group', 'admin_switch_group'), Markup.button.callback('✖️ Close', 'admin_close')]);
  } else {
    kb.push([Markup.button.callback('✖️ Close Panel', 'admin_close')]);
  }

  return Markup.inlineKeyboard(kb);
}

function taskDeleteKeyboard(tasks) {
  const rows = tasks.map(t => [
    Markup.button.callback(`🗑 [#${t.id}] ${t.type === 'raid' ? '⚡' : '🎯'} ${t.title}`, `del_task_${t.id}`)
  ]);
  rows.push([Markup.button.callback('🔙 Back', 'back_admin')]);
  return Markup.inlineKeyboard(rows);
}

function topicsSetupKeyboard() {
  const types = [
    ['getstarted', '🚀 Get Started'], ['notifications', '🔔 Notifications'],
    ['quests', '🎯 Quests'],         ['raids', '⚡ Raids'],
    ['leaderboard', '🏆 Leaderboard'],['connect', '🐦 Connect'],
    ['announcements', '📢 Announcements'], ['submissions', '📋 Submissions'],
    ['general', '💬 General'],
  ];
  const rows = types.map(([type, label]) => [Markup.button.callback(label, `set_topic_${type}`)]);
  rows.push([Markup.button.callback('🔙 Back', 'back_admin')]);
  return Markup.inlineKeyboard(rows);
}

function groupSelectorKeyboard(groups) {
  return Markup.inlineKeyboard(
    groups.map(g => [Markup.button.callback(`📋 ${g.name || g.id}`, `select_group_${g.id}`)])
  );
}

function switchGroupKeyboard(groups) {
  return groupSelectorKeyboard(groups);
}

module.exports = {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskCardKeyboard, taskCardDMKeyboard, taskListKeyboard,
  approvalKeyboard, cancelKeyboard,
  adminMainKeyboard, taskDeleteKeyboard, topicsSetupKeyboard,
  groupSelectorKeyboard, switchGroupKeyboard,
};
