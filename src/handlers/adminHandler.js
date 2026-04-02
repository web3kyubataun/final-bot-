const db = require('../database');
const tw = require('../twitter');
const { formatActiveRaids, escapeMarkdown } = require('../utils/formatter');
const {
  mainAdminKeyboard, taskPlatformKeyboard, twitterTaskTypeKeyboard,
  telegramTaskTypeKeyboard, settingsKeyboard, closeRaidKeyboard,
} = require('../utils/keyboards');

function isAdmin(userId) {
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim());
  return adminIds.includes(String(userId));
}

async function handleAdminMenu(telegram, chatId, userId) {
  if (!isAdmin(userId)) {
    return telegram.sendMessage(chatId, '_You are not authorized to use admin commands\\._', { parse_mode: 'MarkdownV2' });
  }
  await telegram.sendMessage(
    chatId,
    `*Admin Panel*\n\n_Choose an action:_`,
    { parse_mode: 'MarkdownV2', reply_markup: mainAdminKeyboard() }
  );
}

async function handleCallbackCreateRaid(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return ctx.answerCbQuery('Not authorized.');

  db.setAdminSession(userId, 'create_raid:title', {});
  await ctx.answerCbQuery();
  await ctx.telegram.sendMessage(
    userId,
    `*Create Raid* \\(Step 1 of 3\\)\n\n*Send the raid title:*\n_Example:_ \`Alpha Project Twitter Raid\``,
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
    `*Set Minimum Comment Length*\n\n_Send a number between 5 and 500\\._\n\nExample: \`20\``,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleCallbackSettingsLbTopic(ctx) {
  await ctx.answerCbQuery();
  db.setAdminSession(ctx.from.id, 'settings:lb_topic', {});
  await ctx.telegram.sendMessage(
    ctx.from.id,
    `*Set Leaderboard Topic*\n\n_Send the numeric topic ID where you want leaderboards auto\\-posted\\._`,
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
    `*Raid Closed*\n\n_Raid_ *${escapeMarkdown(raid.title)}* _has been closed\\._`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleAdminTextInput(ctx) {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return false;

  const session = db.getAdminSession(userId);
  if (!session) return false;

  const text = ctx.message?.text?.trim();
  const { state, data } = session;

  if (state === 'create_raid:title') {
    db.setAdminSession(userId, 'create_raid:link', { ...data, title: text });
    await ctx.telegram.sendMessage(
      userId,
      `*Create Raid* \\(Step 2 of 3\\)\n\n*Send the raid link:*\n_Example:_ \`https://x.com/project/status/123456789\``,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  if (state === 'create_raid:link') {
    db.setAdminSession(userId, 'create_raid:reward', { ...data, link: text });
    await ctx.telegram.sendMessage(
      userId,
      `*Create Raid* \\(Step 3 of 3\\)\n\n*Send the reward in points:*\n_Example:_ \`100\``,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  if (state === 'create_raid:reward') {
    const reward = parseInt(text, 10);
    if (isNaN(reward) || reward < 0) {
      await ctx.telegram.sendMessage(userId, '_Invalid number\\. Please send a valid reward amount\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }

    const groups = db.getUserGroups(userId);
    if (groups.length === 0) {
      await ctx.telegram.sendMessage(userId, '_No groups found\\. Add the bot to a group first\\._', { parse_mode: 'MarkdownV2' });
      db.clearAdminSession(userId);
      return true;
    }

    if (groups.length === 1) {
      await finalizeRaidCreation(ctx.telegram, userId, { ...data, reward }, groups[0].id);
    } else {
      const buttons = groups.map((g) => ([{ text: g.name || `Group ${g.telegram_id}`, callback_data: `admin:raid_group:${g.id}` }]));
      db.setAdminSession(userId, 'create_raid:select_group', { ...data, reward });
      await ctx.telegram.sendMessage(
        userId,
        `*Select Group*\n\n_Which group should this raid be posted to?_`,
        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: buttons } }
      );
    }
    return true;
  }

  if (state === 'settings:min_chars') {
    const limit = parseInt(text, 10);
    if (isNaN(limit) || limit < 1 || limit > 500) {
      await ctx.telegram.sendMessage(userId, '_Invalid value\\. Enter a number between 1 and 500\\._', { parse_mode: 'MarkdownV2' });
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

  if (state === 'task:follow:username') {
    const username = text.replace(/^@/, '').replace(/https?:\/\/(twitter|x)\.com\//i, '').split('/')[0];
    db.addTask(data.raid_id, 'twitter', 'follow', null, username, null, null);
    db.setAdminSession(userId, 'task:adding', { ...data });
    await ctx.telegram.sendMessage(
      userId,
      `*Task Added*\n\n_Follow @${escapeMarkdown(username)}_\n\n_Add more tasks or tap Done\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: taskPlatformKeyboard() }
    );
    return true;
  }

  if (state === 'task:tweet_id') {
    const tweetId = tw.extractTweetId(text) || text.trim();
    const taskType = data.tweet_task_type;
    db.addTask(data.raid_id, 'twitter', taskType, null, null, tweetId, null);
    db.setAdminSession(userId, 'task:adding', { ...data });
    await ctx.telegram.sendMessage(
      userId,
      `*Task Added*\n\n_Twitter ${escapeMarkdown(taskType)} task_\n\n_Add more tasks or tap Done\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: taskPlatformKeyboard() }
    );
    return true;
  }

  if (state === 'task:tg:details') {
    const taskType = data.tg_task_type;
    db.addTask(data.raid_id, 'telegram', taskType, text, null, null, null);
    db.setAdminSession(userId, 'task:adding', { ...data });
    await ctx.telegram.sendMessage(
      userId,
      `*Task Added*\n\n_Telegram ${escapeMarkdown(taskType)} task_\n\n_Add more tasks or tap Done\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: taskPlatformKeyboard() }
    );
    return true;
  }

  return false;
}

async function finalizeRaidCreation(telegram, userId, data, groupId) {
  const raidId = db.createRaid(groupId, data.title, data.link, data.reward, userId);
  db.setAdminSession(userId, 'task:adding', { raid_id: raidId, group_id: groupId });

  await telegram.sendMessage(
    userId,
    `*Raid Created*\n\n*Title:* _${escapeMarkdown(data.title)}_\n*Link:* _${escapeMarkdown(data.link)}_\n*Reward:* _${data.reward} points_\n\n*Now add tasks to this raid:*`,
    { parse_mode: 'MarkdownV2', reply_markup: taskPlatformKeyboard() }
  );
}

async function handleTaskPlatformCallback(ctx, platform) {
  const userId = ctx.from.id;
  await ctx.answerCbQuery();

  if (platform === 'done') {
    const session = db.getAdminSession(userId);
    const raidId = session?.data?.raid_id;
    if (!raidId) {
      db.clearAdminSession(userId);
      return ctx.telegram.sendMessage(userId, '_Raid creation cancelled\\._', { parse_mode: 'MarkdownV2' });
    }

    const raid = db.getRaid(raidId);
    const tasks = db.getTasksByRaid(raidId);
    db.clearAdminSession(userId);

    const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(raid.group_id);
    if (!group) return;

    const { formatRaidMessage } = require('../utils/formatter');
    const { submitRaidKeyboard } = require('../utils/keyboards');
    const msg = formatRaidMessage(raid, tasks);

    const sendOpts = { parse_mode: 'MarkdownV2', reply_markup: submitRaidKeyboard(raidId) };
    if (group.leaderboard_topic_id) sendOpts.message_thread_id = group.leaderboard_topic_id;

    await ctx.telegram.sendMessage(group.telegram_id, msg, sendOpts).catch(() => {});
    await ctx.telegram.sendMessage(
      userId,
      `*Raid Published*\n\n_The raid has been posted to the group\\. ${tasks.length} task(s) added\\._`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const markup = platform === 'twitter' ? twitterTaskTypeKeyboard()
    : platform === 'telegram' ? telegramTaskTypeKeyboard()
    : taskPlatformKeyboard();

  await ctx.editMessageReplyMarkup(markup).catch(() => {});
}

async function handleTwitterTaskCallback(ctx, taskType) {
  const userId = ctx.from.id;
  const session = db.getAdminSession(userId);
  if (!session) return ctx.answerCbQuery('Session expired. Run /admin again.');

  await ctx.answerCbQuery();

  if (taskType === 'follow') {
    db.setAdminSession(userId, 'task:follow:username', { ...session.data });
    return ctx.telegram.sendMessage(
      userId,
      `*Twitter Follow Task*\n\n_Send the Twitter username or profile link to follow\\._\n\nExample: \`@projectname\` or \`https://x.com/projectname\``,
      { parse_mode: 'MarkdownV2' }
    );
  }

  db.setAdminSession(userId, 'task:tweet_id', { ...session.data, tweet_task_type: taskType });
  await ctx.telegram.sendMessage(
    userId,
    `*Twitter ${escapeMarkdown(taskType.charAt(0).toUpperCase() + taskType.slice(1))} Task*\n\n_Send the tweet link or tweet ID\\._\n\nExample: \`https://x.com/user/status/1234567890\``,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleTelegramTaskCallback(ctx, taskType) {
  const userId = ctx.from.id;
  const session = db.getAdminSession(userId);
  if (!session) return ctx.answerCbQuery('Session expired. Run /admin again.');

  await ctx.answerCbQuery();
  db.setAdminSession(userId, 'task:tg:details', { ...session.data, tg_task_type: taskType });

  const prompts = {
    join: 'Send the group or channel name/link \\(e\\.g\\. `@myproject` or `https://t.me/myproject`\\)\\.',
    react: 'Send the message link or description of the message to react to\\.',
    send: 'Send the group name where users should post a message\\.',
  };

  await ctx.telegram.sendMessage(
    userId,
    `*Telegram ${escapeMarkdown(taskType.charAt(0).toUpperCase() + taskType.slice(1))} Task*\n\n_${prompts[taskType] || 'Send details for this task\\.'}`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleRaidGroupSelect(ctx, groupId) {
  const userId = ctx.from.id;
  const session = db.getAdminSession(userId);
  if (!session) return ctx.answerCbQuery('Session expired.');

  await ctx.answerCbQuery();
  await finalizeRaidCreation(ctx.telegram, userId, session.data, parseInt(groupId, 10));
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
  handleTaskPlatformCallback,
  handleTwitterTaskCallback,
  handleTelegramTaskCallback,
  handleRaidGroupSelect,
};
