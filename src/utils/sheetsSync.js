/**
 * sheetsSync.js
 *
 * Syncs raid completion data to Google Sheets.
 * Integrates with the existing sheets service at src/services/sheets.js.
 *
 * Sheets columns (headers set on first write):
 *  A: Telegram ID
 *  B: Telegram Username
 *  C: Display Name
 *  D: Twitter Username
 *  E: Total Points
 *  F: Raids Completed
 *  G: Last Raid Title
 *  H: Last Reward (points)
 *  I: Completed At (ISO date)
 *  J: First Seen (ISO date)
 */

const db = require('../database');

const HEADERS = [
  'Telegram ID',
  'Telegram Username',
  'Display Name',
  'Twitter Username',
  'Total Points',
  'Raids Completed',
  'Last Raid Title',
  'Last Reward',
  'Completed At',
  'First Seen',
];

let sheetsService = null;

function getSheetsService() {
  if (sheetsService) return sheetsService;
  try {
    sheetsService = require('../../services/sheets');
  } catch {
    try {
      sheetsService = require('../services/sheets');
    } catch {
      sheetsService = null;
    }
  }
  return sheetsService;
}

async function ensureHeaders(sheets) {
  if (!sheets || typeof sheets.getRows !== 'function') return;
  try {
    const rows = await sheets.getRows();
    if (!rows || rows.length === 0) {
      if (typeof sheets.addRow === 'function') {
        await sheets.addRow(HEADERS);
      }
    }
  } catch (err) {
    console.error('[SheetsSync] Failed to ensure headers:', err.message);
  }
}

async function syncUserData(user, raid, rewardPoints) {
  const sheets = getSheetsService();
  if (!sheets) return;

  try {
    await ensureHeaders(sheets);

    const groups = db.getUserGroups(user.telegram_id);
    let totalPoints = 0;
    for (const g of groups) {
      const pts = db.getUserPoints(user.id, g.id);
      totalPoints += pts?.points || 0;
    }

    const completedCount = db.getUserCompletedRaidCount(user.id);
    const now = new Date().toISOString();
    const firstSeen = user.created_at
      ? new Date(user.created_at * 1000).toISOString()
      : now;

    const rowData = [
      user.telegram_id,
      user.username ? `@${user.username}` : '',
      user.first_name || '',
      user.twitter_username ? `@${user.twitter_username}` : '',
      totalPoints,
      completedCount,
      raid.title,
      rewardPoints,
      now,
      firstSeen,
    ];

    if (typeof sheets.appendRow === 'function') {
      await sheets.appendRow(rowData);
    } else if (typeof sheets.addRow === 'function') {
      await sheets.addRow(rowData);
    }

    console.log(`[SheetsSync] Synced user ${user.telegram_id} for raid "${raid.title}"`);
  } catch (err) {
    console.error('[SheetsSync] Error syncing user data:', err.message);
  }
}

module.exports = { syncUserData, HEADERS };
