// ─────────────────────────────────────────────────────────────────────────────
//  keyboards.js  —  All inline keyboard builders
// ─────────────────────────────────────────────────────────────────────────────

const TWITTER_TASK_TYPES = ['follow', 'like', 'retweet', 'comment', 'quote'];
const TELEGRAM_TASK_TYPES = ['join', 'react', 'send'];
const TASK_TYPES = [...TWITTER_TASK_TYPES, ...TELEGRAM_TASK_TYPES];

const TASK_LABELS = {
  // Twitter
  follow:  'Follow',
  like:    'Like',
  retweet: 'Retweet',
  comment: 'Comment',
  quote:   'Quote Tweet',
  // Telegram
  join:    'Join Group/Channel',
  react:   'React to Message',
  send:    'Send a Message',
};

// ── Admin main menu ───────────────────────────────────────────────────────────
function mainAdminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Create Raid',    callback_data: 'admin:create_raid' },
        { text: '📋 Active Raids',   callback_data: 'admin:active_raids' },
      ],
      [
        { text: '🏆 Leaderboard',    callback_data: 'admin:leaderboard' },
        { text: '⚙️ Settings',       callback_data: 'admin:settings' },
      ],
    ],
  };
}

// ── Skip description ──────────────────────────────────────────────────────────
function descriptionSkipKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Skip Description', callback_data: 'create_raid:skip_description' }],
    ],
  };
}

// ── Platform selector (Twitter / Telegram) ────────────────────────────────────
function platformSelectKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🐦 Twitter / X',    callback_data: 'admin:platform:twitter' },
        { text: '✈️ Telegram',        callback_data: 'admin:platform:telegram' },
      ],
    ],
  };
}

// ── Task type toggle (filtered by platform) ───────────────────────────────────
function taskTypeToggleKeyboard(selected = {}, platform = 'twitter') {
  const rows = [];

  if (platform === 'twitter') {
    rows.push([
      { text: `${selected.follow  ? '✅' : '⬜'} Follow`,       callback_data: 'task_toggle:follow' },
      { text: `${selected.like    ? '✅' : '⬜'} Like`,         callback_data: 'task_toggle:like' },
    ]);
    rows.push([
      { text: `${selected.retweet ? '✅' : '⬜'} Retweet`,      callback_data: 'task_toggle:retweet' },
      { text: `${selected.comment ? '✅' : '⬜'} Comment`,      callback_data: 'task_toggle:comment' },
    ]);
    rows.push([
      { text: `${selected.quote   ? '✅' : '⬜'} Quote Tweet`,  callback_data: 'task_toggle:quote' },
    ]);
  } else {
    // Telegram
    rows.push([
      { text: `${selected.join  ? '✅' : '⬜'} Join Channel/Group`, callback_data: 'task_toggle:join' },
    ]);
    rows.push([
      { text: `${selected.react ? '✅' : '⬜'} React to Message`,   callback_data: 'task_toggle:react' },
      { text: `${selected.send  ? '✅' : '⬜'} Send Message`,       callback_data: 'task_toggle:send' },
    ]);
  }

  const anySelected = Object.values(selected).some(Boolean);
  if (anySelected) {
    rows.push([{ text: '✅ Confirm Task Selection', callback_data: 'task_confirm' }]);
  }

  return { inline_keyboard: rows };
}

// ── Raid submit button (shown in group) ───────────────────────────────────────
// Uses a start deep link so clicking always opens the bot DM
function submitRaidKeyboard(raidId, botUsername) {
  const url = botUsername
    ? `https://t.me/${botUsername}?start=raid_${raidId}`
    : null;

  if (url) {
    return {
      inline_keyboard: [
        [{ text: '🚀 Submit Tasks', url }],
      ],
    };
  }
  // Fallback: inline callback (will DM user from handler)
  return {
    inline_keyboard: [
      [{ text: '🚀 Submit Tasks', callback_data: `raid:submit:${raidId}` }],
    ],
  };
}

