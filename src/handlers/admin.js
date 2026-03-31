const store = require('../store');
const sheets = require('../services/sheets');
const { adminOnly } = require('../middleware/auth');
const { approvalKeyboard, adminPanelKeyboard } = require('../utils/keyboard');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── /addadmin <userId> ─────────────────────────────────
async function handleAddAdmin(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const targetId = parseInt(args[0]);
  if (!targetId) return ctx.reply('Usage: /addadmin <userId>');

  const groupId = ctx.chat.id.toString();
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ This group is not registered. Ask the owner to /addgroup.');

  store.addAdmin(groupId, targetId);
  await ctx.reply(`✅ User ${targetId} added as admin for this group.`);
}

// ── /removeadmin <userId> ──────────────────────────────
async function handleRemoveAdmin(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const targetId = parseInt(args[0]);
  if (!targetId) return ctx.reply('Usage: /removeadmin <userId>');

  const groupId = ctx.chat.id.toString();
  store.removeAdmin(groupId, targetId);
  await ctx.reply(`✅ User ${targetId} removed from admins.`);
}

// ── /ban <userId> ──────────────────────────────────────
async function handleBan(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const targetId = parseInt(args[0]);
  if (!targetId) return ctx.reply('Usage: /ban <userId>');
  store.banUser(targetId);
  await ctx.reply(`🚫 User ${targetId} has been banned.`);
}

// ── /unban <userId> ────────────────────────────────────
async function handleUnban(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const targetId = parseInt(args[0]);
  if (!targetId) return ctx.reply('Usage: /unban <userId>');
  store.unbanUser(targetId);
  await ctx.reply(`✅ User ${targetId} has been unbanned.`);
}

// ── /setmode all|group|whitelist ───────────────────────
async function handleSetMode(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const mode = args[0];
  if (!['all', 'group', 'whitelist'].includes(mode)) {
    return ctx.reply('Usage: /setmode all|group|whitelist');
  }
  const groupId = ctx.chat.id.toString();
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');
  store.setAccessMode(groupId, mode);
  await ctx.reply(`✅ Access mode set to: <b>${mode}</b>`, { parse_mode: 'HTML' });
}

// ── /addemail gmail@example.com ────────────────────────
async function handleAddEmail(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const email = args[0];
  if (!email || !email.includes('@')) return ctx.reply('Usage: /addemail gmail@example.com');

  const groupId = ctx.chat.id.toString();
  const group = store.getGroup(groupId);
  if (!group) return ctx.reply('⚠️ Group not registered.');

  store.addExtraEmail(groupId, email);

  if (group.sheetId && group.sheetId !== 'manual') {
    try {
      await sheets.shareSheet(group.sheetId, email);
      await ctx.reply(`✅ ${email} added and sheet shared.`);
    } catch (e) {
      await ctx.reply(`✅ Email saved, but sheet share failed: ${e.message}`);
    }
  } else {
    await ctx.reply(`✅ Email ${email} saved (no sheet to share).`);
  }
}

// ── /createtask title | link | reward ─────────────────
async function handleCreateTask(ctx) {
  await _createTaskOrRaid(ctx, 'task');
}

// ── /createraid title | link | reward ─────────────────
async function handleCreateRaid(ctx) {
  await _createTaskOrRaid(ctx, 'raid');
}

async function _createTaskOrRaid(ctx, type) {
  const groupId = ctx.chat.id.toString();
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');

  const raw = ctx.message.text.split(' ').slice(1).join(' ');
  const parts = raw.split('|').map(s => s.trim());
  if (parts.length < 3) {
    return ctx.reply(`Usage: /${type === 'task' ? 'createtask' : 'createraid'} Title | Link | Reward`);
  }

  const [title, link, reward] = parts;
  const task = store.createTask(groupId, title, link, parseInt(reward) || 0, type);

  const emoji = type === 'raid' ? '⚡' : '🎯';
  const msg = `${emoji} <b>New ${type.charAt(0).toUpperCase() + type.slice(1)}!</b>\n\n` +
    `📌 <b>${task.title}</b>\n` +
    `🔗 ${task.link}\n` +
    `💰 Reward: <b>${task.reward} points</b>\n\n` +
    `To submit, use /submit ${task.id} <proof_link>`;

  // Post in group
  await ctx.reply(msg, { parse_mode: 'HTML' });

  // DM all users
  const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
  let dmSent = 0;
  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.id, msg, { parse_mode: 'HTML' });
      dmSent++;
    } catch { }
    await delay(50);
  }
  await ctx.reply(`📬 Task sent to ${dmSent} users via DM.`);
}

// ── /announce <message> ────────────────────────────────
async function handleAnnounce(ctx) {
  const groupId = ctx.chat.id.toString();
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');

  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /announce <message>');

  const msg = `📢 <b>Announcement</b>\n\n${text}`;
  await ctx.reply(msg, { parse_mode: 'HTML' });

  const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
  let sent = 0;
  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.id, msg, { parse_mode: 'HTML' });
      sent++;
    } catch { }
    await delay(50);
  }
  await ctx.reply(`✅ Announced to ${sent} users.`);
}

