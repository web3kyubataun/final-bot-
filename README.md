# Telegram Task/Raid Bot

A fully-featured Telegram bot for community management — tasks, raids, XP leaderboard, user info collection, and Google Sheets integration.

---

## Features

- ✅ Group membership gating (users must join your group)
- 🎯 Task & ⚡ Raid system with custom content + action buttons
- 🏆 XP leaderboard
- 📋 Info collection (Twitter, Discord, Wallet, etc.) → Google Sheets
- 📤 Proof submission with admin approval/rejection
- 📢 Broadcast announcements to all users
- 🚫 Ban / Unban users
- ⚙️ Multi-admin support
- 🔔 All admins notified on submissions

---

## Setup

### 1. Clone / Download

```bash
git clone <your-repo-url>
cd telegram-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure `.env`

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=your_telegram_bot_token
ADMIN_IDS=123456789,987654321        # comma-separated Telegram user IDs
GROUP_ID=-1001234567890              # your Telegram group ID (negative number)
GROUP_LINK=https://t.me/yourgroupusername
GOOGLE_SHEET_ID=your_sheet_id_from_url
GOOGLE_WORKSHEET=Submissions
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

### 4. Google Sheets Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable **Google Sheets API**
3. IAM & Admin → Service Accounts → Create service account
4. Create a JSON key → Download it
5. Copy the **entire JSON content** as one line into `GOOGLE_SERVICE_ACCOUNT_JSON`
6. Open your Google Sheet → Share it with the service account email (Editor access)

### 5. Run the bot

```bash
node src/index.js
```

---

## Deployment

### Railway

1. Push to GitHub
2. New project on [Railway](https://railway.app) → Deploy from GitHub
3. Add all environment variables from your `.env` in Railway's Variables tab
4. Done — Railway auto-restarts on crashes

### Render

1. Push to GitHub
2. New **Web Service** on [Render](https://render.com)
3. Build command: `npm install`
4. Start command: `node src/index.js`
5. Add environment variables in the Environment tab

---

## Admin Guide

### Creating a Task or Raid

1. Open the bot → ⚙️ Admin Panel → ➕ Create Task (or ⚡ Post Raid)
2. **Step 1** — Write the full message users will see (use bold, emojis, any formatting)
3. **Step 2** — Enter the XP reward (number)
4. **Step 3** — Enter the button: `Button Label | https://your-link.com`
   - Example: `Like & Comment | https://twitter.com/post`
   - Type `none` if no button needed

The task is instantly broadcast to all users with your content + a Submit Proof button.

### Collecting User Info

1. Admin Panel → 📝 Collect User Info
2. Enter a title (e.g. `Airdrop Registration`)
3. Enter fields comma-separated (e.g. `Twitter, Discord, Wallet Address`)
4. Enter XP reward

A "Submit My Info" button appears for all users. Submissions go to Google Sheets automatically.

To stop collecting: Admin Panel → 🗑 Close Collect Task

### Adding More Admins

Edit `.env` and add their Telegram user ID to `ADMIN_IDS`:

```env
ADMIN_IDS=6379409064,1907472686,NEW_ID_HERE
```

Restart the bot. New admin can immediately use the Admin Panel.

To find a user's ID: have them message [@userinfobot](https://t.me/userinfobot)

---

## File Structure

```
telegram-bot/
├── src/
│   ├── index.js      # Main bot logic
│   ├── store.js      # In-memory storage
│   ├── keyboards.js  # All inline keyboards
│   └── sheets.js     # Google Sheets integration
├── .env              # Your config (never commit this)
├── .env.example      # Template for new deployments
├── package.json
└── README.md
```

---

## Notes

- Data is in-memory — it resets when the bot restarts. For persistence, add a database.
- The bot uses polling (no webhook needed) — works on any server.
