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

function registerHandlers(bot) {
  // --- Register group on join ---
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
      db.upsertGroup(String(chat.id), chat.title);
      console.log(`[Bot] Added to group: ${chat.title} (${chat.id})`);
    }
  });

  // --- Message handler ---
  bot.on('message', async (ctx) => {
    if (!ctx.from || ctx.from.is_bot) return;

    const user = db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    if (ctx.chat.type !== 'private') {
      const group = db.upsertGroup(String(ctx.chat.id), ctx.chat.title);
      db.linkUserToGroup(user.id, group.id);
    }

    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return;

    // Private message session handling
    if (ctx.chat.type === 'private') {
      const session = db.getAdminSession(ctx.from.id);
      if (session) {
        if (session.state === 'waiting_twitter_username') {
          await handleTwitterUsernameInput(ctx).catch(console.error);
          return;
        }
        if (session.state === 'waiting_quote_link' || session.state === 'waiting_comment_link') {
          await handleQuoteOrCommentLink(ctx, session).catch(console.error);
          return;
        }
        if (isAdmin(ctx.from.id)) {
          const handled = await handleAdminTextInput(ctx).catch(console.error);
          if (handled) return;
        }
      }
      return;
    }

    // Group anti-spam
    await checkAntiSpam(ctx).catch(console.error);
  });

  // --- Commands ---
  bot.command('start', (ctx) => handleStart(ctx).catch(console.error));
  bot.command('leaderboard', (ctx) => handleLeaderboardCommand(ctx).catch(console.error));
  bot.command('raids', (ctx) => handleRaidsCommand(ctx).catch(console.error));
  bot.command('mypoints', (ctx) => handleMyPoints(ctx).catch(console.error));
  bot.command('settwitter', (ctx) => handleSetTwitter(ctx).catch(console.error));
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const chatId = ctx.chat.type === 'private' ? ctx.chat.id : ctx.from.id;
    await handleAdminMenu(ctx.telegram, chatId, ctx.from.id).catch(console.error);
    if (ctx.chat.type !== 'private') ctx.deleteMessage().catch(() => {});
  });
  bot.command('createraid', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    db.setAdminSession(ctx.from.id, 'create_raid:title', {});
    const chatId = ctx.chat.type === 'private' ? ctx.chat.id : ctx.from.id;
    await ctx.telegram.sendMessage(
      chatId,
      `*Create Raid* \\(Step 1 of 3\\)\n\n*Send the raid title:*\n_Example:_ \`Alpha Project Twitter Raid\``,
      { parse_mode: 'MarkdownV2' }
    ).catch(console.error);
  });

  // --- Callback Queries ---
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    try {
      if (data === 'admin:create_raid') return await handleCallbackCreateRaid(ctx);
      if (data === 'admin:active_raids') return await handleCallbackActiveRaids(ctx);
      if (data === 'admin:leaderboard') {
        await ctx.answerCbQuery();
        return await handleLeaderboardCommand(ctx, true);
      }
      if (data === 'admin:settings') return await handleCallbackSettings(ctx);
      if (data === 'settings:min_chars') return await handleCallbackSettingsMinChars(ctx);
      if (data === 'settings:lb_topic') return await handleCallbackSettingsLbTopic(ctx);
      if (data === 'settings:close_raid') return await handleCallbackCloseRaid(ctx);

      if (data.startsWith('task_platform:')) return await handleTaskPlatformCallback(ctx, data.split(':')[1]);
      if (data.startsWith('twitter_task:')) return await handleTwitterTaskCallback(ctx, data.split(':')[1]);
      if (data.startsWith('telegram_task:')) return await handleTelegramTaskCallback(ctx, data.split(':')[1]);
      if (data.startsWith('admin:raid_group:')) return await handleRaidGroupSelect(ctx, data.split(':')[2]);
      if (data.startsWith('raid:submit:')) return await handleRaidSubmit(ctx, data.split(':')[2]);
      if (data.startsWith('task:verify:')) return await handleTaskVerify(ctx, parseInt(data.split(':')[2], 10));
      if (data.startsWith('task:tg_done:')) return await handleTelegramTaskDone(ctx, parseInt(data.split(':')[2], 10));
      if (data.startsWith('lb:group:')) return await handleLeaderboardGroupSelect(ctx, data.split(':')[2]);
      if (data.startsWith('close_raid:')) return await handleConfirmCloseRaid(ctx, parseInt(data.split(':')[1], 10));

    } catch (err) {
      console.error('[Bot] Callback error:', err.message, '| data:', data);
      ctx.answerCbQuery('An error occurred. Please try again.').catch(() => {});
    }
  });

  console.log('[Bot] All handlers registered');
}

module.exports = { registerHandlers };
