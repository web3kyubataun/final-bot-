/**
 * user.js — All user-facing interactions
 */

const { Markup } = require('telegraf');
const store   = require('../store');
const session = require('../sessions');
const { getTokens } = require('../db/sqlite');
const { generateAuthUrl } = require('../oauth/twitterOAuth');
const tw = require('../utils/twitterVerify');
const sheets = require('../services/sheets');
const { getBotUsername } = require('../botInfo');
const {
  mainMenuKeyboard, profileKeyboard, settingsKeyboard, oauthConnectKeyboard,
  taskListKeyboard, taskCardKeyboard, cancelKeyboard,
} = require('../utils/keyboard');

const TASK_TYPE_LABELS = {
  follow: 'Follow @handle on Twitter',
  like: 'Like the tweet',
  retweet: 'Retweet the post',
  comment: 'Reply to the tweet with your comment',
  quote: 'Quote tweet the post',
  join: 'Join the Telegram channel/group',
  react: 'React to the message',
  send: 'Send a message',
};

// ── /start ────────────────────────────────────────────────────────────────────

async function handleStart(ctx) {
  const payload = ctx.startPayload;

  if (payload?.startsWith('submit_')) {
    const taskId = parseInt(payload.replace('submit_', ''));
    const task   = store.getTask(taskId);
    if (!task || !task.active) {
      return ctx.replyWithHTML('<b>Task Unavailable</b>\n\nThis task is no longer active or does not exist.');
    }
    if (task.type === 'raid' && task.expiresAt && new Date(task.expiresAt) < new Date()) {
      return ctx.replyWithHTML('<b>Raid Expired</b>\n\nThis raid has ended.');
    }
    if (store.hasSubmitted(ctx.from.id, task.groupId, taskId)) {
      return ctx.replyWithHTML('<b>Already Done</b>\n\nYou have already completed this task!');
    }
    store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
    return sendTaskCard(ctx, task, true);
  }

  const user   = store.getOrCreateUser(ctx.from.id, ctx.from.username || ctx.from.first_name);
  if (ctx.from.first_name) store.setUserField(ctx.from.id, 'firstName', ctx.from.first_name);
  const tokens = getTokens(ctx.from.id);
  const hasOAuth = !!(tokens?.access_token);

  const welcomeText =
    `<b>Welcome to Momentum Hub!</b>\n${'─'.repeat(28)}\n\n` +
    `<b>What We Do:</b>\n` +
    `We connect a powerful network of engaged members who support each other's social media presence across all major platforms including Instagram, TikTok, X, YouTube, LinkedIn, and more. Every like, share, comment, and follow fuels a thriving ecosystem built on mutual growth and real rewards.\n\n` +
    `<b>Why Members Love It:</b>\n` +
    `• Real, active community with no bots, no fake accounts\n` +
    `• Fast payment processing so get paid without the wait\n` +
    `• Dedicated support team available 24/7\n` +
    `• Transparent point tracking dashboard\n` +
    `• Exclusive member-only campaigns with top brands\n\n` +
    `<b>Who It's For:</b>\n` +
    `Whether you're a rising creator or a seasoned influencer, Momentum Hub is your unfair advantage in the attention economy.`;

  if (hasOAuth) {
    await ctx.replyWithHTML(welcomeText);
    await ctx.replyWithHTML(
      `✅ <b>Twitter Connected:</b> @${user.twitter || 'linked'}\n\nYour Points: <b>${user.points}</b>`,
      mainMenuKeyboard()
    );
  } else {
    await ctx.replyWithHTML(
      welcomeText + `\n\n⚠️ <b>Your Twitter account can only be connected once and cannot be changed by you. Contact an admin if you need it updated.</b>`,
      Markup.inlineKeyboard([[Markup.button.callback('🔗 Connect Twitter Account via OAuth', 'connect_twitter_oauth')]])
    );
  }
}

// ── Task card ─────────────────────────────────────────────────────────────────

function getTaskInstructions(task) {
  const types = task.taskTypes ? JSON.parse(task.taskTypes) : [task.taskType];
  const instructions = {
    like:    'Like the tweet, then tap Verify.',
    retweet: 'Retweet the post (natively), then tap Verify.',
    follow:  'Follow the account, then tap Verify.',
    comment: 'Reply to the tweet with your comment, then paste your reply URL.',
    quote:   'Quote tweet the post, then paste your quote tweet URL.',
    join:    'Join the channel/group, then tap Verify.',
    react:   'React to the message (trust-based).',
    send:    'Send the message (trust-based).',
  };
  return types.map(t => `• ${instructions[t] || 'Complete the task'}`).join('\n');
}

