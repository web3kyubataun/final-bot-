const store = require('../store');
const sheets = require('../services/sheets');
const { ownerOnly } = require('../middleware/auth');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── /addgroup  ─────────────────────────────────────────
// Can be used two ways:
//   1. Run directly INSIDE the group → uses chat ID automatically
//   2. Run in DM with a group ID → /addgroup -1001234567
async function handleAddGroup(ctx) {
  let groupId, groupName;

  const chatType = ctx.chat?.type;

  if (chatType === 'group' || chatType === 'supergroup') {
    // Command run inside the group itself
    groupId = String(ctx.chat.id);
    groupName = ctx.chat.title;
  } else {
    // Command run in DM — group ID must be provided
    const args = ctx.message.text.split(' ').slice(1);
    groupId = args[0];
    groupName = args.slice(1).join(' ') || `Group_${groupId}`;
    if (!groupId) {
      return ctx.replyWithHTML(
        `<b>Usage:</b>\n` +
        `• Run <code>/addgroup</code> directly inside your group, OR\n` +
        `• In DM: <code>/addgroup -1001234567890 GroupName</code>`
      );
    }
  }

  if (store.isGroupRegistered(groupId)) {
    return ctx.replyWithHTML(`⚠️ Group <code>${groupId}</code> is already registered.`);
  }

  await ctx.reply('⏳ Setting up group and creating Google Sheet...');

  let sheetId = 'none';
  try {
    sheetId = await sheets.createGroupSheet(groupName || `Group_${groupId}`);
  } catch (e) {
    console.error('Sheet creation error:', e.message);
    await ctx.reply(`⚠️ Google Sheet creation failed: ${e.message}\nGroup registered without a sheet.`);
  }

  const group = store.addGroup(groupId, sheetId, ctx.from.id);
  if (groupName) group.groupName = groupName;

  await ctx.replyWithHTML(
    `✅ <b>Group Registered!</b>\n\n` +
    `🆔 Group ID: <code>${groupId}</code>\n` +
    `📛 Name: ${groupName || 'Unknown'}\n` +
    `📊 Sheet: ${sheetId === 'none' ? 'None (set GOOGLE_SERVICE_ACCOUNT_JSON)' : `<code>${sheetId}</code>`}\n\n` +
    `Next steps:\n` +
    `• Add admins: <code>/addadmin ${groupId} &lt;userId&gt;</code>\n` +
    `• Run <code>/setup</code> in the group for forum topics`
  );
}

// ── /removegroup ────────────────────────────────────────
async function handleRemoveGroup(ctx) {
  let groupId;
  const chatType = ctx.chat?.type;

  if (chatType === 'group' || chatType === 'supergroup') {
    groupId = String(ctx.chat.id);
  } else {
    const args = ctx.message.text.split(' ').slice(1);
    groupId = args[0];
    if (!groupId) return ctx.reply('Usage: /removegroup <groupId>  OR run inside the group');
  }

  if (!store.isGroupRegistered(groupId)) {
    return ctx.replyWithHTML(`⚠️ Group <code>${groupId}</code> is not registered.`);
  }

  const group = store.getGroup(groupId);
  const name = group.groupName || groupId;
  store.removeGroup(groupId);

  await ctx.replyWithHTML(
    `✅ <b>Group Removed</b>\n\n` +
    `📋 <b>${name}</b> (<code>${groupId}</code>) has been unregistered.\n` +
    `All tasks and data for this group are cleared.`
  );
}

// ── /broadcast ─────────────────────────────────────────
async function handleBroadcast(ctx) {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /broadcast <message>');

  const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
  await ctx.reply(`📤 Sending to ${users.length} users...`);

  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.id, `📢 <b>Broadcast</b>\n\n${text}`, { parse_mode: 'HTML' });
      sent++;
    } catch { failed++; }
    await delay(50);
  }
  await ctx.reply(`✅ Done! Sent: ${sent} | Failed: ${failed}`);
}

// ── /listgroups ─────────────────────────────────────────
async function handleListGroups(ctx) {
  const groups = store.getAllGroups();
  if (!groups.length) return ctx.reply('No groups registered yet.');

  const lines = groups.map((g, i) =>
    `${i + 1}. <b>${g.groupName || 'Unknown'}</b>\n` +
    `   ID: <code>${g.id}</code>\n` +
    `   Mode: ${g.accessMode}  •  Admins: ${g.admins?.size || 0}`
  ).join('\n\n');

  await ctx.replyWithHTML(`📋 <b>Registered Groups (${groups.length})</b>\n\n${lines}`);
}

// ── /ownerhelp ─────────────────────────────────────────
async function handleOwnerHelp(ctx) {
  await ctx.replyWithHTML(
    `👑 <b>Owner Commands</b>\n` +
    `${'─'.repeat(30)}\n\n` +
    `<b>Group Management</b>\n` +
    `/addgroup — Register a group (run in group or DM)\n` +
    `/removegroup — Remove a group\n` +
    `/listgroups — List all registered groups\n\n` +
    `<b>Broadcasting</b>\n` +
    `/broadcast &lt;message&gt; — DM all bot users\n\n` +
    `<b>Admin Setup</b>\n` +
    `/addadmin &lt;groupId&gt; &lt;userId&gt; — Add group admin\n` +
    `/removeadmin &lt;groupId&gt; &lt;userId&gt; — Remove admin`
  );
}

function register(bot) {
  bot.command('addgroup', ownerOnly, handleAddGroup);
  bot.command('removegroup', ownerOnly, handleRemoveGroup);
  bot.command('broadcast', ownerOnly, handleBroadcast);
  bot.command('listgroups', ownerOnly, handleListGroups);
  bot.command('ownerhelp', ownerOnly, handleOwnerHelp);
}

module.exports = { register };
