/**
 * sqlite.js — JSON-file token storage for OAuth tokens & PKCE states.
 * Named sqlite.js for drop-in compatibility with existing imports.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.OAUTH_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const TOKENS_PATH = process.env.OAUTH_TOKENS_PATH || path.join(DATA_DIR, 'oauth_tokens.json');
const STATES_PATH = process.env.OAUTH_STATES_PATH || path.join(DATA_DIR, 'oauth_states.json');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function readJson(filePath) {
 try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

function writeJson(filePath, data) {
 try { fs.writeFileSync(filePath, JSON.stringify(data), 'utf8'); } catch {}
}

function saveTokens(telegramUserId, accessToken, refreshToken, expiresInSeconds) {
 const tokens = readJson(TOKENS_PATH);
 tokens[String(telegramUserId)] = {
 access_token: accessToken,
 refresh_token: refreshToken || null,
 expires_at: Date.now() + ((expiresInSeconds || 7200) - 60) * 1000,
 };
 writeJson(TOKENS_PATH, tokens);
}

function getTokens(telegramUserId) {
 const tokens = readJson(TOKENS_PATH);
 return tokens[String(telegramUserId)] || null;
}

function deleteTokens(telegramUserId) {
 const tokens = readJson(TOKENS_PATH);
 delete tokens[String(telegramUserId)];
 writeJson(TOKENS_PATH, tokens);
}

function saveState(state, telegramUserId, codeVerifier) {
 const states = readJson(STATES_PATH);
 states[state] = {
 telegram_user_id: String(telegramUserId),
 code_verifier: codeVerifier,
 created_at: Date.now(),
 };
 writeJson(STATES_PATH, states);
}

function popState(state) {
 const states = readJson(STATES_PATH);
 const row = states[state];
 if (!row) return null;
 delete states[state];
 writeJson(STATES_PATH, states);
 if (Date.now() - row.created_at > 10 * 60 * 1000) return null;
 return row;
}

function cleanOldStates() {
 const states = readJson(STATES_PATH);
 const cutoff = Date.now() - 10 * 60 * 1000;
 let changed = false;
 for (const [k, row] of Object.entries(states)) {
 if (row.created_at < cutoff) { delete states[k]; changed = true; }
 }
 if (changed) writeJson(STATES_PATH, states);
}

module.exports = { saveTokens, getTokens, deleteTokens, saveState, popState, cleanOldStates };
