function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

function bold(text)   { return `*${escapeMarkdown(text)}*`; }
function italic(text) { return `_${escapeMarkdown(text)}_`; }
function code(text)   { return `\`${escapeMarkdown(text)}\``; }
function divider()    { return `\n──────────────────\n`; }

// ── Raid card (posted in group) ───────────────────────────────────────────────
function formatRaidMessage(raid, tasks) {
  const taskLines = tasks.map((t, i) =>
    `  ${i + 1}\\. ${escapeMarkdown(formatTaskLabel(t))}`
  ).join('\n');

  let msg = `🚨 *New Raid*\n`;
  msg += divider();
  msg += `*Task:* ${escapeMarkdown(raid.title)}\n`;
  if (raid.link) msg += `*Link:* ${escapeMarkdown(raid.link)}\n`;
  msg += `*Reward:* ${escapeMarkdown(String(raid.reward))} pts\n`;
  if (tasks.length > 0) {
    msg += divider();
    msg += `*What to do:*\n${taskLines}\n`;
  }
  if (raid.description) {
    msg += divider();
    msg += `${escapeMarkdown(raid.description)}\n`;
  }
  msg += divider();
  msg += `_Tap Submit after completing all tasks\\._`;
  return msg;
}

// ── Task label (human-readable) ───────────────────────────────────────────────
function formatTaskLabel(task) {
  const t = task.type || task.taskType || '';
  switch (t) {
    case 'follow':  return `Follow @${task.target_username || task.targetUsername || '?'}`;
    case 'like':    return 'Like the Tweet';
    case 'retweet': return 'Retweet';
    case 'quote':   return 'Quote Tweet';
    case 'comment': return 'Comment on the Tweet';
    case 'join':    return `Join ${task.details || 'the group/channel'}`;
    case 'react':   return 'React to the Message';
    case 'send':    return 'Send a Message';
    default:        return t || 'Task';
  }
}

// ── Per-task instruction (shown in DM) ────────────────────────────────────────
function formatTaskInstruction(task, index) {
  const header = `*Task ${index + 1}: ${escapeMarkdown(formatTaskLabel(task))}*`;
  const t = task.type || task.taskType || '';
  const instructions = {
    follow:  `Follow the account, then tap *Verify* below\\.`,
    like:    `Like the tweet, then tap *Verify* below\\.`,
    retweet: `Retweet the post, then tap *Verify* below\\.`,
    comment: `Reply to the tweet with at least *${task.min_chars || 20} characters*\\. No emoji\\-only or repetitive replies\\.\n\nThen send your tweet link here in this chat\\.`,
    quote:   `Quote tweet with at least *${task.min_chars || 20} characters*\\. No emoji\\-only or repetitive content\\.\n\nThen send your quote tweet link here in this chat\\.`,
    join:    `Join the channel or group, then tap *Verify I Joined* below\\.`,
    react:   `React to the message, then tap *Mark as Done* below\\.`,
    send:    `Send a message in the group, then tap *Mark as Done* below\\.`,
  };
  const body = instructions[t] || `Complete the task and tap Done\\.`;
  return `${header}\n\n_${body}_`;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function formatLeaderboard(entries, groupName) {
  if (!entries || entries.length === 0) {
    return (
      `🏆 *Leaderboard*\n` +
      `_${escapeMarkdown(groupName || 'Group')}_` +
      divider() +
      `_No entries yet\\. Complete raids to earn points\\._`
    );
  }
  const rankLabel = (i) => {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return `${i + 1}\\.`;
  };
  const rows = entries.map((e, i) => {
    const name = e.username ? `@${e.username}` : (e.first_name || 'Unknown');
    return `${rankLabel(i)} ${escapeMarkdown(name)} — *${escapeMarkdown(String(e.points))} pts*`;
  });
  return (
    `🏆 *Leaderboard*\n` +
    `_${escapeMarkdown(groupName || 'Group')}_` +
    divider() +
    rows.join('\n')
  );
}

// ── Active raids list ─────────────────────────────────────────────────────────
function formatActiveRaids(raids, groupName) {
  if (!raids || raids.length === 0) {
    return (
      `📋 *Active Raids*\n` +
      `_${escapeMarkdown(groupName || 'Group')}_` +
      divider() +
      `_No active raids at the moment\\._`
    );
  }
  const rows = raids.map((r, i) =>
    `*${i + 1}\\. ${escapeMarkdown(r.title)}*\n` +
    `   Reward: _${escapeMarkdown(String(r.reward))} pts_\n` +
    `   Tasks: _${escapeMarkdown(String(r.task_count || 0))}_`
  );
  return (
    `📋 *Active Raids*\n` +
    `_${escapeMarkdown(groupName || 'Group')}_` +
    divider() +
    rows.join('\n\n')
  );
}

// ── Verification results ──────────────────────────────────────────────────────
function formatVerificationFailed(taskLabel, reason) {
  return (
    `❌ *Verification Failed*\n` +
    `_${escapeMarkdown(taskLabel)}_` +
    `\n\n` +
    `${escapeMarkdown(reason || 'Could not verify this task\\. Please try again\\.')}`
  );
}

function formatVerificationSuccess(taskLabel) {
  return (
    `✅ *Task Verified*\n` +
    `_${escapeMarkdown(taskLabel)}_` +
    `\n\nVerified successfully\\.`
  );
}

function formatRaidComplete(raid, reward) {
  return (
    `🎉 *Raid Complete\\!*` +
    divider() +
    `*${escapeMarkdown(raid.title)}*\n\n` +
    `*Points Earned:* ${escapeMarkdown(String(reward))} pts\n\n` +
    `_Well done\\! Keep completing raids to climb the leaderboard\\._`
  );
}

module.exports = {
  escapeMarkdown,
  bold, italic, code, divider,
  formatRaidMessage,
  formatTaskLabel,
  formatTaskInstruction,
  formatLeaderboard,
  formatActiveRaids,
  formatVerificationFailed,
  formatVerificationSuccess,
  formatRaidComplete,
};
