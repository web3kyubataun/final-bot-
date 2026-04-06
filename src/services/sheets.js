const { google } = require('googleapis');
const config = require('../config');
const fs = require('fs');

let auth = null;
let _serviceAccountEmail = null;

function getAuth() {
  if (auth) return auth;

  let credentials;

  if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the entire file content.');
    }
  } else if (config.GOOGLE_SERVICE_ACCOUNT_PATH && fs.existsSync(config.GOOGLE_SERVICE_ACCOUNT_PATH)) {
    credentials = JSON.parse(fs.readFileSync(config.GOOGLE_SERVICE_ACCOUNT_PATH, 'utf-8'));
  } else {
    throw new Error('Google credentials not found. Set GOOGLE_SERVICE_ACCOUNT_JSON in .env');
  }

  _serviceAccountEmail = credentials.client_email || null;

  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return auth;
}

/** Returns the service account email (parsed from credentials). */
function getServiceAccountEmail() {
  if (_serviceAccountEmail) return _serviceAccountEmail;
  try {
    getAuth(); // triggers credential parsing
    return _serviceAccountEmail;
  } catch {
    return null;
  }
}

/**
 * Try to create a new Google Sheet automatically.
 * This REQUIRES:
 *   - Google Sheets API enabled
 *   - Google Drive API enabled
 *   - Service account with sufficient Drive permissions
 *
 * If it fails, instruct the user to create the sheet manually and use /setsheet.
 */
async function createGroupSheet(groupName, emailsToShare = []) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive  = google.drive({ version: 'v3', auth: authClient });

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${groupName} - Bot Tracker` },
      sheets: [
        {
          properties: { title: 'Submissions', sheetId: 0, index: 0 },
          data: [{
            startRow: 0, startColumn: 0,
            rowData: [{
              values: ['Timestamp','UserID','Username','Task','Proof','Status','Points'].map(v => ({
                userEnteredValue: { stringValue: v },
                userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 } },
              })),
            }],
          }],
        },
        {
          properties: { title: 'Users', sheetId: 1, index: 1 },
          data: [{
            startRow: 0, startColumn: 0,
            rowData: [{
              values: ['UserID','Username','Points','Twitter','Wallet','JoinedAt'].map(v => ({
                userEnteredValue: { stringValue: v },
                userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 } },
              })),
            }],
          }],
        },
      ],
    },
  });

  const spreadsheetId = res.data.spreadsheetId;

  const allEmails = [];
  if (config.DEFAULT_SHARE_EMAIL) allEmails.push(config.DEFAULT_SHARE_EMAIL);
  for (const em of emailsToShare) {
    if (em && !allEmails.includes(em)) allEmails.push(em);
  }

  for (const email of allEmails) {
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'writer', emailAddress: email },
        sendNotificationEmail: false,
      });
    } catch (e) {
      console.error(`Share failed (${email}):`, e.message);
    }
  }

  return spreadsheetId;
}

/**
 * Setup a manually-created sheet (creates the header rows).
 * Use when auto-creation fails — user creates the sheet, shares it with the
 * service account email, then calls /setsheet.
 */
async function setupManualSheet(spreadsheetId) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  // Write headers in Submissions tab
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1:G1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Timestamp','UserID','Username','Task','Proof','Status','Points']],
    },
  });

  // Try to rename Sheet1 → Submissions and add a Users tab
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet1Id = meta.data.sheets[0].properties.sheetId;
    const requests = [
      { updateSheetProperties: { properties: { sheetId: sheet1Id, title: 'Submissions' }, fields: 'title' } },
      { addSheet: { properties: { title: 'Users' } } },
    ];
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

    // Add Users header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Users!A1:F1',
      valueInputOption: 'RAW',
      requestBody: { values: [['UserID','Username','Points','Twitter','Wallet','JoinedAt']] },
    });
  } catch { /* sheet may already be renamed or tab exists — ignore */ }
}

async function appendSubmission(spreadsheetId, { timestamp, userId, username, task, proof, status, points }) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Submissions!A:G',
    valueInputOption: 'RAW',
    requestBody: { values: [[timestamp, userId, username, task, proof, status, points]] },
  });
}

async function upsertUser(spreadsheetId, { userId, username, points, twitter, wallet, joinedAt }) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Users!A:A' });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => r[0] == userId);
  const rowData  = [userId, username, points, twitter || '', wallet || '', joinedAt];

  if (rowIndex >= 1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Users!A${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Users!A:F',
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
  }
}

async function updateSubmissionStatus(spreadsheetId, userId, taskTitle, newStatus) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Submissions!A:G' });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] == userId && rows[i][3] === taskTitle && rows[i][5] === 'pending') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Submissions!F${i + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[newStatus]] },
      });
      break;
    }
  }
}

async function shareSheet(spreadsheetId, email) {
  const authClient = await getAuth().getClient();
  const drive = google.drive({ version: 'v3', auth: authClient });
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'user', role: 'writer', emailAddress: email },
    sendNotificationEmail: false,
  });
}

module.exports = {
  createGroupSheet, setupManualSheet, appendSubmission,
  upsertUser, updateSubmissionStatus, shareSheet, getServiceAccountEmail,
};
