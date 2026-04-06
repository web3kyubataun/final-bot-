/**
 * group.js — Group event handler
 *
 * Handles:
 *  - Bot being added to / removed from a group
 *  - In-group commands (silently delete and redirect to DM)
 *  - New member join notifications
 */

const store  = require('../store');
const { getBotUsername } = require('../botInfo');
const { isOwner } = require('../middleware/auth');
const { Markup } = require('telegraf');

function register(bot) {

  // ── Bot added to / removed from a group ──────────────────────────────────────
  bot.on('my_chat_member', async (ctx) => {
    const update   = ctx.myChatMember;
    const newStatus = update?.new_chat_member?.status;
    const chatType  = ctx.chat?.type;

    if (chatType !== 'group' && chatType !== 'supergroup') return;

    if (newStatus === 'member' || newStatus === 'administrator') {
      const groupId   = String(ctx.chat.id);
      const groupName = ctx.chat.title || groupId;
      const addedBy   = update.from?.id;

      // Auto-register group when bot is added (owner must still approve or pre-register)
      if (!store.isGroupRegistered(groupId)) {
        if (isOwner(addedBy)) {
          store.addGroup(groupId, null, addedBy);
          store.setGroupMeta(groupId, { groupName });
          console.log(`[Group] Auto-registered ${groupName} (${groupId}) added by owner ${addedBy}`);
        } else {
          // Bot was added by a non-owner — let it stay but inform
          console.log(`[Group] Bot added to ${groupName} (${groupId}) by user ${addedBy} — not auto-registered`);
        }
      } else {
        store.setGroupMeta(groupId, { groupName });
      }
    }

    if (newStatus === 'kicked' || newStatus === 'left') {
      console.log(`[Group] Bot removed from ${ctx.chat?.title} (${ctx.chat?.id})`);
    }
  });

  // ── New member joins group ────────────────────────────────────────────────────
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

    // Get started topic if set
    const topicId = group?.topics?.getstarted || null;

    try {
      await ctx.telegram.sendMessage(
        groupId,
        `👋 Welcome <b>${newMember.first_name}</b>!\n\n` +
        `Start earning points by completing tasks.\n` +
        `<a href="https://t.me/${botName}">Open bot DM</a> → tap Tasks or Raids!`,
        {
          parse_mode: 'HTML',
          message_thread_id: topicId || undefined,
          ...Markup.inlineKeyboard([[
            Markup.button.url('Open Bot', `https://t.me/${botName}`),
          ]]),
        }
      );
    } catch {}
  });

  // ── In-group commands — silently redirect to DM ────────────────────────────
  const GROUP_COMMANDS = ['/start', '/help', '/tasks', '/raids', '/leaderboard', '/profile'];

  bot.on('message', async (ctx, next) => {
    const chatType = ctx.chat?.type;
    if (chatType !== 'group' && chatType !== 'supergroup') return next();

    const text = ctx.message?.text;
    if (!text) return next();

    // Delete non-owner bot commands from group chat
    const isCmd = text.startsWith('/');
    if (!isCmd) return next();

    // Always delete commands in group to keep chat clean
    await ctx.deleteMessage().catch(() => {});

    const botName = getBotUsername() || 'MomentumHubBot';
    const isGroupCmd = GROUP_COMMANDS.some(c => text.toLowerCase().startsWith(c));

    if (isGroupCmd) {
      try {
        await ctx.telegram.sendMessage(
          ctx.from.id,
          `Please use the bot in our private chat for tasks and commands!`,
          Markup.inlineKeyboard([[Markup.button.url('Open Bot', `https://t.me/${botName}`)]])
        );
      } catch {}
    }

    return next();
  });
}

module.exports = { register };
