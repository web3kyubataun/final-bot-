/**
 * Group setup commands — topics, welcome, stats.
 * Run INSIDE the group (most commands).
 * /autotopics removed per requirements.
 */
const store = require('../store');
const { adminOnly, isOwner } = require('../middleware/auth');

const TOPIC_TYPES = {
  getstarted:    { label: ' Get Started',    desc: 'Onboarding & welcome' },
  notifications: { label: ' Notifications',   desc: 'Task & raid alerts' },
  quests:        { label: ' Quests',           desc: 'Active tasks list' },
  raids:         { label: ' Raids',            desc: 'Active raids list' },
  leaderboard:   { label: ' Leaderboard',      desc: 'Points leaderboard' },
  connect:       { label: ' Connect Twitter',  desc: 'Twitter link channel' },
  announcements: { label: ' Announcements',    desc: 'Admin announcements' },
  submissions:   { label: ' Submissions',      desc: 'Submission reviews' },
  general:       { label: ' General',          desc: 'General chat' },
};

function requireGroup(ctx) {
  const chatType = ctx.chat?.type;
  if (chatType !== 'group' && chatType !== 'supergroup') {
    ctx.reply(' This command must be run inside the group.');
    return null;
  }
  return String(ctx.chat.id);
}

// ── /setup ──────────────────────────────────────────────
async function handleSetup(ctx) {
  const groupId = requireGroup(ctx);
  if (!groupId) return;

  const isReg = store.isGroupRegistered(groupId);
  const group = isReg ? store.getGroup(groupId) : null;

  await ctx.replyWithHTML(
    ` <b>Group Setup Guide</b>\n` +
    `${'─'.repeat(30)}\n\n` +
    `<b>Step 1 — Register</b>\n` +
    (isReg
      ? ` Registered (ID: <code>${groupId}</code>)`
      : ` Not registered.\nAn owner must run: <code>/addgroup</code> in this group.`) +
    `\n\n` +
    `<b>Step 2 — Add Forum Topics (optional)</b>\n` +
    `Enable in Group Settings → Topics, then use:\n` +
    `<code>/settopic &lt;type&gt; &lt;topicId&gt;</code>\n\n` +
    `<b>Step 3 — Add Admins</b>\n` +
    `<code>/addadmin &lt;userId&gt;</code>\n\n` +
    `<b>Step 4 — Create Campaigns</b>\n` +
    `Use <code>/admin</code> → admin panel\n\n` +
    `<b>Step 5 — Set Access Mode</b>\n` +
    `/setmode all|group|whitelist\n\n` +
    (isReg ? `<b>Current:</b> Mode: <b>${group.accessMode}</b>  |  Admins: <b>${group.admins?.size || 0}</b>` : '')
  );
}

// ── /settopic <type> <topicId> ──────────────────────────
async function handleSetTopic(ctx) {
  const groupId = requireGroup(ctx);
  if (!groupId) return;
  if (!store.isGroupRegistered(groupId)) return ctx.reply(' Group not registered. An owner must /addgroup first.');

  const args = ctx.message.text.split(' ').slice(1);
  const type = args[0]?.toLowerCase();
  const topicId = parseInt(args[1]);

  if (!type || !topicId || !TOPIC_TYPES[type]) {
    const types = Object.keys(TOPIC_TYPES).join(' | ');
    return ctx.replyWithHTML(
      `<b>Usage:</b> <code>/settopic &lt;type&gt; &lt;topicId&gt;</code>\n\n` +
      `<b>Types:</b>\n${Object.entries(TOPIC_TYPES).map(([k, v]) => `• <code>${k}</code> — ${v.label}`).join('\n')}\n\n` +
      `<b>Example:</b> <code>/settopic notifications 12345</code>\n\n` +
      `<i>To get a topic ID: right-click the topic → Copy Link → the last number is the ID.</i>`
    );
  }

  store.setGroupTopic(groupId, type, topicId);
  await ctx.replyWithHTML(` Topic <b>${TOPIC_TYPES[type].label}</b> set to thread ID <code>${topicId}</code>`);
}

// ── /listtopics ─────────────────────────────────────────
async function handleListTopics(ctx) {
  const groupId = requireGroup(ctx);
  if (!groupId) return;
  if (!store.isGroupRegistered(groupId)) return ctx.reply(' Group not registered.');

  const group = store.getGroup(groupId);
  const topics = group.topics || {};

  const lines = Object.entries(TOPIC_TYPES).map(([type, info]) => {
    const id = topics[type];
    return `${id ? '' : ''} ${info.label}: ${id ? `<code>${id}</code>` : 'Not set'}`;
  });

  await ctx.replyWithHTML(
    ` <b>Forum Topics for this Group</b>\n` +
    `${'─'.repeat(30)}\n\n` +
    lines.join('\n') +
    `\n\n<i>Use /settopic &lt;type&gt; &lt;id&gt; to set each topic.</i>`
  );
}

