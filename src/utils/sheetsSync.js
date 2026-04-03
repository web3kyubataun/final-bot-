/**
 * sheetsSync.js
 *
 * Syncs raid completion data to Google Sheets.
 *
 * Submissions sheet columns:
 *   Timestamp | UserID | Username | Task | Platform | Action | Points | Status
 *
 * Users sheet columns:
 *   UserID | Username | Points | TwitterUsername | JoinedAt
 */

const db = require('../database');

const SUBMISSION_HEADERS = [
  'Timestamp',
  'UserID',
  'Username',
  'Task',
  'Platform',
  'Action',
  'Points',
  'Status',
];

const USER_HEADERS = [
  'UserID',
  'Username',
  'Points',
  'TwitterUsername',
  'JoinedAt',
];

let sheetsService = null;

function getSheetsService() {
  if (sheetsService) return sheetsService;
  try {
    sheetsService = require('../services/sheets');
  } catch {
    sheetsService = null;
  }
  return sheetsService;
}

async function ensureHeaders(sheets, headers) {
  if (!sheets || typeof sheets.getRows !== 'function') return;
  try {
    const rows = await sheets.getRows();
    if (!rows || rows.length === 0) {
      if (typeof sheets.addRow === 'function') {
        await sheets.addRow(headers);
      }
    }
  } catch (err) {
    console.error('[SheetsSync] Failed to ensure headers:', err.message);
  }
}

/**
 * Called after a user completes a full raid and earns points.
 *
 * @param {object} user   - DB user row
 * @param {object} raid   - DB raid row
 * @param {number} rewardPoints
 */
async function syncUserData(user, raid, rewardPoints) {
  const sheets = getSheetsService();
  if (!sheets) return;

  try {
    await ensureHeaders(sheets, SUBMISSION_HEADERS);

    const now = new Date().toISOString();

    // Gather task info for this raid
    const tasks = db.getTasksByRaid(raid.id);
    const platform = tasks[0]?.platform || 'unknown';
    const actions = tasks.map((t) => t.type).join(', ');
    const taskTitle = raid.title;

    const submissionRow = [
      now,                                                        // Timestamp
      user.telegram_id,                                           // UserID
      user.username ? `@${user.username}` : (user.first_name || ''),  // Username
      taskTitle,                                                  // Task
      platform,                                                   // Platform
      actions,                                                    // Action
      rewardPoints,                                               // Points
      'completed',                                                // Status
    ];

    if (typeof sheets.appendRow === 'function') {
      await sheets.appendRow(submissionRow);
    } else if (typeof sheets.addRow === 'function') {
      await sheets.addRow(submissionRow);
    }

    // Also upsert a user summary row if sheets exposes a second tab method
    if (typeof sheets.upsertUserRow === 'function') {
      const groups = db.getUserGroups(user.telegram_id);
      let totalPoints = 0;
      for (const g of groups) {
        const pts = db.getUserPoints(user.id, g.id);
        totalPoints += pts?.points || 0;
      }

      const joinedAt = user.created_at
        ? new Date(user.created_at * 1000).toISOString()
        : now;

      await sheets.upsertUserRow([
        user.telegram_id,                                          // UserID
        user.username ? `@${user.username}` : (user.first_name || ''), // Username
        totalPoints,                                               // Points
        user.twitter_username ? `@${user.twitter_username}` : '', // TwitterUsername
        joinedAt,                                                  // JoinedAt
      ]);
    }

    console.log(`[SheetsSync] Synced user ${user.telegram_id} — raid "${raid.title}" +${rewardPoints}pts`);
  } catch (err) {
    console.error('[SheetsSync] Error syncing user data:', err.message);
  }
}

module.exports = {
  syncUserData,
  SUBMISSION_HEADERS,
  USER_HEADERS,
};
