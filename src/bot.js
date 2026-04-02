const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const { checkAntiSpam } = require('./handlers/antiSpam');
const { handleStart, handleSetTwitter, handleMyPoints } = require('./commands/start');
const { handleLeaderboardCommand, handleLeaderboardGroupSelect } = require('./commands/leaderboard');
const { handleRaidsCommand, handleRaidSubmit } = require('./commands/raids');
const {
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
} = require('./handlers/adminHandler');
const {
  handleTaskVerify,
  handleTelegramTaskDone,
  handleQuoteOrCommentLink,
  handleTwitterUsernameInput,
} = require('./handlers/taskHandler');

function startBot() {
  if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not set in environment variables.');
  }

  const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

  // --- Group join: register group and user ---
  bot.on('new_chat_members', async (msg) => {
    const group = db.upsertGroup(String(msg.chat.id), msg.chat.title);
    for (const member of msg.new_chat_members) {
      if (member.id === (await bot.getMe()).id) {
        console.log(`[Bot] Added to group: ${msg.chat.title} (${msg.chat.id})`);
      }
    }
  });

  bot.on('message', async (msg) => {
    if (!msg.from || msg.via_bot) return;

    // Register user and group
    const user = db.upsertUser(msg.from.id, msg.from.username, msg.from.first_name);
    if (msg.chat.type !== 'private') {
      const group = db.upsertGroup(String(msg.chat.id), msg.chat.title);
      db.linkUserToGroup(user.id, group.id);
    }

    // Handle private message sessions (admin flow, task verification)
    if (msg.chat.type === 'private' && msg.text && !msg.text.startsWith('/')) {
      const session = db.getAdminSession(msg.from.id);
      if (session) {
        // Twitter username input
        if (session.state === 'waiting_twitter_username') {
          await handleTwitterUsernameInput(bot, msg, session);
          return;
        }

        // Quote tweet link
        if (session.state === 'waiting_quote_link' || session.state === 'waiting_comment_link') {
          await handleQuoteOrCommentLink(bot, msg, session);
          return;
        }

        // Admin text flows
        if (isAdmin(msg.from.id)) {
          const handled = await handleAdminTextInput(bot, msg);
          if (handled) return;
        }
      }
    }

    // Anti-spam for group messages
    if (msg.chat.type !== 'private' && msg.text) {
      await checkAntiSpam(bot, msg).catch(() => {});
    }
  });

  // --- Commands ---
  bot.onText(/\/start/, (msg) => handleStart(bot, msg).catch(console.error));

  bot.onText(/\/leaderboard/, (msg) => handleLeaderboardCommand(bot, msg).catch(console.error));

  bot.onText(/\/raids/, (msg) => handleRaidsCommand(bot, msg).catch(console.error));

  bot.onText(/\/mypoints/, (msg) => handleMyPoints(bot, msg).catch(console.error));

  bot.onText(/\/settwitter/, (msg) => handleSetTwitter(bot, msg).catch(console.error));

  bot.onText(/\/admin/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.type === 'private' ? msg.chat.id : msg.from.id;
    await handleAdminMenu(bot, chatId, msg.from.id).catch(console.error);
    if (msg.chat.type !== 'private') {
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }
  });

  bot.onText(/\/createraid/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    db.setAdminSession(msg.from.id, 'create_raid:title', {});
    const chatId = msg.chat.type === 'private' ? msg.chat.id : msg.from.id;
    await bot.sendMessage(
      chatId,
      `*Create Raid* \\(Step 1 of 3\\)\n\n*Send the raid title:*\n_Example:_ \`Alpha Project Twitter Raid\``,
      { parse_mode: 'MarkdownV2' }
    ).catch(console.error);
  });

  // --- Callback Queries ---
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data) return;

    try {
      // Admin callbacks
      if (data === 'admin:create_raid') return await handleCallbackCreateRaid(bot, query);
      if (data === 'admin:active_raids') return await handleCallbackActiveRaids(bot, query);
      if (data === 'admin:leaderboard') {
        await bot.answerCallbackQuery(query.id);
        return await handleLeaderboardCommand(bot, { ...query.message, from: query.from, chat: { id: query.from.id, type: 'private' } });
      }
      if (data === 'admin:settings') return await handleCallbackSettings(bot, query);
      if (data === 'settings:min_chars') return await handleCallbackSettingsMinChars(bot, query);
      if (data === 'settings:lb_topic') return await handleCallbackSettingsLbTopic(bot, query);
      if (data === 'settings:close_raid') return await handleCallbackCloseRaid(bot, query);

      // Task platform selection
      if (data.startsWith('task_platform:')) {
        return await handleTaskPlatformCallback(bot, query, data.split(':')[1]);
      }

      // Twitter task type
      if (data.startsWith('twitter_task:')) {
        return await handleTwitterTaskCallback(bot, query, data.split(':')[1]);
      }

      // Telegram task type
      if (data.startsWith('telegram_task:')) {
        return await handleTelegramTaskCallback(bot, query, data.split(':')[1]);
      }

      // Raid group select (admin)
      if (data.startsWith('admin:raid_group:')) {
        return await handleRaidGroupSelect(bot, query, data.split(':')[2]);
      }

      // Raid submit button (in group)
      if (data.startsWith('raid:submit:')) {
        return await handleRaidSubmit(bot, query, data.split(':')[2]);
      }

      // Task verify (in DM)
      if (data.startsWith('task:verify:')) {
        return await handleTaskVerify(bot, query, parseInt(data.split(':')[2], 10));
      }

      // Telegram task done
      if (data.startsWith('task:tg_done:')) {
        return await handleTelegramTaskDone(bot, query, parseInt(data.split(':')[2], 10));
      }

      // Leaderboard group select
      if (data.startsWith('lb:group:')) {
        return await handleLeaderboardGroupSelect(bot, query, data.split(':')[2]);
      }

      // Close raid
      if (data.startsWith('close_raid:')) {
        return await handleConfirmCloseRaid(bot, query, parseInt(data.split(':')[1], 10));
      }

    } catch (err) {
      console.error('[Bot] Callback error:', err.message, '| data:', data);
      bot.answerCallbackQuery(query.id, { text: 'An error occurred. Please try again.', show_alert: true }).catch(() => {});
    }
  });

  bot.on('polling_error', (err) => {
    console.error('[Bot] Polling error:', err.message);
  });

  bot.on('error', (err) => {
    console.error('[Bot] Error:', err.message);
  });

  console.log('[Bot] All handlers registered');
  return bot;
}

module.exports = { startBot };
