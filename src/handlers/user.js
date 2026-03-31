const store = require('../store');
const sheets = require('../services/sheets');
const { checkGroupAccess } = require('../middleware/auth');
const { mainMenuKeyboard, taskListKeyboard, approvalKeyboard } = require('../utils/keyboard');
const { verifyTweet } = require('../utils/twitter');

// ── /start ─────────────────────────────────────────────
async function handleStart(ctx) {
  const user = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);

  const greeting = `👋 <b>Welcome, ${ctx.from.first_name}!</b>\n\n` +
    `I'm your group automation bot.\n\n` +
    `Use the menu below to:\n` +
    `🎯 View and complete tasks\n` +
    `⚡ Join raids\n` +
    `🏆 Check the leaderboard\n\n` +
    `Your current points: <b>${user.points}</b>`;

  await ctx.reply(greeting, { parse_mode: 'HTML', ...mainMenuKeyboard() });
}

// ── 🎯 Tasks menu ──────────────────────────────────────
async function handleTasksMenu(ctx) {
  const groupId = ctx.chat?.id?.toString() || 'dm';
  const tasks = store.getTasksForGroup(groupId, 'task');
  if (!tasks.length) return ctx.reply('No active tasks right now. Check back soon!');

  const keyboard = taskListKeyboard(tasks);
  const msg = `🎯 <b>Active Tasks</b>\n\nSelect a task to submit your proof:`;
  await ctx.reply(msg, { parse_mode: 'HTML', ...(keyboard || {}) });
}

// ── ⚡ Raids menu ──────────────────────────────────────
async function handleRaidsMenu(ctx) {
  const groupId = ctx.chat?.id?.toString() || 'dm';
  const raids = store.getTasksForGroup(groupId, 'raid');
  if (!raids.length) return ctx.reply('No active raids right now. Check back soon!');

  const keyboard = taskListKeyboard(raids);
  const msg = `⚡ <b>Active Raids</b>\n\nSelect a raid to submit your proof:`;
  await ctx.reply(msg, { parse_mode: 'HTML', ...(keyboard || {}) });
}

// ── 🏆 Leaderboard ─────────────────────────────────────
async function handleLeaderboard(ctx) {
  const top = store.getLeaderboard(10);
  if (!top.length) return ctx.reply('No users on the leaderboard yet.');

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((u, i) => {
    const medal = medals[i] || `${i + 1}.`;
    return `${medal} @${u.username} — <b>${u.points} pts</b>`;
  });

  await ctx.reply(
    `🏆 <b>Leaderboard</b>\n\n${lines.join('\n')}`,
    { parse_mode: 'HTML' }
  );
}

// ── 👤 My Profile ──────────────────────────────────────
async function handleMyProfile(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');

  const top = store.getLeaderboard(1000);
  const rank = top.findIndex(u => u.id == ctx.from.id) + 1;

  await ctx.reply(
    `👤 <b>My Profile</b>\n\n` +
    `🙍 Username: @${user.username}\n` +
    `💰 Points: <b>${user.points}</b>\n` +
    `🏆 Rank: <b>#${rank || 'N/A'}</b>\n` +
    `🐦 Twitter: ${user.twitter || 'Not set'}\n` +
    `👛 Wallet: ${user.wallet || 'Not set'}\n` +
    `📅 Joined: ${user.joinedAt ? user.joinedAt.split('T')[0] : 'N/A'}`,
    { parse_mode: 'HTML' }
  );
}

// ── 🔔 Toggle Notifications ────────────────────────────
async function handleToggleNotifications(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');
  user.notifications = !user.notifications;
  await ctx.reply(user.notifications
    ? '🔔 Notifications <b>enabled</b>.'
    : '🔕 Notifications <b>disabled</b>.',
    { parse_mode: 'HTML' }
  );
}

// ── /notifications on|off ──────────────────────────────
async function handleNotificationsCommand(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const mode = args[0]?.toLowerCase();
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');

  if (mode === 'on') {
    user.notifications = true;
    await ctx.reply('🔔 Notifications <b>enabled</b>.', { parse_mode: 'HTML' });
  } else if (mode === 'off') {
    user.notifications = false;
    await ctx.reply('🔕 Notifications <b>disabled</b>.', { parse_mode: 'HTML' });
  } else {
    await ctx.reply('Usage: /notifications on|off');
  }
}

// ── /settwitter <twitter_handle_or_link> ───────────────
async function handleSetTwitter(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const handle = args[0];
  if (!handle) return ctx.reply('Usage: /settwitter <handle_or_link>');
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');
  user.twitter = handle;
  await ctx.reply(`✅ Twitter set to: ${handle}`);
}

