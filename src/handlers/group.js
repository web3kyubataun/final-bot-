/**
 * Group setup commands — forum topics, welcome messages, stats.
 * Most of these run INSIDE the group.
 */
const store = require('../store');
const { adminOnly } = require('../middleware/auth');

const TOPIC_TYPES = {
  getstarted:    { label: '🚀 Get Started',    desc: 'Onboarding & welcome info' },
  notifications: { label: '🔔 Notifications',   desc: 'Task & raid alerts' },
  quests:        { label: '🎯 Quests',           desc: 'Active tasks list' },
  raids:         { label: '⚡ Raids',            desc: 'Active raids list' },
  leaderboard:   { label: '🏆 Leaderboard',      desc: 'Points leaderboard' },
  connect:       { label: '🐦 Connect Twitter',  desc: 'Twitter link channel' },
  announcements: { label: '📢 Announcements',    desc: 'Admin announcements' },
  submissions:   { label: '📋 Submissions',      desc: 'Submission notifications' },
  general:       { label: '💬 General',          desc: 'General chat' },
};

// ── /setup ──────────────────────────────────────────────
async function handleSetup(ctx) {
  const groupId = ctx.chat?.id?.toString();
  if (!groupId || ctx.chat?.type === 'private') {
    return ctx.reply('Run /setup inside your group.');
  }

  const isRegistered = store.isGroupRegistered(groupId);
  const group = isRegistered ? store.getGroup(groupId) : null;

  await ctx.replyWithHTML(
    `⚙️ <b>Group Setup Guide</b>\n` +
    `${'─'.repeat(30)}\n\n` +

    `<b>Step 1 — Register the group</b>\n` +
    (isRegistered
      ? `✅ Registered (ID: <code>${groupId}</code>)`
      : `❌ Not registered yet.\nOwner must run: <code>/addgroup</code> in this group`) +
    `\n\n` +

    `<b>Step 2 — Enable Forum Topics (optional)</b>\n` +
    `In Group Settings → Enable Topics.\n` +
    `Then run <code>/autotopics</code> to auto-create all channels.\n\n` +

    `<b>Step 3 — Add Admins</b>\n` +
    `<code>/addadmin &lt;userId&gt;</code> in this group\n\n` +

    `<b>Step 4 — Create Tasks & Raids</b>\n` +
    `Use <code>/admin</code> to open the admin panel.\n\n` +

    `<b>Step 5 — Set access mode</b>\n` +
    `<code>/setmode all</code> — Everyone can use bot\n` +
    `<code>/setmode group</code> — Group members only\n` +
    `<code>/setmode whitelist</code> — Whitelisted users only\n\n` +

    `<b>Current Status</b>\n` +
    (isRegistered
      ? `Mode: <b>${group.accessMode}</b>  |  Admins: <b>${group.admins?.size || 0}</b>`
      : `Not registered`)
  );
}

