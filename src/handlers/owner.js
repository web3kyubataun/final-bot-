/**
 * owner.js — Owner-only commands
 *
 * /addgroup, /removegroup, /listgroups, /setsheet,
 * /addadmin, /removeadmin, /broadcast, /ownerhelp
 */

const store  = require('../store');
const sheets = require('../services/sheets');
const { isOwner, ownerOnly } = require('../middleware/auth');

const delay = ms => new Promise(r => setTimeout(r, ms));

function register(bot) {

  // ── /addgroup ──────────────────────────────────────────────────────────────

  bot.command('addgroup', async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const chatType = ctx.chat?.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      const groupId   = String(ctx.chat.id);
      const groupName = ctx.chat.title || groupId;
      store.addGroup(groupId, null, ctx.from.id);
      store.setGroupMeta(groupId, { groupName });
      return ctx.replyWithHTML(
        `<b>Group Registered</b>\n\n<b>${groupName}</b> (<code>${groupId}</code>) has been whitelisted.\n\nUse /admin in DM to manage it.`
      );
    }

    const parts = ctx.message.text.split(' ').slice(1);
    if (!parts.length) {
      return ctx.replyWithHTML(
        `<b>Usage</b>\n\n<b>Inside a group:</b> /addgroup\n<b>From DM:</b> /addgroup &lt;groupId&gt; &lt;Group Name&gt;\n\n<i>Example: /addgroup -1001234567890 My Community</i>`
      );
    }

    const groupId   = parts[0].trim();
    const groupName = parts.slice(1).join(' ').trim() || groupId;
    if (!/^-?\d+$/.test(groupId)) {
      return ctx.replyWithHTML(`<b>Invalid group ID.</b> Must be a numeric Telegram chat ID.`);
    }
    store.addGroup(groupId, null, ctx.from.id);
    store.setGroupMeta(groupId, { groupName });
    await ctx.replyWithHTML(
      `<b>Group Registered</b>\n\n<b>${groupName}</b> (<code>${groupId}</code>) added.\n\nUse /admin to manage it.`
    );
  });

  // ── /removegroup ───────────────────────────────────────────────────────────

  bot.command('removegroup', async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const chatType = ctx.chat?.type;
    if (chatType === 'group' || chatType === 'supergroup') {
      const groupId = String(ctx.chat.id);
      const ok = store.removeGroup(groupId);
      return ctx.replyWithHTML(
        ok ? `<b>Group Removed</b>\n\n<code>${groupId}</code> has been unregistered.`
           : `<b>Group not found.</b> <code>${groupId}</code> was not registered.`
      );
    }
    const args    = ctx.message.text.split(' ').slice(1);
    const groupId = args[0]?.trim();
    if (!groupId) return ctx.replyWithHTML(`<b>Usage:</b> /removegroup &lt;groupId&gt;`);
    const ok = store.removeGroup(groupId);
    await ctx.replyWithHTML(
      ok ? `<b>Group Removed</b>\n\n<code>${groupId}</code> unregistered.`
         : `<b>Not found.</b> <code>${groupId}</code> was not registered.`
    );
  });

  // ── /listgroups ────────────────────────────────────────────────────────────

  bot.command('listgroups', ownerOnly, async (ctx) => {
    const groups = store.getAllGroups();
    if (!groups.length) {
      return ctx.replyWithHTML(`<b>Registered Groups</b>\n\n<i>No groups registered yet.</i>\n\nUse /addgroup inside a group or /addgroup &lt;id&gt; &lt;name&gt; from DM.`);
    }
    const lines = groups.map((g, i) => {
      const sheetStatus = g.sheetId && g.sheetId !== 'none' ? '✅ Sheet linked' : '❌ No sheet';
      const adminsCount = (g.admins || []).length;
      return `${i + 1}. <b>${g.groupName || g.id}</b>\n   ID: <code>${g.id}</code>\n   ${sheetStatus} | Admins: ${adminsCount} | Mode: ${g.accessMode}`;
    });
    await ctx.replyWithHTML(`<b>Registered Groups</b> (${groups.length})\n${'─'.repeat(28)}\n\n${lines.join('\n\n')}`);
  });

  // ── /setsheet ──────────────────────────────────────────────────────────────

  bot.command('setsheet', ownerOnly, async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.replyWithHTML(
        `<b>Usage:</b> /setsheet &lt;groupId&gt; &lt;sheetId&gt;\n\n<i>Example: /setsheet -1001234567890 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms</i>`
      );
    }
    const [groupId, sheetId] = args;
    if (!store.isGroupRegistered(groupId)) {
      return ctx.replyWithHTML(`<b>Group not found.</b> Register the group first with /addgroup.`);
    }
    store.setGroupMeta(groupId, { sheetId });
    const serviceEmail = (() => {
      try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}').client_email || 'Not configured'; } catch { return 'Not configured'; }
    })();
    await ctx.replyWithHTML(
      `<b>Sheet Linked</b>\n\nGroup <code>${groupId}</code> is now linked to sheet <code>${sheetId}</code>.\n\n<b>Remember to share the sheet with:</b>\n<code>${serviceEmail}</code>\n(give Editor access)`
    );
  });

  // ── /addadmin ──────────────────────────────────────────────────────────────

  bot.command('addadmin', ownerOnly, async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.replyWithHTML(
        `<b>Usage:</b> /addadmin &lt;userId&gt; &lt;groupId&gt;\n\n<i>Example: /addadmin 123456789 -1001234567890</i>\n\n` +
        `<b>Available groups:</b>\n` +
        store.getAllGroups().map(g => `• ${g.groupName || g.id} — <code>${g.id}</code>`).join('\n') || '<i>No groups registered.</i>'
      );
    }
    const [userId, groupId] = args;
    if (!store.isGroupRegistered(groupId)) {
      return ctx.replyWithHTML(`<b>Group not found:</b> <code>${groupId}</code>\n\nUse /listgroups to see registered groups.`);
    }
    store.addAdmin(groupId, userId);
    const group = store.getGroup(groupId);
    await ctx.replyWithHTML(
      `<b>Admin Added</b>\n\nUser <code>${userId}</code> is now an admin of <b>${group?.groupName || groupId}</b>.`
    );
  });

  // ── /removeadmin ───────────────────────────────────────────────────────────

  bot.command('removeadmin', ownerOnly, async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.replyWithHTML(
        `<b>Usage:</b> /removeadmin &lt;userId&gt; &lt;groupId&gt;\n\n<i>Example: /removeadmin 123456789 -1001234567890</i>`
      );
    }
    const [userId, groupId] = args;
    if (!store.isGroupRegistered(groupId)) {
      return ctx.replyWithHTML(`<b>Group not found:</b> <code>${groupId}</code>`);
    }
    store.removeAdmin(groupId, userId);
    const group = store.getGroup(groupId);
    await ctx.replyWithHTML(
      `<b>Admin Removed</b>\n\nUser <code>${userId}</code> has been removed as admin of <b>${group?.groupName || groupId}</b>.`
    );
  });

  // ── /broadcast ─────────────────────────────────────────────────────────────

  bot.command('broadcast', ownerOnly, async (ctx) => {
    const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!text) return ctx.replyWithHTML(`<b>Usage:</b> /broadcast &lt;message&gt;`);
    const users = store.getAllUsers();
    if (!users.length) return ctx.replyWithHTML(`<b>No users found.</b>`);
    await ctx.replyWithHTML(`<b>Broadcasting</b> to ${users.length} users…`);
    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.id, text);
        sent++;
      } catch { failed++; }
      await delay(50);
    }
    await ctx.replyWithHTML(`<b>Broadcast Complete</b>\n\nDelivered: <b>${sent}</b>\nFailed: <b>${failed}</b>`);
  });

  // ── /ownerhelp ─────────────────────────────────────────────────────────────

  bot.command('ownerhelp', ownerOnly, async (ctx) => {
    const serviceEmail = (() => {
      try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}').client_email || 'Not configured'; } catch { return 'Not configured'; }
    })();
    await ctx.replyWithHTML(
      `<b>Owner Commands</b>\n${'─'.repeat(30)}\n\n` +
      `<b>Group Management</b>\n` +
      `/addgroup — Whitelist current group (run in group)\n` +
      `/addgroup &lt;id&gt; &lt;name&gt; — Add group from DM\n` +
      `/removegroup — Unregister current group\n` +
      `/removegroup &lt;id&gt; — Unregister from DM\n` +
      `/listgroups — List all registered groups\n` +
      `/setsheet &lt;groupId&gt; &lt;sheetId&gt; — Link Google Sheet\n\n` +
      `<b>Admin Management</b>\n` +
      `/addadmin &lt;userId&gt; &lt;groupId&gt; — Grant admin role\n` +
      `/removeadmin &lt;userId&gt; &lt;groupId&gt; — Revoke admin role\n\n` +
      `<b>Communication</b>\n` +
      `/broadcast &lt;message&gt; — DM all users\n\n` +
      `<b>Service Account Email</b>\n` +
      `<code>${serviceEmail}</code>\n` +
      `<i>Share your Google Sheets with this email (Editor).</i>`
    );
  });
}

module.exports = { register };
