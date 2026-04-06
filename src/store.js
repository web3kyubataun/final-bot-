/**
 * store.js — In-memory data store
 * All data is lost on restart. Use the SQLite system (database.js) for persistence.
 */

const store = {
  groups: {},
  users: {},
  tasks: {},
  submissions: {},
  userSubmissions: {},
  adminContext: {},
  taskCounter: 0,
  submissionCounter: 0,
};

// ═══════════════════════════════════════════════
//  ADMIN CONTEXT
// ═══════════════════════════════════════════════

function setAdminContext(userId, groupId) {
  store.adminContext[String(userId)] = String(groupId);
}

function getAdminContext(userId) {
  return store.adminContext[String(userId)] || null;
}

function clearAdminContext(userId) {
  delete store.adminContext[String(userId)];
}

// ═══════════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════════

function addGroup(groupId, sheetId, ownerId) {
  const gid = String(groupId);
  if (!store.groups[gid]) {
    store.groups[gid] = {
      sheetId: sheetId || 'none',
      ownerId: ownerId ? String(ownerId) : null,
      admins: new Set(),
      accessMode: 'all',           // 'all' | 'group' | 'whitelist'
      whitelist: new Set(),
      extraEmails: [],
      topics: {
        getstarted: null, notifications: null, quests: null,
        raids: null, leaderboard: null, connect: null,
        announcements: null, submissions: null, general: null,
      },
      groupLink: null,
      groupName: null,
      createdAt: new Date().toISOString(),
    };
  }
  return store.groups[gid];
}

function removeGroup(groupId) {
  if (store.groups[String(groupId)]) {
    delete store.groups[String(groupId)];
    return true;
  }
  return false;
}

function getGroup(groupId) {
  return store.groups[String(groupId)] || null;
}

function getAllGroups() {
  return Object.entries(store.groups).map(([id, data]) => ({ id, ...data }));
}

function isGroupRegistered(groupId) {
  return !!store.groups[String(groupId)];
}

function setGroupTopic(groupId, type, topicId) {
  const g = store.groups[String(groupId)];
  if (g) {
    if (!g.topics) g.topics = {};
    g.topics[type] = topicId;
  }
}

function setGroupMeta(groupId, meta) {
  const g = store.groups[String(groupId)];
  if (g) Object.assign(g, meta);
}

function getGroupsForAdmin(userId) {
  const { isOwner } = require('./middleware/auth');
  const uid = String(userId);
  return Object.entries(store.groups)
    .filter(([, g]) => isOwner(userId) || g.admins.has(uid) || g.ownerId === uid)
    .map(([id, g]) => ({ id, name: g.groupName || id, ...g }));
}

// ═══════════════════════════════════════════════
//  WHITELIST MANAGEMENT
// ═══════════════════════════════════════════════

function addToWhitelist(groupId, userId) {
  const g = store.groups[String(groupId)];
  if (g) { g.whitelist.add(String(userId)); return true; }
  return false;
}

function removeFromWhitelist(groupId, userId) {
  const g = store.groups[String(groupId)];
  if (g) { g.whitelist.delete(String(userId)); return true; }
  return false;
}

function isWhitelisted(groupId, userId) {
  const g = store.groups[String(groupId)];
  return g?.whitelist.has(String(userId)) || false;
}

function setAccessMode(groupId, mode) {
  const g = store.groups[String(groupId)];
  if (g) g.accessMode = mode;
}

// ═══════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════

function getOrCreateUser(userId, username) {
  const uid = String(userId);
  if (!store.users[uid]) {
    store.users[uid] = {
      username: username || 'unknown',
      points: 0,
      twitter: null,
      twitterLocked: false,        // once set, user cannot change without admin
      wallet: null,
      discord: null,
      joinedAt: new Date().toISOString(),
      banned: false,
      notifications: true,
    };
  } else if (username) {
    store.users[uid].username = username;
  }
  return store.users[uid];
}

function getUser(userId) {
  return store.users[String(userId)] || null;
}

function getAllUsers() {
  return Object.entries(store.users).map(([id, u]) => ({ id, ...u }));
}

function banUser(userId) {
  const u = store.users[String(userId).replace('@', '')];
  if (u) { u.banned = true; return true; }
  return false;
}