// ── /autotopics ─────────────────────────────────────────
async function handleAutoTopics(ctx) {
  const groupId = ctx.chat?.id?.toString();
  if (!groupId || ctx.chat?.type === 'private') {
    return ctx.reply('Run /autotopics inside your group.');
  }
  if (!store.isGroupRegistered(groupId)) {
    return ctx.reply('⚠️ Group not registered. Owner must /addgroup first.');
  }
  if (!ctx.chat?.is_forum) {
    return ctx.replyWithHTML(
      '⚠️ <b>Forum Topics not enabled.</b>\n\n' +
      'Enable them in: Group Settings → Topics → Enable\n' +
      'Then run /autotopics again.'
    );
  }

  await ctx.reply('⏳ Creating forum topics...');

  const created = [];
  const failed = [];

  for (const [type, info] of Object.entries(TOPIC_TYPES)) {
    try {
      const topic = await ctx.telegram.createForumTopic(groupId, info.label);
      store.setGroupTopic(groupId, type, topic.message_thread_id);
      created.push(`${info.label}`);
    } catch (e) {
      failed.push(`${info.label} (${e.message})`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  await ctx.replyWithHTML(
    `✅ <b>Topics Created!</b>\n\n` +
    (created.length ? `<b>Created:</b>\n${created.map(c => `• ${c}`).join('\n')}\n\n` : '') +
    (failed.length ? `<b>Failed:</b>\n${failed.map(f => `• ${f}`).join('\n')}` : '')
  );
}

// ── /settopic <type> <topicId> ──────────────────────────
async function handleSetTopic(ctx) {
  const groupId = ctx.chat?.id?.toString();
  if (!groupId || ctx.chat?.type === 'private') return ctx.reply('Run this inside your group.');
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');

  const args = ctx.message.text.split(' ').slice(1);
  const type = args[0]?.toLowerCase();
  const topicId = parseInt(args[1]);

  if (!type || !topicId || !TOPIC_TYPES[type]) {
    const types = Object.keys(TOPIC_TYPES).join(' | ');
    return ctx.replyWithHTML(
      `<b>Usage:</b> <code>/settopic &lt;type&gt; &lt;topicId&gt;</code>\n\n` +
      `<b>Types:</b> ${types}\n\n` +
      `<b>Example:</b> <code>/settopic notifications 12345</code>\n\n` +
      `<i>To get a topic ID, right-click on the topic → Copy Link → the number at the end is the ID.</i>`
    );
  }

  store.setGroupTopic(groupId, type, topicId);
  await ctx.replyWithHTML(
    `✅ Topic <b>${TOPIC_TYPES[type].label}</b> set to thread ID <code>${topicId}</code>`
  );
}

// ── /listtopics ─────────────────────────────────────────
async function handleListTopics(ctx) {
  const groupId = ctx.chat?.id?.toString();
  if (!groupId || ctx.chat?.type === 'private') return ctx.reply('Run this inside your group.');
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');

  const group = store.getGroup(groupId);
  const topics = group.topics || {};

  const lines = Object.entries(TOPIC_TYPES).map(([type, info]) => {
    const topicId = topics[type];
    return `${topicId ? '✅' : '❌'} ${info.label}: ${topicId ? `<code>${topicId}</code>` : 'Not set'}`;
  });

  await ctx.replyWithHTML(
    `📌 <b>Forum Topics for this Group</b>\n` +
    `${'─'.repeat(30)}\n\n` +
    lines.join('\n') + '\n\n' +
    `<i>Use /settopic &lt;type&gt; &lt;id&gt; to set manually\nor /autotopics to auto-create all.</i>`
  );
}

// ── /postwelcome ────────────────────────────────────────
async function handlePostWelcome(ctx) {
  const groupId = ctx.chat?.id?.toString();
  if (!groupId || ctx.chat?.type === 'private') return ctx.reply('Run this inside your group.');
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');

  const group = store.getGroup(groupId);
  const topicId = group.topics?.getstarted;

  const welcomeMsg =
    `🚀 <b>Welcome to the Community!</b>\n\n` +
    `Here's how to get started:\n\n` +
    `1️⃣ Start the bot in DM: @${ctx.botInfo?.username}\n` +
    `2️⃣ Link your Twitter: tap ⚙️ Settings → Set Twitter\n` +
    `3️⃣ Complete tasks & raids to earn points\n` +
    `4️⃣ Check the leaderboard to see your rank\n\n` +
    `📋 <b>Channels:</b>\n` +
    `🔔 Check Notifications for new tasks\n` +
    `🎯 Check Quests for active tasks\n` +
    `⚡ Check Raids for active raids\n\n` +
    `Good luck and earn those points! 🏆`;

  try {
    if (topicId) {
      await ctx.telegram.sendMessage(groupId, welcomeMsg, {
        parse_mode: 'HTML',
        message_thread_id: topicId,
      });
      await ctx.reply(`✅ Welcome message posted in Get Started topic.`);
    } else {
      await ctx.replyWithHTML(welcomeMsg);
      await ctx.reply('ℹ️ No "Get Started" topic set. Posted here instead. Use /settopic getstarted <id> to configure.');
    }
  } catch (e) {
    await ctx.reply(`❌ Failed to post: ${e.message}`);
  }
}

// ── /stats ──────────────────────────────────────────────
async function handleStats(ctx) {
  const groupId = ctx.chat?.id?.toString() || '';
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');

  const s = store.getGroupStats(groupId);
  const group = store.getGroup(groupId);

  await ctx.replyWithHTML(
    `📊 <b>Group Statistics</b>\n` +
    `${'─'.repeat(30)}\n\n` +
    `<b>📋 Tasks & Raids</b>\n` +
    `🎯 Active Tasks: <b>${s.activeTasks}</b> / ${s.totalTasks} total\n` +
    `⚡ Active Raids: <b>${s.activeRaids}</b> / ${s.totalRaids} total\n\n` +
    `<b>📬 Submissions</b>\n` +
    `⏳ Pending: <b>${s.pendingSubmissions}</b>\n` +
    `✅ Approved: <b>${s.approvedSubmissions}</b>\n` +
    `❌ Rejected: <b>${s.rejectedSubmissions}</b>\n\n` +
    `<b>👥 Users</b>\n` +
    `Total: <b>${s.totalUsers}</b>  •  Banned: <b>${s.bannedUsers}</b>\n\n` +
    `<b>⚙️ Config</b>\n` +
    `Access Mode: <b>${group.accessMode}</b>\n` +
    `Admins: <b>${group.admins?.size || 0}</b>`
  );
}

// ── /setmode ────────────────────────────────────────────
async function handleSetMode(ctx) {
  const groupId = ctx.chat?.id?.toString();
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');

  const args = ctx.message.text.split(' ').slice(1);
  const mode = args[0]?.toLowerCase();
  if (!['all', 'group', 'whitelist'].includes(mode)) {
    return ctx.reply('Usage: /setmode all|group|whitelist');
  }
  store.setAccessMode(groupId, mode);
  await ctx.replyWithHTML(`✅ Access mode set to: <b>${mode}</b>`);
}

// ── /addadmin / /removeadmin ────────────────────────────
async function handleAddAdmin(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  // Support: /addadmin <userId> (in group) OR /addadmin <groupId> <userId> (in DM)
  let groupId, userId;
  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat.id.toString();
    userId = args[0];
  } else {
    groupId = args[0];
    userId = args[1];
  }
  if (!groupId || !userId) return ctx.reply('Usage (in group): /addadmin <userId>\nUsage (DM): /addadmin <groupId> <userId>');
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');
  store.addAdmin(groupId, userId);
  await ctx.replyWithHTML(`✅ User <code>${userId}</code> added as admin.`);
}

async function handleRemoveAdmin(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  let groupId, userId;
  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat.id.toString();
    userId = args[0];
  } else {
    groupId = args[0];
    userId = args[1];
  }
  if (!groupId || !userId) return ctx.reply('Usage (in group): /removeadmin <userId>');
  store.removeAdmin(groupId, userId);
  await ctx.replyWithHTML(`✅ User <code>${userId}</code> removed from admins.`);
}

function register(bot) {
  bot.command('setup', adminOnly, handleSetup);
  bot.command('autotopics', adminOnly, handleAutoTopics);
  bot.command('settopic', adminOnly, handleSetTopic);
  bot.command('listtopics', adminOnly, handleListTopics);
  bot.command('postwelcome', adminOnly, handlePostWelcome);
  bot.command('stats', adminOnly, handleStats);
  bot.command('setmode', adminOnly, handleSetMode);
  bot.command('addadmin', adminOnly, handleAddAdmin);
  bot.command('removeadmin', adminOnly, handleRemoveAdmin);
}

module.exports = { register, TOPIC_TYPES };