async function sendTaskCard(ctx, task, isDm = false) {
  const types = task.taskTypes ? JSON.parse(task.taskTypes) : [task.taskType];
  const typeLabel = types.map(t => TASK_TYPE_LABELS[t] ? t.charAt(0).toUpperCase() + t.slice(1) : t).join(' + ');

  let body = `<b>${task.type === 'raid' ? '⚡' : '📋'} ${task.title}</b>\n${'─'.repeat(26)}\n`;
  body += `<b>Type:</b> ${typeLabel}\n<b>Reward:</b> ${task.reward} pts\n`;
  if (task.minChars > 0) body += `<b>Min characters:</b> ${task.minChars}\n`;
  if (task.expiresAt) {
    const ms = new Date(task.expiresAt) - Date.now();
    if (ms > 0) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      body += `<b>Time left:</b> ${h > 0 ? `${h}h ${m}m` : `${m}m`}\n`;
    }
  }
  body += `\n<b>Required actions:</b>\n${getTaskInstructions(task)}\n\n<i>Complete all actions, then tap Verify.</i>`;

  const primaryType = types[0];
  await ctx.replyWithHTML(body, taskCardKeyboard(task.id, task.link, task.buttonLabel, primaryType));
}

async function handleViewTask(ctx) {
  await ctx.answerCbQuery();
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  if (!task || !task.active) return ctx.replyWithHTML('<b>Task Unavailable</b>\n\nThis task no longer exists.');
  if (store.hasSubmitted(ctx.from.id, task.groupId, taskId)) {
    return ctx.replyWithHTML('<b>Already Done</b>\n\nYou already completed this task!');
  }
  await sendTaskCard(ctx, task, false);
}

// ── Submit / verify ───────────────────────────────────────────────────────────

async function completeTask(ctx, userId, task, user) {
  store.createSubmission(userId, user.username, task.groupId, task.id, task.title, 'auto-verified', task.reward, 'auto', null, 'approved');
  store.addPoints(userId, task.reward);
  const type = task.type;
  if (type === 'raid') {
    store.setUserField(userId, 'raidsCompleted', (user.raidsCompleted || 0) + 1);
  } else {
    store.setUserField(userId, 'tasksCompleted', (user.tasksCompleted || 0) + 1);
  }

  const updatedUser = store.getUser(userId);
  await ctx.replyWithHTML(
    `<b>✅ Task Completed!</b>\n\n<b>${task.title}</b>\n<b>+${task.reward} points</b>\nTotal: <b>${updatedUser.points} pts</b>`,
    mainMenuKeyboard()
  );

  // Google Sheets logging (fire-and-forget)
  const group = store.getGroup(task.groupId);
  if (group?.sheetId) {
    sheets.onCompletion(group.sheetId, {
      user: { ...updatedUser, id: userId },
      task,
      isRaid: task.type === 'raid',
    }).catch(() => {});
  }
}

