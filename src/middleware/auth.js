const config = require('../config');

function isOwner(userId) {
  return config.OWNER_IDS.includes(String(userId));
}

function isAdminUser(userId) {
  if (isOwner(userId)) return true;
  const store = require('../store');
  return store.getAllGroups().some(g => store.isAdmin(g.id, userId));
}

const ownerOnly = async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    return ctx.deleteMessage().catch(() => {});
  }
  if (!isOwner(ctx.from?.id)) {
    return ctx.reply('This command is restricted to bot owners only.');
  }
  return next();
};

const adminOnly = async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    return ctx.deleteMessage().catch(() => {});
  }
  if (!isAdminUser(ctx.from?.id)) return;
  return next();
};

const userMiddleware = async (ctx, next) => {
  if (ctx.from) {
    const store = require('../store');
    store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  }
  return next();
};

module.exports = { isOwner, isAdminUser, ownerOnly, adminOnly, userMiddleware };
