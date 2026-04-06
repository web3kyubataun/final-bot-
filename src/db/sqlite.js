/**
 * sqlite.js — Lightweight JSON-file token storage.
 * Replaces better-sqlite3 (which requires native compilation).
 * Stores OAuth tokens and PKCE states in /tmp/oauth_tokens.json and /tmp/oauth_states.json
 */

const fs = require('fs');

const TOKENS_PATH = process.env.OAUTH_TOKENS_PATH || '/tmp/oauth_tokens.json';
const STATES_PATH = process.env.OAUTH_STATES_PATH  || '/tmp/oauth_states.json';

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

function writeJson(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data), 'utf8'); } catch {}
}

// ── Tokens ────────────────────────────────────────────────────────────────────

function saveTokens(telegramUserId, accessToken, refreshToken, expiresInSeconds) {
  const tokens = readJson(TOKENS_PATH);
  tokens[String(telegramUserId)] = {
    access_token:  accessToken,
    refresh_token: refreshToken || null,
    expires_at:    Date.now() + ((expiresInSeconds || 7200) - 60) * 1000,
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

// ── OAuth States (PKCE) ───────────────────────────────────────────────────────

function saveState(state, telegramUserId, codeVerifier) {
  const states = readJson(STATES_PATH);
  states[state] = {
    telegram_user_id: String(telegramUserId),
    code_verifier:    codeVerifier,
    created_at:       Date.now(),
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
