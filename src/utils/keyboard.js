const { Markup } = require('telegraf');

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['🎯 Tasks', '⚡ Raids'],
    ['🏆 Leaderboard', '👤 My Profile'],
    ['🔔 Toggle Notifications'],
  ]).resize();
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Create Task', 'admin_create_task'), Markup.button.callback('⚡ Create Raid', 'admin_create_raid')],
    [Markup.button.callback('📢 Announce', 'admin_announce'), Markup.button.callback('👥 Manage Users', 'admin_manage_users')],
    [Markup.button.callback('📊 View Submissions', 'admin_view_submissions'), Markup.button.callback('❌ Close', 'admin_close')],
  ]);
}

function approvalKeyboard(submissionId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve', `approve_${submissionId}`),
      Markup.button.callback('❌ Reject', `reject_${submissionId}`),
    ],
  ]);
}

function taskListKeyboard(tasks) {
  if (!tasks.length) return null;
  const buttons = tasks.map(t =>
    [Markup.button.callback(`${t.type === 'raid' ? '⚡' : '🎯'} ${t.title} (+${t.reward} pts)`, `submit_${t.id}`)]
  );
  return Markup.inlineKeyboard(buttons);
}

module.exports = { mainMenuKeyboard, adminPanelKeyboard, approvalKeyboard, taskListKeyboard };
