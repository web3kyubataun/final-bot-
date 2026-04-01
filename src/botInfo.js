// Stores bot username after launch — set from index.js
let botUsername = '';

function setBotUsername(username) {
  botUsername = username;
}

function getBotUsername() {
  return botUsername;
}

module.exports = { setBotUsername, getBotUsername };
