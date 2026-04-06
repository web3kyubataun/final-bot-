# Railway Deployment Guide

## How data is saved across updates

This bot uses **SQLite** stored on a Railway **Volume** at `/data/bot.db`.

When you push code to GitHub and Railway auto-deploys:
- Your code updates (new features, bug fixes)
- The `/data` volume stays untouched — all users, groups, tasks, points are preserved
- Exactly like updating a phone app: code changes, data stays

---

## One-time Railway Setup

### Step 1 — Connect GitHub
1. Create a new Railway project
2. Click **New Service → GitHub Repo** and select your repo
3. Railway will auto-detect Node.js and deploy on every push to `main`

### Step 2 — Add a Volume (persistent storage)
1. In your Railway project, click **New** → **Volume**
2. Set **Mount Path** to `/data`
3. Attach the volume to your bot service

### Step 3 — Set Environment Variables
In your Railway service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `BOT_TOKEN` | Your Telegram bot token |
| `BOT_OWNER_IDS` | Your Telegram user ID |
| `DB_PATH` | `/data/bot.db` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (optional) your service account JSON |
| `DEFAULT_SHARE_EMAIL` | (optional) email to share Google Sheets |
| `TWITTER_BEARER_TOKEN` | (optional) for tweet verification |

### Step 4 — Deploy
Railway deploys automatically on every GitHub push.
All data in `/data/bot.db` survives every redeploy.

---

## How it works

```
GitHub push → Railway redeploys code → Volume /data untouched
                                        └── bot.db (all your data) ✓
```

The bot reads `DB_PATH=/data/bot.db` from the environment.
The Railway Volume mounts at `/data` — a persistent disk that never gets wiped on redeploy.

---

## Local development

```bash
cp .env.example .env
# Edit .env with your values (DB_PATH can be left as default ./data/bot.db)
npm install
npm start
```
