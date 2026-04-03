const TASK_TYPES = ['follow', 'like', 'retweet', 'comment', 'quote'];

const TASK_LABELS = {
  follow: 'Follow',
  like: 'Like',
  retweet: 'Retweet',
  comment: 'Comment',
  quote: 'Quote Tweet',
};

function mainAdminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Create Raid', callback_data: 'admin:create_raid' },
        { text: 'Active Raids', callback_data: 'admin:active_raids' },
      ],
      [
        { text: 'Leaderboard', callback_data: 'admin:leaderboard' },
        { text: 'Settings', callback_data: 'admin:settings' },
      ],
    ],
  };
}

function descriptionSkipKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Skip Description', callback_data: 'create_raid:skip_description' }],
    ],
  };
}

function taskTypeToggleKeyboard(selected = {}) {
  const rows = [];

  // Row 1: Follow | Like
  rows.push([
    {
      text: `${selected.follow ? '[x]' : '[ ]'} Follow`,
      callback_data: 'task_toggle:follow',
    },
    {
      text: `${selected.like ? '[x]' : '[ ]'} Like`,
      callback_data: 'task_toggle:like',
    },
  ]);

  // Row 2: Retweet | Comment
  rows.push([
    {
      text: `${selected.retweet ? '[x]' : '[ ]'} Retweet`,
      callback_data: 'task_toggle:retweet',
    },
    {
      text: `${selected.comment ? '[x]' : '[ ]'} Comment`,
      callback_data: 'task_toggle:comment',
    },
  ]);

  // Row 3: Quote Tweet (full width)
  rows.push([
    {
      text: `${selected.quote ? '[x]' : '[ ]'} Quote Tweet`,
      callback_data: 'task_toggle:quote',
    },
  ]);

  // Row 4: Confirm
  const anySelected = Object.values(selected).some(Boolean);
  if (anySelected) {
    rows.push([{ text: 'Confirm Task Selection', callback_data: 'task_confirm' }]);
  }

  return { inline_keyboard: rows };
}

function submitRaidKeyboard(raidId) {
  return {
    inline_keyboard: [
      [{ text: 'Submit Tasks', callback_data: `raid:submit:${raidId}` }],
    ],
  };
}

function raidTaskKeyboard(tasks, doneIds = []) {
  const buttons = tasks.map((t, i) => {
    const done = doneIds.includes(t.id);
    const label = done
      ? `[Done] Task ${i + 1}: ${taskShortLabel(t)}`
      : `Task ${i + 1}: ${taskShortLabel(t)}`;
    return [{ text: label, callback_data: done ? 'noop' : `task:verify:${t.id}` }];
  });
  return { inline_keyboard: buttons };
}

function taskActionKeyboard(task, taskIndex) {
  const rows = [];

  if (task.task_link) {
    const linkLabel = task.type === 'follow'
      ? `Open Profile`
      : task.type === 'like' ? `Open Tweet to Like`
      : task.type === 'retweet' ? `Open Tweet to Retweet`
      : task.type === 'comment' ? `Open Tweet to Comment`
      : task.type === 'quote' ? `Open Tweet to Quote`
      : `Open Link`;
    rows.push([{ text: linkLabel, url: task.task_link }]);
  }

  if (task.type === 'follow' || task.type === 'like' || task.type === 'retweet') {
    rows.push([{ text: `Verify Task ${taskIndex + 1}`, callback_data: `task:confirm_verify:${task.id}` }]);
  }

  return { inline_keyboard: rows };
}

function telegramTaskActionKeyboard(task) {
  const rows = [];
  if (task.task_link) {
    rows.push([{ text: 'Open Channel / Group', url: task.task_link }]);
  }
  rows.push([{ text: 'Mark as Done', callback_data: `task:tg_done:${task.id}` }]);
  return { inline_keyboard: rows };
}

function groupSelectKeyboard(groups) {
  const buttons = groups.map((g) => ([
    { text: g.name || `Group ${g.telegram_id}`, callback_data: `lb:group:${g.id}` },
  ]));
  return { inline_keyboard: buttons };
}

function settingsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Set Min Comment Length', callback_data: 'settings:min_chars' }],
      [{ text: 'Set Leaderboard Topic ID', callback_data: 'settings:lb_topic' }],
      [{ text: 'Close a Raid', callback_data: 'settings:close_raid' }],
    ],
  };
}

function closeRaidKeyboard(raids) {
  const buttons = raids.map((r) => ([
    { text: r.title, callback_data: `close_raid:${r.id}` },
  ]));
  return { inline_keyboard: buttons };
}

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
  TASK_LABELS,
  mainAdminKeyboard,
  descriptionSkipKeyboard,
  taskTypeToggleKeyboard,
  submitRaidKeyboard,
  raidTaskKeyboard,
  taskActionKeyboard,
  telegramTaskActionKeyboard,
  groupSelectKeyboard,
  settingsKeyboard,
  closeRaidKeyboard,
};