function unbanUser(userId) {
  const u = store.users[String(userId).replace('@', '')];
  if (u) { u.banned = false; return true; }
  return false;
}

function addPoints(userId, points) {
  const u = store.users[String(userId)];
  if (u) u.points = Math.max(0, (u.points || 0) + points);
}

function setUserField(userId, field, value) {
  const user = store.users[String(userId)];
  if (user) user[field] = value;
}

/**
 * Check if a Twitter username is already claimed by another user.
 * @param {string} cleanUsername - lowercase username without @
 * @param {string|number} userId  - the current user's Telegram ID (excluded from check)
 * @returns {object|null} conflicting user object or null
 */
function checkTwitterUsernameConflict(cleanUsername, userId) {
  const uid = String(userId);
  const found = Object.entries(store.users).find(
    ([id, u]) => id !== uid && u.twitter === cleanUsername
  );
  return found ? { id: found[0], ...found[1] } : null;
}

/**
 * Admin-only: force-set a user's Twitter handle (bypasses lock).
 */
function adminSetTwitter(userId, cleanUsername) {
  const u = store.users[String(userId)];
  if (!u) return false;
  u.twitter = cleanUsername;
  u.twitterLocked = true;
  return true;
}

// ═══════════════════════════════════════════════
//  TASKS / RAIDS
// ═══════════════════════════════════════════════

/**
 * Create a task or raid.
 * @param {string} groupId
 * @param {string} title
 * @param {string} link
 * @param {number} reward
 * @param {string} type            'task' | 'raid'
 * @param {string} buttonLabel
 * @param {string} platform        'twitter' | 'telegram'
 * @param {string} taskType        primary task type
 * @param {Array}  taskTypes       array of types for multi-action (or null)
 * @param {number} minChars        min comment chars (0 = no limit)
 * @param {number} durationMinutes raid duration in minutes (1-1440), null for tasks
 */
function createTask(groupId, title, link, reward, type, buttonLabel, platform, taskType, taskTypes, minChars, durationMinutes) {
  const id = ++store.taskCounter;
  const clampedDuration = durationMinutes ? Math.min(Math.max(1, parseInt(durationMinutes) || 60), 1440) : null;
  const expiresAt = (type === 'raid' && clampedDuration)
    ? new Date(Date.now() + clampedDuration * 60 * 1000).toISOString()
    : null;

  store.tasks[id] = {
    id,
    groupId: String(groupId),
    title,
    link: link || '',
    reward: parseInt(reward) || 0,
    type: type || 'task',
    buttonLabel: buttonLabel || null,
    platform: platform || 'twitter',
    taskType: taskType || 'like',
    taskTypes: taskTypes ? JSON.stringify(taskTypes) : null,
    minChars: parseInt(minChars) || 0,
    durationMinutes: clampedDuration,
    expiresAt,
    active: true,
    createdAt: new Date().toISOString(),
  };
  return store.tasks[id];
}

function getTask(taskId) {
  return store.tasks[taskId] || null;
}

function deactivateTask(taskId) {
  const t = store.tasks[taskId];
  if (t) { t.active = false; return true; }
  return false;
}

/**
 * Get active tasks/raids for a group, filtering out expired raids.
 */
function getTasksForGroup(groupId, type) {
  const now = new Date().toISOString();
  return Object.values(store.tasks).filter(t =>
    t.groupId === String(groupId) &&
    t.active &&
    (!type || t.type === type) &&
    (!t.expiresAt || t.expiresAt > now)
  );
}

function getAllTasksForGroup(groupId) {
  return Object.values(store.tasks).filter(t => t.groupId === String(groupId));
}

/**
 * Deactivate all expired raids. Called by scheduler every minute.
 * @returns {number} count of raids deactivated
 */
function deactivateExpiredRaids() {
  const now = new Date().toISOString();
  let count = 0;
  for (const task of Object.values(store.tasks)) {
    if (task.active && task.type === 'raid' && task.expiresAt && task.expiresAt < now) {
      task.active = false;
      count++;
    }
  }
  return count;
}

// ═══════════════════════════════════════════════
//  SUBMISSIONS  (anti-duplicate via userSubmissions map)
// ═══════════════════════════════════════════════

