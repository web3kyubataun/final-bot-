const store = require('../store');
const sheets = require('../services/sheets');
const session = require('../sessions');
const config = require('../config');
const { isOwner } = require('../middleware/auth');
const { getBotUsername } = require('../botInfo');
const {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard,
  taskListKeyboard, taskCardKeyboard, taskCardDMKeyboard,
  approvalKeyboard, cancelKeyboard,
} = require('../utils/keyboard');
const { verifyTweet } = require('../utils/twitter');
const { Markup } = require('telegraf');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════
//  /start  — also handles deeplinks like /start submit_123
// ═══════════════════════════════════════════════

async function handleStart(ctx) {
  const payload = ctx.startPayload; // text after /start

  // ── Deep-link: submit_<taskId> ────────────────
  if (payload?.startsWith('submit_')) {
    const taskId = parseInt(payload.replace('submit_', ''));
    const task   = store.getTask(taskId);

    if (!task || !task.active) {
      return ctx.replyWithHTML('❌ That task is no longer available.');
    }
    if (store.hasSubmitted(ctx.from.id, task.groupId, taskId)) {
      return ctx.replyWithHTML('⚠️ You already submitted for this task. Wait for admin review.');
    }

    session.setSession(ctx.from.id, { step: 'awaiting_proof', taskId });
    return ctx.replyWithHTML(
      `📤 <b>Submit Proof</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: <b>${task.title}</b>\n` +
      `💰 Reward: <b>${task.reward} pts</b>\n\n` +
      `Send your <b>proof now</b>:\n` +
      `• Paste a tweet/link URL, OR\n` +
      `• Send a <b>screenshot</b> (photo)\n\n` +
      `<i>Screenshots are forwarded directly to admins for review.</i>`,
      cancelKeyboard()
    );
  }

  // ── Normal /start ─────────────────────────────
  const user = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  await ctx.replyWithHTML(
    `✨ <b>Welcome!</b> ✨\n` +
    `${'─'.repeat(28)}\n\n` +
    `Hey <b>${ctx.from.first_name}</b>! 👋\n\n` +
    `💰 Your Points: <b>${user.points}</b>\n` +
    `🏆 Complete tasks & raids to earn points and climb the leaderboard!\n\n` +
    `Use the menu below 👇`,
    mainMenuKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  TASKS & RAIDS MENUS
// ═══════════════════════════════════════════════

async function handleTasksMenu(ctx) {
  let tasks = [];
  store.getAllGroups().forEach(g => tasks.push(...store.getTasksForGroup(g.id, 'task')));

  if (!tasks.length) {
    return ctx.replyWithHTML(`🎯 <b>Active Tasks</b>\n\n💤 No active tasks right now. Check back soon!`);
  }
  await ctx.replyWithHTML(
    `🎯 <b>Active Tasks</b> (${tasks.length})\n\n<i>Tap a task to view details:</i>`,
    taskListKeyboard(tasks)
  );
}

async function handleRaidsMenu(ctx) {
  let raids = [];
  store.getAllGroups().forEach(g => raids.push(...store.getTasksForGroup(g.id, 'raid')));

  if (!raids.length) {
    return ctx.replyWithHTML(`⚡ <b>Active Raids</b>\n\n💤 No raids running right now!`);
  }
  await ctx.replyWithHTML(
    `⚡ <b>Active Raids</b> (${raids.length})\n\n<i>Tap a raid to view details:</i>`,
    taskListKeyboard(raids)
  );
}

// ── View task detail ──────────────────────────
async function handleViewTask(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  await ctx.answerCbQuery();
  const userId      = ctx.from.id;
  const alreadyDone = store.hasSubmitted(userId, task.groupId, taskId);
  const emoji       = task.type === 'raid' ? '⚡' : '🎯';
  const isInGroup   = ctx.chat?.type !== 'private';
  const botName     = getBotUsername();

  await ctx.replyWithHTML(
    `${emoji} <b>${task.title}</b>\n` +
    `${'─'.repeat(28)}\n` +
    (task.link ? `🔗 <a href="${task.link}">Open Link</a>\n` : '') +
    `💰 Reward: <b>${task.reward} pts</b>\n` +
    `${'─'.repeat(28)}\n` +
    (alreadyDone
      ? `✅ <i>Already submitted. Awaiting admin review.</i>`
      : `📤 <i>Complete the task, then submit your proof in DM.</i>`),
    alreadyDone ? {} : (isInGroup
      ? taskCardDMKeyboard(task.id, task.link, task.buttonLabel, botName)
      : taskCardKeyboard(task.id, task.link, task.buttonLabel))
  );
}

// ── Submit button tapped from GROUP → redirect to DM ──
async function handleDoSubmit(ctx) {
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Task not found.', { show_alert: true });

  const userId = ctx.from.id;
  if (store.hasSubmitted(userId, task.groupId, taskId)) {
    return ctx.answerCbQuery('⚠️ Already submitted!', { show_alert: true });
  }
  if (!task.active) {
    return ctx.answerCbQuery('❌ Task no longer active.', { show_alert: true });
  }

  const isInGroup = ctx.chat?.type !== 'private';

  if (isInGroup) {
    // Redirect to DM with deeplink
    await ctx.answerCbQuery('📬 Please submit in DM →', { show_alert: true });
    const botName = getBotUsername();
    await ctx.reply(
      `📬 Submissions must be done in private DM.\nTap below to open the bot:`,
      Markup.inlineKeyboard([[
        Markup.button.url('📬 Submit in DM', `https://t.me/${botName}?start=submit_${taskId}`)
      ]])
    );
    return;
  }

  // Already in DM — start proof flow immediately
  await ctx.answerCbQuery();
  session.setSession(userId, { step: 'awaiting_proof', taskId });
  await ctx.replyWithHTML(
    `📤 <b>Submit Proof</b>\n` +
    `${'─'.repeat(28)}\n` +
    `🎯 Task: <b>${task.title}</b>\n\n` +
    `Send your <b>proof</b>:\n` +
    `• Paste a tweet/link URL, OR\n` +
    `• Send a <b>screenshot</b> (photo)`,
    cancelKeyboard()
  );
}

// ═══════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════

async function handleLeaderboard(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const top = store.getLeaderboard(10);
  if (!top.length) {
    return ctx.replyWithHTML(`🏆 <b>Leaderboard</b>\n\n<i>No users ranked yet. Be the first!</i>`);
  }
  const medals  = ['🥇', '🥈', '🥉'];
  const maxPts  = top[0].points || 1;
  const bar     = pts => { const f = Math.round((pts / maxPts) * 10); return '█'.repeat(f) + '░'.repeat(10 - f); };
  const lines   = top.map((u, i) =>
    `${medals[i] || `${i + 1}.`} <b>@${u.username}</b>\n   <code>${bar(u.points)}</code>  <b>${u.points}</b> pts`
  );
  await ctx.replyWithHTML(`🏆 <b>Leaderboard — Top ${top.length}</b>\n${'─'.repeat(28)}\n\n${lines.join('\n\n')}`);
}

// ═══════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════

async function handleMyProfile(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const user   = store.getUser(userId);
  if (!user) return ctx.replyWithHTML('Please use /start first.');

  const top    = store.getLeaderboard(1000);
  const rank   = top.findIndex(u => String(u.id) === String(userId)) + 1;
  const text   =
    `👤 <b>My Profile</b>\n` +
    `${'─'.repeat(28)}\n` +
    `🙍 @${user.username}\n` +
    `💰 Points: <b>${user.points}</b>  🏆 Rank: <b>#${rank || '—'}</b>\n` +
    `🐦 Twitter: ${user.twitter || '<i>Not set</i>'}\n` +
    `👛 Wallet: ${user.wallet || '<i>Not set</i>'}\n` +
    `💬 Discord: ${user.discord || '<i>Not set</i>'}\n` +
    `🔔 Notifs: ${user.notifications === false ? '🔕 Off' : '🔔 On'}\n` +
    `${'─'.repeat(28)}`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...profileKeyboard(user) }).catch(async () => {
      await ctx.replyWithHTML(text, profileKeyboard(user));
    });
  } else {
    await ctx.replyWithHTML(text, profileKeyboard(user));
  }
}

