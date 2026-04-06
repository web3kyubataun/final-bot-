const store = require('../store');
const sheets = require('../services/sheets');
const { ownerOnly, isOwner } = require('../middleware/auth');
const config = require('../config');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── /addgroup ──────────────────────────────────────────────────
async function handleAddGroup(ctx) {
  const chatType = ctx.chat?.type;
  let groupId, groupName;

  if (chatType === 'group' || chatType === 'supergroup') {
    groupId   = String(ctx.chat.id);
    groupName = ctx.chat.title;
  } else {
    const args = ctx.message.text.split(' ').slice(1);
    groupId   = args[0];
    groupName = args.slice(1).join(' ') || null;
    if (!groupId) {
      return ctx.replyWithHTML(
        `<b>Usage:</b>\n` +
        `Run <code>/addgroup</code> directly <b>inside the group</b>, OR\n` +
        `From DM: <code>/addgroup -1001234567890 GroupName</code>`
      );
    }
  }

  if (store.isGroupRegistered(groupId)) {
    return ctx.replyWithHTML(`Group <code>${groupId}</code> is already registered.`);
  }

  await ctx.reply('Registering group and trying to create Google Sheet...');

  let sheetId  = 'none';
  let sheetMsg = '';

  try {
    sheetId  = await sheets.createGroupSheet(groupName || `Group_${groupId}`);
    sheetMsg = `Sheet created automatically\nID: <code>${sheetId}</code>`;
  } catch (e) {
    console.error('Sheet auto-creation error:', e.message);
    const saEmail = sheets.getServiceAccountEmail();
    const emailLine = saEmail
      ? `3. Share the sheet with this email <b>(Editor access)</b>:\n   <code>${saEmail}</code>`
      : `3. Share the sheet with your service account email <b>(Editor access)</b>`;
    sheetMsg =
      `<b>Auto sheet creation failed.</b>\n\n` +
      `<b>Fix — create the sheet manually:</b>\n` +
      `1. Go to <a href="https://sheets.google.com">sheets.google.com</a> and create a new spreadsheet\n` +
      `2. Copy the Sheet ID from the URL:\n` +
      `   <code>docs.google.com/spreadsheets/d/<b>[THIS PART]</b>/edit</code>\n` +
      `${emailLine}\n` +
      `4. Run: <code>/setsheet ${groupId} YOUR_SHEET_ID</code>\n\n` +
      `<i>Group is registered without a sheet for now.</i>`;
  }

  const group = store.addGroup(groupId, sheetId, ctx.from.id);
  if (groupName) group.groupName = groupName;

  await ctx.replyWithHTML(
    `<b>Group Registered!</b>\n\n` +
    `ID: <code>${groupId}</code>\n` +
    `Name: ${groupName || 'Unknown'}\n\n` +
    `${sheetMsg}`
  );
}

// ── /setsheet <groupId> <sheetId> ─────────────────────────────
async function handleSetSheet(ctx) {
  const args    = ctx.message.text.split(' ').slice(1);
  const groupId = args[0];
  const sheetId = args[1];

  if (!groupId || !sheetId) {
    return ctx.replyWithHTML(
      `<b>Usage:</b> <code>/setsheet &lt;groupId&gt; &lt;sheetId&gt;</code>\n\n` +
      `<b>Example:</b>\n` +
      `<code>/setsheet -1001234567890 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms</code>\n\n` +
      `<b>How to get the Sheet ID:</b>\n` +
      `Open your Google Sheet → look at the URL:\n` +
      `<code>docs.google.com/spreadsheets/d/<b>[Sheet ID here]</b>/edit</code>`
    );
  }

  if (!store.isGroupRegistered(groupId)) {
    return ctx.replyWithHTML(`Group <code>${groupId}</code> is not registered. Run /addgroup first.`);
  }

  await ctx.reply('Linking sheet and setting up headers...');

  try {
    await sheets.setupManualSheet(sheetId);
    const group = store.getGroup(groupId);
    group.sheetId = sheetId;
    await ctx.replyWithHTML(
      `<b>Sheet linked successfully!</b>\n\n` +
      `Sheet ID: <code>${sheetId}</code>\n` +
      `Headers created for Submissions, Users, and Collected Info tabs.`
    );
  } catch (e) {
    const saEmail = sheets.getServiceAccountEmail();
    await ctx.replyWithHTML(
      `<b>Failed to link sheet.</b>\n\nError: ${e.message}\n\n` +
      (saEmail ? `Make sure you shared the sheet with:\n<code>${saEmail}</code>` : '')
    );
  }
}

// ── /removegroup <groupId> ─────────────────────────────────────
async function handleRemoveGroup(ctx) {
  const args    = ctx.message.text.split(' ').slice(1);
  const groupId = args[0] || (ctx.chat?.type !== 'private' ? String(ctx.chat.id) : null);
  if (!groupId) return ctx.reply('Usage: /removegroup <groupId>');
  const ok = store.removeGroup(groupId);
  await ctx.replyWithHTML(ok
    ? `Group <code>${groupId}</code> removed.`
    : `Group <code>${groupId}</code> not found.`
  );
}

