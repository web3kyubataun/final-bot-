const { Markup } = require('telegraf');

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

function profileKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Twitter', 'set_twitter'), Markup.button.callback('Wallet', 'set_wallet')],
    [Markup.button.callback('Discord', 'set_discord')],
    [Markup.button.callback('Refresh', 'refresh_profile'), Markup.button.callback('Close', 'close_msg')],
  ]);
}

function settingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Set Twitter', 'set_twitter'), Markup.button.callback('Set Wallet', 'set_wallet')],
    [Markup.button.callback('Set Discord', 'set_discord')],
    [Markup.button.callback('Close', 'close_msg')],
  ]);
}

function taskListKeyboard(tasks) {
  if (!tasks.length) return null;
  return Markup.inlineKeyboard(
    tasks.map(t => [Markup.button.callback(
      `${t.type === 'raid' ? '[Raid]' : '[Task]'} ${t.title}  +${t.reward}pts`,
      `view_task_${t.id}`
    )])
  );
}

function taskCardKeyboard(taskId, taskLink, btnLabel, taskType) {
  const rows = [];
  if (taskLink) {
    rows.push([Markup.button.url(btnLabel || 'Open Link', taskLink)]);
  }
  if (taskType === 'comment' || taskType === 'quote') {
    rows.push([Markup.button.callback('Submit My Tweet URL', `do_submit_${taskId}`)]);
  } else if (taskType === 'join') {
    rows.push([Markup.button.callback('I Joined - Verify', `do_submit_${taskId}`)]);
  } else {
    rows.push([Markup.button.callback('I Did It - Verify', `do_submit_${taskId}`)]);
  }
  return Markup.inlineKeyboard(rows);
}

function taskCardDMKeyboard(taskId, taskLink, btnLabel, botUsername) {
  const rows = [];
  if (taskLink) rows.push([Markup.button.url(btnLabel || 'Open Link', taskLink)]);
  rows.push([
    Markup.button.url('Submit in DM', `https://t.me/${botUsername}?start=submit_${taskId}`)
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
//  ADMIN TASK CREATION KEYBOARDS
// ═══════════════════════════════════════════════

function platformSelectKeyboard(type) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Twitter / X',  `admin_platform_${type}_twitter`),
      Markup.button.callback('Telegram',      `admin_platform_${type}_telegram`),
    ],
    [Markup.button.callback('Cancel', 'cancel_flow')],
  ]);
}

const TWITTER_TYPES = [
  ['Follow',      'follow'],
  ['Like',        'like'],
  ['Retweet',     'retweet'],
  ['Comment',     'comment'],
  ['Quote Tweet', 'quote'],
];

const TELEGRAM_TYPES = [
  ['Join Channel/Group', 'join'],
  ['React to Message',   'react'],
  ['Send Message',       'send'],
];

function taskTypeKeyboard(type, platform) {
  const types = platform === 'telegram' ? TELEGRAM_TYPES : TWITTER_TYPES;
  const rows = types.map(([label, ttype]) => [
    Markup.button.callback(label, `admin_tasktype_${type}_${ttype}`)
  ]);
  rows.push([Markup.button.callback('Cancel', 'cancel_flow')]);
  return Markup.inlineKeyboard(rows);
}

// Twitter multi-action toggle keyboard
function twitterMultiActionKeyboard(selected = {}) {
  const rows = [];
  rows.push([
    Markup.button.callback(`${selected.follow  ? '[x]' : '[ ]'} Follow`,      'admin_ttoggle_follow'),
    Markup.button.callback(`${selected.like    ? '[x]' : '[ ]'} Like`,        'admin_ttoggle_like'),
  ]);
  rows.push([
    Markup.button.callback(`${selected.retweet ? '[x]' : '[ ]'} Retweet`,     'admin_ttoggle_retweet'),
    Markup.button.callback(`${selected.comment ? '[x]' : '[ ]'} Comment`,     'admin_ttoggle_comment'),
  ]);
  rows.push([
    Markup.button.callback(`${selected.quote   ? '[x]' : '[ ]'} Quote Tweet`, 'admin_ttoggle_quote'),
  ]);
  const anySelected = Object.values(selected).some(Boolean);
  if (anySelected) {
    rows.push([Markup.button.callback('Confirm Selection', 'admin_tconfirm')]);
  }
  rows.push([Markup.button.callback('Cancel', 'cancel_flow')]);
  return Markup.inlineKeyboard(rows);
}