// ═══════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════

async function handleSettings(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.replyWithHTML('Please use /start first.');
  await ctx.replyWithHTML(
    `⚙️ <b>Settings</b>\n${'─'.repeat(28)}\n` +
    `🐦 Twitter: <b>${user.twitter || 'Not set'}</b>\n` +
    `👛 Wallet: <b>${user.wallet || 'Not set'}</b>\n` +
    `💬 Discord: <b>${user.discord || 'Not set'}</b>\n` +
    `🔔 Notifications: <b>${user.notifications === false ? 'Off' : 'On'}</b>`,
    settingsKeyboard(user)
  );
}

// ═══════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════

async function handleHelp(ctx) {
  await ctx.replyWithHTML(
    `❓ <b>How to Use This Bot</b>\n` +
    `${'─'.repeat(28)}\n\n` +
    `<b>📱 Bottom Menu</b>\n` +
    `🎯 <b>Tasks</b> — View active tasks\n` +
    `⚡ <b>Raids</b> — View active raids\n` +
    `🏆 <b>Leaderboard</b> — Top earners\n` +
    `👤 <b>My Profile</b> — Stats & rank\n` +
    `⚙️ <b>Settings</b> — Twitter, Wallet, Discord\n\n` +
    `<b>📤 How to Submit Proof</b>\n` +
    `1. Tap 🎯 Tasks or ⚡ Raids\n` +
    `2. Tap a task to open it\n` +
    `3. Complete the task (open link)\n` +
    `4. Tap <b>📬 Submit in DM</b>\n` +
    `5. Send a URL or <b>screenshot</b>\n` +
    `6. Admin reviews & approves\n\n` +
    `<b>⚠️ Submissions are DM-only</b>\n` +
    `For privacy, all proofs must be submitted in private DM.\n\n` +
    `<b>💰 Points</b>\n` +
    `Earned when admin approves your submission.\n\n` +
    `<b>🛠 Admins:</b> /admin\n` +
    `<b>👑 Owners:</b> /ownerhelp`
  );
}

