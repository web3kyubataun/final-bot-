const { Markup } = require('telegraf');

function cancelKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_flow')]]);
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['Tasks', 'Raids'],
    ['Leaderboard', 'My Profile'],
    ['Settings', 'Help'],
  ]).resize();
}

function profileKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh', 'refresh_profile')],
    [Markup.button.callback('Close', 'close_msg')],
  ]);
}

function settingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🐦 Set Twitter Handle', 'set_twitter')],
    [Markup.button.callback('💳 Set Wallet', 'set_wallet')],
    [Markup.button.callback('🎮 Set Discord', 'set_discord')],
    [Markup.button.callback('Close', 'close_msg')],
  ]);
}

function taskListKeyboard(tasks) {
  const rows = tasks.map(t => {
    const icon  = t.type === 'raid' ? '⚡' : '📋';
    const label = `${icon} ${t.title} — ${t.reward}pts`.slice(0, 64);
    return [Markup.button.callback(label, `view_task_${t.id}`)];
  });
  return Markup.inlineKeyboard(rows);
}

function taskCardKeyboard(taskId, link, buttonLabel, taskType) {
  const rows = [];
  if (link) {
    rows.push([Markup.button.url(buttonLabel || 'Open Link', link)]);
  }
  const verifyLabel = ['comment', 'quote', 'retweet'].includes(taskType)
    ? '📎 Submit URL'
    : '✅ Verify';
  rows.push([Markup.button.callback(verifyLabel, `do_submit_${taskId}`)]);
  rows.push([Markup.button.callback('Close', 'close_msg')]);
  return Markup.inlineKeyboard(rows);
}

function taskCardDMKeyboard(taskId, link, buttonLabel, botName) {
  const rows = [];
  if (link) {
    rows.push([Markup.button.url(buttonLabel || 'Open Link', link)]);
  }
  rows.push([Markup.button.url('✅ Complete & Verify', `https://t.me/${botName}?start=submit_${taskId}`)]);
  return Markup.inlineKeyboard(rows);
}

function approvalKeyboard(subId) {
  return Markup.inlineKeyboard([[
    Markup.button.callback('✅ Approve', `approve_${subId}`),
    Markup.button.callback('❌ Reject',  `reject_${subId}`),
  ]]);
}

function adminMainKeyboard(groupName, canSwitch) {
  const rows = [
    [
      Markup.button.callback('➕ New Task',    'admin_create_task'),
      Markup.button.callback('⚡ New Raid',    'admin_create_raid'),
    ],
    [
      Markup.button.callback('📋 View Tasks',  'admin_view_tasks'),
      Markup.button.callback('🗑 Delete Task', 'admin_delete_task_menu'),
    ],
    [
      Markup.button.callback('📢 Announce',    'admin_announce'),
      Markup.button.callback('✉️ DM All',      'admin_dm_all'),
    ],
    [
      Markup.button.callback('👥 Users',       'admin_view_users'),
      Markup.button.callback('📊 Stats',       'admin_stats'),
    ],
    [
      Markup.button.callback('🚫 Ban',         'admin_ban'),
      Markup.button.callback('✅ Unban',       'admin_unban'),
    ],
    [
      Markup.button.callback('➕ Add Admin',   'admin_add_admin'),
      Markup.button.callback('➖ Rem Admin',   'admin_rem_admin'),
    ],
    [
      Markup.button.callback('🔒 WL Add',      'admin_wl_add'),
      Markup.button.callback('🔓 WL Remove',   'admin_wl_remove'),
      Markup.button.callback('📄 WL View',     'admin_wl_view'),
    ],
    [
      Markup.button.callback('Mode: All',       'admin_mode_all'),
      Markup.button.callback('Mode: Group',     'admin_mode_group'),
      Markup.button.callback('Mode: WL',        'admin_mode_whitelist'),
    ],
    [
      Markup.button.callback('⚙️ Topics',      'admin_setup_topics'),
      Markup.button.callback('📧 Email',        'admin_add_email'),
      Markup.button.callback('🔗 Link',         'admin_set_link'),
    ],
  ];

  if (canSwitch) {
    rows.push([Markup.button.callback('🔄 Switch Group', 'admin_switch_group')]);
  }
  rows.push([Markup.button.callback('Close', 'admin_close')]);
  return Markup.inlineKeyboard(rows);
}

