# Telegram Premium Bot — Group Automation + Raid + Task System

A production-ready Telegram bot built with Telegraf.js. Supports multiple groups, task/raid campaigns, Google Sheets logging, admin approval flows, and leaderboards.

---

## Features

- **Multi-group support** — each group gets its own Google Sheet
- **Task & Raid system** — create campaigns with proof submission
- **Google Sheets** — auto-creates sheet per group, logs submissions + users
- **Approval workflow** — admins approve/reject via inline buttons in DM
- **Leaderboard** — points-based ranking
- **Access control** — all users / group members only / whitelist
- **Admin panel** — inline keyboard panel in group
- **Ban system** — ban/unban users
- **Broadcast & Announce** — DM all users or group announce
- **Twitter verification** — validates tweet URL format (+ API if token set)
- **Notification control** — users can toggle DMs on/off

---

## Quick Start

### 1. Clone / Download and install

```bash
npm install
```

### 2. Create `.env` from template

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=your_bot_token_from_BotFather
OWNER_ID=your_telegram_user_id
GOOGLE_SERVICE_ACCOUNT_PATH=./google-service-account.json
DEFAULT_SHARE_EMAIL=youremail@gmail.com
```

### 3. Set up Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Google Sheets API** and **Google Drive API**
3. Create a **Service Account** → Download the JSON key
4. Save the JSON file as `google-service-account.json` in the bot folder
5. The bot will automatically share new sheets with `DEFAULT_SHARE_EMAIL`

### 4. Start the bot

```bash
node src/index.js
# or with auto-reload:
npx nodemon src/index.js
```

---

## Bot Setup Flow

1. Get your **Group ID** (add `@userinfobot` to your group, or forward a group message to it)
2. Message the bot: `/addgroup -1001234567890`
3. A Google Sheet is auto-created and shared with your email
4. Add admins: `/addadmin 123456789` (in the group)
5. Create tasks: `/createtask Retweet our post | https://x.com/post | 100`
6. Create raids: `/createraid Follow our Twitter | https://x.com | 50`

---

## Commands Reference

### User Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot, show menu |
| `/submit <taskId> <proof>` | Submit proof for a task |
| `/leaderboard` | View top 10 users |
| `/profile` | Your points & stats |
| `/settwitter <handle>` | Link your Twitter |
| `/setwallet <address>` | Link your wallet |
| `/notifications on\|off` | Toggle DM notifications |
| `/help` | Full command list |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/admin` | Open admin panel |
| `/createtask Title \| Link \| Reward` | Create a task |
| `/createraid Title \| Link \| Reward` | Create a raid |
| `/announce <message>` | Group + DM announcement |
| `/viewsubmissions` | See pending submissions |
| `/addadmin <userId>` | Add group admin |
| `/removeadmin <userId>` | Remove group admin |
| `/ban <userId>` | Ban a user |
| `/unban <userId>` | Unban a user |
| `/setmode all\|group\|whitelist` | Set access mode |
| `/addemail email@gmail.com` | Share sheet with email |

### Owner Commands

| Command | Description |
|---------|-------------|
| `/addgroup <groupId>` | Register a group |
| `/broadcast <message>` | DM all bot users |

---

## Deployment Options

### Option A: Railway (Recommended — Free Tier Available)
1. Push to GitHub
2. Connect repo to [Railway](https://railway.app)
3. Add environment variables in Railway dashboard
4. Deploy — Railway keeps it running 24/7

### Option B: VPS (DigitalOcean / Hetzner — $4-6/month)
```bash
# Install PM2 for process management
npm install -g pm2
pm2 start src/index.js --name telegram-bot
pm2 save
pm2 startup
```

### Option C: Docker
```bash
docker build -t telegram-bot .
docker run -d --env-file .env telegram-bot
```

### Option D: Replit (requires Always-On / $7/month Hacker plan)
- Upload files to Replit
- Add secrets in Replit's Secrets panel
- Enable Always-On to keep running

---

## Google Sheets Structure

Each group gets its own spreadsheet with two tabs:

**Submissions tab:**
| Timestamp | UserID | Username | Task | Proof | Status | Points |

**Users tab:**
| UserID | Username | Points | Twitter | Wallet | JoinedAt |

---

## Project Structure

```
telegram-premium-bot/
├── src/
│   ├── index.js              # Entry point, bot setup
│   ├── config.js             # Environment config
│   ├── store.js              # In-memory data store
│   ├── handlers/
│   │   ├── owner.js          # Owner-only commands
│   │   ├── admin.js          # Admin commands + approval callbacks
│   │   └── user.js           # User commands + menu
│   ├── services/
│   │   └── sheets.js         # Google Sheets integration
│   ├── middleware/
│   │   └── auth.js           # Auth, ban checks, access control
│   └── utils/
│       ├── keyboard.js       # Telegram keyboard helpers
│       └── twitter.js        # Tweet URL validation
├── .env.example
├── .dockerignore
├── Dockerfile
├── package.json
└── README.md
```

---

## Notes

- Data is stored **in-memory** — it resets when the bot restarts. For persistent storage, add SQLite or MongoDB (see upgrade notes below).
- The bot runs in **polling mode** — no webhook/domain setup needed.
- All admin notification DMs require that admins have started the bot at least once (`/start`).

---

## Upgrading to Persistent Storage

To persist data across restarts, replace `store.js` with a database adapter:

```bash
npm install better-sqlite3
# or
npm install mongoose  # for MongoDB
```

Then swap the `store.js` in-memory objects with database read/write calls.
