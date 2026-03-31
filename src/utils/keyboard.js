const { Markup } = require('telegraf');

// ═══════════════════════════════════════════════════════
//  DIVIDERS & HELPERS
// ═══════════════════════════════════════════════════════
const D = '▸'; // section arrow

// ═══════════════════════════════════════════════════════
//  USER KEYBOARDS
// ═══════════════════════════════════════════════════════

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['🎯 Tasks', '⚡ Raids'],
    ['🏆 Leaderboard', '👤 My Profile'],
    ['⚙️ Settings', '❓ Help'],
  ]).resize();
}

function profileKeyboard(user) {
  const notifBtn = user?.notifications === false
    ? '🔔 Enable Notifications'
    : '🔕 Disable Notifications';
  return Markup.inlineKeyboard([
    [Markup.button.callback('🐦 Set Twitter', 'set_twitter'), Markup.button.callback('👛 Set Wallet', 'set_wallet')],
    [Markup.button.callback('💬 Set Discord', 'set_discord'), Markup.button.callback(notifBtn, 'toggle_notif')],
    [Markup.button.callback('🔄 Refresh', 'refresh_profile'), Markup.button.callback('❌ Close', 'close_msg')],
  ]);
}

function settingsKeyboard(user) {
  const notifBtn = user?.notifications === false
    ? '🔔 Enable Notifications'
    : '🔕 Disable Notifications';
  return Markup.inlineKeyboard([
    [Markup.button.callback(notifBtn, 'toggle_notif')],
    [Markup.button.callback('🐦 Set Twitter', 'set_twitter'), Markup.button.callback('👛 Set Wallet', 'set_wallet')],
    [Markup.button.callback('💬 Set Discord', 'set_discord')],
    [Markup.button.callback('❌ Close', 'close_msg')],
  ]);
}

function taskCardKeyboard(taskId, taskLink, btnLabel) {
  const rows = [];
  if (taskLink) rows.push([Markup.button.url(`🔗 ${btnLabel || 'Open Link'}`, taskLink)]);
  rows.push([Markup.button.callback('📤 Submit Proof', `do_submit_${taskId}`)]);
  return Markup.inlineKeyboard(rows);
}

function taskListKeyboard(tasks) {
  if (!tasks.length) return null;
  return Markup.inlineKeyboard(
    tasks.map(t => [Markup.button.callback(
      `${t.type === 'raid' ? '⚡' : '🎯'} ${t.title}  ·  +${t.reward} pts`,
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

// ═══════════════════════════════════════════════════════
//  ADMIN KEYBOARDS  (RoseBot-style)
// ═══════════════════════════════════════════════════════

function adminMainKeyboard(groupName) {
  return Markup.inlineKeyboard([
    // Header row (info only via noop)
    [Markup.button.callback(`📋 CAMPAIGNS`, 'admin_section_campaigns')],
    [Markup.button.callback('📝 Create Task', 'admin_create_task'), Markup.button.callback('⚡ Create Raid', 'admin_create_raid')],
    [Markup.button.callback('📊 View Tasks', 'admin_view_tasks'), Markup.button.callback('🗑 Delete Task', 'admin_delete_task_menu')],

    [Markup.button.callback(`📬 SUBMISSIONS`, 'admin_section_subs')],
    [Markup.button.callback('⏳ Pending', 'admin_subs_pending'), Markup.button.callback('✅ Approved', 'admin_subs_approved'), Markup.button.callback('❌ Rejected', 'admin_subs_rejected')],

    [Markup.button.callback(`📢 BROADCAST`, 'admin_section_bc')],
    [Markup.button.callback('📣 Announce to Group', 'admin_announce'), Markup.button.callback('📨 DM All Users', 'admin_dm_all')],

    [Markup.button.callback(`👤 USERS`, 'admin_section_users')],
    [Markup.button.callback('👥 View Users', 'admin_view_users'), Markup.button.callback('🚫 Ban User', 'admin_ban'), Markup.button.callback('✅ Unban', 'admin_unban')],
    [Markup.button.callback('➕ Add Admin', 'admin_add_admin'), Markup.button.callback('➖ Remove Admin', 'admin_rem_admin')],

    [Markup.button.callback(`🔐 ACCESS CONTROL`, 'admin_section_access')],
    [Markup.button.callback('🌐 All', 'admin_mode_all'), Markup.button.callback('👥 Group Only', 'admin_mode_group'), Markup.button.callback('📋 Whitelist', 'admin_mode_whitelist')],

    [Markup.button.callback(`⚙️ SETUP & SETTINGS`, 'admin_section_setup')],
    [Markup.button.callback('📌 Setup Topics', 'admin_setup_topics'), Markup.button.callback('📧 Add Email', 'admin_add_email')],
    [Markup.button.callback('📊 Group Stats', 'admin_stats'), Markup.button.callback('🔗 Set Group Link', 'admin_set_link')],

    [Markup.button.callback('✖️  Close Panel', 'admin_close')],
  ]);
}

function taskDeleteKeyboard(tasks) {
  const rows = tasks.map(t => [
    Markup.button.callback(`🗑 [${t.id}] ${t.type === 'raid' ? '⚡' : '🎯'} ${t.title}`, `del_task_${t.id}`)
  ]);
  rows.push([Markup.button.callback('🔙 Back', 'back_admin')]);
  return Markup.inlineKeyboard(rows);
}

function topicsSetupKeyboard(groupId) {
  const types = [
    ['getstarted', '🚀 Get Started'],
    ['notifications', '🔔 Notifications'],
    ['quests', '🎯 Quests'],
    ['raids', '⚡ Raids'],
    ['leaderboard', '🏆 Leaderboard'],
    ['connect', '🐦 Connect'],
    ['announcements', '📢 Announcements'],
    ['submissions', '📋 Submissions'],
    ['general', '💬 General'],
  ];
  const rows = types.map(([type, label]) => [
    Markup.button.callback(`${label}`, `set_topic_${type}`)
  ]);
  rows.push([Markup.button.callback('🔙 Back', 'back_admin')]);
  return Markup.inlineKeyboard(rows);
}

function groupSelectorKeyboard(groups) {
  const rows = groups.map(g => [
    Markup.button.callback(`📋 ${g.name || g.id}`, `select_group_${g.id}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskCardKeyboard, taskListKeyboard, approvalKeyboard, cancelKeyboard,
  adminMainKeyboard, taskDeleteKeyboard, topicsSetupKeyboard, groupSelectorKeyboard,
};
