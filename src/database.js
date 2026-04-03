const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/bot.db';

let db;

function initDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      name TEXT,
      leaderboard_topic_id INTEGER,
      min_char_limit INTEGER DEFAULT 20,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      twitter_username TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      last_active INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_groups (
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      joined_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, group_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    );

    CREATE TABLE IF NOT EXISTS raids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      link TEXT NOT NULL,
      reward INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raid_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      details TEXT,
      target_username TEXT,
      tweet_id TEXT,
      task_link TEXT,
      min_chars INTEGER DEFAULT 20,
      required_account TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (raid_id) REFERENCES raids(id)
    );

    CREATE TABLE IF NOT EXISTS user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE (user_id, group_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    );

    CREATE TABLE IF NOT EXISTS task_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      raid_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submission_link TEXT,
      verified_at INTEGER,
      submitted_at INTEGER DEFAULT (unixepoch()),
      UNIQUE (user_id, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS raid_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      raid_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      all_tasks_done INTEGER DEFAULT 0,
      points_awarded INTEGER DEFAULT 0,
      completed_at INTEGER,
      UNIQUE (user_id, raid_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (raid_id) REFERENCES raids(id)
    );

    CREATE TABLE IF NOT EXISTS user_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      reason TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      user_id TEXT PRIMARY KEY,
      state TEXT,
      data TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);

  // Safe migrations for existing databases
  const migrations = [
    `ALTER TABLE raids ADD COLUMN description TEXT`,
    `ALTER TABLE tasks ADD COLUMN task_link TEXT`,
    `ALTER TABLE tasks ADD COLUMN min_chars INTEGER DEFAULT 20`,
    `ALTER TABLE users ADD COLUMN last_active INTEGER DEFAULT (unixepoch())`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) {}
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// --- USER ---
function upsertUser(telegramId, username, firstName) {
  const d = getDb();
  d.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_active)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_active = unixepoch()
  `).run(String(telegramId), username || null, firstName || null);
  return d.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
}

function getUserByTelegramId(telegramId) {
  return getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
}

function setUserTwitterUsername(telegramId, twitterUsername) {
  const clean = twitterUsername.replace(/^@/, '').toLowerCase().trim();
  getDb().prepare('UPDATE users SET twitter_username = ? WHERE telegram_id = ?')
    .run(clean, String(telegramId));
}

function checkTwitterUsernameConflict(twitterUsername, telegramId) {
  const clean = twitterUsername.replace(/^@/, '').toLowerCase().trim();
  const existing = getDb().prepare(
    'SELECT * FROM users WHERE LOWER(twitter_username) = ? AND telegram_id != ?'
  ).get(clean, String(telegramId));
  return existing || null;
}

// --- GROUP ---
function upsertGroup(telegramId, name) {
  const d = getDb();
  d.prepare(`
    INSERT INTO groups (telegram_id, name)
    VALUES (?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET name = excluded.name
  `).run(String(telegramId), name || null);
  return d.prepare('SELECT * FROM groups WHERE telegram_id = ?').get(String(telegramId));
}

function getGroupByTelegramId(telegramId) {
  return getDb().prepare('SELECT * FROM groups WHERE telegram_id = ?').get(String(telegramId));
}

function setGroupLeaderboardTopic(telegramId, topicId) {
  getDb().prepare('UPDATE groups SET leaderboard_topic_id = ? WHERE telegram_id = ?')
    .run(topicId, String(telegramId));
}

function setGroupMinCharLimit(telegramId, limit) {
  getDb().prepare('UPDATE groups SET min_char_limit = ? WHERE telegram_id = ?')
    .run(limit, String(telegramId));
}

function linkUserToGroup(userId, groupId) {
  getDb().prepare(`INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)`).run(userId, groupId);
}

function getUserGroups(telegramUserId) {
  const user = getUserByTelegramId(telegramUserId);
  if (!user) return [];
  return getDb().prepare(`
    SELECT g.* FROM groups g
    INNER JOIN user_groups ug ON ug.group_id = g.id
    WHERE ug.user_id = ?
  `).all(user.id);
}

// --- RAIDS ---
function createRaid(groupId, title, description, link, reward, createdBy) {
  const result = getDb().prepare(`
    INSERT INTO raids (group_id, title, description, link, reward, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(groupId, title, description || null, link, reward, String(createdBy));
  return result.lastInsertRowid;
}

function getRaid(raidId) {
  return getDb().prepare('SELECT * FROM raids WHERE id = ?').get(raidId);
}

function getActiveRaids(groupId) {
  return getDb().prepare(`
    SELECT r.*, COUNT(t.id) as task_count
    FROM raids r
    LEFT JOIN tasks t ON t.raid_id = r.id
    WHERE r.group_id = ? AND r.status = 'active'
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all(groupId);
}

function closeRaid(raidId) {
  getDb().prepare("UPDATE raids SET status = 'closed' WHERE id = ?").run(raidId);
}

// --- TASKS ---
function addTask(raidId, platform, type, details, targetUsername, tweetId, taskLink, minChars) {
  const result = getDb().prepare(`
    INSERT INTO tasks (raid_id, platform, type, details, target_username, tweet_id, task_link, min_chars)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    raidId, platform, type,
    details || null,
    targetUsername || null,
    tweetId || null,
    taskLink || null,
    minChars || 20
  );
  return result.lastInsertRowid;
}

function getTasksByRaid(raidId) {
  return getDb().prepare('SELECT * FROM tasks WHERE raid_id = ? ORDER BY id ASC').all(raidId);
}

