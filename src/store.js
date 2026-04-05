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
//  USERS
// ═══════════════════════════════════════════════

function getOrCreateUser(userId, username) {
  const uid = String(userId);
  if (!store.users[uid]) {
    store.users[uid] = {
      username: username || 'unknown',
      points: 0,
      twitter: null,
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

// ═══════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════

/**
 * platform: 'twitter' | 'telegram'
 * taskType: 'like' | 'retweet' | 'follow' | 'comment' | 'quote'
 *           'join' | 'react' | 'send'
 */
function createTask(groupId, title, link, reward, type, buttonLabel, platform, taskType, taskTypes, minChars) {
  const id = ++store.taskCounter;
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

function getTasksForGroup(groupId, type) {
  return Object.values(store.tasks).filter(
    t => t.groupId === String(groupId) && t.active && (!type || t.type === type)
  );
}

function getAllTasksForGroup(groupId) {
  return Object.values(store.tasks).filter(t => t.groupId === String(groupId));
}

// ═══════════════════════════════════════════════
//  SUBMISSIONS
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
//  ACCESS CONTROL
// ═══════════════════════════════════════════════

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
  setGroupTopic, setGroupMeta, getGroupsForAdmin,
  getOrCreateUser, getUser, getAllUsers, banUser, unbanUser, addPoints,
  createTask, getTask, setUserField, deactivateTask, getTasksForGroup, getAllTasksForGroup,
  createSubmission, hasSubmitted, getSubmission, approveSubmission, rejectSubmission,
  getSubmissionsForGroup,
  addAdmin, removeAdmin, isAdmin,
  addToWhitelist, setAccessMode,
  getLeaderboard, getGroupStats,
};
