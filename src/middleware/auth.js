const store = require('../store');
const config = require('../config');

/**
 * Middleware: register user and check ban status.
 */
async function userMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'unknown';
  store.getOrCreateUser(userId, username);

  const user = store.getUser(userId);
  if (user && user.banned) {
    return ctx.reply('🚫 You are banned from using this bot.');
  }
  return next();
}

/**
 * Check if user has access in this group based on access mode.
 */
async function checkGroupAccess(ctx) {
  const groupId = ctx.chat?.id?.toString();
  const userId = ctx.from?.id;
  if (!groupId || !userId) return false;

  const group = store.getGroup(groupId);
  if (!group) return false;

  const mode = group.accessMode || 'all';

  if (mode === 'all') return true;
  if (mode === 'whitelist') return group.whitelist.has(userId);

  if (mode === 'group') {
    try {
      const member = await ctx.telegram.getChatMember(groupId, userId);
      return ['member', 'administrator', 'creator'].includes(member.status);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Middleware: only owner can use this command.
 */
function ownerOnly(ctx, next) {
  if (ctx.from?.id === config.OWNER_ID) return next();
  return ctx.reply('⛔ Only the bot owner can use this command.');
}

/**
 * Middleware: owner or group admin.
 */
async function adminOnly(ctx, next) {
  if (!ctx.from) return;
  const groupId = ctx.chat?.id?.toString();
  const userId = ctx.from.id;

  if (userId === config.OWNER_ID) return next();

  if (groupId && store.isAdmin(groupId, userId)) return next();

  // Also allow Telegram group admins
  try {
    const member = await ctx.telegram.getChatMember(groupId, userId);
    if (['administrator', 'creator'].includes(member.status)) return next();
  } catch {}

  return ctx.reply('⛔ This command is for admins only.');
}

module.exports = { userMiddleware, checkGroupAccess, ownerOnly, adminOnly };
