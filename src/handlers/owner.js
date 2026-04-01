const store = require('../store');
const sheets = require('../services/sheets');
const { ownerOnly, isOwner } = require('../middleware/auth');
const config = require('../config');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── /addgroup ──────────────────────────────────────────
// Run inside the group  OR  /addgroup -1001234567 [GroupName]  from DM
async function handleAddGroup(ctx) {
  const chatType = ctx.chat?.type;
  let groupId, groupName;

  if (chatType === 'group' || chatType === 'supergroup') {
    groupId  = String(ctx.chat.id);
    groupName = ctx.chat.title;
  } else {
    const args = ctx.message.text.split(' ').slice(1);
    groupId   = args[0];
    groupName = args.slice(1).join(' ') || null;
    if (!groupId) {
      return ctx.replyWithHTML(
        `<b>Usage:</b>\n` +
        `• Run <code>/addgroup</code> directly <b>inside the group</b>, OR\n` +
        `• From DM: <code>/addgroup -1001234567890 GroupName</code>`
      );
    }
  }

  if (store.isGroupRegistered(groupId)) {
    return ctx.replyWithHTML(`⚠️ Group <code>${groupId}</code> is already registered.`);
  }

  await ctx.reply('⏳ Registering group and creating Google Sheet...');

  let sheetId = 'none';
  let sheetNote = '';
  try {
    sheetId = await sheets.createGroupSheet(groupName || `Group_${groupId}`);
    sheetNote = `📊 Sheet: <code>${sheetId}</code>`;
  } catch (e) {
    console.error('Sheet creation error:', e.message);
    sheetNote =
      `⚠️ <b>Sheet creation failed:</b> ${e.message}\n\n` +
      `<b>How to fix:</b>\n` +
      `1. Go to <a href="https://console.cloud.google.com">Google Cloud Console</a>\n` +
      `2. Select your project → <b>APIs & Services</b>\n` +
      `3. Enable both <b>Google Sheets API</b> and <b>Google Drive API</b>\n` +
      `4. Then run /addgroup again\n\n` +
      `<i>Group registered without a sheet for now.</i>`;
  }

  const group = store.addGroup(groupId, sheetId, ctx.from.id);
  if (groupName) group.groupName = groupName;

  await ctx.replyWithHTML(
    `✅ <b>Group Registered!</b>\n\n` +
    `🆔 ID: <code>${groupId}</code>\n` +
    `📛 Name: ${groupName || 'Unknown'}\n` +
    `${sheetNote}\n\n` +
    `<b>Next steps:</b>\n` +
    `• Add admins: run <code>/addadmin &lt;userId&gt;</code> in the group\n` +
    `• Run <code>/setup</code> in the group for full setup guide`
  );
}

// ── /removegroup ─────────────────────────────────────────
async function handleRemoveGroup(ctx) {
  const chatType = ctx.chat?.type;
  let groupId;

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

  const g = store.getGroup(groupId);
  store.removeGroup(groupId);
  await ctx.replyWithHTML(
    `✅ <b>Group Removed</b>\n\n` +
    `<b>${g.groupName || groupId}</b> (<code>${groupId}</code>) has been unregistered.`
  );
}

// ── /listgroups ───────────────────────────────────────────
async function handleListGroups(ctx) {
  const groups = store.getAllGroups();
  if (!groups.length) return ctx.reply('No groups registered yet.');

  const lines = groups.map((g, i) =>
    `${i + 1}. <b>${g.groupName || 'Unknown'}</b>\n` +
    `   🆔 <code>${g.id}</code>\n` +
    `   🔐 Mode: ${g.accessMode}  |  👥 Admins: ${g.admins?.size || 0}\n` +
    `   📊 Sheet: ${g.sheetId !== 'none' ? '✅' : '❌'}`
  ).join('\n\n');

  await ctx.replyWithHTML(`📋 <b>Registered Groups (${groups.length})</b>\n\n${lines}`);
}

// ── /broadcast ────────────────────────────────────────────
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
  await ctx.reply(`✅ Done!  Sent: ${sent}  |  Failed: ${failed}`);
}

// ── /ownerhelp ────────────────────────────────────────────
async function handleOwnerHelp(ctx) {
  const ownerList = config.OWNER_IDS.join(', ') || 'none';
  await ctx.replyWithHTML(
    `👑 <b>Owner Commands</b>\n` +
    `${'─'.repeat(30)}\n\n` +
    `<b>Current Owners:</b> <code>${ownerList}</code>\n` +
    `<i>Set BOT_OWNER_IDS=id1,id2 in .env for multiple owners</i>\n\n` +
    `<b>Group Management</b>\n` +
    `/addgroup — Whitelist a group (run inside OR DM with ID)\n` +
    `/removegroup — Unregister a group\n` +
    `/listgroups — List all registered groups\n\n` +
    `<b>Broadcasting</b>\n` +
    `/broadcast &lt;message&gt; — DM all bot users\n\n` +
    `<b>Difference: Owners vs Admins</b>\n` +
    `👑 <b>Owners</b>: Can whitelist/addgroup/removegroup. Set in .env.\n` +
    `🛠 <b>Admins</b>: Can manage tasks/raids/submissions for their group. Added via /addadmin.`
  );
}

function register(bot) {
  bot.command('addgroup',    ownerOnly, handleAddGroup);
  bot.command('removegroup', ownerOnly, handleRemoveGroup);
  bot.command('listgroups',  ownerOnly, handleListGroups);
  bot.command('broadcast',   ownerOnly, handleBroadcast);
  bot.command('ownerhelp',   ownerOnly, handleOwnerHelp);
}

module.exports = { register };