// ── /postwelcome ────────────────────────────────────────
async function handlePostWelcome(ctx) {
  const groupId = requireGroup(ctx);
  if (!groupId) return;
  if (!store.isGroupRegistered(groupId)) return ctx.reply(' Group not registered.');

  const group = store.getGroup(groupId);
  const topicId = group.topics?.getstarted;

  const botInfo = await ctx.telegram.getMe();
  const welcomeMsg =
    ` <b>Welcome to the Community!</b>\n\n` +
    `Here's how to get started:\n\n` +
    `1⃣ Start the bot in DM: @${botInfo.username}\n` +
    `2⃣ Link your Twitter via  Settings\n` +
    `3⃣ Complete  Tasks &  Raids to earn points\n` +
    `4⃣ Check the  Leaderboard for your rank\n\n` +
    ` <b>Channels:</b>\n` +
    ` Notifications — New task alerts\n` +
    ` Quests — Active tasks\n` +
    ` Raids — Active raids\n\n` +
    `Good luck! `;

  try {
    await ctx.telegram.sendMessage(groupId, welcomeMsg, {
      parse_mode: 'HTML',
      message_thread_id: topicId || undefined,
    });
    await ctx.reply(topicId
      ? ` Welcome message posted in Get Started topic.`
      : ` Posted here. Use /settopic getstarted <id> to configure a dedicated topic.`
    );
  } catch (e) {
    await ctx.reply(` Failed to post: ${e.message}`);
  }
}

// ── /stats ──────────────────────────────────────────────
async function handleStats(ctx) {
  // Allow from DM too if admin has context
  let groupId = ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null;
  if (!groupId) {
    groupId = store.getAdminContext(ctx.from.id);
  }
  if (!groupId || !store.isGroupRegistered(groupId)) {
    return ctx.reply(' Group not registered or not selected. Run /admin first.');
  }

  const s = store.getGroupStats(groupId);
  const group = store.getGroup(groupId);

  await ctx.replyWithHTML(
    ` <b>Group Statistics</b>\n` +
    ` ${group.groupName || groupId}\n` +
    `${'─'.repeat(30)}\n\n` +
    `<b> Campaigns</b>\n` +
    ` Active Tasks: <b>${s.activeTasks}</b> / ${s.totalTasks} total\n` +
    ` Active Raids: <b>${s.activeRaids}</b> / ${s.totalRaids} total\n\n` +
    `<b> Submissions</b>\n` +
    ` Pending: <b>${s.pendingSubmissions}</b>\n` +
    ` Approved: <b>${s.approvedSubmissions}</b>\n` +
    ` Rejected: <b>${s.rejectedSubmissions}</b>\n\n` +
    `<b> Users</b>\n` +
    `Total: <b>${s.totalUsers}</b>  •  Banned: <b>${s.bannedUsers}</b>\n\n` +
    `<b> Config</b>\n` +
    `Access Mode: <b>${group.accessMode}</b>  •  Admins: <b>${group.admins?.size || 0}</b>`
  );
}

// ── /setmode ────────────────────────────────────────────
async function handleSetMode(ctx) {
  const groupId = requireGroup(ctx);
  if (!groupId) return;
  if (!store.isGroupRegistered(groupId)) return ctx.reply(' Group not registered.');

  const mode = ctx.message.text.split(' ')[1]?.toLowerCase();
  if (!['all', 'group', 'whitelist'].includes(mode)) {
    return ctx.reply('Usage: /setmode all|group|whitelist\n\nall — everyone\ngroup — group members only\nwhitelist — manually approved users only');
  }
  store.setAccessMode(groupId, mode);
  await ctx.replyWithHTML(` Access mode set to: <b>${mode}</b>`);
}

// ── /addadmin / /removeadmin ────────────────────────────
async function handleAddAdmin(ctx) {
  let groupId, userId;
  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat.id.toString();
    userId  = ctx.message.text.split(' ')[1];
  } else {
    const args = ctx.message.text.split(' ').slice(1);
    groupId = args[0]; userId = args[1];
  }
  if (!userId) return ctx.reply('Usage (in group): /addadmin <userId>\nUsage (DM): /addadmin <groupId> <userId>');
  if (!store.isGroupRegistered(groupId)) return ctx.reply(' Group not registered or invalid ID.');

  store.addAdmin(groupId, userId.replace('@', ''));
  await ctx.replyWithHTML(` User <code>${userId}</code> added as admin for this group.`);
}

async function handleRemoveAdmin(ctx) {
  let groupId, userId;
  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat.id.toString();
    userId  = ctx.message.text.split(' ')[1];
  } else {
    const args = ctx.message.text.split(' ').slice(1);
    groupId = args[0]; userId = args[1];
  }
  if (!userId) return ctx.reply('Usage (in group): /removeadmin <userId>');
  if (!store.isGroupRegistered(groupId)) return ctx.reply(' Group not registered.');

  store.removeAdmin(groupId, userId.replace('@', ''));
  await ctx.replyWithHTML(` User <code>${userId}</code> removed from admins.`);
}

function register(bot) {
  bot.command('setup',        adminOnly, handleSetup);
  bot.command('settopic',     adminOnly, handleSetTopic);
  bot.command('listtopics',   adminOnly, handleListTopics);
  bot.command('postwelcome',  adminOnly, handlePostWelcome);
  bot.command('stats',        adminOnly, handleStats);
  bot.command('setmode',      adminOnly, handleSetMode);
  bot.command('addadmin',     adminOnly, handleAddAdmin);
  bot.command('removeadmin',  adminOnly, handleRemoveAdmin);
}

module.exports = { register, TOPIC_TYPES };
