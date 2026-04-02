function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

function bold(text) {
  return `*${escapeMarkdown(text)}*`;
}

function italic(text) {
  return `_${escapeMarkdown(text)}_`;
}

function code(text) {
  return `\`${text}\``;
}

function formatRaidMessage(raid, tasks) {
  const taskLines = tasks.map((t, i) => {
    const label = formatTaskLabel(t);
    return `  ${i + 1}\\. ${escapeMarkdown(label)}`;
  }).join('\n');

  return (
    `*New Raid*\n\n` +
    `*Task:* ${escapeMarkdown(raid.title)}\n` +
    `*Link:* ${escapeMarkdown(raid.link)}\n` +
    `*Reward:* ${escapeMarkdown(String(raid.reward))} points\n\n` +
    (taskLines ? `*Tasks:*\n${taskLines}\n\n` : '') +
    `_Tap_ *Submit* _after completing all tasks_`
  );
}

function formatTaskLabel(task) {
  const platform = task.platform === 'twitter' ? 'Twitter' : 'Telegram';
  switch (task.type) {
    case 'follow':     return `[Twitter] Follow @${task.target_username}`;
    case 'like':       return `[Twitter] Like the tweet`;
    case 'retweet':    return `[Twitter] Retweet the tweet`;
    case 'quote':      return `[Twitter] Quote tweet with comment`;
    case 'comment':    return `[Twitter] Comment on the tweet`;
    case 'join':       return `[Telegram] Join ${task.details || 'the group/channel'}`;
    case 'react':      return `[Telegram] React to the message`;
    case 'send':       return `[Telegram] Send a message in the group`;
    default:           return `[${platform}] ${task.type}`;
  }
}

function formatLeaderboard(entries, groupName) {
  if (!entries || entries.length === 0) {
    return `*Leaderboard*\n_${escapeMarkdown(groupName || 'Group')}_\n\n_No entries yet\\. Complete raids to earn points\\!_`;
  }

  const rows = entries.map((e, i) => {
    const name = e.username ? `@${e.username}` : (e.first_name || 'Unknown');
    const pos = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
    return `${bold(pos)}  ${escapeMarkdown(name)}  \\-  ${bold(String(e.points))} pts`;
  });

  return (
    `*Leaderboard*\n_${escapeMarkdown(groupName || 'Group')}_\n\n` +
    rows.join('\n')
  );
}

function formatActiveRaids(raids, groupName) {
  if (!raids || raids.length === 0) {
    return `*Active Raids*\n_${escapeMarkdown(groupName || 'Group')}_\n\n_No active raids at the moment\\._`;
  }

  const rows = raids.map((r, i) => (
    `*${escapeMarkdown(String(i + 1))}\\. ${escapeMarkdown(r.title)}*\n` +
    `   Link: ${escapeMarkdown(r.link)}\n` +
    `   Reward: _${escapeMarkdown(String(r.reward))} points_  \\|  Tasks: _${escapeMarkdown(String(r.task_count || 0))}_`
  ));

  return (
    `*Active Raids*\n_${escapeMarkdown(groupName || 'Group')}_\n\n` +
    rows.join('\n\n')
  );
}

function formatTaskVerificationResult(taskLabel, success, reason) {
  if (success) {
    return `*Task Complete*\n\n_${escapeMarkdown(taskLabel)}_\n\nVerified successfully\\.`;
  }
  return `*Verification Failed*\n\n_${escapeMarkdown(taskLabel)}_\n\n${escapeMarkdown(reason || 'Could not verify this task. Please try again.')}`;
}

module.exports = {
  escapeMarkdown,
  bold,
  italic,
  code,
  formatRaidMessage,
  formatTaskLabel,
  formatLeaderboard,
  formatActiveRaids,
  formatTaskVerificationResult,
};
