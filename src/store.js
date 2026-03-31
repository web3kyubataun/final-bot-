/**
 * In-memory store for all bot data.
 * In production, replace with a persistent database (SQLite, MongoDB, etc.)
 */

const store = {
  // groupId -> { sheetId, admins: Set<userId>, accessMode: 'all'|'group'|'whitelist', whitelist: Set<userId>, extraEmails: [] }
  groups: {},

  // userId -> { username, points, twitter, wallet, joinedAt, banned, notifications }
  users: {},

  // taskId -> { id, groupId, title, link, reward, type: 'task'|'raid', createdAt, active }
  tasks: {},

  // submissionId -> { id, userId, username, groupId, taskId, taskTitle, proof, status, points, createdAt }
  submissions: {},

  // userId -> Set<taskId> (to prevent duplicate submissions)
  userSubmissions: {},

  taskCounter: 0,
  submissionCounter: 0,
};

// ── Groups ─────────────────────────────────────────────

function addGroup(groupId, sheetId) {
  if (!store.groups[groupId]) {
    store.groups[groupId] = {
      sheetId,
      admins: new Set(),
      accessMode: 'all',
      whitelist: new Set(),
      extraEmails: [],
    };
  }
  return store.groups[groupId];
}

function getGroup(groupId) {
  return store.groups[groupId] || null;
}

function getAllGroups() {
  return Object.entries(store.groups).map(([id, data]) => ({ id, ...data }));
}

function isGroupRegistered(groupId) {
  return !!store.groups[groupId];
}

// ── Users ─────────────────────────────────────────────

function getOrCreateUser(userId, username) {
  if (!store.users[userId]) {
    store.users[userId] = {
      username: username || 'unknown',
      points: 0,
      twitter: null,
      wallet: null,
      joinedAt: new Date().toISOString(),
      banned: false,
      notifications: true,
    };
  } else if (username) {
    store.users[userId].username = username;
  }
  return store.users[userId];
}

function getUser(userId) {
  return store.users[userId] || null;
}

function getAllUsers() {
  return Object.entries(store.users).map(([id, data]) => ({ id, ...data }));
}

function banUser(userId) {
  const u = store.users[userId];
  if (u) u.banned = true;
}

function unbanUser(userId) {
  const u = store.users[userId];
  if (u) u.banned = false;
}

function addPoints(userId, points) {
  const u = store.users[userId];
  if (u) u.points += points;
}

// ── Tasks ─────────────────────────────────────────────

function createTask(groupId, title, link, reward, type) {
  const id = ++store.taskCounter;
  store.tasks[id] = { id, groupId, title, link, reward: parseInt(reward) || 0, type, createdAt: new Date().toISOString(), active: true };
  return store.tasks[id];
}

function getTask(taskId) {
  return store.tasks[taskId] || null;
}

function getTasksForGroup(groupId, type = null) {
  return Object.values(store.tasks).filter(t => {
    if (t.groupId !== groupId) return false;
    if (type && t.type !== type) return false;
    return t.active;
  });
}

// ── Submissions ────────────────────────────────────────

function createSubmission(userId, username, groupId, taskId, taskTitle, proof, points) {
  const id = ++store.submissionCounter;
  store.submissions[id] = {
    id, userId, username, groupId, taskId, taskTitle,
    proof, status: 'pending', points,
    createdAt: new Date().toISOString(),
  };
  if (!store.userSubmissions[userId]) store.userSubmissions[userId] = new Set();
  store.userSubmissions[userId].add(`${groupId}:${taskId}`);
  return store.submissions[id];
}

function hasSubmitted(userId, groupId, taskId) {
  const key = `${groupId}:${taskId}`;
  return !!(store.userSubmissions[userId] && store.userSubmissions[userId].has(key));
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

// ── Admins ─────────────────────────────────────────────

function addAdmin(groupId, userId) {
  const g = store.groups[groupId];
  if (g) g.admins.add(userId);
}

function removeAdmin(groupId, userId) {
  const g = store.groups[groupId];
  if (g) g.admins.delete(userId);
}

function isAdmin(groupId, userId) {
  const { OWNER_ID } = require('./config');
  if (userId === OWNER_ID) return true;
  const g = store.groups[groupId];
  return g ? g.admins.has(userId) : false;
}

// ── Whitelist ──────────────────────────────────────────

function addToWhitelist(groupId, userId) {
  const g = store.groups[groupId];
  if (g) g.whitelist.add(userId);
}

function setAccessMode(groupId, mode) {
  const g = store.groups[groupId];
  if (g) g.accessMode = mode;
}

// ── Extra Emails ───────────────────────────────────────

function addExtraEmail(groupId, email) {
  const g = store.groups[groupId];
  if (g && !g.extraEmails.includes(email)) g.extraEmails.push(email);
}

// ── Leaderboard ────────────────────────────────────────

function getLeaderboard(limit = 10) {
  return Object.entries(store.users)
    .filter(([, u]) => !u.banned)
    .map(([id, u]) => ({ id, username: u.username, points: u.points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

module.exports = {
  addGroup, getGroup, getAllGroups, isGroupRegistered,
  getOrCreateUser, getUser, getAllUsers, banUser, unbanUser, addPoints,
  createTask, getTask, getTasksForGroup,
  createSubmission, hasSubmitted, getSubmission, approveSubmission, rejectSubmission,
  addAdmin, removeAdmin, isAdmin,
  addToWhitelist, setAccessMode,
  addExtraEmail,
  getLeaderboard,
  store,
};