// ── Raid task list (inside DM) ────────────────────────────────────────────────
function raidTaskKeyboard(tasks, doneIds = []) {
  const buttons = tasks.map((t, i) => {
    const done = doneIds.includes(t.id);
    const label = done
      ? `✅ Task ${i + 1}: ${taskShortLabel(t)}`
      : `▶️ Task ${i + 1}: ${taskShortLabel(t)}`;
    return [{ text: label, callback_data: done ? 'noop' : `task:verify:${t.id}` }];
  });
  return { inline_keyboard: buttons };
}

// ── Per-task action keyboard ──────────────────────────────────────────────────
function taskActionKeyboard(task, taskIndex) {
  const rows = [];

  if (task.task_link) {
    const linkLabel =
      task.type === 'follow'   ? '👤 Open Profile' :
      task.type === 'like'     ? '❤️ Open Tweet to Like' :
      task.type === 'retweet'  ? '🔁 Open Tweet to Retweet' :
      task.type === 'comment'  ? '💬 Open Tweet to Comment' :
      task.type === 'quote'    ? '🗣 Open Tweet to Quote' :
      '🔗 Open Link';
    rows.push([{ text: linkLabel, url: task.task_link }]);
  }

  // Verify button only for verifiable-via-API task types
  if (['follow', 'like', 'retweet'].includes(task.type)) {
    rows.push([{ text: `✅ Verify Task ${taskIndex + 1}`, callback_data: `task:confirm_verify:${task.id}` }]);
  }

  return { inline_keyboard: rows };
}

// ── Telegram task action keyboard ─────────────────────────────────────────────
function telegramTaskActionKeyboard(task) {
  const rows = [];
  if (task.task_link) {
    const label =
      task.type === 'join'  ? '📥 Open Channel / Group' :
      task.type === 'react' ? '💬 Open Message' :
      task.type === 'send'  ? '💬 Open Group' :
      '🔗 Open Link';
    rows.push([{ text: label, url: task.task_link }]);
  }

  if (task.type === 'join') {
    rows.push([{ text: '✅ Verify I Joined', callback_data: `task:tg_verify:${task.id}` }]);
  } else {
    rows.push([{ text: '✅ Mark as Done', callback_data: `task:tg_done:${task.id}` }]);
  }

  return { inline_keyboard: rows };
}

// ── Leaderboard group selector ────────────────────────────────────────────────
function groupSelectKeyboard(groups) {
  const buttons = groups.map((g) => ([
    { text: g.name || `Group ${g.telegram_id}`, callback_data: `lb:group:${g.id}` },
  ]));
  return { inline_keyboard: buttons };
}

// ── Settings keyboard ─────────────────────────────────────────────────────────
function settingsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✏️ Set Min Comment Length',  callback_data: 'settings:min_chars' }],
      [{ text: '📌 Set Leaderboard Topic ID', callback_data: 'settings:lb_topic' }],
      [{ text: '🔒 Close a Raid',            callback_data: 'settings:close_raid' }],
    ],
  };
}

// ── Close raid selector ───────────────────────────────────────────────────────
function closeRaidKeyboard(raids) {
  const buttons = raids.map((r) => ([
    { text: r.title, callback_data: `close_raid:${r.id}` },
  ]));
  return { inline_keyboard: buttons };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function taskShortLabel(task) {
  switch (task.type) {
    case 'follow':  return `Follow @${task.target_username || '?'}`;
    case 'like':    return 'Like Tweet';
    case 'retweet': return 'Retweet';
    case 'quote':   return 'Quote Tweet';
    case 'comment': return 'Comment';
    case 'join':    return `Join ${task.details || 'Channel'}`;
    case 'react':   return 'React to Message';
    case 'send':    return 'Send Message';
    default:        return task.type;
  }
}

module.exports = {
  TASK_TYPES,
  TWITTER_TASK_TYPES,
  TELEGRAM_TASK_TYPES,
  TASK_LABELS,
  mainAdminKeyboard,
  descriptionSkipKeyboard,
  platformSelectKeyboard,
  taskTypeToggleKeyboard,
  submitRaidKeyboard,
  raidTaskKeyboard,
  taskActionKeyboard,
  telegramTaskActionKeyboard,
  groupSelectKeyboard,
  settingsKeyboard,
  closeRaidKeyboard,
};
