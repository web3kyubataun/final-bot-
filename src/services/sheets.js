/**
 * sheets.js — Google Sheets multi-tab integration
 *
 * Tabs: Users | Tasks | Raids | Leaderboard
 * Creates tabs automatically if they don't exist.
 * All operations are no-ops if GOOGLE_SERVICE_ACCOUNT is not configured.
 */

const { google } = require('googleapis');

let auth = null;
let sheetsApi = null;

const TAB_HEADERS = {
 Users: ['Telegram ID', 'Username', 'First Name', 'Twitter Handle', 'Wallet', 'Discord', 'Points', 'Rank', 'Tasks Completed', 'Raids Completed', 'Date Joined'],
 Tasks: ['User Telegram ID', 'Twitter Handle', 'Task ID', 'Task Title', 'Task Type', 'Points Awarded', 'Timestamp'],
 Raids: ['User Telegram ID', 'Twitter Handle', 'Raid ID', 'Raid Title', 'Task Type', 'Points Awarded', 'Raid Expires', 'Timestamp'],
 Leaderboard: ['Rank', 'Username', 'Twitter Handle', 'Points'],
};

function init() {
 if (sheetsApi) return sheetsApi;
 const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
 if (!raw) return null;
 try {
 const creds = typeof raw === 'string' ? JSON.parse(raw) : raw;
 auth = new google.auth.GoogleAuth({
 credentials: creds,
 scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
 });
 sheetsApi = google.sheets({ version: 'v4', auth });
 return sheetsApi;
 } catch (e) {
 console.warn('[Sheets] Failed to init Google Auth:', e.message);
 return null;
 }
}

// Ensure a tab exists; create it if it doesn't. Returns true if ready.
async function ensureTab(api, sheetId, tabName) {
 try {
 const meta = await api.spreadsheets.get({ spreadsheetId: sheetId });
 const exists = meta.data.sheets?.some(s => s.properties?.title === tabName);
 if (!exists) {
 await api.spreadsheets.batchUpdate({
 spreadsheetId: sheetId,
 requestBody: {
 requests: [{ addSheet: { properties: { title: tabName } } }],
 },
 });
 // Write headers
 await api.spreadsheets.values.update({
 spreadsheetId: sheetId,
 range:`${tabName}!A1`,
 valueInputOption: 'USER_ENTERED',
 requestBody: { values: [TAB_HEADERS[tabName] || []] },
 });
 }
 return true;
 } catch (e) {
 console.error(`[Sheets] ensureTab(${tabName}) failed:`, e.message);
 return false;
 }
}

// ── Append a single row to a tab ─────────────────────────────────────────────

async function appendRow(sheetId, tabName, row) {
 const api = init();
 if (!api || !sheetId || sheetId === 'none') return;
 try {
 await ensureTab(api, sheetId, tabName);
 await api.spreadsheets.values.append({
 spreadsheetId: sheetId,
 range:`${tabName}!A:Z`,
 valueInputOption: 'USER_ENTERED',
 requestBody: { values: [row] },
 });
 } catch (e) {
 console.error(`[Sheets] appendRow(${tabName}) failed:`, e.message);
 }
}

// ── Overwrite a tab completely (used for Users and Leaderboard) ───────────────

async function overwriteTab(sheetId, tabName, rows) {
 const api = init();
 if (!api || !sheetId || sheetId === 'none') return;
 try {
 await ensureTab(api, sheetId, tabName);
 await api.spreadsheets.values.clear({
 spreadsheetId: sheetId,
 range:`${tabName}!A:Z`,
 });
 const allRows = [TAB_HEADERS[tabName] || [], ...rows];
 await api.spreadsheets.values.update({
 spreadsheetId: sheetId,
 range:`${tabName}!A1`,
 valueInputOption: 'USER_ENTERED',
 requestBody: { values: allRows },
 });
 } catch (e) {
 console.error(`[Sheets] overwriteTab(${tabName}) failed:`, e.message);
 }
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Log a task submission.
 */
async function logTask(sheetId, { userId, twitter, taskId, taskTitle, taskType, points }) {
 const ts = new Date().toISOString();
 await appendRow(sheetId, 'Tasks', [String(userId), twitter || '', String(taskId), taskTitle || '', taskType || '', points || 0, ts]);
}

/**
 * Log a raid submission.
 */
async function logRaid(sheetId, { userId, twitter, taskId, taskTitle, taskType, points, raidExpiry }) {
 const ts = new Date().toISOString();
 await appendRow(sheetId, 'Raids', [String(userId), twitter || '', String(taskId), taskTitle || '', taskType || '', points || 0, raidExpiry || '', ts]);
}

/**
 * Refresh the Users tab with all current user data.
 */
async function refreshUsers(sheetId, users) {
 const sorted = [...users].sort((a, b) => (b.points || 0) - (a.points || 0));
 const rows = sorted.map((u, i) => [
 u.id,
 u.username || '',
 u.firstName || '',
 u.twitter ?`@${u.twitter}` : '',
 u.wallet || '',
 u.discord || '',
 u.points || 0,
 i + 1,
 u.tasksCompleted || 0,
 u.raidsCompleted || 0,
 u.joinedAt || '',
 ]);
 await overwriteTab(sheetId, 'Users', rows);
}

/**
 * Refresh the Leaderboard tab with top 50 users.
 */
async function refreshLeaderboard(sheetId, users) {
 const top50 = [...users]
 .filter(u => !u.banned)
 .sort((a, b) => (b.points || 0) - (a.points || 0))
 .slice(0, 50);
 const rows = top50.map((u, i) => [
 i + 1,
 u.username ?`@${u.username}` :`id:${u.id}`,
 u.twitter ?`@${u.twitter}` : '',
 u.points || 0,
 ]);
 await overwriteTab(sheetId, 'Leaderboard', rows);
}

/**
 * Share a sheet with an email address (editor access).
 */
async function shareSheet(sheetId, email) {
 if (!sheetId || sheetId === 'none' || !email) return;
 try {
 const drive = google.drive({ version: 'v3', auth });
 if (!auth) return;
 await drive.permissions.create({
 fileId: sheetId,
 requestBody: { role: 'writer', type: 'user', emailAddress: email },
 });
 } catch (e) {
 console.error('[Sheets] shareSheet failed:', e.message);
 }
}

/**
 * Helper: fire-and-forget log on task/raid completion.
 * Handles all four tabs (Users, Tasks/Raids, Leaderboard).
 */
async function onCompletion(sheetId, { user, task, isRaid }) {
 if (!sheetId || sheetId === 'none') return;
 const store = require('../store');
 try {
 const allUsers = store.getAllUsers();
 if (isRaid) {
 await Promise.all([
 logRaid(sheetId, {
 userId: user.id, twitter: user.twitter,
 taskId: task.id, taskTitle: task.title, taskType: task.taskType,
 points: task.reward, raidExpiry: task.expiresAt,
 }),
 refreshUsers(sheetId, allUsers),
 refreshLeaderboard(sheetId, allUsers),
 ]);
 } else {
 await Promise.all([
 logTask(sheetId, {
 userId: user.id, twitter: user.twitter,
 taskId: task.id, taskTitle: task.title, taskType: task.taskType,
 points: task.reward,
 }),
 refreshUsers(sheetId, allUsers),
 refreshLeaderboard(sheetId, allUsers),
 ]);
 }
 } catch (e) {
 console.error('[Sheets] onCompletion failed:', e.message);
 }
}

module.exports = { logTask, logRaid, refreshUsers, refreshLeaderboard, shareSheet, onCompletion };
