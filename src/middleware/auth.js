const store = require('../store');
const config = require('../config');

/** Check if userId is a bot owner */
function isOwner(userId) {
  return config.OWNER_IDS.includes(Number(userId));
}

/** Register user & block banned users */
async function userMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'unknown';
  store.getOrCreateUser(userId, username);
  const user = store.getUser(userId);
  if (user?.banned) return ctx.reply('🚫 You are banned from using this bot.');
  return next();
}

/** Owner only — only users in OWNER_IDS */
function ownerOnly(ctx, next) {
  if (isOwner(ctx.from?.id)) return next();
  return ctx.reply('⛔ Only the bot owner can use this command.');
}

/**
 * Admin only — owner OR a registered admin of a whitelisted group.
 * Users are explicitly blocked.
 */
async function adminOnly(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Owners always pass
  if (isOwner(userId)) return next();

  const chatType = ctx.chat?.type;
  const groupId = (chatType !== 'private') ? ctx.chat?.id?.toString() : null;

  // In a group: check bot-level admin list OR Telegram admin role
  if (groupId) {
    if (!store.isGroupRegistered(groupId)) {
      return ctx.reply('⚠️ This group is not registered with the bot.\nThe owner must whitelist it first with /addgroup.');
    }
    if (store.isAdmin(groupId, userId)) return next();
    try {
      const member = await ctx.telegram.getChatMember(groupId, userId);
      if (['administrator', 'creator'].includes(member.status)) return next();
    } catch { /* ignore */ }
  }

  // In DM: check if user is admin of at least one registered group
  if (!groupId) {
    const groups = store.getGroupsForAdmin(userId);
    if (groups.length > 0) return next();
  }

  return ctx.reply('⛔ This command is for admins only. Regular users cannot use admin commands.');
}

module.exports = { userMiddleware, ownerOnly, adminOnly, isOwner };