// ═══════════════════════════════════════════════
//  SESSION INPUT HANDLER  (text + photo)
// ═══════════════════════════════════════════════

async function handleSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const s = session.getSession(userId);
  if (!s || s.adminFlow) return next();

  const hasText  = !!ctx.message?.text;
  const hasPhoto = !!(ctx.message?.photo?.length);

  if (!hasText && !hasPhoto) return next();

  const text = ctx.message?.text?.trim() || '';

  // ── PROOF SUBMISSION ──────────────────────────
  if (s.step === 'awaiting_proof') {
    // Must be in DM
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('⚠️ Please submit your proof in DM with the bot.');
    }

    const task = store.getTask(s.taskId);
    if (!task)         return ctx.replyWithHTML('❌ Task no longer exists.');
    if (!task.active)  return ctx.replyWithHTML('❌ This task is no longer active.');
    if (store.hasSubmitted(userId, task.groupId, s.taskId)) {
      session.clearSession(userId);
      return ctx.replyWithHTML('⚠️ You already submitted for this task.');
    }

    session.clearSession(userId);

    let proofType   = 'text';
    let proofValue  = text;
    let proofFileId = null;

    if (hasPhoto) {
      // Take highest resolution photo
      const photo  = ctx.message.photo.slice(-1)[0];
      proofFileId  = photo.file_id;
      proofType    = 'photo';
      proofValue   = ctx.message.caption || '[screenshot]';
    } else {
      // Validate tweet URL if applicable
      if (text.includes('twitter.com') || text.includes('x.com')) {
        const r = await verifyTweet(text);
        if (!r.valid) {
          session.setSession(userId, s); // keep session alive to retry
          return ctx.replyWithHTML(`❌ <b>Invalid tweet URL:</b> ${r.reason}\n\nPlease send a valid tweet link.`);
        }
      }
    }

    const username = ctx.from.username || ctx.from.first_name;
    const sub = store.createSubmission(
      userId, username, task.groupId, s.taskId,
      task.title, proofValue, task.reward, proofType, proofFileId
    );

    // Log TEXT submissions to Google Sheet only
    const group = store.getGroup(task.groupId);
    if (group?.sheetId && group.sheetId !== 'none' && proofType === 'text') {
      try {
        await sheets.appendSubmission(group.sheetId, {
          timestamp: new Date().toISOString(), userId, username,
          task: task.title, proof: proofValue, status: 'pending', points: task.reward,
        });
      } catch (e) { console.error('Sheet error:', e.message); }
    }

    await ctx.replyWithHTML(
      `✅ <b>Submission Received!</b>\n` +
      `${'─'.repeat(28)}\n` +
      `🎯 Task: <b>${task.title}</b>\n` +
      (proofType === 'photo' ? `📸 Screenshot submitted\n` : `🔗 ${proofValue}\n`) +
      `💰 Pending: <b>${task.reward} pts</b>\n\n` +
      `You'll be notified once an admin reviews it.`
    );

    // Notify admins — send photo or text
    const adminCaption =
      `📋 <b>New Submission #${sub.id}</b>\n` +
      `${'─'.repeat(28)}\n` +
      `👤 @${username} (<code>${userId}</code>)\n` +
      `🎯 Task: <b>${task.title}</b>\n` +
      (proofType === 'photo' ? `📸 Screenshot\n` : `🔗 ${proofValue}\n`) +
      `💰 <b>${task.reward} pts</b>`;

    const admins = new Set([
      ...config.OWNER_IDS.map(String),
      ...(group?.admins ? [...group.admins] : []),
    ]);

    for (const adminId of admins) {
      try {
        if (proofType === 'photo') {
          await ctx.telegram.sendPhoto(adminId, proofFileId, {
            caption: adminCaption,
            parse_mode: 'HTML',
            ...approvalKeyboard(sub.id),
          });
        } else {
          await ctx.telegram.sendMessage(adminId, adminCaption, {
            parse_mode: 'HTML',
            ...approvalKeyboard(sub.id),
          });
        }
      } catch { }
    }

    // Post to submissions topic in group
    if (group?.topics?.submissions) {
      try {
        if (proofType === 'photo') {
          await ctx.telegram.sendPhoto(task.groupId, proofFileId, {
            caption: adminCaption,
            parse_mode: 'HTML',
            message_thread_id: group.topics.submissions,
            ...approvalKeyboard(sub.id),
          });
        } else {
          await ctx.telegram.sendMessage(task.groupId, adminCaption, {
            parse_mode: 'HTML',
            message_thread_id: group.topics.submissions,
            ...approvalKeyboard(sub.id),
          });
        }
      } catch { }
    }
    return;
  }

  // Non-proof flows only process text
  if (!hasText) return next();

  // Cancel if it's a command (let it fall through)
  if (text.startsWith('/')) {
    session.clearSession(userId);
    return next();
  }

  if (s.step === 'awaiting_twitter') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.twitter = text.startsWith('@') ? text : `@${text}`;
    return ctx.replyWithHTML(`✅ Twitter set: <b>${user.twitter}</b>`, mainMenuKeyboard());
  }

  if (s.step === 'awaiting_wallet') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.wallet = text;
    return ctx.replyWithHTML(`✅ Wallet updated:\n<code>${text}</code>`, mainMenuKeyboard());
  }

  if (s.step === 'awaiting_discord') {
    session.clearSession(userId);
    const user = store.getUser(userId);
    if (user) user.discord = text;
    return ctx.replyWithHTML(`✅ Discord set: <b>${text}</b>`, mainMenuKeyboard());
  }

  return next();
}