function createSubmission(userId, username, groupId, taskId, taskTitle, proof, points, proofType, proofFileId) {
  const id = ++store.submissionCounter;
  store.submissions[id] = {
    id,
    userId: String(userId),
    username,
    groupId: String(groupId),
    taskId,
    taskTitle,
    proof: proof || '',
    points,
    proofType: proofType || 'text',
    proofFileId: proofFileId || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  // Track per-user per-task completion (groupId:taskId key)
  const key = `${groupId}:${taskId}`;
  if (!store.userSubmissions[String(userId)]) store.userSubmissions[String(userId)] = new Set();
  store.userSubmissions[String(userId)].add(key);
  return store.submissions[id];
}

function hasSubmitted(userId, groupId, taskId) {
  const key = `${groupId}:${taskId}`;
  return !!(store.userSubmissions[String(userId)]?.has(key));
}

function getSubmission(subId) {
  return store.submissions[subId] || null;
}

function approveSubmission(subId) {
  const sub = store.submissions[subId];
  if (sub) sub.status = 'approved';
  return sub;
}

function rejectSubmission(subId) {
  const sub = store.submissions[subId];
  if (sub) sub.status = 'rejected';
  return sub;
}

function getSubmissionsForGroup(groupId, status) {
  return Object.values(store.submissions).filter(
    s => s.groupId === String(groupId) && (!status || s.status === status)
  );
}

// ═══════════════════════════════════════════════
//  ADMIN MANAGEMENT
// ═══════════════════════════════════════════════

function addAdmin(groupId, userId) {
  const g = store.groups[String(groupId)];
  if (g) g.admins.add(String(userId));
}

function removeAdmin(groupId, userId) {
  const g = store.groups[String(groupId)];
  if (g) g.admins.delete(String(userId));
}

function isAdmin(groupId, userId) {
  const g = store.groups[String(groupId)];
  return !!g?.admins.has(String(userId));
}

// ═══════════════════════════════════════════════
//  LEADERBOARD & STATS
// ═══════════════════════════════════════════════

function getLeaderboard(limit = 10) {
  return Object.entries(store.users)
    .map(([id, u]) => ({ id, username: u.username, points: u.points || 0, banned: u.banned }))
    .filter(u => !u.banned)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

function getGroupStats(groupId) {
  const gid = String(groupId);
  const tasks = Object.values(store.tasks).filter(t => t.groupId === gid);
  const subs  = Object.values(store.submissions).filter(s => s.groupId === gid);
  const users = Object.values(store.users);
  const now   = new Date().toISOString();
  return {
    activeTasks:         tasks.filter(t => t.active && t.type === 'task').length,
    totalTasks:          tasks.filter(t => t.type === 'task').length,
    activeRaids:         tasks.filter(t => t.active && t.type === 'raid' && (!t.expiresAt || t.expiresAt > now)).length,
    totalRaids:          tasks.filter(t => t.type === 'raid').length,
    pendingSubmissions:  subs.filter(s => s.status === 'pending').length,
    approvedSubmissions: subs.filter(s => s.status === 'approved').length,
    rejectedSubmissions: subs.filter(s => s.status === 'rejected').length,
    totalUsers:          users.length,
    bannedUsers:         users.filter(u => u.banned).length,
  };
}

module.exports = {
  setAdminContext, getAdminContext, clearAdminContext,
  addGroup, removeGroup, getGroup, getAllGroups, isGroupRegistered,
  setGroupTopic, setGroupMeta, getGroupsForAdmin,
  addToWhitelist, removeFromWhitelist, isWhitelisted, setAccessMode,
  getOrCreateUser, getUser, getAllUsers, banUser, unbanUser, addPoints,
  setUserField, checkTwitterUsernameConflict, adminSetTwitter,
  createTask, getTask, deactivateTask, getTasksForGroup, getAllTasksForGroup, deactivateExpiredRaids,
  createSubmission, hasSubmitted, getSubmission, approveSubmission, rejectSubmission,
  getSubmissionsForGroup,
  addAdmin, removeAdmin, isAdmin,
  getLeaderboard, getGroupStats,
};
