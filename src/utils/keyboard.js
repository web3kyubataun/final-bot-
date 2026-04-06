const { Markup } = require('telegraf');

const BOT_DM_LINK = 'https://t.me/MomentumHubBot';

const TASK_TYPE_LABELS = {
  follow: 'Follow', like: 'Like', retweet: 'Retweet',
  comment: 'Comment', quote: 'Quote Tweet',
  join: 'Join Channel/Group', react: 'React to Message', send: 'Send Message',
};

// ═══════════════════════════════════════════════
//  USER KEYBOARDS
// ═══════════════════════════════════════════════

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['Tasks', 'Raids'],
    ['Leaderboard', 'My Profile'],
    ['Settings', 'Help'],
  ]).resize();
}

// Profile keyboard — Twitter button hidden if locked
function profileKeyboard(twitterLocked) {
  const rows = [];
  if (!twitterLocked) {
    rows.push([Markup.button.callback('Connect Twitter', 'set_twitter'), Markup.button.callback('Set Wallet', 'set_wallet')]);
  } else {
    rows.push([Markup.button.callback('Set Wallet', 'set_wallet')]);
  }
  rows.push([Markup.button.callback('Set Discord', 'set_discord')]);
  rows.push([Markup.button.callback('Refresh', 'refresh_profile'), Markup.button.callback('Close', 'close_msg')]);
  return Markup.inlineKeyboard(rows);
}

// Settings keyboard — Twitter button hidden if locked
function settingsKeyboard(twitterLocked) {
  const rows = [];
  if (!twitterLocked) {
    rows.push([Markup.button.callback('Connect Twitter', 'set_twitter'), Markup.button.callback('Set Wallet', 'set_wallet')]);
  } else {
    rows.push([Markup.button.callback('Set Wallet', 'set_wallet')]);
  }
  rows.push([Markup.button.callback('Set Discord', 'set_discord')]);
  rows.push([Markup.button.callback('Close', 'close_msg')]);
  return Markup.inlineKeyboard(rows);
}

// Connect Twitter button shown on /start
function connectTwitterKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Connect Twitter Account', 'set_twitter')],
  ]);
}

// Task list
function taskListKeyboard(tasks) {
  if (!tasks.length) return null;
  return Markup.inlineKeyboard(
    tasks.map(t => [Markup.button.callback(
      `${t.type === 'raid' ? 'Raid' : 'Task'}: ${t.title}  +${t.reward}pts`,
      `view_task_${t.id}`
    )])
  );
}

// Task card in DM — handles combined task types (e.g. 'retweet,comment')
function taskCardKeyboard(taskId, taskLink, btnLabel, taskType) {
  const types = (taskType || '').split(',').map(t => t.trim()).filter(Boolean);
  const needsUrl = types.some(t => ['comment', 'quote', 'retweet'].includes(t));
  const rows = [];
  if (taskLink) {
    rows.push([Markup.button.url(`Open Link: ${btnLabel || 'View'}`, taskLink)]);
  }
  if (types.includes('comment') || types.includes('quote')) {
    rows.push([Markup.button.callback('Submit My Tweet URL', `do_submit_${taskId}`)]);
  } else if (types.includes('retweet') && needsUrl) {
    rows.push([Markup.button.callback('Submit Retweet URL', `do_submit_${taskId}`)]);
  } else if (types.includes('join')) {
    rows.push([Markup.button.callback('I Joined — Verify', `do_submit_${taskId}`)]);
  } else {
    rows.push([Markup.button.callback('I Did It — Verify', `do_submit_${taskId}`)]);
  }
  return Markup.inlineKeyboard(rows);
}

