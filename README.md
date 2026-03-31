# Telegram Premium Bot — Group Automation + Task + Raid System

A fully-featured, production-ready Telegram bot built with Telegraf.js.  
Multi-group support, forum topic routing, RoseBot-style admin panel, Google Sheets integration, and a full approval workflow.

---

## Features

- **Multi-group support** — each group gets its own Google Sheet
- **Forum Topics** — auto-create or manually assign channels for raids, tasks, notifications, leaderboard, etc.
- **Task & Raid system** — create campaigns with inline buttons and proof submission
- **Google Sheets** — auto-creates a sheet per group, logs submissions + user data
- **Approval workflow** — admins get DM notifications with ✅ Approve / ❌ Reject buttons
- **RoseBot-style admin panel** — full inline keyboard panel with sections
- **Leaderboard** — points-based ranking with visual bar chart
- **Access control** — all users / group members only / whitelist modes
- **Ban/Unban** — block users from the bot
- **Broadcast & Announce** — DM all users or post in the group's announcements topic
- **Twitter/X verification** — validates tweet URLs (+ API verification if bearer token set)
- **Notification control** — users toggle DM notifications on/off
- **Group setup guide** — `/setup` command walks admins through configuration

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=your_bot_token_from_BotFather
BOT_OWNER_ID=your_telegram_user_id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
DEFAULT_SHARE_EMAIL=you@gmail.com
```

### 3. Google Sheets setup

1. [Google Cloud Console](https://console.cloud.google.com/) → New Project
2. Enable **Google Sheets API** and **Google Drive API**
3. IAM → Service Accounts → Create → Add key → JSON
4. Open the downloaded JSON, paste the **entire file content** (as one line) into `GOOGLE_SERVICE_ACCOUNT_JSON`

### 4. Run the bot

```bash
node src/index.js
# Or with auto-reload:
npx nodemon src/index.js
```

---

## Setup Flow (First Time)

1. **Add the bot to your group** (make it an admin)
2. **Register the group** — run `/addgroup` directly in the group (owner only)
3. **Open admin panel** — run `/admin` in the group
4. **Follow `/setup`** — step-by-step guide inside the group
5. **Enable Forum Topics** (optional) — Group Settings → Topics → Enable → run `/autotopics`
6. **Add admins** — `/addadmin <userId>` in the group
7. **Create tasks** — use the admin panel `📝 Create Task` button

---

## Commands Reference

### 👑 Owner Commands (you only)

| Command | Description |
|---------|-------------|
| `/addgroup` | Register the group (run inside the group OR `/addgroup -1001234567` from DM) |
| `/removegroup` | Remove a group (run inside group or `/removegroup -1001234567` from DM) |
| `/listgroups` | List all registered groups |
| `/broadcast <message>` | DM all bot users |
| `/ownerhelp` | Show all owner commands |

### 🛠️ Admin Commands

| Command | Description |
|---------|-------------|
| `/admin` | Open the full inline admin panel |
| `/setup` | Step-by-step group setup guide |
| `/stats` | Group statistics |
| `/autotopics` | Auto-create all forum topics in the group |
| `/settopic <type> <id>` | Manually set a forum topic ID |
| `/listtopics` | Show all topic assignments |
| `/postwelcome` | Post welcome message in Get Started topic |
| `/setmode all\|group\|whitelist` | Set who can use the bot |
| `/addadmin <userId>` | Add a group admin |
| `/removeadmin <userId>` | Remove a group admin |

**Admin Panel Sections** (all via `/admin` inline buttons):
- 📋 **Campaigns** — Create Task, Create Raid, View Tasks, Delete Task
- 📬 **Submissions** — View Pending / Approved / Rejected
- 📢 **Broadcast** — Announce to group, DM all users
- 👤 **Users** — View users, Ban, Unban, Add/Remove admins
- 🔐 **Access Control** — All / Group Only / Whitelist
- ⚙️ **Setup** — Set topics, Add email, Group stats, Set group link

### 👤 User Commands

All user interaction is through the bottom keyboard menu:
- 🎯 **Tasks** — View and submit tasks
- ⚡ **Raids** — View and join raids
- 🏆 **Leaderboard** — Top earners
- 👤 **My Profile** — Stats, points, rank
- ⚙️ **Settings** — Twitter, Wallet, Discord, Notifications
- ❓ **Help** — How to use the bot

---

## Forum Topic Types

When you run `/autotopics` or `/settopic`, these types are available:

| Type | Topic Name | Purpose |
|------|-----------|---------|
| `getstarted` | 🚀 Get Started | Onboarding, `/postwelcome` posts here |
| `notifications` | 🔔 Notifications | New task/raid alerts |
| `quests` | 🎯 Quests | Active task cards |
| `raids` | ⚡ Raids | Active raid cards |
| `leaderboard` | 🏆 Leaderboard | Leaderboard posts |
| `connect` | 🐦 Connect Twitter | Twitter linking |
| `announcements` | 📢 Announcements | Admin broadcasts |
| `submissions` | 📋 Submissions | Submission review |
| `general` | 💬 General | General chat |

To manually set a topic: `/settopic notifications 12345`
*(Get the ID: right-click the topic → Copy Link → number at the end)*

---

## Deployment

### Railway (Recommended — free tier available)
1. Push to GitHub
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables from `.env`
4. Done — auto-restarts on crash

### VPS (DigitalOcean / Hetzner — ~$5/month)
```bash
npm install -g pm2
pm2 start src/index.js --name telegram-bot
pm2 save && pm2 startup
```

### Docker
```bash
docker build -t telegram-bot .
docker run -d --env-file .env telegram-bot
```

### Render
1. New Web Service → Connect GitHub repo
2. Build: `npm install` | Start: `node src/index.js`
3. Add environment variables

---

## Google Sheets Structure

Each group gets its own spreadsheet with two tabs:

**Submissions tab:**  
`Timestamp | UserID | Username | Task | Proof | Status | Points`

**Users tab:**  
`UserID | Username | Points | Twitter | Wallet | JoinedAt`

---

## Project Structure

```
tgbot/
├── src/
│   ├── index.js              # Entry point & handler registration
│   ├── config.js             # Environment config
│   ├── store.js              # In-memory data store
│   ├── sessions.js           # Multi-step session state
│   ├── handlers/
│   │   ├── owner.js          # addgroup, removegroup, broadcast
│   │   ├── group.js          # setup, autotopics, settopic, stats
│   │   ├── admin.js          # Admin panel + all inline flows
│   │   └── user.js           # User menu, tasks, submissions
│   ├── services/
│   │   └── sheets.js         # Google Sheets API integration
│   ├── middleware/
│   │   └── auth.js           # Auth, ban checks, access control
│   └── utils/
│       ├── keyboard.js       # All Telegram keyboard builders
│       └── twitter.js        # Tweet URL validation
├── .env.example
├── Dockerfile
├── package.json
└── README.md
```

---

## Notes

- Data is **in-memory** — resets on restart. For persistence, swap `store.js` with SQLite (`better-sqlite3`) or MongoDB (`mongoose`).
- Bot runs in **polling mode** — no domain or webhook required.
- Admin DMs (approve/reject buttons) require the admin to have `/start`-ed the bot in DM at least once.
- Group ID format: always a negative number like `-1001234567890`.