// ═══════════════════════════════════════════════
//  INLINE CALLBACKS
// ═══════════════════════════════════════════════

async function handleToggleNotif(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) return ctx.answerCbQuery();
  user.notifications = user.notifications === false ? true : false;
  await ctx.answerCbQuery(user.notifications ? '🔔 Notifications ON' : '🔕 Notifications OFF', { show_alert: true });
  await handleMyProfile(ctx);
}

async function handleSetTwitter(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_twitter' });
  await ctx.replyWithHTML(`🐦 <b>Set Twitter</b>\n\nSend your @handle:`, cancelKeyboard());
}

async function handleSetWallet(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_wallet' });
  await ctx.replyWithHTML(`👛 <b>Set Wallet</b>\n\nSend your wallet address:`, cancelKeyboard());
}

async function handleSetDiscord(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_discord' });
  await ctx.replyWithHTML(`💬 <b>Set Discord</b>\n\nSend your Discord username:`, cancelKeyboard());
}

async function handleCancelFlow(ctx) {
  await ctx.answerCbQuery('Cancelled.');
  session.clearSession(ctx.from.id);
  await ctx.deleteMessage().catch(() => {});
}

// ═══════════════════════════════════════════════
//  REGISTER
// ═══════════════════════════════════════════════

function register(bot) {
  // Session input for text AND photo messages
  bot.on(['message'], handleSessionInput);

  bot.start(handleStart);
  bot.command('leaderboard', handleLeaderboard);
  bot.command('profile', handleMyProfile);
  bot.command('help', handleHelp);

  bot.hears('🎯 Tasks',        handleTasksMenu);
  bot.hears('⚡ Raids',        handleRaidsMenu);
  bot.hears('🏆 Leaderboard',  handleLeaderboard);
  bot.hears('👤 My Profile',   handleMyProfile);
  bot.hears('⚙️ Settings',     handleSettings);
  bot.hears('❓ Help',         handleHelp);

  bot.action('toggle_notif',   handleToggleNotif);
  bot.action('set_twitter',    handleSetTwitter);
  bot.action('set_wallet',     handleSetWallet);
  bot.action('set_discord',    handleSetDiscord);
  bot.action('refresh_profile', ctx => handleMyProfile(ctx));
  bot.action('close_msg',      async ctx => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(() => {}); });
  bot.action('cancel_flow',    handleCancelFlow);

  bot.action(/^view_task_(\d+)$/, handleViewTask);
  bot.action(/^do_submit_(\d+)$/, handleDoSubmit);
}

module.exports = { register };