function taskDeleteKeyboard(tasks) {
  const rows = tasks.map(t => {
    const label = `[${t.type === 'raid' ? 'Raid' : 'Task'}] ${t.title}`.slice(0, 60);
    return [Markup.button.callback(label, `del_task_${t.id}`)];
  });
  rows.push([Markup.button.callback('Cancel', 'cancel_flow')]);
  return Markup.inlineKeyboard(rows);
}

function topicsSetupKeyboard() {
  const topics = [
    'getstarted', 'notifications', 'quests', 'raids',
    'leaderboard', 'connect', 'announcements', 'submissions', 'general',
  ];
  const rows = topics.map(t => [Markup.button.callback(t, `set_topic_${t}`)]);
  rows.push([Markup.button.callback('Back', 'back_admin')]);
  return Markup.inlineKeyboard(rows);
}

function groupSelectorKeyboard(groups) {
  const rows = groups.map(g => [
    Markup.button.callback(
      (g.name || g.groupName || g.id).toString().slice(0, 40),
      `select_group_${g.id}`
    ),
  ]);
  return Markup.inlineKeyboard(rows);
}

function platformSelectKeyboard(kind) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🐦 Twitter/X', `admin_platform_${kind}_twitter`),
      Markup.button.callback('✈️ Telegram',  `admin_platform_${kind}_telegram`),
    ],
    [Markup.button.callback('❌ Cancel', 'cancel_flow')],
  ]);
}

function taskTypeKeyboard(kind, platform) {
  if (platform === 'telegram') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('Join Channel/Group', `admin_tasktype_${kind}_join`)],
      [Markup.button.callback('React to Message',   `admin_tasktype_${kind}_react`)],
      [Markup.button.callback('Send Message',       `admin_tasktype_${kind}_send`)],
      [Markup.button.callback('Cancel', 'cancel_flow')],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback('Like',        `admin_tasktype_${kind}_like`)],
    [Markup.button.callback('Retweet',     `admin_tasktype_${kind}_retweet`)],
    [Markup.button.callback('Follow',      `admin_tasktype_${kind}_follow`)],
    [Markup.button.callback('Comment',     `admin_tasktype_${kind}_comment`)],
    [Markup.button.callback('Quote Tweet', `admin_tasktype_${kind}_quote`)],
    [Markup.button.callback('Cancel', 'cancel_flow')],
  ]);
}

function twitterMultiActionKeyboard(selected = {}) {
  const actions = [
    { key: 'follow',  label: 'Follow'      },
    { key: 'like',    label: 'Like'        },
    { key: 'retweet', label: 'Retweet'     },
    { key: 'comment', label: 'Comment'     },
    { key: 'quote',   label: 'Quote Tweet' },
  ];
  const rows = actions.map(a => {
    const label = selected[a.key] ? `✅ ${a.label}` : a.label;
    return [Markup.button.callback(label, `admin_ttoggle_${a.key}`)];
  });
  rows.push([
    Markup.button.callback('✔ Confirm', 'admin_tconfirm'),
    Markup.button.callback('❌ Cancel', 'cancel_flow'),
  ]);
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  cancelKeyboard,
  mainMenuKeyboard,
  profileKeyboard,
  settingsKeyboard,
  taskListKeyboard,
  taskCardKeyboard,
  taskCardDMKeyboard,
  approvalKeyboard,
  adminMainKeyboard,
  taskDeleteKeyboard,
  topicsSetupKeyboard,
  groupSelectorKeyboard,
  platformSelectKeyboard,
  taskTypeKeyboard,
  twitterMultiActionKeyboard,
};
