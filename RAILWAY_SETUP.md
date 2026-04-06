# Railway Deployment Guide

## How data is saved across updates

This bot uses **SQLite** stored on a Railway **Volume** at `/data/bot.db`.

When you push code to GitHub and Railway auto-deploys:
- Your code updates (new features, bug fixes)
- The `/data` volume stays untouched — all users, groups, tasks, points are preserved
- Exactly like updating a phone app: code changes, data stays

---

## Database path — two modes

| Mode | DB_PATH set? | Data survives redeploy? |
|------|-------------|-------------------------|
| No Volume yet | No | Bot works, but data resets on redeploy |
| With Volume | Yes (`/data/bot.db`) | YES — fully persistent |

The bot always starts without crashing, even without a Volume configured.

---

## One-time Railway Setup

### Step 1 — Connect GitHub
1. Create a new Railway project
2. Click **New Service → GitHub Repo** and select your repo
3. Railway auto-detects Node.js and deploys on every push to `main`

### Step 2 — Add a Volume (persistent storage)
1. In your Railway project, click **New** → **Volume**
2. Set **Mount Path** to `/data`
3. Attach the volume to your bot service
4. Redeploy after adding the volume

### Step 3 — Set Environment Variables
In your Railway service → **Variables**, add:

| Variable | Value | Required? |
|----------|-------|-----------|
| `BOT_TOKEN` | Your Telegram bot token | YES |
| `BOT_OWNER_IDS` | Your Telegram user ID | YES |
| `DB_PATH` | `/data/bot.db` | YES (for persistence) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | your service account JSON | Optional |
| `DEFAULT_SHARE_EMAIL` | email to share Google Sheets | Optional |
| `TWITTER_BEARER_TOKEN` | for tweet verification | Optional |

### Step 4 — Deploy
Railway deploys automatically on every GitHub push.
All data in `/data/bot.db` survives every redeploy.

---

## How it works

```
With Volume + DB_PATH=/data/bot.db:
  GitHub push → Railway redeploys code → Volume /data untouched
                                          └── bot.db (all data) ✓

Without Volume (DB_PATH not set):
  Bot starts → writes to /tmp/bot.db → data lost on next redeploy
```

---

## Local development

```bash
cp .env.example .env
# Edit .env with your BOT_TOKEN and BOT_OWNER_IDS
# Leave DB_PATH unset for local dev (auto-uses /tmp/bot.db)
npm install
npm start
```
