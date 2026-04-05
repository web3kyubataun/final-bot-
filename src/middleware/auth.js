const store = require('../store');
const config = require('../config');

function isOwner(userId) {
  return config.OWNER_IDS.includes(Number(userId));
}

async function userMiddleware(ctx, next) {
  if (!ctx.from) return next();
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'unknown';
  store.getOrCreateUser(userId, username);
  const user = store.getUser(userId);
  if (user?.banned) return ctx.reply('You are banned from using this bot.');
  return next();
}

function ownerOnly(ctx, next) {
  if (isOwner(ctx.from?.id)) return next();
  return ctx.reply('Only the bot owner can use this command.');
}

async function adminOnly(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (isOwner(userId)) return next();

  const groups = store.getGroupsForAdmin(userId);
  if (groups.length > 0) return next();

  return ctx.reply('You are not authorized to use this command.');
}

function isAdminUser(userId) {
  if (!userId) return false;
  if (isOwner(userId)) return true;
  return store.getGroupsForAdmin(userId).length > 0;
}

module.exports = { isOwner, isAdminUser, userMiddleware, ownerOnly, adminOnly };