// ═══════════════════════════════════════════════
//  ADMIN PANEL KEYBOARDS
// ═══════════════════════════════════════════════

function adminMainKeyboard(groupName, canSwitch = false) {
  const kb = [
    [Markup.button.callback('--- CAMPAIGNS ---', 'admin_section_campaigns')],
    [Markup.button.callback('Create Task', 'admin_create_task'), Markup.button.callback('Create Raid', 'admin_create_raid')],
    [Markup.button.callback('View Tasks', 'admin_view_tasks'), Markup.button.callback('Delete Task', 'admin_delete_task_menu')],

    [Markup.button.callback('--- BROADCAST ---', 'admin_section_bc')],
    [Markup.button.callback('Announce', 'admin_announce'), Markup.button.callback('DM All', 'admin_dm_all')],

    [Markup.button.callback('--- USERS ---', 'admin_section_users')],
    [Markup.button.callback('View Users', 'admin_view_users'), Markup.button.callback('Ban', 'admin_ban'), Markup.button.callback('Unban', 'admin_unban')],
    [Markup.button.callback('Add Admin', 'admin_add_admin'), Markup.button.callback('Remove Admin', 'admin_rem_admin')],

    [Markup.button.callback('--- ACCESS CONTROL ---', 'admin_section_access')],
    [Markup.button.callback('All Users', 'admin_mode_all'), Markup.button.callback('Group Only', 'admin_mode_group'), Markup.button.callback('Whitelist', 'admin_mode_whitelist')],

    [Markup.button.callback('--- SETUP ---', 'admin_section_setup')],
    [Markup.button.callback('Topics', 'admin_setup_topics'), Markup.button.callback('Add Email', 'admin_add_email')],
    [Markup.button.callback('Stats', 'admin_stats'), Markup.button.callback('Set Link', 'admin_set_link')],
  ];

  if (canSwitch) {
    kb.push([Markup.button.callback('Switch Group', 'admin_switch_group'), Markup.button.callback('Close', 'admin_close')]);
  } else {
    kb.push([Markup.button.callback('Close Panel', 'admin_close')]);
  }

  return Markup.inlineKeyboard(kb);
}

function taskDeleteKeyboard(tasks) {
  const rows = tasks.map(t => [
    Markup.button.callback(`[Delete] [#${t.id}] ${t.type === 'raid' ? '[Raid]' : '[Task]'} ${t.title}`, `del_task_${t.id}`)
  ]);
  rows.push([Markup.button.callback('Back', 'back_admin')]);
  return Markup.inlineKeyboard(rows);
}

function topicsSetupKeyboard() {
  const types = [
    ['getstarted', 'Get Started'], ['notifications', 'Notifications'],
    ['quests', 'Quests'],          ['raids', 'Raids'],
    ['leaderboard', 'Leaderboard'], ['connect', 'Connect Twitter'],
    ['announcements', 'Announcements'], ['submissions', 'Submissions'],
    ['general', 'General'],
  ];
  const rows = types.map(([type, label]) => [Markup.button.callback(label, `set_topic_${type}`)]);
  rows.push([Markup.button.callback('Back', 'back_admin')]);
  return Markup.inlineKeyboard(rows);
}

function groupSelectorKeyboard(groups) {
  return Markup.inlineKeyboard(
    groups.map(g => [Markup.button.callback(g.name || g.id, `select_group_${g.id}`)])
  );
}

function switchGroupKeyboard(groups) {
  return groupSelectorKeyboard(groups);
}

module.exports = {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskCardKeyboard, taskCardDMKeyboard, taskListKeyboard,
  approvalKeyboard, cancelKeyboard,
  platformSelectKeyboard, taskTypeKeyboard, twitterMultiActionKeyboard,
  adminMainKeyboard, taskDeleteKeyboard, topicsSetupKeyboard,
  groupSelectorKeyboard, switchGroupKeyboard,
};
