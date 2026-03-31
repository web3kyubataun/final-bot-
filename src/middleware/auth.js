const store = require('../store');
const config = require('../config');

/** Register user & block banned users */
async function userMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'unknown';
  store.getOrCreateUser(userId, username);
  const user = store.getUser(userId);
  if (user?.banned) {
    return ctx.reply('🚫 You are banned from using this bot.');
  }
  return next();
}

/** Owner only — works in group and DM */
function ownerOnly(ctx, next) {
  if (String(ctx.from?.id) === String(config.OWNER_ID)) return next();
  return ctx.reply('⛔ Only the bot owner can use this command.');
}

/** Admin only — works correctly in group AND DM contexts */
async function adminOnly(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Owner always passes
  if (String(userId) === String(config.OWNER_ID)) return next();

  const chatType = ctx.chat?.type;
  const groupId = chatType !== 'private' ? ctx.chat?.id?.toString() : null;

  // In-group: check bot-admin list OR Telegram admin role
  if (groupId) {
    if (store.isAdmin(groupId, userId)) return next();
    try {
      const member = await ctx.telegram.getChatMember(groupId, userId);
      if (['administrator', 'creator'].includes(member.status)) return next();
    } catch { /* ignore */ }
  }

  // In DM: check if user is admin of ANY registered group
  if (!groupId) {
    const groups = store.getGroupsForAdmin(userId);
    if (groups.length > 0) return next();
  }

  return ctx.reply('⛔ This command is for admins only.');
}

/** Check if user has access to a group based on its access mode */
async function checkGroupAccess(ctx, groupId) {
  const gid = groupId || ctx.chat?.id?.toString();
  const userId = ctx.from?.id;
  if (!gid || !userId) return false;

  const group = store.getGroup(gid);
  if (!group) return false;

  const mode = group.accessMode || 'all';
  if (mode === 'all') return true;
  if (mode === 'whitelist') return group.whitelist.has(String(userId));

  if (mode === 'group') {
    try {
      const member = await ctx.telegram.getChatMember(gid, userId);
      return ['member', 'administrator', 'creator'].includes(member.status);
    } catch { return false; }
  }
  return false;
}

module.exports = { userMiddleware, ownerOnly, adminOnly, checkGroupAccess };
