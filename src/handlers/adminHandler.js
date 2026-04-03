const db = require('../database');
const tw = require('../twitter');
const { formatActiveRaids, escapeMarkdown, formatRaidMessage } = require('../utils/formatter');
const {
  mainAdminKeyboard,
  descriptionSkipKeyboard,
  taskTypeToggleKeyboard,
  submitRaidKeyboard,
  settingsKeyboard,
  closeRaidKeyboard,
  TASK_LABELS,
} = require('../utils/keyboards');

function isAdmin(userId) {
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim());
  return adminIds.includes(String(userId));
}

// ─────────────────────────────────────────────
//  ADMIN PANEL
// ─────────────────────────────────────────────
async function handleAdminMenu(telegram, chatId, userId) {
  if (!isAdmin(userId)) {
    return telegram.sendMessage(chatId, '_You are not authorized\\._', { parse_mode: 'MarkdownV2' });
  }
  await telegram.sendMessage(
    chatId,
    `*Admin Panel*\n\n_Select an action below:_`,
    { parse_mode: 'MarkdownV2', reply_markup: mainAdminKeyboard() }
  );
}

// ─────────────────────────────────────────────
//  CREATE RAID  (multi-step)
// ─────────────────────────────────────────────
async function handleCallbackCreateRaid(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');

  db.setAdminSession(userId, 'create_raid:title', {});
  await ctx.answerCbQuery();
  await ctx.telegram.sendMessage(
    userId,
    `*Create Raid*  \\(Step 1\\)\n\n*Send the raid title:*\n_Example:_ \`Alpha Project Twitter Raid\``,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleCallbackActiveRaids(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');
  await ctx.answerCbQuery();

  const groups = db.getUserGroups(userId);
  if (groups.length === 0) {
    return ctx.telegram.sendMessage(userId, '_No groups found\\. Add the bot to a group first\\._', { parse_mode: 'MarkdownV2' });
  }
  for (const group of groups) {
    const raids = db.getActiveRaids(group.id);
    await ctx.telegram.sendMessage(userId, formatActiveRaids(raids, group.name), { parse_mode: 'MarkdownV2' });
  }
}

async function handleCallbackSettings(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');
  await ctx.answerCbQuery();
  await ctx.telegram.sendMessage(
    userId,
    `*Settings*\n\n_Choose a setting to configure:_`,
    { parse_mode: 'MarkdownV2', reply_markup: settingsKeyboard() }
  );
}

async function handleCallbackSettingsMinChars(ctx) {
  await ctx.answerCbQuery();
  db.setAdminSession(ctx.from.id, 'settings:min_chars', {});
  await ctx.telegram.sendMessage(
    ctx.from.id,
    `*Minimum Comment Length*\n\n_Send a number between 5 and 500\\. This applies to comment and quote tweet tasks\\._\n\nExample: \`30\``,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleCallbackSettingsLbTopic(ctx) {
  await ctx.answerCbQuery();
  db.setAdminSession(ctx.from.id, 'settings:lb_topic', {});
  await ctx.telegram.sendMessage(
    ctx.from.id,
    `*Leaderboard Topic ID*\n\n_Send the numeric topic ID where leaderboards will be auto\\-posted\\._`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleCallbackCloseRaid(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');
  await ctx.answerCbQuery();

  const groups = db.getUserGroups(userId);
  let allRaids = [];
  for (const g of groups) allRaids = allRaids.concat(db.getActiveRaids(g.id));

  if (allRaids.length === 0) {
    return ctx.telegram.sendMessage(userId, '_No active raids to close\\._', { parse_mode: 'MarkdownV2' });
  }
  await ctx.telegram.sendMessage(
    userId,
    `*Close a Raid*\n\n_Select the raid to close:_`,
    { parse_mode: 'MarkdownV2', reply_markup: closeRaidKeyboard(allRaids) }
  );
}

async function handleConfirmCloseRaid(ctx, raidId) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');

  const raid = db.getRaid(raidId);
  if (!raid) return ctx.answerCbQuery('Raid not found.');

  db.closeRaid(raidId);
  await ctx.answerCbQuery();
  await ctx.telegram.sendMessage(
    userId,
    `*Raid Closed*\n\n_${escapeMarkdown(raid.title)}_ has been closed\\.`,
    { parse_mode: 'MarkdownV2' }
  );
}

// ─────────────────────────────────────────────
//  TASK TYPE MULTI-SELECT
// ─────────────────────────────────────────────
async function handleTaskToggle(ctx, taskType) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');

  const session = db.getAdminSession(userId);
  if (!session || session.state !== 'create_raid:select_tasks') {
    return ctx.answerCbQuery('Session expired. Run /admin again.');
  }

  const selected = session.data.selected_tasks || {};
  selected[taskType] = !selected[taskType];
  db.setAdminSession(userId, 'create_raid:select_tasks', { ...session.data, selected_tasks: selected });

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(taskTypeToggleKeyboard(selected)).catch(() => {});
}

async function handleTaskConfirm(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');

  const session = db.getAdminSession(userId);
  if (!session || session.state !== 'create_raid:select_tasks') {
    return ctx.answerCbQuery('Session expired. Run /admin again.');
  }

  const selected = session.data.selected_tasks || {};
  const chosen = Object.keys(selected).filter((k) => selected[k]);

  if (chosen.length === 0) {
    return ctx.answerCbQuery('Select at least one task type.');
  }

  await ctx.answerCbQuery();

  // If follow is selected, ask for the profile link
  if (selected.follow) {
    db.setAdminSession(userId, 'create_raid:follow_link', { ...session.data, pending_tasks: chosen });
    await ctx.telegram.sendMessage(
      userId,
      `*Follow Task Setup*\n\n_Send the Twitter profile link or @username for the account to follow\\._\n\nExample: \`https://x\\.com/projectname\`  or  \`@projectname\``,
      { parse_mode: 'MarkdownV2' }
    );
  } else {
    // No follow task — finalize directly
    await finalizeRaidAndPublish(ctx.telegram, userId, session.data, chosen, null);
  }
}

// ─────────────────────────────────────────────
//  TEXT INPUT HANDLER
// ─────────────────────────────────────────────
async function handleAdminTextInput(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return false;

  const session = db.getAdminSession(userId);
  if (!session) return false;

  const text = ctx.message?.text?.trim();
  const { state, data } = session;

  // ── Step 1: Title
  if (state === 'create_raid:title') {
    if (!text || text.length < 2) {
      await ctx.telegram.sendMessage(userId, '_Title is too short\\. Please enter a valid title\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }
    db.setAdminSession(userId, 'create_raid:description', { ...data, title: text });
    await ctx.telegram.sendMessage(
      userId,
      `*Create Raid*  \\(Step 2\\)\n\n*Send a description for this raid:*\n_This will be shown to participants\\. You can write anything \\(rules, instructions, etc\\.\\)_\n\nOr tap Skip to leave it blank\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: descriptionSkipKeyboard() }
    );
    return true;
  }

  // ── Step 2: Description (text path)
  if (state === 'create_raid:description') {
    db.setAdminSession(userId, 'create_raid:link', { ...data, description: text });
    await ctx.telegram.sendMessage(
      userId,
      `*Create Raid*  \\(Step 3\\)\n\n*Send the main raid link:*\n_This is the tweet/post link participants will engage with\\._\n\nExample: \`https://x\\.com/user/status/1234567890\``,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  // ── Step 3: Main Link
  if (state === 'create_raid:link') {
    if (!text || !text.startsWith('http')) {
      await ctx.telegram.sendMessage(userId, '_Invalid link\\. Please send a valid URL starting with https://\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }
    db.setAdminSession(userId, 'create_raid:reward', { ...data, link: text });
    await ctx.telegram.sendMessage(
      userId,
      `*Create Raid*  \\(Step 4\\)\n\n*Send the reward in points:*\n\nExample: \`100\``,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  // ── Step 4: Reward
  if (state === 'create_raid:reward') {
    const reward = parseInt(text, 10);
    if (isNaN(reward) || reward < 0) {
      await ctx.telegram.sendMessage(userId, '_Invalid number\\. Please send a positive number\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }

    const groups = db.getUserGroups(userId);
    if (groups.length === 0) {
      await ctx.telegram.sendMessage(userId, '_No groups found\\. Add the bot to a group first\\._', { parse_mode: 'MarkdownV2' });
      db.clearAdminSession(userId);
      return true;
    }

    const newData = { ...data, reward };

    if (groups.length === 1) {
      await showTaskTypeSelector(ctx.telegram, userId, { ...newData, group_id: groups[0].id });
    } else {
      const buttons = groups.map((g) => ([
        { text: g.name || `Group ${g.telegram_id}`, callback_data: `admin:raid_group:${g.id}` },
      ]));
      db.setAdminSession(userId, 'create_raid:select_group', newData);
      await ctx.telegram.sendMessage(
        userId,
        `*Select Group*\n\n_Which group should this raid be posted to?_`,
        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: buttons } }
      );
    }
    return true;
  }

  // ── Follow link input
  if (state === 'create_raid:follow_link') {
    const rawInput = text;
    let username = null;
    let profileLink = rawInput;

    if (rawInput.match(/^@?[A-Za-z0-9_]{1,50}$/)) {
      username = rawInput.replace(/^@/, '');
      profileLink = `https://x.com/${username}`;
    } else if (rawInput.match(/https?:\/\/(twitter|x)\.com\/([A-Za-z0-9_]+)/i)) {
      const match = rawInput.match(/https?:\/\/(twitter|x)\.com\/([A-Za-z0-9_]+)/i);
      username = match[2];
      profileLink = rawInput;
    } else {
      await ctx.telegram.sendMessage(
        userId,
        `_Invalid input\\. Send a Twitter username \\(e\\.g\\. \`@projectname\`\\) or profile URL\\._`,
        { parse_mode: 'MarkdownV2' }
      );
      return true;
    }

    const chosen = data.pending_tasks || [];
    await finalizeRaidAndPublish(ctx.telegram, userId, data, chosen, { username, profileLink });
    return true;
  }

  // ── Settings: min chars
  if (state === 'settings:min_chars') {
    const limit = parseInt(text, 10);
    if (isNaN(limit) || limit < 5 || limit > 500) {
      await ctx.telegram.sendMessage(userId, '_Invalid value\\. Enter a number between 5 and 500\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }
    const groups = db.getUserGroups(userId);
    for (const g of groups) db.setGroupMinCharLimit(g.telegram_id, limit);
    db.clearAdminSession(userId);
    await ctx.telegram.sendMessage(
      userId,
      `*Setting Updated*\n\n_Minimum comment length set to_ *${limit} characters*\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  // ── Settings: leaderboard topic
  if (state === 'settings:lb_topic') {
    const topicId = parseInt(text, 10);
    if (isNaN(topicId)) {
      await ctx.telegram.sendMessage(userId, '_Invalid topic ID\\. Please send a number\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }
    const groups = db.getUserGroups(userId);
    for (const g of groups) db.setGroupLeaderboardTopic(g.telegram_id, topicId);
    db.clearAdminSession(userId);
    await ctx.telegram.sendMessage(
      userId,
      `*Setting Updated*\n\n_Leaderboard topic ID set to_ \`${topicId}\`\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────
//  SKIP DESCRIPTION CALLBACK
// ─────────────────────────────────────────────
async function handleSkipDescription(ctx) {
  const userId = ctx.from.id;
  const session = db.getAdminSession(userId);
  if (!session || session.state !== 'create_raid:description') {
    return ctx.answerCbQuery('Session expired.');
  }
  await ctx.answerCbQuery();
  db.setAdminSession(userId, 'create_raid:link', { ...session.data, description: null });
  await ctx.telegram.sendMessage(
    userId,
    `*Create Raid*  \\(Step 3\\)\n\n*Send the main raid link:*\n_This is the tweet/post link participants will engage with\\._\n\nExample: \`https://x\\.com/user/status/1234567890\``,
    { parse_mode: 'MarkdownV2' }
  );
}

// ─────────────────────────────────────────────
//  TASK SELECTOR DISPLAY
// ─────────────────────────────────────────────
async function showTaskTypeSelector(telegram, userId, data) {
  const selected = {};
  db.setAdminSession(userId, 'create_raid:select_tasks', { ...data, selected_tasks: selected });
  await telegram.sendMessage(
    userId,
    `*Select Task Types*\n\n_Tap to toggle which tasks participants must complete for this raid\\. Then tap Confirm\\._`,
    { parse_mode: 'MarkdownV2', reply_markup: taskTypeToggleKeyboard(selected) }
  );
}

// ─────────────────────────────────────────────
//  GROUP SELECT (multi-group flow)
// ─────────────────────────────────────────────
async function handleRaidGroupSelect(ctx, groupId) {
  const userId = ctx.from.id;
  const session = db.getAdminSession(userId);
  if (!session) return ctx.answerCbQuery('Session expired.');

  await ctx.answerCbQuery();
  await showTaskTypeSelector(ctx.telegram, userId, { ...session.data, group_id: parseInt(groupId, 10) });
}

// ─────────────────────────────────────────────
//  FINALIZE & PUBLISH
// ─────────────────────────────────────────────
async function finalizeRaidAndPublish(telegram, userId, data, chosenTaskTypes, followInfo) {
  const groupId = data.group_id;
  const minChars = (() => {
    try {
      const g = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
      return g?.min_char_limit || 20;
    } catch { return 20; }
  })();

  // Create raid
  const raidId = db.createRaid(groupId, data.title, data.description || null, data.link, data.reward, userId);

  // Extract tweet ID from main link
  const mainTweetId = tw.extractTweetId(data.link);

  // Add each selected task
  for (const taskType of chosenTaskTypes) {
    if (taskType === 'follow') {
      const username = followInfo?.username || null;
      const profileLink = followInfo?.profileLink || null;
      db.addTask(raidId, 'twitter', 'follow', null, username, null, profileLink, null);
    } else {
      // like, retweet, comment, quote all use the main raid link
      db.addTask(raidId, 'twitter', taskType, null, null, mainTweetId, data.link, minChars);
    }
  }

  const tasks = db.getTasksByRaid(raidId);
  db.clearAdminSession(userId);

  // Post to group
  const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) {
    await telegram.sendMessage(userId, '_Error: group not found\\._', { parse_mode: 'MarkdownV2' });
    return;
  }

  const msg = formatRaidMessage({ ...db.getRaid(raidId) }, tasks);
  const sendOpts = { parse_mode: 'MarkdownV2', reply_markup: submitRaidKeyboard(raidId) };
  if (group.leaderboard_topic_id) sendOpts.message_thread_id = group.leaderboard_topic_id;

  await telegram.sendMessage(group.telegram_id, msg, sendOpts).catch((err) => {
    console.error('[Admin] Failed to post raid to group:', err.message);
  });

  const taskSummary = chosenTaskTypes.map((t) => {
    if (t === 'follow' && followInfo?.username) return `Follow @${followInfo.username}`;
    return TASK_LABELS[t] || t;
  }).join(', ');

  await telegram.sendMessage(
    userId,
    `*Raid Published*\n\n*Title:* ${escapeMarkdown(data.title)}\n*Tasks:* ${escapeMarkdown(taskSummary)}\n*Reward:* ${data.reward} points\n\n_The raid has been posted to the group\\._`,
    { parse_mode: 'MarkdownV2' }
  );
}

module.exports = {
  isAdmin,
  handleAdminMenu,
  handleCallbackCreateRaid,
  handleCallbackActiveRaids,
  handleCallbackSettings,
  handleCallbackSettingsMinChars,
  handleCallbackSettingsLbTopic,
  handleCallbackCloseRaid,
  handleConfirmCloseRaid,
  handleAdminTextInput,
  handleTaskToggle,
  handleTaskConfirm,
  handleSkipDescription,
  handleRaidGroupSelect,
};