// --- SUBMISSIONS ---
function upsertTaskSubmission(userId, taskId, raidId, status, submissionLink) {
  const d = getDb();
  const existing = d.prepare('SELECT * FROM task_submissions WHERE user_id = ? AND task_id = ?').get(userId, taskId);
  if (existing) {
    d.prepare(`
      UPDATE task_submissions SET status = ?, submission_link = ?, verified_at = unixepoch()
      WHERE user_id = ? AND task_id = ?
    `).run(status, submissionLink || null, userId, taskId);
  } else {
    d.prepare(`
      INSERT INTO task_submissions (user_id, task_id, raid_id, status, submission_link)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, taskId, raidId, status, submissionLink || null);
  }
}

function getUserTaskSubmission(userId, taskId) {
  return getDb().prepare('SELECT * FROM task_submissions WHERE user_id = ? AND task_id = ?').get(userId, taskId);
}

function getUserRaidSubmissions(userId, raidId) {
  return getDb().prepare('SELECT * FROM task_submissions WHERE user_id = ? AND raid_id = ?').all(userId, raidId);
}

function checkRaidCompletion(userId, raidId) {
  const d = getDb();
  const tasks = d.prepare('SELECT id FROM tasks WHERE raid_id = ?').all(raidId);
  if (tasks.length === 0) return false;
  const done = d.prepare(`
    SELECT COUNT(*) as c FROM task_submissions
    WHERE user_id = ? AND raid_id = ? AND status = 'verified'
  `).get(userId, raidId);
  return done.c >= tasks.length;
}

function awardRaidPoints(userId, raidId, groupId, points) {
  const d = getDb();
  const existing = d.prepare('SELECT * FROM raid_submissions WHERE user_id = ? AND raid_id = ?').get(userId, raidId);
  if (existing && existing.points_awarded) return false;

  d.prepare(`
    INSERT INTO raid_submissions (user_id, raid_id, group_id, all_tasks_done, points_awarded, completed_at)
    VALUES (?, ?, ?, 1, ?, unixepoch())
    ON CONFLICT(user_id, raid_id) DO UPDATE SET
      all_tasks_done = 1, points_awarded = ?, completed_at = unixepoch()
  `).run(userId, raidId, groupId, points, points);

  d.prepare(`
    INSERT INTO user_points (user_id, group_id, points) VALUES (?, ?, ?)
    ON CONFLICT(user_id, group_id) DO UPDATE SET
      points = user_points.points + excluded.points,
      updated_at = unixepoch()
  `).run(userId, groupId, points);

  return true;
}

function getUserCompletedRaidCount(userId) {
  const result = getDb().prepare(
    'SELECT COUNT(*) as c FROM raid_submissions WHERE user_id = ? AND points_awarded > 0'
  ).get(userId);
  return result?.c || 0;
}

// --- LEADERBOARD ---
function getLeaderboard(groupId, limit = 10) {
  return getDb().prepare(`
    SELECT u.username, u.first_name, u.twitter_username, up.points
    FROM user_points up
    INNER JOIN users u ON u.id = up.user_id
    WHERE up.group_id = ?
    ORDER BY up.points DESC
    LIMIT ?
  `).all(groupId, limit);
}

function getUserRank(userId, groupId) {
  return getDb().prepare(`
    SELECT rank FROM (
      SELECT user_id, RANK() OVER (ORDER BY points DESC) as rank
      FROM user_points WHERE group_id = ?
    ) WHERE user_id = ?
  `).get(groupId, userId);
}

function getUserPoints(userId, groupId) {
  return getDb().prepare('SELECT points FROM user_points WHERE user_id = ? AND group_id = ?').get(userId, groupId);
}

// --- WARNINGS ---
function addWarning(userId, groupId, reason) {
  getDb().prepare('INSERT INTO user_warnings (user_id, group_id, reason) VALUES (?, ?, ?)').run(userId, groupId, reason || null);
}

function getWarningCount(userId, groupId) {
  const result = getDb().prepare('SELECT COUNT(*) as c FROM user_warnings WHERE user_id = ? AND group_id = ?').get(userId, groupId);
  return result.c;
}

// --- ADMIN SESSION ---
function setAdminSession(userId, state, data) {
  getDb().prepare(`
    INSERT INTO admin_sessions (user_id, state, data, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = unixepoch()
  `).run(String(userId), state, data ? JSON.stringify(data) : null);
}

function getAdminSession(userId) {
  const row = getDb().prepare('SELECT * FROM admin_sessions WHERE user_id = ?').get(String(userId));
  if (!row) return null;
  return { state: row.state, data: row.data ? JSON.parse(row.data) : {} };
}

function clearAdminSession(userId) {
  getDb().prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(String(userId));
}

module.exports = {
  initDatabase, getDb,
  upsertUser, getUserByTelegramId, setUserTwitterUsername, checkTwitterUsernameConflict,
  upsertGroup, getGroupByTelegramId, setGroupLeaderboardTopic, setGroupMinCharLimit,
  linkUserToGroup, getUserGroups,
  createRaid, getRaid, getActiveRaids, closeRaid,
  addTask, getTasksByRaid,
  upsertTaskSubmission, getUserTaskSubmission, getUserRaidSubmissions,
  checkRaidCompletion, awardRaidPoints, getUserCompletedRaidCount,
  getLeaderboard, getUserRank, getUserPoints,
  addWarning, getWarningCount,
  setAdminSession, getAdminSession, clearAdminSession,
};