// Task card in GROUP — deep-link to DM using fixed bot link
function taskCardDMKeyboard(taskId, taskLink, btnLabel) {
  const rows = [];
  if (taskLink) rows.push([Markup.button.url(`Open Link: ${btnLabel || 'View'}`, taskLink)]);
  rows.push([
    Markup.button.url('Submit in DM', `${BOT_DM_LINK}?start=submit_${taskId}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

function cancelKeyboard(label = 'Cancel') {
  return Markup.inlineKeyboard([[Markup.button.callback(label, 'cancel_flow')]]);
}

function approvalKeyboard(subId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Approve', `approve_${subId}`), Markup.button.callback('Reject', `reject_${subId}`)],
  ]);
}

// ═══════════════════════════════════════════════
//  ADMIN KEYBOARDS
// ═══════════════════════════════════════════════

function adminMainKeyboard(groupName, showSwitch = false) {
  const rows = [
    [
      { text: 'Create Task', callback_data: 'admin_create_task' },
      { text: 'Create Raid', callback_data: 'admin_create_raid' },
    ],
    [
      { text: 'View Tasks', callback_data: 'admin_view_tasks' },
      { text: 'Delete Task', callback_data: 'admin_delete_task_menu' },
    ],
    [
      { text: 'Announce', callback_data: 'admin_announce' },
      { text: 'DM All Users', callback_data: 'admin_dm_all' },
    ],
    [
      { text: 'View Users', callback_data: 'admin_view_users' },
      { text: 'Collect Info', callback_data: 'admin_collect_info' },
    ],
    [
      { text: 'Ban User', callback_data: 'admin_ban' },
      { text: 'Unban User', callback_data: 'admin_unban' },
    ],
    [
      { text: 'Add Admin', callback_data: 'admin_add_admin' },
      { text: 'Remove Admin', callback_data: 'admin_rem_admin' },
    ],
    [
      { text: 'Access Mode', callback_data: 'admin_section_access' },
      { text: 'Setup Topics', callback_data: 'admin_setup_topics' },
    ],
    [
      { text: 'All', callback_data: 'admin_mode_all' },
      { text: 'Group Only', callback_data: 'admin_mode_group' },
      { text: 'Whitelist', callback_data: 'admin_mode_whitelist' },
    ],
    [
      { text: 'Add Sheet Email', callback_data: 'admin_add_email' },
      { text: 'Set Group Link', callback_data: 'admin_set_link' },
    ],
    [
      { text: 'Stats', callback_data: 'admin_stats' },
      ...(showSwitch ? [{ text: 'Switch Group', callback_data: 'admin_switch_group' }] : []),
    ],
    [{ text: 'Close', callback_data: 'admin_close' }],
  ];
  return Markup.inlineKeyboard(rows);
}

function taskDeleteKeyboard(tasks) {
  return Markup.inlineKeyboard(
    tasks.map(t => [Markup.button.callback(
      `[${t.id}] ${t.title} (${t.type === 'raid' ? 'Raid' : 'Task'})`,
      `del_task_${t.id}`
    )])
  );
}

function topicsSetupKeyboard() {
  const topics = ['getstarted','notifications','tasks','raids','leaderboard','connect','announcements','submissions','general'];
  return Markup.inlineKeyboard([
    ...topics.map(t => [Markup.button.callback(t, `set_topic_${t}`)]),
    [Markup.button.callback('Cancel', 'cancel_flow')],
  ]);
}

function groupSelectorKeyboard(groups) {
  return Markup.inlineKeyboard(
    groups.map(g => [Markup.button.callback(g.name || g.id, `select_group_${g.id}`)])
  );
}

function platformSelectKeyboard(kind) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Twitter / X', `admin_platform_${kind}_twitter`),
      Markup.button.callback('Telegram', `admin_platform_${kind}_telegram`),
    ],
    [Markup.button.callback('Cancel', 'cancel_flow')],
  ]);
}

function taskTypeKeyboard(kind, platform) {
  const rows = [];
  if (platform === 'twitter') {
    rows.push([
      Markup.button.callback('Follow (solo only)', `admin_tasktype_${kind}_follow`),
      Markup.button.callback('Like (solo only)', `admin_tasktype_${kind}_like`),
    ]);
    rows.push([
      Markup.button.callback('Retweet', `admin_tasktype_${kind}_retweet`),
      Markup.button.callback('Comment', `admin_tasktype_${kind}_comment`),
    ]);
    rows.push([
      Markup.button.callback('Quote Tweet', `admin_tasktype_${kind}_quote`),
    ]);
  } else {
    rows.push([Markup.button.callback('Join Channel/Group', `admin_tasktype_${kind}_join`)]);
    rows.push([
      Markup.button.callback('React to Message', `admin_tasktype_${kind}_react`),
      Markup.button.callback('Send Message', `admin_tasktype_${kind}_send`),
    ]);
  }
  rows.push([Markup.button.callback('Cancel', 'cancel_flow')]);
  return Markup.inlineKeyboard(rows);
}

/**
 * Combo-select keyboard for Retweet / Comment / Quote combination.
 * Shows checkmarks on already-selected types. Admin presses Done when satisfied.
 */
function taskTypeComboKeyboard(kind, selectedTypes = []) {
  const COMBINABLE = ['retweet', 'comment', 'quote'];
  const rows = COMBINABLE.map(t => {
    const selected = selectedTypes.includes(t);
    const label = `${selected ? '✓ ' : ''}${TASK_TYPE_LABELS[t]}`;
    return [Markup.button.callback(label, `admin_combo_toggle_${kind}_${t}`)];
  });
  rows.push([Markup.button.callback('Done — Set Title', 'admin_combo_done')]);
  rows.push([Markup.button.callback('Cancel', 'cancel_flow')]);
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard, connectTwitterKeyboard,
  taskListKeyboard, taskCardKeyboard, taskCardDMKeyboard, cancelKeyboard,
  approvalKeyboard, adminMainKeyboard, taskDeleteKeyboard,
  topicsSetupKeyboard, groupSelectorKeyboard, platformSelectKeyboard,
  taskTypeKeyboard, taskTypeComboKeyboard,
};
