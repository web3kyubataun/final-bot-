const store = require('../store');
const sheets = require('../services/sheets');
const { ownerOnly } = require('../middleware/auth');
const config = require('../config');

/**
 * /addgroup <groupId>
 * Owner registers a group and creates its Google Sheet.
 */
async function handleAddGroup(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const groupId = args[0];
  if (!groupId) return ctx.reply('Usage: /addgroup <groupId>');

  if (store.isGroupRegistered(groupId)) {
    return ctx.reply('⚠️ Group already registered.');
  }

  await ctx.reply('⏳ Creating Google Sheet for this group...');

  let sheetId = 'manual';
  try {
    sheetId = await sheets.createGroupSheet(`Group_${groupId}`);
  } catch (e) {
    console.error('Sheet creation error:', e.message);
    await ctx.reply(`⚠️ Sheet creation failed: ${e.message}\nGroup registered without a sheet.`);
  }

  store.addGroup(groupId, sheetId);
  await ctx.reply(
    `✅ Group ${groupId} registered!\n` +
    `📊 Sheet ID: ${sheetId === 'manual' ? 'None (configure Google credentials)' : sheetId}`
  );
}

/**
 * /broadcast <message>
 * Send a message to ALL users who have used the bot.
 */
async function handleBroadcast(ctx) {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /broadcast <message>');

  const users = store.getAllUsers().filter(u => !u.banned && u.notifications !== false);
  let sent = 0, failed = 0;

  await ctx.reply(`📤 Sending to ${users.length} users...`);

  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.id, `📢 <b>Broadcast Message</b>\n\n${text}`, { parse_mode: 'HTML' });
      sent++;
    } catch {
      failed++;
    }
    await delay(50); // rate limit safety
  }

  await ctx.reply(`✅ Broadcast complete!\nSent: ${sent} | Failed: ${failed}`);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function register(bot) {
  bot.command('addgroup', ownerOnly, handleAddGroup);
  bot.command('broadcast', ownerOnly, handleBroadcast);
}

module.exports = { register };
