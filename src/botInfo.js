let _username = null;

module.exports = {
  getBotUsername: () => _username,
  setBotUsername: (name) => { _username = name; },
};
