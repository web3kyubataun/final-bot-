/**
 * In-memory store — replace with SQLite/MongoDB for persistence
 */

const store = {
  groups: {},       // groupId -> group object
  users: {},        // userId -> user object
  tasks: {},        // taskId -> task object
  submissions: {},  // subId -> submission object
  userSubmissions: {}, // userId -> Set of "groupId:taskId"
  taskCounter: 0,
  submissionCounter: 0,
};

// ═══════════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════════

function addGroup(groupId, sheetId, ownerId) {
  if (!store.groups[groupId]) {
    store.groups[groupId] = {
      sheetId: sheetId || 'none',
      ownerId: ownerId || null,
      admins: new Set(),
      accessMode: 'all',       // 'all' | 'group' | 'whitelist'
      whitelist: new Set(),
      extraEmails: [],
      topics: {                 // Forum topic IDs
        getstarted: null,
        notifications: null,
        quests: null,
        leaderboard: null,
        connect: null,
        general: null,
        raids: null,
        announcements: null,
        submissions: null,
      },
      groupLink: null,
      groupName: null,
      createdAt: new Date().toISOString(),
    };
  }
  return store.groups[groupId];
}

function removeGroup(groupId) {
  if (store.groups[groupId]) {
    delete store.groups[groupId];
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
  const { OWNER_ID } = require('./config');
  return Object.entries(store.groups)
    .filter(([, g]) => g.admins.has(userId) || g.ownerId === userId || userId === OWNER_ID)
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
    type, // 'task' | 'raid'
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

function createSubmission(userId, username, groupId, taskId, taskTitle, proof, points) {
  const id = ++store.submissionCounter;
  store.submissions[id] = {
    id,
    userId: String(userId),
    username,
    groupId: String(groupId),
    taskId,
    taskTitle,
    proof,
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
  const { OWNER_ID } = require('./config');
  if (String(userId) === String(OWNER_ID)) return true;
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
//  LEADERBOARD
// ═══════════════════════════════════════════════

function getLeaderboard(limit = 10) {
  return Object.entries(store.users)
    .filter(([, u]) => !u.banned)
    .map(([id, u]) => ({ id, username: u.username, points: u.points || 0 }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

// ═══════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════

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
