/**
 * sheets.js — Google Sheets integration (optional)
 * Requires GOOGLE_SERVICE_ACCOUNT env var (JSON string of service account credentials)
 * If not configured, all calls are no-ops and return gracefully.
 */

const { google } = require('googleapis');

let auth = null;
let sheetsApi = null;

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

/**
 * Append a submission row to a Google Sheet.
 * The sheet must have headers: Timestamp | User ID | Username | Task | Proof | Status | Points
 */
async function appendSubmission(sheetId, { timestamp, userId, username, task, proof, status, points }) {
  const api = init();
  if (!api || !sheetId || sheetId === 'none') return;

  try {
    await api.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, userId, username, task, proof, status, points]],
      },
    });
  } catch (e) {
    console.error('[Sheets] appendSubmission failed:', e.message);
  }
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

module.exports = { appendSubmission, shareSheet };
