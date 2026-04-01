/**
 * In-memory store — replace with SQLite/MongoDB for persistence
 */

const store = {
  groups: {},
  users: {},
  tasks: {},
  submissions: {},
  userSubmissions: {},
  adminContext: {},   // userId -> groupId (which group each admin is currently managing in DM)
  taskCounter: 0,
  submissionCounter: 0,
};

// ═══════════════════════════════════════════════
//  ADMIN CONTEXT (for DM-based admin control)
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

/** Get groups where userId is admin or owner */
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
  return Object.entries(store.users).map(([id, data]) => ({ id, ...data }));
}

function banUser(userId) {
  const u = store.users[String(userId)];
  if (u) { u.banned = true; return true; }
  return false;
}

function unbanUser(userId) {
  const u = store.users[String(userId)];
  if (u) { u.banned = false; return true; }
  return false;
}

function addPoints(userId, points) {
  const u = store.users[String(userId)];
  if (u) u.points = Math.max(0, (u.points || 0) + points);
}

// ═══════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════

function createTask(groupId, title, link, reward, type, buttonLabel) {
  const id = ++store.taskCounter;
  store.tasks[id] = {
    id,
    groupId: String(groupId),
    title,
    link,
    reward: parseInt(reward) || 0,
    type,
    buttonLabel: buttonLabel || null,
    createdAt: new Date().toISOString(),
    active: true,
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

function getTasksForGroup(groupId, type = null) {
  return Object.values(store.tasks).filter(t => {
    if (t.groupId !== String(groupId)) return false;
    if (type && t.type !== type) return false;
    return t.active;
  });
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
    proof,
    proofType: proofType || 'text', // 'text' | 'photo'
    proofFileId: proofFileId || null,
    status: 'pending',
    points,
    createdAt: new Date().toISOString(),
  };
  const uid = String(userId);
  if (!store.userSubmissions[uid]) store.userSubmissions[uid] = new Set();
  store.userSubmissions[uid].add(`${groupId}:${taskId}`);
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

function getSubmissionsForGroup(groupId, status = null) {
  return Object.values(store.submissions).filter(s => {
    if (s.groupId !== String(groupId)) return false;
    if (status && s.status !== status) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════
//  ADMINS
// ═══════════════════════════════════════════════

function addAdmin(groupId, userId) {
  const g = store.groups[String(groupId)];
  if (g) { g.admins.add(String(userId)); return true; }
  return false;
}

function removeAdmin(groupId, userId) {
  const g = store.groups[String(groupId)];
  if (g) { g.admins.delete(String(userId)); return true; }
  return false;
}

function isAdmin(groupId, userId) {
  const { isOwner } = require('./middleware/auth');
  if (isOwner(userId)) return true;
  const g = store.groups[String(groupId)];
  return g ? g.admins.has(String(userId)) : false;
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
    .filter(([, u]) => !u.banned)
    .map(([id, u]) => ({ id, username: u.username, points: u.points || 0 }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

function getGroupStats(groupId) {
  const tasks = getAllTasksForGroup(groupId);
  const subs = getSubmissionsForGroup(groupId);
  return {
    totalTasks: tasks.filter(t => t.type === 'task').length,
    totalRaids: tasks.filter(t => t.type === 'raid').length,
    activeTasks: tasks.filter(t => t.active && t.type === 'task').length,
    activeRaids: tasks.filter(t => t.active && t.type === 'raid').length,
    totalSubmissions: subs.length,
    pendingSubmissions: subs.filter(s => s.status === 'pending').length,
    approvedSubmissions: subs.filter(s => s.status === 'approved').length,
    rejectedSubmissions: subs.filter(s => s.status === 'rejected').length,
    totalUsers: getAllUsers().length,
    bannedUsers: getAllUsers().filter(u => u.banned).length,
  };
}

module.exports = {
  store,
  setAdminContext, getAdminContext, clearAdminContext,
  addGroup, removeGroup, getGroup, getAllGroups, isGroupRegistered,
  setGroupTopic, setGroupMeta, getGroupsForAdmin,
  getOrCreateUser, getUser, getAllUsers, banUser, unbanUser, addPoints,
  createTask, getTask, deactivateTask, getTasksForGroup, getAllTasksForGroup,
  createSubmission, hasSubmitted, getSubmission, approveSubmission, rejectSubmission,
  getSubmissionsForGroup,
  addAdmin, removeAdmin, isAdmin,
  addToWhitelist, setAccessMode,
  getLeaderboard, getGroupStats,
};
