/**
 * store.js — In-memory data store
 * Replace with SQLite/MongoDB for persistence across restarts.
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
      accessMode: 'all',
      whitelist: new Set(),
      extraEmails: [],
      topics: {
        getstarted: null, notifications: null, tasks: null,
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

/** Returns true if the group has at least one topic configured */
function groupHasTopics(groupId) {
  const g = store.groups[String(groupId)];
  if (!g || !g.topics) return false;
  return Object.values(g.topics).some(v => v !== null && v !== undefined);
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
      twitterLocked: false,
      wallet: null,
      discord: null,
      collectedInfo: {},
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

/**
 * Set Twitter username and lock it — user cannot change it after this.
 * Returns false if already locked.
 */
function setUserTwitter(userId, twitter) {
  const u = store.users[String(userId)];
  if (!u) return false;
  if (u.twitterLocked) return false;
  u.twitter = twitter;
  u.twitterLocked = true;
  return true;
}

/**
 * Admin override: change a user's Twitter username regardless of lock.
 */
function adminSetUserTwitter(userId, twitter) {
  const uid = String(userId).replace('@', '');
  const u = store.users[uid];
  if (!u) return false;
  u.twitter = twitter;
  u.twitterLocked = true;
  return true;
}

/**
 * Store additional info collected by admin via Collect Info flow.
 */
function setCollectedInfo(userId, key, value) {
  const u = store.users[String(userId)];
  if (!u) return false;
  if (!u.collectedInfo) u.collectedInfo = {};
  u.collectedInfo[key] = value;
  return true;
}

// ═══════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════

function createTask(groupId, title, link, reward, type, buttonLabel, platform, taskType, timeLimitMinutes) {
  store.taskCounter++;
  const id = store.taskCounter;
  const expiresAt = timeLimitMinutes && timeLimitMinutes > 0
    ? new Date(Date.now() + timeLimitMinutes * 60 * 1000).toISOString()
    : null;
  store.tasks[id] = {
    id, groupId: String(groupId), title, link: link || '',
    reward: reward || 0, type: type || 'task',
    buttonLabel: buttonLabel || '', platform: platform || 'twitter',
    taskType: taskType || 'follow', active: true,
    createdAt: new Date().toISOString(),
    timeLimitMinutes: timeLimitMinutes || null,
    expiresAt,
  };
  return store.tasks[id];
}

function getTask(taskId) {
  const t = store.tasks[String(taskId)];
  if (!t) return null;
  if (t.active && t.expiresAt && new Date() > new Date(t.expiresAt)) {
    t.active = false;
  }
  return t;
}

function deactivateTask(taskId) {
  const t = store.tasks[String(taskId)];
  if (t) { t.active = false; return true; }
  return false;
}

function getTasksForGroup(groupId, type) {
  return Object.values(store.tasks).filter(t => {
    if (t.groupId !== String(groupId)) return false;
    if (t.active && t.expiresAt && new Date() > new Date(t.expiresAt)) t.active = false;
    if (!t.active) return false;
    if (type) return t.type === type;
    return true;
  });
}

function getAllTasksForGroup(groupId) {
  return Object.values(store.tasks).filter(t => t.groupId === String(groupId));
}

// ═══════════════════════════════════════════════
//  SUBMISSIONS
// ═══════════════════════════════════════════════

function createSubmission(userId, username, groupId, taskId, taskTitle, proof, points, proofType, photoId) {
  store.submissionCounter++;
  const id = store.submissionCounter;
  store.submissions[id] = {
    id, userId: String(userId), username, groupId: String(groupId),
    taskId, taskTitle, proof, points, proofType, photoId,
    status: 'approved', createdAt: new Date().toISOString(),
  };
  const key = `${userId}_${groupId}_${taskId}`;
  store.userSubmissions[key] = id;
  return store.submissions[id];
}

function hasSubmitted(userId, groupId, taskId) {
  const key = `${userId}_${groupId}_${taskId}`;
  return !!store.userSubmissions[key];
}

function getSubmission(subId) {
  return store.submissions[String(subId)] || null;
}

function approveSubmission(subId) {
  const s = store.submissions[String(subId)];
  if (s) { s.status = 'approved'; return true; }
  return false;
}

function rejectSubmission(subId) {
  const s = store.submissions[String(subId)];
  if (s) { s.status = 'rejected'; return true; }
  return false;
}

function getSubmissionsForGroup(groupId) {
  return Object.values(store.submissions).filter(s => s.groupId === String(groupId));
}

// ═══════════════════════════════════════════════
//  ACCESS
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
  return g ? g.admins.has(String(userId)) : false;
}

function addToWhitelist(groupId, userId) {
  const g = store.groups[String(groupId)];
  if (g) g.whitelist.add(String(userId));
}

function setAccessMode(groupId, mode) {
  const g = store.groups[String(groupId)];
  if (g) g.accessMode = mode;
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
