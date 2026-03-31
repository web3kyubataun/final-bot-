const { google } = require('googleapis');
const config = require('../config');
const fs = require('fs');

let auth = null;

function getAuth() {
  if (auth) return auth;

  let credentials;

  if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    // Preferred: JSON content pasted directly as an environment variable
    try {
      credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Make sure you pasted the entire file content.');
    }
  } else if (fs.existsSync(config.GOOGLE_SERVICE_ACCOUNT_PATH)) {
    // Fallback: read from a local file
    credentials = JSON.parse(fs.readFileSync(config.GOOGLE_SERVICE_ACCOUNT_PATH, 'utf-8'));
  } else {
    throw new Error(
      'Google credentials not found. Set GOOGLE_SERVICE_ACCOUNT_JSON variable with your service account JSON content.'
    );
  }

  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return auth;
}

/**
 * Create a new Google Sheet for a group and share it.
 * Returns the spreadsheetId.
 */
async function createGroupSheet(groupName, emailsToShare = []) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  // Create spreadsheet with two tabs
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${groupName} - Bot Tracker` },
      sheets: [
        {
          properties: { title: 'Submissions', sheetId: 0, index: 0 },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: ['Timestamp', 'UserID', 'Username', 'Task', 'Proof', 'Status', 'Points'].map(v => ({
                userEnteredValue: { stringValue: v },
                userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 } },
              })),
            }],
          }],
        },
        {
          properties: { title: 'Users', sheetId: 1, index: 1 },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: ['UserID', 'Username', 'Points', 'Twitter', 'Wallet', 'JoinedAt'].map(v => ({
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

  // Share with all emails
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
      console.error(`Failed to share sheet with ${email}:`, e.message);
    }
  }

  return spreadsheetId;
}

/**
 * Append a submission row to the Submissions tab.
 */
async function appendSubmission(spreadsheetId, { timestamp, userId, username, task, proof, status, points }) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Submissions!A:G',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[timestamp, userId, username, task, proof, status, points]],
    },
  });
}

/**
 * Update or insert a user row on the Users tab.
 */
async function upsertUser(spreadsheetId, { userId, username, points, twitter, wallet, joinedAt }) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  // Try to find existing row
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Users!A:A',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => r[0] == userId);

  const rowData = [userId, username, points, twitter || '', wallet || '', joinedAt];

  if (rowIndex >= 1) {
    // Update existing row (rowIndex is 0-based, sheet is 1-based, skip header -> +2)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Users!A${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Users!A:F',
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
  }
}

/**
 * Update the status of an existing submission row.
 */
async function updateSubmissionStatus(spreadsheetId, userId, taskTitle, newStatus) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Submissions!A:G',
  });
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

/**
 * Share an existing sheet with a new email.
 */
async function shareSheet(spreadsheetId, email) {
  const authClient = await getAuth().getClient();
  const drive = google.drive({ version: 'v3', auth: authClient });
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'user', role: 'writer', emailAddress: email },
    sendNotificationEmail: false,
  });
}

module.exports = { createGroupSheet, appendSubmission, upsertUser, updateSubmissionStatus, shareSheet };
