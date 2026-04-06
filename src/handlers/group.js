const store  = require('../store');
const { getBotUsername } = require('../botInfo');
const { isOwner } = require('../middleware/auth');
const { Markup } = require('telegraf');

function register(bot) {

  bot.on('my_chat_member', async (ctx) => {
    const update    = ctx.myChatMember;
    const newStatus = update?.new_chat_member?.status;
    const chatType  = ctx.chat?.type;
    if (chatType !== 'group' && chatType !== 'supergroup') return;

    if (newStatus === 'member' || newStatus === 'administrator') {
      const groupId   = String(ctx.chat.id);
      const groupName = ctx.chat.title || groupId;
      const addedBy   = update.from?.id;
      if (!store.isGroupRegistered(groupId)) {
        if (isOwner(addedBy)) {
          store.addGroup(groupId, null, addedBy);
          store.setGroupMeta(groupId, { groupName });
          console.log(`[Group] Auto-registered ${groupName} (${groupId})`);
        }
      } else {
        store.setGroupMeta(groupId, { groupName });
      }
    }

    if (newStatus === 'kicked' || newStatus === 'left') {
      console.log(`[Group] Bot removed from ${ctx.chat?.title} (${ctx.chat?.id})`);
    }
  });

  bot.on('chat_member', async (ctx) => {
    const update = ctx.chatMember;
    if (!update) return;
    const newStatus = update.new_chat_member?.status;
    if (newStatus !== 'member' && newStatus !== 'restricted') return;
    const newMember = update.new_chat_member?.user;
    if (!newMember || newMember.is_bot) return;
    const groupId = String(ctx.chat.id);
    if (!store.isGroupRegistered(groupId)) return;
    const botName = getBotUsername() || 'MomentumHubBot';
    const group   = store.getGroup(groupId);
    const topicId = group?.topics?.getstarted || null;
    try {
      await ctx.telegram.sendMessage(groupId,
        `Welcome <b>${newMember.first_name}</b>!\n\nStart earning points by completing tasks.\n<a href="https://t.me/${botName}">Open bot DM</a> → tap Tasks or Raids!`,
        {
          parse_mode: 'HTML',
          message_thread_id: topicId || undefined,
          ...Markup.inlineKeyboard([[Markup.button.url('Open Bot', `https://t.me/${botName}`)]]),
        }
      );
    } catch {}
  });

  const GROUP_COMMANDS = ['/start', '/help', '/tasks', '/raids', '/leaderboard', '/profile'];

  bot.on('message', async (ctx, next) => {
    const chatType = ctx.chat?.type;
    if (chatType !== 'group' && chatType !== 'supergroup') return next();
    const text = ctx.message?.text;
    if (!text || !text.startsWith('/')) return next();
    await ctx.deleteMessage().catch(() => {});
    const botName = getBotUsername() || 'MomentumHubBot';
    const isGroupCmd = GROUP_COMMANDS.some(c => text.toLowerCase().startsWith(c));
    if (isGroupCmd) {
      try {
        await ctx.telegram.sendMessage(ctx.from.id,
          `Please use the bot in our private chat for tasks and commands!`,
          Markup.inlineKeyboard([[Markup.button.url('Open Bot', `https://t.me/${botName}`)]])
        );
      } catch {}
    }
    return next();
  });
}

module.exports = { register };
