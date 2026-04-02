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

async function handleAdminMenu(bot, chatId, userId) {
  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '_You are not authorized to use admin commands\\._', { parse_mode: 'MarkdownV2' });
  }
  await bot.sendMessage(
    chatId,
    `*Admin Panel*\n\n_Choose an action:_`,
    { parse_mode: 'MarkdownV2', reply_markup: mainAdminKeyboard() }
  );
}

async function handleCallbackCreateRaid(bot, query) {
  const userId = query.from.id;
  if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: 'Not authorized.', show_alert: true });

  db.setAdminSession(userId, 'create_raid:title', {});
  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(
    userId,
    `*Create Raid* \\(Step 1 of 3\\)\n\n*Send the raid title:*\n_Example:_ \`Alpha Project Twitter Raid\``,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleCallbackActiveRaids(bot, query) {
  const userId = query.from.id;
  if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: 'Not authorized.', show_alert: true });

  await bot.answerCallbackQuery(query.id);

  const groups = db.getUserGroups(userId);
  if (groups.length === 0) {
    return bot.sendMessage(userId, '_No groups found\\. Add the bot to a group first\\._', { parse_mode: 'MarkdownV2' });
  }

  for (const group of groups) {
    const raids = db.getActiveRaids(group.id);
    const msg = formatActiveRaids(raids, group.name);
    await bot.sendMessage(userId, msg, { parse_mode: 'MarkdownV2' });
  }
}

async function handleCallbackSettings(bot, query) {
  const userId = query.from.id;
  if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: 'Not authorized.', show_alert: true });

  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(
    userId,
    `*Settings*\n\n_Choose a setting to configure:_`,
    { parse_mode: 'MarkdownV2', reply_markup: settingsKeyboard() }
  );
}

