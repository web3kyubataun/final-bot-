/**
 * store.js — Persistent SQLite-backed store
 *
 * Drop-in replacement for the in-memory store.
 * Uses better-sqlite3 so every function stays SYNCHRONOUS — no caller changes needed.
 * Data survives bot restarts and Railway redeploys (via Railway Volume at /data).
 *
 * DB_PATH resolution (checked in order):
 *   1. DB_PATH env var (e.g. /data/bot.db on Railway with a Volume)
 *   2. /tmp/bot.db    — always writable fallback (ephemeral, lost on restart)
 *
 * To make data fully persistent on Railway:
 *   - Add a Volume mounted at /data in Railway dashboard
 *   - Set env var DB_PATH=/data/bot.db in Railway Variables
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

function _resolvePath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  // /tmp is always writable in any container environment
  return '/tmp/bot.db';
}

const DB_PATH = _resolvePath();

let _db = null;

function getDb() {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // If we can't create the directory (e.g. read-only volume not mounted yet),
    // fall back to /tmp which is always writable
    console.warn(`[Store] Cannot create dir ${dir}: ${e.message}. Falling back to /tmp/bot.db`);
    return _openDb('/tmp/bot.db');
  }
  return _openDb(DB_PATH);
}

function _openDb(dbPath) {
  console.log(`[Store] Opening database at ${dbPath}`);
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _initSchema(_db);
  return _db;
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_admin_context (
      user_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_groups (
      id TEXT PRIMARY KEY,
      sheet_id TEXT DEFAULT 'none',
      owner_id TEXT,
      access_mode TEXT DEFAULT 'all',
      group_link TEXT,
      group_name TEXT,
      admins TEXT DEFAULT '[]',
      whitelist TEXT DEFAULT '[]',
      extra_emails TEXT DEFAULT '[]',
      topics TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS store_users (
      id TEXT PRIMARY KEY,
      username TEXT DEFAULT 'unknown',
      points INTEGER DEFAULT 0,
      twitter TEXT,
      twitter_locked INTEGER DEFAULT 0,
      wallet TEXT,
      discord TEXT,
      collected_info TEXT DEFAULT '{}',
      joined_at TEXT DEFAULT (datetime('now')),
      banned INTEGER DEFAULT 0,
      notifications INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS store_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT DEFAULT '',
      reward INTEGER DEFAULT 0,
      type TEXT DEFAULT 'task',
      button_label TEXT DEFAULT '',
      platform TEXT DEFAULT 'twitter',
      task_type TEXT DEFAULT 'follow',
      active INTEGER DEFAULT 1,
      time_limit_minutes INTEGER,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS store_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      username TEXT,
      group_id TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      task_title TEXT,
      proof TEXT,
      points INTEGER DEFAULT 0,
      proof_type TEXT,
      photo_id TEXT,
      status TEXT DEFAULT 'approved',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, group_id, task_id)
    );
  `);

  // Safe migrations for existing databases
  const migrations = [
    `ALTER TABLE store_users ADD COLUMN twitter_locked INTEGER DEFAULT 0`,
    `ALTER TABLE store_users ADD COLUMN collected_info TEXT DEFAULT '{}'`,
    `ALTER TABLE store_groups ADD COLUMN extra_emails TEXT DEFAULT '[]'`,
    `ALTER TABLE store_tasks ADD COLUMN time_limit_minutes INTEGER`,
    `ALTER TABLE store_tasks ADD COLUMN expires_at TEXT`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) {}
  }
}

// ═══════════════════════════════════════════════
//  ADMIN CONTEXT
// ═══════════════════════════════════════════════

function setAdminContext(userId, groupId) {
  getDb().prepare(
    `INSERT INTO store_admin_context (user_id, group_id) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET group_id = excluded.group_id`
  ).run(String(userId), String(groupId));
}

function getAdminContext(userId) {
  const row = getDb().prepare('SELECT group_id FROM store_admin_context WHERE user_id = ?').get(String(userId));
  return row ? row.group_id : null;
}

function clearAdminContext(userId) {
  getDb().prepare('DELETE FROM store_admin_context WHERE user_id = ?').run(String(userId));
}

// ═══════════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════════

function _groupFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    admins:      new Set(JSON.parse(row.admins || '[]')),
    whitelist:   new Set(JSON.parse(row.whitelist || '[]')),
    extraEmails: JSON.parse(row.extra_emails || '[]'),
    topics:      JSON.parse(row.topics || '{}'),
    sheetId:     row.sheet_id,
    ownerId:     row.owner_id,
    accessMode:  row.access_mode,
    groupLink:   row.group_link,
    groupName:   row.group_name,
    createdAt:   row.created_at,
  };
}

function _saveGroup(gid, g) {
  getDb().prepare(`
    INSERT INTO store_groups (id, sheet_id, owner_id, access_mode, group_link, group_name, admins, whitelist, extra_emails, topics, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sheet_id = excluded.sheet_id, owner_id = excluded.owner_id,
      access_mode = excluded.access_mode, group_link = excluded.group_link,
      group_name = excluded.group_name, admins = excluded.admins,
      whitelist = excluded.whitelist, extra_emails = excluded.extra_emails,
      topics = excluded.topics
  `).run(
    gid,
    g.sheetId || g.sheet_id || 'none',
    g.ownerId || g.owner_id || null,
    g.accessMode || g.access_mode || 'all',
    g.groupLink || g.group_link || null,
    g.groupName || g.group_name || null,
    JSON.stringify(g.admins instanceof Set ? [...g.admins] : (g.admins || [])),
    JSON.stringify(g.whitelist instanceof Set ? [...g.whitelist] : (g.whitelist || [])),
    JSON.stringify(g.extraEmails || g.extra_emails || []),
    JSON.stringify(g.topics || {}),
    g.createdAt || g.created_at || new Date().toISOString()
  );
}

function addGroup(groupId, sheetId, ownerId) {
  const gid = String(groupId);
  const existing = getDb().prepare('SELECT * FROM store_groups WHERE id = ?').get(gid);
  if (!existing) {
    const g = {
      sheetId: sheetId || 'none',
      ownerId: ownerId ? String(ownerId) : null,
      accessMode: 'all',
      groupLink: null,
      groupName: null,
      admins: new Set(),
      whitelist: new Set(),
      extraEmails: [],
      topics: {
        getstarted: null, notifications: null, tasks: null,
        raids: null, leaderboard: null, connect: null,
        announcements: null, submissions: null, general: null,
      },
      createdAt: new Date().toISOString(),
    };
    _saveGroup(gid, g);
  }
  return getGroup(gid);
}

function removeGroup(groupId) {
  const result = getDb().prepare('DELETE FROM store_groups WHERE id = ?').run(String(groupId));
  return result.changes > 0;
}

function getGroup(groupId) {
  const row = getDb().prepare('SELECT * FROM store_groups WHERE id = ?').get(String(groupId));
  if (!row) return null;
  const g = _groupFromRow(row);
  // Return a proxy-like object that auto-saves on property set
  return _makeGroupProxy(String(groupId), g);
}

function _makeGroupProxy(gid, g) {
  return new Proxy(g, {
    set(target, prop, value) {
      target[prop] = value;
      _saveGroup(gid, target);
      return true;
    }
  });
}

function getAllGroups() {
  return getDb().prepare('SELECT * FROM store_groups').all().map(row => {
    const g = _groupFromRow(row);
    return { id: row.id, ...g };
  });
}

function isGroupRegistered(groupId) {
  return !!getDb().prepare('SELECT id FROM store_groups WHERE id = ?').get(String(groupId));
}

function setGroupTopic(groupId, type, topicId) {
  const row = getDb().prepare('SELECT topics FROM store_groups WHERE id = ?').get(String(groupId));
  if (!row) return;
  const topics = JSON.parse(row.topics || '{}');
  topics[type] = topicId;
  getDb().prepare('UPDATE store_groups SET topics = ? WHERE id = ?').run(JSON.stringify(topics), String(groupId));
}

function setGroupMeta(groupId, meta) {
  const row = getDb().prepare('SELECT * FROM store_groups WHERE id = ?').get(String(groupId));
  if (!row) return;
  const g = _groupFromRow(row);
  Object.assign(g, meta);
  _saveGroup(String(groupId), g);
}

function getGroupsForAdmin(userId) {
  const { isOwner } = require('./middleware/auth');
  const uid = String(userId);
  return getAllGroups().filter(g => {
    return isOwner(userId) ||
      (g.admins instanceof Set ? g.admins.has(uid) : (g.admins || []).includes(uid)) ||
      g.ownerId === uid;
  });
}

function groupHasTopics(groupId) {
  const row = getDb().prepare('SELECT topics FROM store_groups WHERE id = ?').get(String(groupId));
  if (!row) return false;
  const topics = JSON.parse(row.topics || '{}');
  return Object.values(topics).some(v => v !== null && v !== undefined);
}

// ═══════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════

function getOrCreateUser(userId, username) {
  const uid = String(userId);
  const db = getDb();
  db.prepare(`
    INSERT INTO store_users (id, username) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET username = CASE WHEN excluded.username IS NOT NULL THEN excluded.username ELSE store_users.username END
  `).run(uid, username || 'unknown');
  return _userFromRow(db.prepare('SELECT * FROM store_users WHERE id = ?').get(uid));
}

function _userFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    twitterLocked: !!row.twitter_locked,
    collectedInfo: JSON.parse(row.collected_info || '{}'),
    banned: !!row.banned,
    notifications: row.notifications !== 0,
    joinedAt: row.joined_at,
  };
}

function getUser(userId) {
  const row = getDb().prepare('SELECT * FROM store_users WHERE id = ?').get(String(userId));
  return _userFromRow(row);
}

function getAllUsers() {
  return getDb().prepare('SELECT * FROM store_users').all().map(r => ({ ...r, ..._userFromRow(r) }));
}

function banUser(userId) {
  const uid = String(userId).replace('@', '');
  const result = getDb().prepare('UPDATE store_users SET banned = 1 WHERE id = ?').run(uid);
  return result.changes > 0;
}

function unbanUser(userId) {
  const uid = String(userId).replace('@', '');
  const result = getDb().prepare('UPDATE store_users SET banned = 0 WHERE id = ?').run(uid);
  return result.changes > 0;
}

function addPoints(userId, points) {
  getDb().prepare('UPDATE store_users SET points = MAX(0, points + ?) WHERE id = ?').run(points, String(userId));
}

function setUserTwitter(userId, twitter) {
  const db = getDb();
  const row = db.prepare('SELECT twitter_locked FROM store_users WHERE id = ?').get(String(userId));
  if (!row) return false;
  if (row.twitter_locked) return false;
  db.prepare('UPDATE store_users SET twitter = ?, twitter_locked = 1 WHERE id = ?').run(twitter, String(userId));
  return true;
}

function adminSetUserTwitter(userId, twitter) {
  const uid = String(userId).replace('@', '');
  const result = getDb().prepare(
    'UPDATE store_users SET twitter = ?, twitter_locked = 1 WHERE id = ?'
  ).run(twitter, uid);
  return result.changes > 0;
}

function setCollectedInfo(userId, key, value) {
  const db = getDb();
  const row = db.prepare('SELECT collected_info FROM store_users WHERE id = ?').get(String(userId));
  if (!row) return false;
  const info = JSON.parse(row.collected_info || '{}');
  info[key] = value;
  db.prepare('UPDATE store_users SET collected_info = ? WHERE id = ?').run(JSON.stringify(info), String(userId));
  return true;
}

// ═══════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════

function createTask(groupId, title, link, reward, type, buttonLabel, platform, taskType, timeLimitMinutes) {
  const db = getDb();
  const expiresAt = timeLimitMinutes && timeLimitMinutes > 0
    ? new Date(Date.now() + timeLimitMinutes * 60 * 1000).toISOString()
    : null;
  const result = db.prepare(`
    INSERT INTO store_tasks (group_id, title, link, reward, type, button_label, platform, task_type, active, time_limit_minutes, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(String(groupId), title, link || '', reward || 0, type || 'task', buttonLabel || '', platform || 'twitter', taskType || 'follow', timeLimitMinutes || null, expiresAt);
  return _taskFromRow(db.prepare('SELECT * FROM store_tasks WHERE id = ?').get(result.lastInsertRowid));
}

function _taskFromRow(row) {
  if (!row) return null;
  const t = {
    ...row,
    groupId:          row.group_id,
    buttonLabel:      row.button_label,
    taskType:         row.task_type,
    timeLimitMinutes: row.time_limit_minutes,
    expiresAt:        row.expires_at,
    active:           !!row.active,
    createdAt:        row.created_at,
  };
  // Auto-expire check
  if (t.active && t.expiresAt && new Date() > new Date(t.expiresAt)) {
    getDb().prepare('UPDATE store_tasks SET active = 0 WHERE id = ?').run(t.id);
    t.active = false;
  }
  return t;
}

function getTask(taskId) {
  return _taskFromRow(getDb().prepare('SELECT * FROM store_tasks WHERE id = ?').get(Number(taskId)));
}

function deactivateTask(taskId) {
  const result = getDb().prepare('UPDATE store_tasks SET active = 0 WHERE id = ?').run(Number(taskId));
  return result.changes > 0;
}

function getTasksForGroup(groupId, type) {
  let sql = 'SELECT * FROM store_tasks WHERE group_id = ? AND active = 1';
  const params = [String(groupId)];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  return getDb().prepare(sql).all(...params).map(_taskFromRow).filter(t => t && t.active);
}

function getAllTasksForGroup(groupId) {
  return getDb().prepare('SELECT * FROM store_tasks WHERE group_id = ?').all(String(groupId)).map(_taskFromRow);
}

// ═══════════════════════════════════════════════
//  SUBMISSIONS
// ═══════════════════════════════════════════════

function createSubmission(userId, username, groupId, taskId, taskTitle, proof, points, proofType, photoId) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO store_submissions (user_id, username, group_id, task_id, task_title, proof, points, proof_type, photo_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
      ON CONFLICT(user_id, group_id, task_id) DO NOTHING
    `).run(String(userId), username, String(groupId), taskId, taskTitle, proof, points || 0, proofType, photoId);
  } catch (_) {}
  return db.prepare('SELECT * FROM store_submissions WHERE user_id = ? AND group_id = ? AND task_id = ?').get(String(userId), String(groupId), taskId);
}

function hasSubmitted(userId, groupId, taskId) {
  return !!getDb().prepare('SELECT id FROM store_submissions WHERE user_id = ? AND group_id = ? AND task_id = ?').get(String(userId), String(groupId), taskId);
}

function getSubmission(subId) {
  return getDb().prepare('SELECT * FROM store_submissions WHERE id = ?').get(Number(subId));
}

function approveSubmission(subId) {
  const result = getDb().prepare('UPDATE store_submissions SET status = ? WHERE id = ?').run('approved', Number(subId));
  return result.changes > 0;
}

function rejectSubmission(subId) {
  const result = getDb().prepare('UPDATE store_submissions SET status = ? WHERE id = ?').run('rejected', Number(subId));
  return result.changes > 0;
}

function getSubmissionsForGroup(groupId) {
  return getDb().prepare('SELECT * FROM store_submissions WHERE group_id = ?').all(String(groupId));
}

// ═══════════════════════════════════════════════
//  ACCESS CONTROL
// ═══════════════════════════════════════════════

function addAdmin(groupId, userId) {
  const gid = String(groupId);
  const uid = String(userId);
  const row = getDb().prepare('SELECT admins FROM store_groups WHERE id = ?').get(gid);
  if (!row) return;
  const admins = JSON.parse(row.admins || '[]');
  if (!admins.includes(uid)) admins.push(uid);
  getDb().prepare('UPDATE store_groups SET admins = ? WHERE id = ?').run(JSON.stringify(admins), gid);
}

function removeAdmin(groupId, userId) {
  const gid = String(groupId);
  const uid = String(userId);
  const row = getDb().prepare('SELECT admins FROM store_groups WHERE id = ?').get(gid);
  if (!row) return;
  const admins = JSON.parse(row.admins || '[]').filter(a => a !== uid);
  getDb().prepare('UPDATE store_groups SET admins = ? WHERE id = ?').run(JSON.stringify(admins), gid);
}

function isAdmin(groupId, userId) {
  const gid = String(groupId);
  const uid = String(userId);
  const row = getDb().prepare('SELECT admins FROM store_groups WHERE id = ?').get(gid);
  if (!row) return false;
  return JSON.parse(row.admins || '[]').includes(uid);
}

function addToWhitelist(groupId, userId) {
  const gid = String(groupId);
  const uid = String(userId);
  const row = getDb().prepare('SELECT whitelist FROM store_groups WHERE id = ?').get(gid);
  if (!row) return;
  const wl = JSON.parse(row.whitelist || '[]');
  if (!wl.includes(uid)) wl.push(uid);
  getDb().prepare('UPDATE store_groups SET whitelist = ? WHERE id = ?').run(JSON.stringify(wl), gid);
}

function setAccessMode(groupId, mode) {
  getDb().prepare('UPDATE store_groups SET access_mode = ? WHERE id = ?').run(mode, String(groupId));
}

// ═══════════════════════════════════════════════
//  LEADERBOARD & STATS
// ═══════════════════════════════════════════════

function getLeaderboard(limit = 10) {
  return getDb().prepare(
    'SELECT id, username, points FROM store_users WHERE banned = 0 ORDER BY points DESC LIMIT ?'
  ).all(limit);
}

function getGroupStats(groupId) {
  const gid = String(groupId);
  const db = getDb();
  const tasks  = db.prepare('SELECT * FROM store_tasks WHERE group_id = ?').all(gid);
  const subs   = db.prepare('SELECT * FROM store_submissions WHERE group_id = ?').all(gid);
  const users  = db.prepare('SELECT * FROM store_users').all();
  return {
    activeTasks:         tasks.filter(t => t.active && t.type === 'task').length,
    totalTasks:          tasks.filter(t => t.type === 'task').length,
    activeRaids:         tasks.filter(t => t.active && t.type === 'raid').length,
    totalRaids:          tasks.filter(t => t.type === 'raid').length,
    pendingSubmissions:  subs.filter(s => s.status === 'pending').length,
    approvedSubmissions: subs.filter(s => s.status === 'approved').length,
    rejectedSubmissions: subs.filter(s => s.status === 'rejected').length,
    totalUsers:          users.length,
    bannedUsers:         users.filter(u => u.banned).length,
  };
}

// Initialize DB on first import
getDb();

module.exports = {
  setAdminContext, getAdminContext, clearAdminContext,
  addGroup, removeGroup, getGroup, getAllGroups, isGroupRegistered,
  setGroupTopic, setGroupMeta, getGroupsForAdmin, groupHasTopics,
  getOrCreateUser, getUser, getAllUsers, banUser, unbanUser, addPoints,
  setUserTwitter, adminSetUserTwitter, setCollectedInfo,
  createTask, getTask, deactivateTask, getTasksForGroup, getAllTasksForGroup,
  createSubmission, hasSubmitted, getSubmission, approveSubmission, rejectSubmission,
  getSubmissionsForGroup,
  addAdmin, removeAdmin, isAdmin,
  addToWhitelist, setAccessMode,
  getLeaderboard, getGroupStats,
};
