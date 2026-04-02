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

function taskPlatformKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Twitter', callback_data: 'task_platform:twitter' },
        { text: 'Telegram', callback_data: 'task_platform:telegram' },
      ],
      [{ text: 'Done Adding Tasks', callback_data: 'task_platform:done' }],
    ],
  };
}

function twitterTaskTypeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Follow', callback_data: 'twitter_task:follow' },
        { text: 'Like', callback_data: 'twitter_task:like' },
      ],
      [
        { text: 'Retweet', callback_data: 'twitter_task:retweet' },
        { text: 'Quote Tweet', callback_data: 'twitter_task:quote' },
      ],
      [{ text: 'Comment / Reply', callback_data: 'twitter_task:comment' }],
      [{ text: 'Back', callback_data: 'task_platform:back' }],
    ],
  };
}

function telegramTaskTypeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Join Group / Channel', callback_data: 'telegram_task:join' },
        { text: 'React to Message', callback_data: 'telegram_task:react' },
      ],
      [{ text: 'Send Message in Group', callback_data: 'telegram_task:send' }],
      [{ text: 'Back', callback_data: 'task_platform:back' }],
    ],
  };
}

function submitRaidKeyboard(raidId) {
  return {
    inline_keyboard: [
      [{ text: 'Submit', callback_data: `raid:submit:${raidId}` }],
    ],
  };
}

function raidTaskKeyboard(tasks, userDone) {
  const buttons = tasks.map((t, i) => {
    const done = userDone.includes(t.id);
    const label = done ? `✓ Task ${i + 1} Done` : `Task ${i + 1}: ${taskShortLabel(t)}`;
    return [{ text: label, callback_data: `task:verify:${t.id}` }];
  });
  return { inline_keyboard: buttons };
}

function taskShortLabel(task) {
  switch (task.type) {
    case 'follow':  return `Follow @${task.target_username}`;
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
      [{ text: 'Set Leaderboard Topic', callback_data: 'settings:lb_topic' }],
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

module.exports = {
  mainAdminKeyboard,
  taskPlatformKeyboard,
  twitterTaskTypeKeyboard,
  telegramTaskTypeKeyboard,
  submitRaidKeyboard,
  raidTaskKeyboard,
  groupSelectKeyboard,
  settingsKeyboard,
  closeRaidKeyboard,
};