// ── /listgroups ────────────────────────────────────────────────
async function handleListGroups(ctx) {
  const groups = store.getAllGroups();
  if (!groups.length) return ctx.reply('No registered groups.');
  const lines = groups.map((g, i) =>
    `${i+1}. <code>${g.id}</code> — ${g.groupName || 'Unnamed'}\n` +
    `   Sheet: ${g.sheetId || 'none'}  |  Mode: ${g.accessMode}\n` +
    `   Topics: ${Object.entries(g.topics || {}).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none configured'}`
  ).join('\n\n');
  await ctx.replyWithHTML(`<b>Registered Groups (${groups.length})</b>\n\n${lines}`);
}

// ── /broadcast <message> ──────────────────────────────────────
async function handleBroadcast(ctx) {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /broadcast <message>');
  const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
  await ctx.reply(`Sending to ${users.length} users...`);
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.id, `<b>Broadcast</b>\n\n${text}`, { parse_mode: 'HTML' });
      sent++;
    } catch { failed++; }
    await delay(50);
  }
  await ctx.reply(`Done!  Sent: ${sent}  |  Failed: ${failed}`);
}

// ── /changeusertwitter <userId> <@newUsername> ─────────────────
async function handleChangeUserTwitter(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const userId = args[0];
  const newUsername = args[1];

  if (!userId || !newUsername) {
    return ctx.replyWithHTML(
      `<b>Usage:</b> <code>/changeusertwitter &lt;userId&gt; &lt;@username&gt;</code>\n\n` +
      `<b>Example:</b>\n` +
      `<code>/changeusertwitter 123456789 @newhandle</code>\n\n` +
      `<i>This bypasses the lock and updates the user's Twitter account.</i>`
    );
  }

  const clean = newUsername.startsWith('@') ? newUsername : `@${newUsername}`;
  const ok = store.adminSetUserTwitter(userId, clean);

  if (!ok) {
    return ctx.replyWithHTML(
      `User <code>${userId}</code> not found.\n\n` +
      `<i>Make sure the user has started the bot first.</i>`
    );
  }

  // Sync to all group sheets
  const groups = store.getAllGroups();
  const user = store.getUser(userId);
  for (const g of groups) {
    if (g.sheetId && g.sheetId !== 'none') {
      try {
        await sheets.upsertUser(g.sheetId, {
          userId, username: user?.username || 'unknown',
          twitter: clean, wallet: user?.wallet, discord: user?.discord, points: user?.points || 0,
        });
      } catch {}
    }
  }

  await ctx.replyWithHTML(
    `<b>Twitter Updated!</b>\n\n` +
    `User: <code>${userId}</code>\n` +
    `New Twitter: <b>${clean}</b>\n\n` +
    `<i>The change has been applied and the account is locked again.</i>`
  );
}

// ── /ownerhelp ────────────────────────────────────────────────
async function handleOwnerHelp(ctx) {
  const ownerList = config.OWNER_IDS.join(', ') || 'none';
  const saEmail   = sheets.getServiceAccountEmail();
  await ctx.replyWithHTML(
    `<b>Owner Commands</b>\n` +
    `${'─'.repeat(30)}\n\n` +
    `<b>Owner IDs:</b> <code>${ownerList}</code>\n` +
    (saEmail ? `<b>Service Account:</b>\n<code>${saEmail}</code>\n` : '') +
    `\n<b>Group Management</b>\n` +
    `/addgroup — Register and whitelist a group\n` +
    `/removegroup — Unregister a group\n` +
    `/listgroups — List all registered groups\n\n` +
    `<b>Google Sheets</b>\n` +
    `/setsheet &lt;groupId&gt; &lt;sheetId&gt; — Link a manually created sheet\n\n` +
    `<b>Broadcasting</b>\n` +
    `/broadcast &lt;msg&gt; — DM all bot users\n\n` +
    `<b>User Management</b>\n` +
    `/changeusertwitter &lt;userId&gt; &lt;@username&gt; — Change a user's Twitter (bypasses lock)\n` +
    `Example: <code>/changeusertwitter 123456789 @newhandle</code>\n\n` +
    `<b>Owners vs Admins</b>\n` +
    `<b>Owners</b>: Set in .env (BOT_OWNER_IDS). Can whitelist groups, manage sheets, change Twitter.\n` +
    `<b>Admins</b>: Added per-group. Can manage tasks, raids and users.`
  );
}

function register(bot) {
  bot.command('addgroup',           ownerOnly, handleAddGroup);
  bot.command('setsheet',           ownerOnly, handleSetSheet);
  bot.command('removegroup',        ownerOnly, handleRemoveGroup);
  bot.command('listgroups',         ownerOnly, handleListGroups);
  bot.command('broadcast',          ownerOnly, handleBroadcast);
  bot.command('changeusertwitter',  ownerOnly, handleChangeUserTwitter);
  bot.command('ownerhelp',          ownerOnly, handleOwnerHelp);
}

module.exports = { register };