async function handleCallbackSettingsMinChars(bot, query) {
  await bot.answerCallbackQuery(query.id);
  db.setAdminSession(query.from.id, 'settings:min_chars', {});
  await bot.sendMessage(
    query.from.id,
    `*Set Minimum Comment Length*\n\n_Send a number between 5 and 500\\. This is the minimum character length for group replies and Twitter comments\\._\n\nExample: \`20\``,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleCallbackSettingsLbTopic(bot, query) {
  await bot.answerCallbackQuery(query.id);
  db.setAdminSession(query.from.id, 'settings:lb_topic', {});
  await bot.sendMessage(
    query.from.id,
    `*Set Leaderboard Topic*\n\n_Forward any message from the topic where you want the leaderboard posted\\. The bot will extract the topic ID automatically\\._\n\n_Or send the numeric topic ID directly\\._`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleCallbackCloseRaid(bot, query) {
  const userId = query.from.id;
  if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: 'Not authorized.', show_alert: true });

  await bot.answerCallbackQuery(query.id);

  const groups = db.getUserGroups(userId);
  let allRaids = [];
  for (const g of groups) {
    const raids = db.getActiveRaids(g.id);
    allRaids = allRaids.concat(raids);
  }

  if (allRaids.length === 0) {
    return bot.sendMessage(userId, '_No active raids to close\\._', { parse_mode: 'MarkdownV2' });
  }

  await bot.sendMessage(
    userId,
    `*Close a Raid*\n\n_Select the raid to close:_`,
    { parse_mode: 'MarkdownV2', reply_markup: closeRaidKeyboard(allRaids) }
  );
}

async function handleConfirmCloseRaid(bot, query, raidId) {
  const userId = query.from.id;
  if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: 'Not authorized.', show_alert: true });

  const raid = db.getRaid(raidId);
  if (!raid) return bot.answerCallbackQuery(query.id, { text: 'Raid not found.', show_alert: true });

  db.closeRaid(raidId);
  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(
    userId,
    `*Raid Closed*\n\n_Raid_ *${escapeMarkdown(raid.title)}* _has been closed\\. No further submissions will be accepted\\._`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleAdminTextInput(bot, msg) {
  const userId = msg.from.id;
  if (!isAdmin(userId)) return;

  const session = db.getAdminSession(userId);
  if (!session) return false;

  const text = msg.text?.trim();
  const { state, data } = session;

  // --- Raid creation flow ---
  if (state === 'create_raid:title') {
    db.setAdminSession(userId, 'create_raid:link', { ...data, title: text });
    await bot.sendMessage(
      userId,
      `*Create Raid* \\(Step 2 of 3\\)\n\n*Send the raid link:*\n_Example:_ \`https://x.com/project/status/123456789\``,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  if (state === 'create_raid:link') {
    db.setAdminSession(userId, 'create_raid:reward', { ...data, link: text });
    await bot.sendMessage(
      userId,
      `*Create Raid* \\(Step 3 of 3\\)\n\n*Send the reward in points:*\n_Example:_ \`100\``,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  if (state === 'create_raid:reward') {
    const reward = parseInt(text, 10);
    if (isNaN(reward) || reward < 0) {
      await bot.sendMessage(userId, '_Invalid number\\. Please send a valid reward amount\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }

    const groups = db.getUserGroups(userId);
    if (groups.length === 0) {
      await bot.sendMessage(userId, '_No groups found\\. Add the bot to a group first\\._', { parse_mode: 'MarkdownV2' });
      db.clearAdminSession(userId);
      return true;
    }

    let groupId;
    if (groups.length === 1) {
      groupId = groups[0].id;
    } else {
      const buttons = groups.map((g) => ([
        { text: g.name || `Group ${g.telegram_id}`, callback_data: `admin:raid_group:${g.id}` },
      ]));
      db.setAdminSession(userId, 'create_raid:select_group', { ...data, reward });
      await bot.sendMessage(
        userId,
        `*Select Group*\n\n_Which group should this raid be posted to?_`,
        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: buttons } }
      );
      return true;
    }

    await finalizeRaidCreation(bot, userId, { ...data, reward }, groupId);
    return true;
  }

  // --- Settings flow ---
  if (state === 'settings:min_chars') {
    const limit = parseInt(text, 10);
    if (isNaN(limit) || limit < 1 || limit > 500) {
      await bot.sendMessage(userId, '_Invalid value\\. Enter a number between 1 and 500\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }

    const groups = db.getUserGroups(userId);
    for (const g of groups) {
      db.setGroupMinCharLimit(g.telegram_id, limit);
    }

    db.clearAdminSession(userId);
    await bot.sendMessage(
      userId,
      `*Setting Updated*\n\n_Minimum comment length set to_ *${limit} characters* _for all your groups\\._`,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  if (state === 'settings:lb_topic') {
    let topicId;

    if (msg.forward_from_message_id && msg.forward_origin) {
      topicId = msg.message_thread_id || null;
    } else {
      topicId = parseInt(text, 10);
    }

    if (!topicId || isNaN(topicId)) {
      await bot.sendMessage(userId, '_Invalid topic ID\\. Please try again or forward a message from the topic\\._', { parse_mode: 'MarkdownV2' });
      return true;
    }

    const groups = db.getUserGroups(userId);
    for (const g of groups) {
      db.setGroupLeaderboardTopic(g.telegram_id, topicId);
    }

    db.clearAdminSession(userId);
    await bot.sendMessage(
      userId,
      `*Setting Updated*\n\n_Leaderboard topic ID set to_ \`${topicId}\`\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    return true;
  }

  // --- Task creation flow ---
  if (state === 'task:follow:username') {
    const username = text.replace(/^@/, '').replace(/https?:\/\/(twitter|x)\.com\//, '');
    db.setAdminSession(userId, 'task:adding', { ...data, follow_username: username });
    db.addTask(data.raid_id, 'twitter', 'follow', null, username, null, null);
    await bot.sendMessage(
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
    db.setAdminSession(userId, 'task:adding', { ...data, tweet_id: tweetId });
    await bot.sendMessage(
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
    await bot.sendMessage(
      userId,
      `*Task Added*\n\n_Telegram ${escapeMarkdown(taskType)} task_\n\n_Add more tasks or tap Done\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: taskPlatformKeyboard() }
    );
    return true;
  }

  return false;
}

async function finalizeRaidCreation(bot, userId, data, groupId) {
  const raidId = db.createRaid(groupId, data.title, data.link, data.reward, userId);
  db.setAdminSession(userId, 'task:adding', { raid_id: raidId, group_id: groupId });

  await bot.sendMessage(
    userId,
    `*Raid Created*\n\n*Title:* _${escapeMarkdown(data.title)}_\n*Link:* _${escapeMarkdown(data.link)}_\n*Reward:* _${data.reward} points_\n\n*Now add tasks to this raid:*`,
    { parse_mode: 'MarkdownV2', reply_markup: taskPlatformKeyboard() }
  );
}

async function handleTaskPlatformCallback(bot, query, platform) {
  const userId = query.from.id;
  await bot.answerCallbackQuery(query.id);

  if (platform === 'done') {
    const session = db.getAdminSession(userId);
    const raidId = session?.data?.raid_id;
    if (!raidId) {
      db.clearAdminSession(userId);
      return bot.sendMessage(userId, '_Raid creation cancelled\\._', { parse_mode: 'MarkdownV2' });
    }

    const raid = db.getRaid(raidId);
    const tasks = db.getTasksByRaid(raidId);
    db.clearAdminSession(userId);

    const group = db.getDb().prepare('SELECT * FROM groups WHERE id = ?').get(raid.group_id);
    if (!group) return;

    const { formatRaidMessage } = require('../utils/formatter');
    const { submitRaidKeyboard } = require('../utils/keyboards');
    const msg = formatRaidMessage(raid, tasks);

    try {
      const sentOptions = { parse_mode: 'MarkdownV2', reply_markup: submitRaidKeyboard(raidId) };
      if (group.leaderboard_topic_id) sentOptions.message_thread_id = group.leaderboard_topic_id;
      await bot.sendMessage(group.telegram_id, msg, sentOptions);
    } catch {}

    await bot.sendMessage(
      userId,
      `*Raid Published*\n\n_The raid has been posted to the group\\. ${tasks.length} task(s) added\\._`,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  if (platform === 'twitter') {
    await bot.editMessageReplyMarkup(twitterTaskTypeKeyboard(), {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    }).catch(() => {});
    return;
  }

  if (platform === 'telegram') {
    await bot.editMessageReplyMarkup(telegramTaskTypeKeyboard(), {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    }).catch(() => {});
    return;
  }

  if (platform === 'back') {
    await bot.editMessageReplyMarkup(taskPlatformKeyboard(), {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    }).catch(() => {});
  }
}

async function handleTwitterTaskCallback(bot, query, taskType) {
  const userId = query.from.id;
  const session = db.getAdminSession(userId);
  if (!session) return bot.answerCallbackQuery(query.id, { text: 'Session expired. Run /admin again.', show_alert: true });

  await bot.answerCallbackQuery(query.id);

  if (taskType === 'follow') {
    db.setAdminSession(userId, 'task:follow:username', { ...session.data });
    await bot.sendMessage(
      userId,
      `*Twitter Follow Task*\n\n_Send the Twitter username or profile link to follow\\._\n\nExample: \`@projectname\` or \`https://x.com/projectname\``,
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  if (['like', 'retweet', 'quote', 'comment'].includes(taskType)) {
    db.setAdminSession(userId, 'task:tweet_id', { ...session.data, tweet_task_type: taskType });
    await bot.sendMessage(
      userId,
      `*Twitter ${taskType.charAt(0).toUpperCase() + taskType.slice(1)} Task*\n\n_Send the tweet link or tweet ID\\._\n\nExample: \`https://x.com/user/status/1234567890\``,
      { parse_mode: 'MarkdownV2' }
    );
  }
}

async function handleTelegramTaskCallback(bot, query, taskType) {
  const userId = query.from.id;
  const session = db.getAdminSession(userId);
  if (!session) return bot.answerCallbackQuery(query.id, { text: 'Session expired. Run /admin again.', show_alert: true });

  await bot.answerCallbackQuery(query.id);
  db.setAdminSession(userId, 'task:tg:details', { ...session.data, tg_task_type: taskType });

  const prompts = {
    join: 'Send the group or channel name/link \\(e\\.g\\. `@myproject` or `https://t.me/myproject`\\)\\.',
    react: 'Send the message link or description of the message to react to\\.',
    send: 'Send the group name where users should post a message\\.',
  };

  await bot.sendMessage(
    userId,
    `*Telegram ${taskType.charAt(0).toUpperCase() + taskType.slice(1)} Task*\n\n_${prompts[taskType] || 'Send details for this task\\.'}`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleRaidGroupSelect(bot, query, groupId) {
  const userId = query.from.id;
  const session = db.getAdminSession(userId);
  if (!session) return bot.answerCallbackQuery(query.id, { text: 'Session expired.', show_alert: true });

  await bot.answerCallbackQuery(query.id);
  await finalizeRaidCreation(bot, userId, session.data, parseInt(groupId, 10));
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
