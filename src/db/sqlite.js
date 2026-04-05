/**
 * sqlite.js — Persistent SQLite storage for OAuth tokens only.
 * All other bot data stays in-memory (store.js).
 * Uses better-sqlite3 (synchronous, fast, zero config).
 */

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../../data/oauth.db');

let db;
function getDb() {
  if (!db) {
    const { mkdirSync } = require('fs');
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        telegram_user_id TEXT PRIMARY KEY,
        access_token     TEXT NOT NULL,
        refresh_token    TEXT,
        expires_at       INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state            TEXT PRIMARY KEY,
        telegram_user_id TEXT NOT NULL,
        code_verifier    TEXT NOT NULL,
        created_at       INTEGER NOT NULL
      );
    `);
  }
  return db;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

function saveTokens(telegramUserId, accessToken, refreshToken, expiresInSeconds) {
  const expiresAt = Date.now() + (expiresInSeconds - 60) * 1000; // 60s early
  getDb().prepare(
    `INSERT INTO oauth_tokens (telegram_user_id, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE
     SET access_token=excluded.access_token,
         refresh_token=excluded.refresh_token,
         expires_at=excluded.expires_at`
  ).run(String(telegramUserId), accessToken, refreshToken || null, expiresAt);
}

function getTokens(telegramUserId) {
  return getDb().prepare(
    `SELECT * FROM oauth_tokens WHERE telegram_user_id = ?`
  ).get(String(telegramUserId)) || null;
}

function deleteTokens(telegramUserId) {
  getDb().prepare(`DELETE FROM oauth_tokens WHERE telegram_user_id = ?`)
    .run(String(telegramUserId));
}

// ── OAuth States (PKCE) ───────────────────────────────────────────────────────

function saveState(state, telegramUserId, codeVerifier) {
  getDb().prepare(
    `INSERT OR REPLACE INTO oauth_states (state, telegram_user_id, code_verifier, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(state, String(telegramUserId), codeVerifier, Date.now());
}

function popState(state) {
  const row = getDb().prepare(
    `SELECT * FROM oauth_states WHERE state = ?`
  ).get(state);
  if (!row) return null;
  getDb().prepare(`DELETE FROM oauth_states WHERE state = ?`).run(state);
  // Expire states older than 10 minutes
  if (Date.now() - row.created_at > 10 * 60 * 1000) return null;
  return row;
}

function cleanOldStates() {
  getDb().prepare(
    `DELETE FROM oauth_states WHERE created_at < ?`
  ).run(Date.now() - 10 * 60 * 1000);
}

module.exports = { saveTokens, getTokens, deleteTokens, saveState, popState, cleanOldStates };
