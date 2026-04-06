const sessions = {};

module.exports = {
 getSession: (userId) => sessions[String(userId)] || null,
 setSession: (userId, data) => { sessions[String(userId)] = data; },
 clearSession: (userId) => { delete sessions[String(userId)]; },
};
