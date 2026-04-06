/**
 * owner.js — Owner-only commands (DM only)
 *
 * Commands:
 *   /addgroup            Whitelist current group (run inside the group) OR /addgroup -100xxx Name (from DM)
 *   /removegroup         Unregister group (run in group, or /removegroup -100xxx from DM)
 *   /listgroups          List all registered groups
 *   /setsheet <gId> <sheetId>   Link a Google Sheet to a group
 *   /broadcast <message> DM all bot users with a message
 *   /ownerhelp           Show all owner commands + service account email
 */

const store  = require('../store');
const sheets = require('../services/sheets');
const { isOwner, ownerOnly } = require('../middleware/auth');

const delay = ms => new Promise(r => setTimeout(r, ms));

function register(bot) {

  // ── /addgroup ───────────────────────────────────────────────────────────────
  bot.command('addgroup', async (ctx) => {
    if (!isOwner(ctx.from.id)) return;

    const chatType = ctx.chat?.type;

    // If run inside a group — whitelist the current group
    if (chatType === 'group' || chatType === 'supergroup') {
      const groupId   = String(ctx.chat.id);
      const groupName = ctx.chat.title || groupId;
      store.addGroup(groupId, null, ctx.from.id);
      store.setGroupMeta(groupId, { groupName });
      return ctx.replyWithHTML(
        `<b>Group Registered</b>\n\n` +
        `<b>${groupName}</b> (<code>${groupId}</code>) has been whitelisted.\n\n` +
        `Use /admin in DM to manage it.`
      );
    }

    // From DM: /addgroup -100123456789 Group Name
    const parts = ctx.message.text.split(' ').slice(1);
    if (!parts.length) {
      return ctx.replyWithHTML(
        `<b>Usage</b>\n\n` +
        `<b>Inside a group:</b> /addgroup (run in the target group)\n` +
        `<b>From DM:</b> /addgroup &lt;groupId&gt; &lt;Group Name&gt;\n\n` +
        `<i>Example: /addgroup -1001234567890 My Community</i>`
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
      `<b>Group Registered</b>\n\n` +
      `<b>${groupName}</b> (<code>${groupId}</code>) added.\n\n` +
      `Use /admin to manage it.`
    );
  });

  // ── /removegroup ────────────────────────────────────────────────────────────
  bot.command('removegroup', async (ctx) => {
    if (!isOwner(ctx.from.id)) return;

    const chatType = ctx.chat?.type;

    if (chatType === 'group' || chatType === 'supergroup') {
      const groupId = String(ctx.chat.id);
      const ok = store.removeGroup(groupId);
      return ctx.replyWithHTML(
        ok
          ? `<b>Group Removed</b>\n\n<code>${groupId}</code> has been unregistered.`
          : `<b>Group not found.</b> <code>${groupId}</code> was not registered.`
      );
    }

    const args    = ctx.message.text.split(' ').slice(1);
    const groupId = args[0]?.trim();
    if (!groupId) {
      return ctx.replyWithHTML(`<b>Usage:</b> /removegroup &lt;groupId&gt;`);
    }

    const ok = store.removeGroup(groupId);
    await ctx.replyWithHTML(
      ok
        ? `<b>Group Removed</b>\n\n<code>${groupId}</code> unregistered.`
        : `<b>Not found.</b> <code>${groupId}</code> was not registered.`
    );
  });

  // ── /listgroups ─────────────────────────────────────────────────────────────
  bot.command('listgroups', ownerOnly, async (ctx) => {
    const groups = store.getAllGroups();
    if (!groups.length) {
      return ctx.replyWithHTML(`<b>Registered Groups</b>\n\n<i>No groups registered yet.</i>\n\nUse /addgroup inside a group or /addgroup &lt;id&gt; &lt;name&gt; from DM.`);
    }

    const lines = groups.map((g, i) => {
      const sheetStatus = g.sheetId && g.sheetId !== 'none' ? `✅ Sheet linked` : `❌ No sheet`;
      return `${i + 1}. <b>${g.groupName || g.id}</b>\n   ID: <code>${g.id}</code> · Mode: ${g.accessMode} · ${sheetStatus}`;
    }).join('\n\n');

    await ctx.replyWithHTML(`<b>Registered Groups (${groups.length})</b>\n${'─'.repeat(28)}\n\n${lines}`);
  });

  // ── /setsheet ───────────────────────────────────────────────────────────────
  bot.command('setsheet', ownerOnly, async (ctx) => {
    const args    = ctx.message.text.split(' ').slice(1);
    const groupId = args[0]?.trim();
    const sheetId = args[1]?.trim();

    if (!groupId || !sheetId) {
      return ctx.replyWithHTML(
        `<b>Usage:</b> /setsheet &lt;groupId&gt; &lt;sheetId&gt;\n\n` +
        `<i>The sheet ID is the long string in your Google Sheet URL.</i>\n` +
        `<i>Example: /setsheet -1001234567890 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms</i>`
      );
    }

    const group = store.getGroup(groupId);
    if (!group) return ctx.replyWithHTML(`<b>Group not found.</b> Register it first with /addgroup.`);

    store.setGroupMeta(groupId, { sheetId });
    await ctx.replyWithHTML(
      `<b>Sheet Linked</b>\n\n` +
      `Group: <b>${group.groupName || groupId}</b>\n` +
      `Sheet ID: <code>${sheetId}</code>\n\n` +
      `<i>Make sure the service account email has editor access to the sheet.</i>`
    );
  });

  // ── /broadcast ──────────────────────────────────────────────────────────────
  bot.command('broadcast', ownerOnly, async (ctx) => {
    const msg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!msg) {
      return ctx.replyWithHTML(`<b>Usage:</b> /broadcast &lt;message&gt;\n\n<i>Sends a DM to all bot users.</i>`);
    }

    const users  = store.getAllUsers().filter(u => !u.banned);
    const text   = `<b>Announcement</b>\n\n${msg}`;
    let sent     = 0;
    let failed   = 0;

    await ctx.replyWithHTML(`<i>Broadcasting to ${users.length} users...</i>`);

    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.id, text, { parse_mode: 'HTML' });
        sent++;
      } catch {
        failed++;
      }
      await delay(50);
    }

    await ctx.replyWithHTML(
      `<b>Broadcast Complete</b>\n\n` +
      `Delivered: <b>${sent}</b>\n` +
      `Failed: <b>${failed}</b>`
    );
  });

  // ── /ownerhelp ──────────────────────────────────────────────────────────────
  bot.command('ownerhelp', ownerOnly, async (ctx) => {
    const serviceEmail = (() => {
      try {
        const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
        if (!raw) return 'Not configured';
        const creds = JSON.parse(raw);
        return creds.client_email || 'Not found';
      } catch {
        return 'Not configured';
      }
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
      `<b>Communication</b>\n` +
      `/broadcast &lt;message&gt; — DM all users\n\n` +
      `<b>Admin Commands</b>\n` +
      `/admin — Open admin panel (DM)\n` +
      `/settwitter &lt;userId&gt; @handle — Override Twitter handle\n` +
      `/wladd &lt;userId&gt; — Add to whitelist\n` +
      `/wlremove &lt;userId&gt; — Remove from whitelist\n\n` +
      `<b>Service Account Email</b>\n` +
      `<code>${serviceEmail}</code>\n` +
      `<i>Share your Google Sheets with this email (editor).</i>`
    );
  });
}

module.exports = { register };