// ── /admin (panel) ─────────────────────────────────────
async function handleAdminPanel(ctx) {
  const groupId = ctx.chat.id.toString();
  if (!store.isGroupRegistered(groupId)) return ctx.reply('⚠️ Group not registered.');
  await ctx.reply('🛠️ <b>Admin Panel</b>', { parse_mode: 'HTML', ...adminPanelKeyboard() });
}

// ── Approve / Reject callbacks ──────────────────────────
async function handleApproveCallback(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.');
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`);

  store.approveSubmission(subId);
  store.addPoints(sub.userId, sub.points);

  // Update Google Sheet
  const groupId = sub.groupId;
  const group = store.getGroup(groupId);
  const user = store.getUser(sub.userId);

  if (group?.sheetId && group.sheetId !== 'manual') {
    try {
      await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'approved');
      if (user) await sheets.upsertUser(group.sheetId, {
        userId: sub.userId,
        username: sub.username,
        points: user.points,
        twitter: user.twitter,
        wallet: user.wallet,
        joinedAt: user.joinedAt,
      });
    } catch (e) {
      console.error('Sheet update error:', e.message);
    }
  }

  // Notify user
  try {
    await ctx.telegram.sendMessage(sub.userId,
      `✅ <b>Submission Approved!</b>\n\n` +
      `Task: ${sub.taskTitle}\n` +
      `Points earned: <b>+${sub.points}</b>\n` +
      `Total points: <b>${user ? user.points : '?'}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch { }

  await ctx.editMessageText(`✅ Approved — ${sub.username} | ${sub.taskTitle}`);
  await ctx.answerCbQuery('Approved!');
}

async function handleRejectCallback(ctx) {
  const subId = parseInt(ctx.match[1]);
  const sub = store.getSubmission(subId);
  if (!sub) return ctx.answerCbQuery('Submission not found.');
  if (sub.status !== 'pending') return ctx.answerCbQuery(`Already ${sub.status}.`);

  store.rejectSubmission(subId);

  // Update Google Sheet
  const group = store.getGroup(sub.groupId);
  if (group?.sheetId && group.sheetId !== 'manual') {
    try {
      await sheets.updateSubmissionStatus(group.sheetId, sub.userId, sub.taskTitle, 'rejected');
    } catch { }
  }

  try {
    await ctx.telegram.sendMessage(sub.userId,
      `❌ <b>Submission Rejected</b>\n\nTask: ${sub.taskTitle}\n\nPlease re-read the task requirements and try again.`,
      { parse_mode: 'HTML' }
    );
  } catch { }

  await ctx.editMessageText(`❌ Rejected — ${sub.username} | ${sub.taskTitle}`);
  await ctx.answerCbQuery('Rejected.');
}

// ── /viewsubmissions ───────────────────────────────────
async function handleViewSubmissions(ctx) {
  const groupId = ctx.chat.id.toString();
  const subs = Object.values(require('../store').store.submissions)
    .filter(s => s.groupId === groupId && s.status === 'pending');

  if (!subs.length) return ctx.reply('No pending submissions.');

  for (const sub of subs.slice(0, 10)) {
    await ctx.reply(
      `📋 <b>Pending Submission #${sub.id}</b>\n` +
      `👤 @${sub.username} (${sub.userId})\n` +
      `🎯 Task: ${sub.taskTitle}\n` +
      `🔗 Proof: ${sub.proof}\n` +
      `💰 Points: ${sub.points}`,
      { parse_mode: 'HTML', ...approvalKeyboard(sub.id) }
    );
  }
}

function register(bot) {
  bot.command('addadmin', adminOnly, handleAddAdmin);
  bot.command('removeadmin', adminOnly, handleRemoveAdmin);
  bot.command('ban', adminOnly, handleBan);
  bot.command('unban', adminOnly, handleUnban);
  bot.command('setmode', adminOnly, handleSetMode);
  bot.command('addemail', adminOnly, handleAddEmail);
  bot.command('createtask', adminOnly, handleCreateTask);
  bot.command('createraid', adminOnly, handleCreateRaid);
  bot.command('announce', adminOnly, handleAnnounce);
  bot.command('admin', adminOnly, handleAdminPanel);
  bot.command('viewsubmissions', adminOnly, handleViewSubmissions);

  bot.action(/^approve_(\d+)$/, handleApproveCallback);
  bot.action(/^reject_(\d+)$/, handleRejectCallback);

  // Admin panel inline button actions
  bot.action('admin_view_submissions', async (ctx) => {
    await ctx.answerCbQuery();
    await handleViewSubmissions(ctx);
  });
  bot.action('admin_announce', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Use the command: /announce <your message>');
  });
  bot.action('admin_create_task', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Use the command:\n/createtask Title | Link | Reward');
  });
  bot.action('admin_create_raid', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Use the command:\n/createraid Title | Link | Reward');
  });
  bot.action('admin_manage_users', async (ctx) => {
    await ctx.answerCbQuery();
    const users = store.getAllUsers();
    const msg = users.slice(0, 20).map(u =>
      `👤 @${u.username} (${u.id}) | Points: ${u.points} | ${u.banned ? '🚫 Banned' : '✅ Active'}`
    ).join('\n') || 'No users yet.';
    await ctx.reply(`👥 <b>Users (top 20)</b>\n\n${msg}`, { parse_mode: 'HTML' });
  });
  bot.action('admin_close', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
  });
}

module.exports = { register };
