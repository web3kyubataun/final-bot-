const { Markup } = require('telegraf');

// ═══════════════════════════════════════════════
//  USER KEYBOARDS
// ═══════════════════════════════════════════════

/** Persistent bottom keyboard for all users */
function mainMenuKeyboard() {
  return Markup.keyboard([
    ['🎯 Tasks', '⚡ Raids'],
    ['🏆 Leaderboard', '👤 My Profile'],
    ['⚙️ Settings'],
  ]).resize();
}

/** Profile page inline buttons */
function profileKeyboard(user) {
  const notifLabel = user.notifications === false ? '🔔 Enable Notifications' : '🔕 Disable Notifications';
  return Markup.inlineKeyboard([
    [Markup.button.callback('🐦 Set Twitter', 'set_twitter'), Markup.button.callback('👛 Set Wallet', 'set_wallet')],
    [Markup.button.callback(notifLabel, 'toggle_notif')],
    [Markup.button.callback('🔄 Refresh Stats', 'refresh_profile')],
  ]);
}

/** Settings page inline buttons */
function settingsKeyboard(user) {
  const notifLabel = user.notifications === false ? '🔔 Enable Notifications' : '🔕 Disable Notifications';
  return Markup.inlineKeyboard([
    [Markup.button.callback(notifLabel, 'toggle_notif')],
    [Markup.button.callback('🐦 Update Twitter', 'set_twitter'), Markup.button.callback('👛 Update Wallet', 'set_wallet')],
    [Markup.button.callback('❌ Close', 'close_msg')],
  ]);
}

/** Task card submit button */
function taskCardKeyboard(taskId, taskLink) {
  return Markup.inlineKeyboard([
    [Markup.button.url('🔗 Open Link', taskLink)],
    [Markup.button.callback('📤 Submit Proof', `do_submit_${taskId}`)],
  ]);
}

/** Task list inline buttons */
function taskListKeyboard(tasks) {
  if (!tasks.length) return null;
  const buttons = tasks.map(t => [
    Markup.button.callback(
      `${t.type === 'raid' ? '⚡' : '🎯'} ${t.title}  •  +${t.reward} pts`,
      `view_task_${t.id}`
    ),
  ]);
  return Markup.inlineKeyboard(buttons);
}

/** Proof submission confirmation */
function approvalKeyboard(submissionId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅  Approve', `approve_${submissionId}`),
      Markup.button.callback('❌  Reject', `reject_${submissionId}`),
    ],
  ]);
}

// ═══════════════════════════════════════════════
//  ADMIN KEYBOARDS
// ═══════════════════════════════════════════════

/** Full admin panel — all sections */
function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    // Section: Campaigns
    [Markup.button.callback('─────  📋 CAMPAIGNS  ─────', 'noop')],
    [
      Markup.button.callback('📝 Create Task', 'admin_create_task'),
      Markup.button.callback('⚡ Create Raid', 'admin_create_raid'),
    ],
    [
      Markup.button.callback('📊 View Tasks', 'admin_view_tasks'),
      Markup.button.callback('🗑️ Delete Task', 'admin_delete_task'),
    ],

    // Section: Submissions
    [Markup.button.callback('─────  📬 SUBMISSIONS  ─────', 'noop')],
    [
      Markup.button.callback('⏳ Pending', 'admin_view_submissions'),
      Markup.button.callback('✅ Approved', 'admin_view_approved'),
      Markup.button.callback('❌ Rejected', 'admin_view_rejected'),
    ],

    // Section: Broadcast
    [Markup.button.callback('─────  📢 BROADCAST  ─────', 'noop')],
    [
      Markup.button.callback('📣 Announce to Group', 'admin_announce'),
      Markup.button.callback('📨 DM All Users', 'admin_dm_all'),
    ],

    // Section: User Management
    [Markup.button.callback('─────  👤 USERS  ─────', 'noop')],
    [
      Markup.button.callback('👥 View Users', 'admin_manage_users'),
      Markup.button.callback('🚫 Ban User', 'admin_ban_user'),
      Markup.button.callback('✅ Unban User', 'admin_unban_user'),
    ],
    [
      Markup.button.callback('➕ Add Admin', 'admin_add_admin'),
      Markup.button.callback('➖ Remove Admin', 'admin_remove_admin'),
    ],

    // Section: Access Control
    [Markup.button.callback('─────  🔐 ACCESS CONTROL  ─────', 'noop')],
    [
      Markup.button.callback('🌐 All Users', 'admin_mode_all'),
      Markup.button.callback('👥 Group Only', 'admin_mode_group'),
      Markup.button.callback('📋 Whitelist', 'admin_mode_whitelist'),
    ],

    // Section: Google Sheets
    [Markup.button.callback('─────  📊 GOOGLE SHEETS  ─────', 'noop')],
    [
      Markup.button.callback('📧 Add Email', 'admin_add_email'),
    ],

    // Close
    [Markup.button.callback('❌  Close Panel', 'admin_close')],
  ]);
}

/** Task delete list */
function taskDeleteKeyboard(tasks) {
  if (!tasks.length) return null;
  const buttons = tasks.map(t => [
    Markup.button.callback(
      `🗑️ [${t.id}] ${t.title}`,
      `del_task_${t.id}`
    ),
  ]);
  buttons.push([Markup.button.callback('🔙 Back to Panel', 'back_admin')]);
  return Markup.inlineKeyboard(buttons);
}

/** Cancel button for input flows */
function cancelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Cancel', 'cancel_flow')],
  ]);
}

module.exports = {
  mainMenuKeyboard,
  profileKeyboard,
  settingsKeyboard,
  taskCardKeyboard,
  taskListKeyboard,
  approvalKeyboard,
  adminPanelKeyboard,
  taskDeleteKeyboard,
  cancelKeyboard,
};