// ── /setwallet <address> ───────────────────────────────
async function handleSetWallet(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const wallet = args[0];
  if (!wallet) return ctx.reply('Usage: /setwallet <wallet_address>');
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');
  user.wallet = wallet;
  await ctx.reply(`✅ Wallet set to: ${wallet}`);
}

// ── /submit <taskId> <proof_link> ─────────────────────
async function handleSubmit(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const taskId = parseInt(args[0]);
  const proof = args.slice(1).join(' ');

  if (!taskId || !proof) return ctx.reply('Usage: /submit <taskId> <proof_link>');

  const task = store.getTask(taskId);
  if (!task) return ctx.reply('❌ Task not found.');
  if (!task.active) return ctx.reply('❌ This task is no longer active.');

  const groupId = task.groupId;
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;

  // Check access
  const group = store.getGroup(groupId);
  if (!group) return ctx.reply('❌ Group not found.');

  // Duplicate check
  if (store.hasSubmitted(userId, groupId, taskId)) {
    return ctx.reply('⚠️ You have already submitted for this task.');
  }

  // Tweet verification for raid tasks
  if (task.type === 'raid' && (proof.includes('twitter.com') || proof.includes('x.com'))) {
    await ctx.reply('🔍 Verifying tweet...');
    const result = await verifyTweet(proof);
    if (!result.valid) {
      return ctx.reply(`❌ Tweet verification failed: ${result.reason}`);
    }
  }

  // Create submission
  const sub = store.createSubmission(userId, username, groupId, taskId, task.title, proof, task.reward);

  // Log to Google Sheet
  if (group.sheetId && group.sheetId !== 'manual') {
    try {
      await sheets.appendSubmission(group.sheetId, {
        timestamp: new Date().toISOString(),
        userId,
        username,
        task: task.title,
        proof,
        status: 'pending',
        points: task.reward,
      });
    } catch (e) {
      console.error('Sheet append error:', e.message);
    }
  }

  await ctx.reply(
    `📬 <b>Submission Received!</b>\n\n` +
    `Task: ${task.title}\n` +
    `Proof: ${proof}\n\n` +
    `Your submission is under review. You will be notified once approved.`,
    { parse_mode: 'HTML' }
  );

  // Send to all admins for approval
  const adminMsg =
    `📋 <b>New Submission #${sub.id}</b>\n\n` +
    `👤 @${username} (${userId})\n` +
    `🎯 Task: ${task.title}\n` +
    `🔗 Proof: ${proof}\n` +
    `💰 Points: ${task.reward}`;

  // Send to group admins
  const groupAdmins = group.admins ? [...group.admins] : [];
  const { OWNER_ID } = require('../config');
  const allAdmins = new Set([OWNER_ID, ...groupAdmins]);

  for (const adminId of allAdmins) {
    try {
      await ctx.telegram.sendMessage(adminId, adminMsg, {
        parse_mode: 'HTML',
        ...approvalKeyboard(sub.id),
      });
    } catch { }
  }
}

// ── submit_<taskId> callback (from task list) ──────────
async function handleSubmitCallback(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.');

  await ctx.answerCbQuery();
  await ctx.reply(
    `📝 <b>${task.title}</b>\n\n` +
    `🔗 Link: ${task.link}\n` +
    `💰 Reward: ${task.reward} points\n\n` +
    `To submit your proof:\n<code>/submit ${task.id} your_proof_link</code>`,
    { parse_mode: 'HTML' }
  );
}

// ── /leaderboard command ───────────────────────────────
async function handleLeaderboardCommand(ctx) {
  await handleLeaderboard(ctx);
}

function register(bot) {
  bot.start(handleStart);
  bot.command('leaderboard', handleLeaderboardCommand);
  bot.command('profile', handleMyProfile);
  bot.command('submit', handleSubmit);
  bot.command('notifications', handleNotificationsCommand);
  bot.command('settwitter', handleSetTwitter);
  bot.command('setwallet', handleSetWallet);

  // Keyboard menu buttons
  bot.hears('🎯 Tasks', handleTasksMenu);
  bot.hears('⚡ Raids', handleRaidsMenu);
  bot.hears('🏆 Leaderboard', handleLeaderboard);
  bot.hears('👤 My Profile', handleMyProfile);
  bot.hears('🔔 Toggle Notifications', handleToggleNotifications);

  // Inline callbacks
  bot.action(/^submit_(\d+)$/, handleSubmitCallback);
}

module.exports = { register };
