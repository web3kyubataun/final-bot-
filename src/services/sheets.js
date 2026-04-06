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
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
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

function getServiceAccountEmail() {
  if (_serviceAccountEmail) return _serviceAccountEmail;
  try { getAuth(); return _serviceAccountEmail; } catch { return null; }
}

function makeHeader(values) {
  return {
    values: values.map(v => ({
      userEnteredValue: { stringValue: v },
      userEnteredFormat: {
        textFormat: { bold: true },
        backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 },
      },
    })),
  };
}

/**
 * Create a new Google Sheet with multiple tabs:
 *  0. Submissions — all task completions
 *  1. Users       — user roster with Twitter, Wallet, Discord
 *  2. CollectedInfo — info gathered via admin Collect Info flow
 */
async function createGroupSheet(groupName, emailsToShare = []) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive  = google.drive({ version: 'v3', auth: authClient });

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${groupName} - Momentum Hub` },
      sheets: [
        {
          properties: { title: 'Submissions', sheetId: 0, index: 0 },
          data: [{ startRow: 0, startColumn: 0, rowData: [makeHeader(
            ['Timestamp','UserID','Telegram Username','Twitter','Task','Proof','Status','Points']
          )] }],
        },
        {
          properties: { title: 'Users', sheetId: 1, index: 1 },
          data: [{ startRow: 0, startColumn: 0, rowData: [makeHeader(
            ['UserID','Telegram Username','Twitter','Wallet','Discord','Points','Joined At','Collected Info']
          )] }],
        },
        {
          properties: { title: 'CollectedInfo', sheetId: 2, index: 2 },
          data: [{ startRow: 0, startColumn: 0, rowData: [makeHeader(
            ['Timestamp','UserID','Telegram Username','Twitter','Question','Answer']
          )] }],
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
 * Setup headers on a manually-created sheet (Submissions, Users, CollectedInfo tabs).
 */
async function setupManualSheet(spreadsheetId) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  // Get existing sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = meta.data.sheets.map(s => s.properties.title);

  const requests = [];

  // Add missing sheets
  const requiredSheets = [
    { title: 'Submissions', headers: ['Timestamp','UserID','Telegram Username','Twitter','Task','Proof','Status','Points'] },
    { title: 'Users',       headers: ['UserID','Telegram Username','Twitter','Wallet','Discord','Points','Joined At','Collected Info'] },
    { title: 'CollectedInfo', headers: ['Timestamp','UserID','Telegram Username','Twitter','Question','Answer'] },
  ];

  for (const s of requiredSheets) {
    if (!existingTitles.includes(s.title)) {
      requests.push({ addSheet: { properties: { title: s.title } } });
    }
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  // Write headers to each sheet
  for (const s of requiredSheets) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${s.title}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [s.headers] },
      });
    } catch {}
  }
}

/**
 * Append a submission row to the Submissions sheet.
 */
async function appendSubmission(spreadsheetId, { timestamp, userId, username, twitter, task, proof, status, points }) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Submissions!A:H',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[timestamp || new Date().toISOString(), userId, username || '', twitter || '', task, proof, status, points]],
    },
  });
}

/**
 * Upsert a user row in the Users sheet.
 */
async function upsertUser(spreadsheetId, { userId, username, twitter, wallet, discord, points, joinedAt, collectedInfo }) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: 'Users!A:H',
  });
  const rows = res.data.values || [];
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) { rowIndex = i; break; }
  }

  const collectedStr = collectedInfo && typeof collectedInfo === 'object'
    ? Object.entries(collectedInfo).map(([k, v]) => `${k}: ${v}`).join('; ')
    : (collectedInfo || '');

  const rowData = [
    String(userId), username || '', twitter || '', wallet || '',
    discord || '', points || 0, joinedAt || new Date().toISOString(), collectedStr,
  ];

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
      range: 'Users!A:H',
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] },
    });
  }
}

/**
 * Append a row to the CollectedInfo sheet.
 */
async function appendCollectedInfo(spreadsheetId, { userId, username, twitter, question, answer }) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'CollectedInfo!A:F',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[new Date().toISOString(), userId, username || '', twitter || '', question || '', answer || '']],
    },
  });
}

async function updateSubmissionStatus(spreadsheetId, userId, taskTitle, newStatus) {
  const authClient = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Submissions!A:H' });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] == userId && rows[i][4] === taskTitle && rows[i][6] === 'pending') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Submissions!G${i + 1}`,
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
  createGroupSheet, setupManualSheet, appendSubmission, upsertUser,
  appendCollectedInfo, updateSubmissionStatus, shareSheet, getServiceAccountEmail,
};