async function handleDoSubmit(ctx) {
  await ctx.answerCbQuery();
  const taskId = parseInt(ctx.match[1]);
  const task   = store.getTask(taskId);
  const userId = ctx.from.id;

  if (!task || !task.active) return ctx.replyWithHTML('<b>Task no longer active.</b>');
  if (task.type === 'raid' && task.expiresAt && new Date(task.expiresAt) < new Date()) {
    return ctx.replyWithHTML('<b>Raid Expired.</b>');
  }
  if (store.hasSubmitted(userId, task.groupId, taskId)) {
    return ctx.replyWithHTML('<b>Already Done</b>\n\nYou already completed this task!');
  }

  const user = store.getUser(userId);
  const types = task.taskTypes ? JSON.parse(task.taskTypes) : [task.taskType];

  // ── Trust-based types (react, send) ──────────────────────────────────────
  if (types.every(t => ['react', 'send'].includes(t))) {
    return completeTask(ctx, userId, task, user);
  }

  // ── Join (Telegram) ───────────────────────────────────────────────────────
  if (types.includes('join')) {
    return verifyJoin(ctx, userId, task, user);
  }

  // ── Multi-step URL types (comment, quote) ─────────────────────────────────
  const needsUrl = types.some(t => ['comment', 'quote'].includes(t));
  if (needsUrl) {
    session.setSession(userId, { step: 'awaiting_proof_url', taskId, taskTypes: types });
    const typeLabel = types.includes('comment') ? 'reply' : 'quote tweet';
    return ctx.replyWithHTML(
      `<b>Submit Your ${typeLabel === 'reply' ? 'Reply' : 'Quote Tweet'} URL</b>\n\nPaste the URL of <b>your ${typeLabel} tweet</b>:`,
      cancelKeyboard()
    );
  }

  // ── Retweet ───────────────────────────────────────────────────────────────
  if (types.includes('retweet')) {
    if (!user?.twitter) {
      return ctx.replyWithHTML(
        `<b>Twitter Not Connected</b>\n\nConnect your Twitter account first.\n\nGo to Settings → Connect Twitter via OAuth.`,
        cancelKeyboard()
      );
    }
    const tweetId = tw.extractTweetId(task.link);
    if (!tweetId) return ctx.replyWithHTML(`<b>Invalid task link.</b> Contact an admin.`);
    await ctx.replyWithHTML(`<i>Checking your retweet via Twitter API…</i>`);
    const result = await tw.verifyRetweet(tweetId, user.twitter, userId).catch(() => ({
      verified: false, apiError: true, reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.'
    }));
    if (result.verified) return completeTask(ctx, userId, task, user);
    if (result.needsOAuth) {
      return ctx.replyWithHTML(
        `<b>OAuth Required</b>\n\n${result.reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔗 Connect Twitter via OAuth', 'connect_twitter_oauth')]])
      );
    }
    return ctx.replyWithHTML(
      `<b>${result.apiError ? '⚠️ API Error' : 'Not Verified'}</b>\n\n${result.reason}`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, 'retweet')
    );
  }

  // ── Like ─────────────────────────────────────────────────────────────────
  if (types.includes('like')) {
    if (!user?.twitter) {
      return ctx.replyWithHTML(
        `<b>Twitter Not Connected</b>\n\nConnect your Twitter account first.`,
        Markup.inlineKeyboard([[Markup.button.callback('🔗 Connect Twitter via OAuth', 'connect_twitter_oauth')]])
      );
    }
    const tweetId = tw.extractTweetId(task.link);
    if (!tweetId) return ctx.replyWithHTML(`<b>Invalid task link.</b> Contact an admin.`);
    await ctx.replyWithHTML(`<i>Verifying like via Twitter API…</i>`);
    const result = await tw.verifyLike(tweetId, user.twitter, userId).catch(() => ({
      verified: false, apiError: true, reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.'
    }));
    if (result.verified) return completeTask(ctx, userId, task, user);
    if (result.needsOAuth) {
      return ctx.replyWithHTML(
        `<b>OAuth Required</b>\n\n${result.reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔗 Connect Twitter via OAuth', 'connect_twitter_oauth')]])
      );
    }
    return ctx.replyWithHTML(
      `<b>${result.apiError ? '⚠️ API Error' : 'Not Verified'}</b>\n\n${result.reason}`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, 'like')
    );
  }

  // ── Follow ────────────────────────────────────────────────────────────────
  if (types.includes('follow')) {
    if (!user?.twitter) {
      return ctx.replyWithHTML(
        `<b>Twitter Not Connected</b>\n\nConnect your Twitter account first.`,
        Markup.inlineKeyboard([[Markup.button.callback('🔗 Connect Twitter via OAuth', 'connect_twitter_oauth')]])
      );
    }
    const targetHandle = tw.extractUsername(task.link);
    if (!targetHandle) return ctx.replyWithHTML(`<b>Invalid task link.</b> Contact an admin.`);
    await ctx.replyWithHTML(`<i>Verifying follow via Twitter API…</i>`);
    const result = await tw.verifyFollow(targetHandle, user.twitter, userId).catch(() => ({
      verified: false, apiError: true, reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.'
    }));
    if (result.verified) return completeTask(ctx, userId, task, user);
    if (result.needsOAuth) {
      return ctx.replyWithHTML(
        `<b>OAuth Required</b>\n\n${result.reason}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔗 Connect Twitter via OAuth', 'connect_twitter_oauth')]])
      );
    }
    return ctx.replyWithHTML(
      `<b>${result.apiError ? '⚠️ API Error' : 'Not Verified'}</b>\n\n${result.reason}`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, 'follow')
    );
  }
}

// ── Verify Telegram join ──────────────────────────────────────────────────────

async function verifyJoin(ctx, userId, task, user) {
  if (!task.link) return completeTask(ctx, userId, task, user);
  try {
    const chatId = task.link.includes('t.me/') ? '@' + task.link.split('t.me/')[1].replace(/\/$/, '') : task.link;
    const member = await ctx.telegram.getChatMember(chatId, userId);
    const joined = ['member', 'administrator', 'creator', 'restricted'].includes(member.status);
    if (joined) return completeTask(ctx, userId, task, user);
    return ctx.replyWithHTML(
      `<b>Not Yet Joined</b>\n\n<a href="${task.link}">Join here</a>, then tap Verify again.`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, 'join')
    );
  } catch {
    return ctx.replyWithHTML(
      `<b>Could Not Verify</b>\n\nMake sure you have joined, then tap Verify again.`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, 'join')
    );
  }
}

// ── Session input handler ─────────────────────────────────────────────────────

async function handleSessionInput(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return next();
  const s = session.getSession(userId);
  if (!s || s.adminFlow) return next();

  const text = ctx.message.text.trim();

  if (text === '/cancel') {
    session.clearSession(userId);
    return ctx.replyWithHTML('Cancelled.');
  }

  if (s.step === 'awaiting_wallet') {
    store.setUserField(userId, 'wallet', text);
    session.clearSession(userId);
    return ctx.replyWithHTML(`<b>Wallet saved.</b>\n\n<code>${text}</code>`);
  }

  if (s.step === 'awaiting_discord') {
    store.setUserField(userId, 'discord', text);
    session.clearSession(userId);
    return ctx.replyWithHTML(`<b>Discord saved.</b>\n\n<code>${text}</code>`);
  }

  if (s.step === 'awaiting_proof_url') {
    const taskId   = s.taskId;
    const taskTypes = s.taskTypes || [];
    const task     = store.getTask(taskId);
    if (!task) { session.clearSession(userId); return ctx.replyWithHTML('<b>Task not found.</b>'); }
    const user = store.getUser(userId);

    const isComment = taskTypes.includes('comment');
    const isQuote   = taskTypes.includes('quote');
    const origId    = tw.extractTweetId(task.link);

    await ctx.replyWithHTML(`<i>Verifying your ${isComment ? 'reply' : 'quote tweet'} via Twitter API…</i>`);

    const apiErrFallback = (e) => ({
      verified: false, apiError: true,
      reason: 'Twitter API is temporarily unavailable. Please wait 30 seconds and try again.'
    });

    const result = isComment
      ? await tw.verifyReply(text, origId, user?.twitter, task.minChars || 0).catch(apiErrFallback)
      : await tw.verifyQuote(text, origId, user?.twitter, task.minChars || 0).catch(apiErrFallback);

    session.clearSession(userId);

    if (result.verified) return completeTask(ctx, userId, task, user);
    return ctx.replyWithHTML(
      `<b>${result.apiError ? '⚠️ API Error' : 'Not Verified'}</b>\n\n${result.reason}\n\n<i>Tap Verify again after 30 seconds to retry.</i>`,
      taskCardKeyboard(task.id, task.link, task.buttonLabel, isComment ? 'comment' : 'quote')
    );
  }

  return next();
}

// ── Menu handlers ─────────────────────────────────────────────────────────────

async function handleTasksMenu(ctx) {
  let tasks = [];
  store.getAllGroups().forEach(g => tasks.push(...store.getTasksForGroup(g.id, 'task')));
  if (!tasks.length) return ctx.replyWithHTML(`<b>Active Tasks</b>\n\n<i>No active tasks right now. Check back soon!</i>`);
  await ctx.replyWithHTML(`<b>Active Tasks</b> (${tasks.length})\n\n<i>Tap a task to view details:</i>`, taskListKeyboard(tasks));
}

async function handleRaidsMenu(ctx) {
  const now = new Date();
  let raids = [];
  store.getAllGroups().forEach(g => raids.push(...store.getTasksForGroup(g.id, 'raid')));
  if (!raids.length) return ctx.replyWithHTML(`<b>Active Raids</b>\n\n<i>No raids running right now!</i>`);
  const lines = raids.map(r => {
    let timeLeft = '';
    if (r.expiresAt) {
      const ms = new Date(r.expiresAt) - now;
      if (ms > 0) {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        timeLeft = h > 0 ? ` (${h}h ${m}m left)` : ` (${m}m left)`;
      } else { timeLeft = ' (expired)'; }
    }
    return `[Raid] <b>${r.title}</b> — ${r.reward} pts${timeLeft}`;
  }).join('\n');
  await ctx.replyWithHTML(`<b>Active Raids</b>\n\n${lines}`, taskListKeyboard(raids));
}

async function handleLeaderboard(ctx) {
  const top = store.getLeaderboard(10);
  if (!top.length) return ctx.replyWithHTML(`<b>Leaderboard</b>\n\n<i>No users with points yet.</i>`);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((u, i) => {
    const icon = medals[i] || `${i + 1}.`;
    const name = u.username ? `@${u.username}` : `id:${u.id}`;
    return `${icon} ${name}${u.twitter ? ` (@${u.twitter})` : ''} — <b>${u.points} pts</b>`;
  }).join('\n');
  await ctx.replyWithHTML(`<b>Leaderboard — Top 10</b>\n${'─'.repeat(28)}\n\n${lines}`);
}

async function handleMyProfile(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const user   = store.getOrCreateUser(userId, ctx.from.username || ctx.from.first_name);
  const tokens = getTokens(userId);
  const hasOAuth = !!(tokens?.access_token);

  const rank = store.getLeaderboard(1000).findIndex(u => u.id === String(userId)) + 1;

  const twitterStatus = hasOAuth && user.twitter
    ? `✅ Connected: @${user.twitter}`
    : hasOAuth
      ? `✅ OAuth linked (handle not set)`
      : `❌ Not connected`;

  const text =
    `<b>My Profile</b>\n${'─'.repeat(28)}\n` +
    `<b>Name:</b> ${ctx.from.first_name || 'N/A'}\n` +
    `<b>Username:</b> @${user.username || 'N/A'}\n` +
    `<b>Twitter:</b> ${twitterStatus}\n` +
    `<b>Points:</b> ${user.points}\n` +
    `<b>Rank:</b> ${rank > 0 ? `#${rank}` : 'N/A'}\n` +
    `<b>Tasks done:</b> ${user.tasksCompleted || 0}\n` +
    `<b>Raids done:</b> ${user.raidsCompleted || 0}\n` +
    (user.wallet ? `<b>Wallet:</b> <code>${user.wallet}</code>\n` : '') +
    (user.discord ? `<b>Discord:</b> ${user.discord}\n` : '') +
    `<b>Joined:</b> ${new Date(user.joinedAt).toLocaleDateString()}`;

  await ctx.replyWithHTML(text, profileKeyboard());
}

async function handleSettings(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const tokens = getTokens(userId);
  const hasOAuth = !!(tokens?.access_token);
  const user = store.getUser(userId);

  const twitterStatus = hasOAuth && user?.twitter
    ? `✅ Connected: @${user.twitter} (locked — contact admin to change)`
    : hasOAuth
      ? `✅ OAuth linked`
      : `❌ Not connected`;

  await ctx.replyWithHTML(
    `<b>Settings</b>\n${'─'.repeat(28)}\n\n` +
    `<b>Twitter:</b> ${twitterStatus}\n\n` +
    `<i>Use the buttons below to update your profile.</i>`,
    settingsKeyboard(hasOAuth)
  );
}

async function handleHelp(ctx) {
  const userId = ctx.from.id;
  const { isOwner, isAdminUser } = require('../middleware/auth');
  const isAdm   = isAdminUser(userId);
  const isOwn   = isOwner(userId);

  let text = `<b>Help — Momentum Hub</b>\n${'─'.repeat(28)}\n\n`;
  text +=
    `<b>User Commands</b>\n` +
    `/start — Welcome screen & Twitter connect\n` +
    `/profile — View your profile & points\n` +
    `/leaderboard — Top earners\n` +
    `/help — Show this help message\n\n` +
    `<b>Tasks & Raids</b>\n` +
    `Use the menu buttons:\n` +
    `• <b>Tasks</b> — Complete social media tasks to earn points\n` +
    `• <b>Raids</b> — Time-limited group actions\n` +
    `• <b>My Profile</b> — View your points and rank\n` +
    `• <b>Settings</b> — Connect Twitter, set wallet/Discord\n\n` +
    `<b>How verification works:</b>\n` +
    `• Like / Follow — verified via your OAuth-linked Twitter account\n` +
    `• Retweet — scans your recent tweets automatically\n` +
    `• Comment / Quote — paste the URL of your tweet\n` +
    `• Join — checked via Telegram membership\n`;

  if (isAdm) {
    text +=
      `\n<b>Admin Commands</b>\n` +
      `/admin — Open admin wizard panel\n` +
      `/commands — List all admin commands\n` +
      `/changeusertwitter &lt;userId&gt; @handle — Update a user's Twitter handle\n` +
      `/wladd &lt;userId&gt; — Add to whitelist\n` +
      `/wlremove &lt;userId&gt; — Remove from whitelist\n`;
  }

  if (isOwn) {
    text +=
      `\n<b>Owner Commands</b>\n` +
      `/addgroup — Register a group\n` +
      `/removegroup — Unregister a group\n` +
      `/listgroups — List registered groups\n` +
      `/setsheet &lt;groupId&gt; &lt;sheetId&gt; — Link Google Sheet\n` +
      `/addadmin &lt;userId&gt; &lt;groupId&gt; — Grant admin role\n` +
      `/removeadmin &lt;userId&gt; &lt;groupId&gt; — Revoke admin role\n` +
      `/broadcast &lt;message&gt; — DM all users\n` +
      `/ownerhelp — All owner commands\n`;
  }

  await ctx.replyWithHTML(text);
}

// ── OAuth connect ─────────────────────────────────────────────────────────────

async function handleConnectTwitterOAuth(ctx) {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const tokens = getTokens(userId);
  const user   = store.getUser(userId);
  if (tokens?.access_token && user?.twitter) {
    return ctx.replyWithHTML(
      `✅ <b>Twitter Already Connected</b>\n\n@${user.twitter} is linked to your account.\n<i>Your Twitter account can only be connected once and cannot be changed by you. Contact an admin if you need it updated.</i>`
    );
  }
  try {
    const url = await generateAuthUrl(userId);
    await ctx.replyWithHTML(
      `<b>Connect Twitter via OAuth</b>\n\nTap the button below to authorize Momentum Hub to verify your Twitter actions.\n\n⚠️ <i>Your Twitter account can only be connected once and cannot be changed by you. Contact an admin if you need it updated.</i>`,
      oauthConnectKeyboard(url)
    );
  } catch (e) {
    await ctx.replyWithHTML(`<b>Error generating OAuth link:</b> ${e.message}\n\nMake sure TWITTER_CLIENT_ID and TWITTER_CALLBACK_URL are correctly set.`);
  }
}

async function handleSetWallet(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_wallet' });
  await ctx.replyWithHTML(`<b>Set Wallet</b>\n\nSend your wallet address:`, cancelKeyboard());
}

async function handleSetDiscord(ctx) {
  await ctx.answerCbQuery();
  session.setSession(ctx.from.id, { step: 'awaiting_discord' });
  await ctx.replyWithHTML(`<b>Set Discord</b>\n\nSend your Discord username:`, cancelKeyboard());
}

async function handleCancelFlow(ctx) {
  await ctx.answerCbQuery('Cancelled.');
  session.clearSession(ctx.from.id);
  await ctx.deleteMessage().catch(() => {});
}

// ── Register ──────────────────────────────────────────────────────────────────

function register(bot) {
  bot.on(['message'], handleSessionInput);

  bot.start(handleStart);
  bot.command('leaderboard', handleLeaderboard);
  bot.command('profile',     handleMyProfile);
  bot.command('help',        handleHelp);

  bot.hears('Tasks',       handleTasksMenu);
  bot.hears('Raids',       handleRaidsMenu);
  bot.hears('Leaderboard', handleLeaderboard);
  bot.hears('My Profile',  handleMyProfile);
  bot.hears('Settings',    handleSettings);
  bot.hears('Help',        handleHelp);

  bot.action('connect_twitter_oauth', handleConnectTwitterOAuth);
  bot.action('open_settings',  async ctx => { await ctx.answerCbQuery(); return handleSettings(ctx); });
  bot.action('set_wallet',     handleSetWallet);
  bot.action('set_discord',    handleSetDiscord);
  bot.action('refresh_profile', ctx => handleMyProfile(ctx));
  bot.action('close_msg',      async ctx => { await ctx.answerCbQuery(); await ctx.deleteMessage().catch(() => {}); });
  bot.action('cancel_flow',    handleCancelFlow);

  bot.action(/^view_task_(\d+)$/, handleViewTask);
  bot.action(/^do_submit_(\d+)$/, handleDoSubmit);
}

module.exports = { register };
