/**
 * Session state for multi-step input flows.
 * Tracks what input the bot is waiting for from each user/admin.
 */

const sessions = {};

function setSession(userId, data) {
  sessions[userId] = data;
}

function getSession(userId) {
  return sessions[userId] || null;
}

function clearSession(userId) {
  delete sessions[userId];
}

module.exports = { setSession, getSession, clearSession };
