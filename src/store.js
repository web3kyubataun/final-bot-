/**
 * store.js — Persistent data store backed by JSON file.
 * Groups, users, tasks, and submissions survive restarts.
 */

const { getData, mutate } = require('./db/jsonStore');

// In-memory admin context (session state, no need to persist)
const _adminContext = {};

// ═══════════════════════════════════════════════
// ADMIN CONTEXT
// ═══════════════════════════════════════════════

function setAdminContext(userId, groupId) {
 _adminContext[String(userId)] = String(groupId);
}

function getAdminContext(userId) {
 return _adminContext[String(userId)] || null;
}

function clearAdminContext(userId) {
 delete _adminContext[String(userId)];
}

// ═══════════════════════════════════════════════
// GROUPS
// ═══════════════════════════════════════════════

function addGroup(groupId, sheetId, ownerId) {
 const gid = String(groupId);
 mutate(d => {
 if (!d.groups[gid]) {
 d.groups[gid] = {
 sheetId: sheetId || 'none',
 ownerId: ownerId ? String(ownerId) : null,
 admins: [],
 accessMode: 'all',
 whitelist: [],
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
 });
 return getData().groups[gid];
}

function removeGroup(groupId) {
 let found = false;
 mutate(d => {
 if (d.groups[String(groupId)]) {
 delete d.groups[String(groupId)];
 found = true;
 }
 });
 return found;
}

function getGroup(groupId) {
 return getData().groups[String(groupId)] || null;
}

function getAllGroups() {
 return Object.entries(getData().groups).map(([id, data]) => ({ id, ...data }));
}

function isGroupRegistered(groupId) {
 return !!getData().groups[String(groupId)];
}

function setGroupTopic(groupId, type, topicId) {
 mutate(d => {
 const g = d.groups[String(groupId)];
 if (g) {
 if (!g.topics) g.topics = {};
 g.topics[type] = topicId;
 }
 });
}

function setGroupMeta(groupId, meta) {
 mutate(d => {
 const g = d.groups[String(groupId)];
 if (g) Object.assign(g, meta);
 });
}

function getGroupsForAdmin(userId) {
 const { isOwner } = require('./middleware/auth');
 const uid = String(userId);
 return getAllGroups().filter(g =>
 isOwner(userId) || (g.admins || []).includes(uid) || g.ownerId === uid
 ).map(g => ({ ...g, name: g.groupName || g.id }));
}

// ═══════════════════════════════════════════════
// WHITELIST MANAGEMENT
// ═══════════════════════════════════════════════

function addToWhitelist(groupId, userId) {
 let ok = false;
 mutate(d => {
 const g = d.groups[String(groupId)];
 if (g) {
 if (!g.whitelist) g.whitelist = [];
 if (!g.whitelist.includes(String(userId))) g.whitelist.push(String(userId));
 ok = true;
 }
 });
 return ok;
}

function removeFromWhitelist(groupId, userId) {
 let ok = false;
 mutate(d => {
 const g = d.groups[String(groupId)];
 if (g && g.whitelist) {
 g.whitelist = g.whitelist.filter(id => id !== String(userId));
 ok = true;
 }
 });
 return ok;
}

function isWhitelisted(groupId, userId) {
 const g = getData().groups[String(groupId)];
 return (g?.whitelist || []).includes(String(userId));
}

function setAccessMode(groupId, mode) {
 mutate(d => {
 const g = d.groups[String(groupId)];
 if (g) g.accessMode = mode;
 });
}

// ═══════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════

function getOrCreateUser(userId, username) {
 const uid = String(userId);
 const d = getData();
 if (!d.users[uid]) {
 mutate(dd => {
 dd.users[uid] = {
 username: username || 'unknown',
 firstName: null,
 points: 0,
 twitter: null,
 twitterLocked: false,
 wallet: null,
 discord: null,
 joinedAt: new Date().toISOString(),
 banned: false,
 notifications: true,
 tasksCompleted: 0,
 raidsCompleted: 0,
 };
 });
 } else if (username) {
 mutate(dd => {
 if (dd.users[uid]) dd.users[uid].username = username;
 });
 }
 return getData().users[uid];
}

function getUser(userId) {
 return getData().users[String(userId)] || null;
}

function getAllUsers() {
 return Object.entries(getData().users).map(([id, u]) => ({ id, ...u }));
}

function banUser(userId) {
 let ok = false;
 mutate(d => {
 const u = d.users[String(userId).replace('@', '')];
 if (u) { u.banned = true; ok = true; }
 });
 return ok;
}

function unbanUser(userId) {
 let ok = false;
 mutate(d => {
 const u = d.users[String(userId).replace('@', '')];
 if (u) { u.banned = false; ok = true; }
 });
 return ok;
}

function addPoints(userId, points) {
 mutate(d => {
 const u = d.users[String(userId)];
 if (u) u.points = Math.max(0, (u.points || 0) + points);
 });
}

function setUserField(userId, field, value) {
 mutate(d => {
 const u = d.users[String(userId)];
 if (u) u[field] = value;
 });
}

function checkTwitterUsernameConflict(cleanUsername, userId) {
 const uid = String(userId);
 const found = Object.entries(getData().users).find(
 ([id, u]) => id !== uid && u.twitter === cleanUsername
 );
 return found ? { id: found[0], ...found[1] } : null;
}

function adminSetTwitter(userId, cleanUsername) {
 let ok = false;
 mutate(d => {
 const u = d.users[String(userId)];
 if (u) { u.twitter = cleanUsername; u.twitterLocked = true; ok = true; }
 });
 return ok;
}

// ═══════════════════════════════════════════════
// TASKS / RAIDS
// ═══════════════════════════════════════════════

function createTask(groupId, title, link, reward, type, buttonLabel, platform, taskType, taskTypes, minChars, durationMinutes) {
 let newTask;
 mutate(d => {
 const id = ++d.taskCounter;
 const clampedDuration = durationMinutes ? Math.min(Math.max(1, parseInt(durationMinutes) || 60), 1440) : null;
 const expiresAt = (type === 'raid' && clampedDuration)
 ? new Date(Date.now() + clampedDuration * 60 * 1000).toISOString()
 : null;

 d.tasks[id] = {
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
 newTask = d.tasks[id];
 });
 return newTask;
}

function getTask(taskId) {
 return getData().tasks[taskId] || null;
}

function deactivateTask(taskId) {
 let ok = false;
 mutate(d => {
 const t = d.tasks[taskId];
 if (t) { t.active = false; ok = true; }
 });
 return ok;
}

function getTasksForGroup(groupId, type) {
 const now = new Date().toISOString();
 return Object.values(getData().tasks).filter(t =>
 t.groupId === String(groupId) &&
 t.active &&
 (!type || t.type === type) &&
 (!t.expiresAt || t.expiresAt > now)
 );
}

function getAllTasksForGroup(groupId) {
 return Object.values(getData().tasks).filter(t => t.groupId === String(groupId));
}

function deactivateExpiredRaids() {
 const now = new Date().toISOString();
 let count = 0;
 mutate(d => {
 for (const task of Object.values(d.tasks)) {
 if (task.active && task.type === 'raid' && task.expiresAt && task.expiresAt < now) {
 task.active = false;
 count++;
 }
 }
 });
 return count;
}

// ═══════════════════════════════════════════════
// SUBMISSIONS
// ═══════════════════════════════════════════════

function createSubmission(userId, username, groupId, taskId, taskTitle, proof, points, proofType, proofFileId, initialStatus) {
 let newSub;
 mutate(d => {
 const id = ++d.submissionCounter;
 d.submissions[id] = {
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
 status: initialStatus || 'pending',
 createdAt: new Date().toISOString(),
 };
 const key =`${groupId}:${taskId}`;
 if (!d.userSubmissions[String(userId)]) d.userSubmissions[String(userId)] = [];
 if (!d.userSubmissions[String(userId)].includes(key)) {
 d.userSubmissions[String(userId)].push(key);
 }
 newSub = d.submissions[id];
 });
 return newSub;
}

function hasSubmitted(userId, groupId, taskId) {
 const key =`${groupId}:${taskId}`;
 const subs = getData().userSubmissions[String(userId)] || [];
 return subs.includes(key);
}

function getSubmission(subId) {
 return getData().submissions[subId] || null;
}

function approveSubmission(subId) {
 let sub;
 mutate(d => {
 const s = d.submissions[subId];
 if (s && s.status === 'pending') { s.status = 'approved'; sub = s; }
 });
 return sub || null;
}

function rejectSubmission(subId) {
 let sub;
 mutate(d => {
 const s = d.submissions[subId];
 if (s && s.status === 'pending') { s.status = 'rejected'; sub = s; }
 });
 return sub || null;
}

function getSubmissionsForGroup(groupId, status) {
 return Object.values(getData().submissions).filter(
 s => s.groupId === String(groupId) && (!status || s.status === status)
 );
}

// ═══════════════════════════════════════════════
// ADMIN MANAGEMENT
// ═══════════════════════════════════════════════

function addAdmin(groupId, userId) {
 mutate(d => {
 const g = d.groups[String(groupId)];
 if (g) {
 if (!g.admins) g.admins = [];
 if (!g.admins.includes(String(userId))) g.admins.push(String(userId));
 }
 });
}

function removeAdmin(groupId, userId) {
 mutate(d => {
 const g = d.groups[String(groupId)];
 if (g && g.admins) {
 g.admins = g.admins.filter(id => id !== String(userId));
 }
 });
}

function isAdmin(groupId, userId) {
 const g = getData().groups[String(groupId)];
 return (g?.admins || []).includes(String(userId));
}

// ═══════════════════════════════════════════════
// LEADERBOARD & STATS
// ═══════════════════════════════════════════════

function getLeaderboard(limit = 10) {
 return Object.entries(getData().users)
 .map(([id, u]) => ({ id, username: u.username, points: u.points || 0, twitter: u.twitter, banned: u.banned }))
 .filter(u => !u.banned)
 .sort((a, b) => b.points - a.points)
 .slice(0, limit);
}

function getGroupStats(groupId) {
 const gid = String(groupId);
 const d = getData();
 const tasks = Object.values(d.tasks).filter(t => t.groupId === gid);
 const subs = Object.values(d.submissions).filter(s => s.groupId === gid);
 const users = Object.values(d.users);
 const now = new Date().toISOString();
 return {
 activeTasks: tasks.filter(t => t.active && t.type === 'task').length,
 totalTasks: tasks.filter(t => t.type === 'task').length,
 activeRaids: tasks.filter(t => t.active && t.type === 'raid' && (!t.expiresAt || t.expiresAt > now)).length,
 totalRaids: tasks.filter(t => t.type === 'raid').length,
 pendingSubmissions: subs.filter(s => s.status === 'pending').length,
 approvedSubmissions: subs.filter(s => s.status === 'approved').length,
 rejectedSubmissions: subs.filter(s => s.status === 'rejected').length,
 totalUsers: users.length,
 bannedUsers: users.filter(u => u.banned).length,
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
