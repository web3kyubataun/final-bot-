# Telegram Raid Bot - Setup Guide

## Overview

This bot manages Twitter/Telegram raid tasks for your Telegram group, with automatic
verification via Twitter API, a leaderboard, anti-spam controls, and a clean UI.

---

## Step 1: Create Your Telegram Bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot`
3. Follow the prompts — give your bot a name and username
4. Copy the **Bot Token** provided (looks like `123456789:ABCdef...`)
5. In BotFather, also run:
   - `/setprivacy` → Select your bot → **Disable** (so it can read group messages)
   - `/setcommands` → Paste these commands:
     ```
     start - Start the bot
     leaderboard - View the leaderboard
     raids - View active raids
     mypoints - Check your points
     settwitter - Link your Twitter account
     admin - Admin panel (admins only)
     ```

---

## Step 2: Get Twitter API Keys

You need a **Twitter Developer Account** with **Elevated access** (free).

1. Go to: https://developer.twitter.com/en/portal/dashboard
2. Click **Create Project** → give it a name and use case (select "Making a bot")
3. Inside the project, click **Create App**
4. In the app settings, go to **Keys and Tokens**
5. Copy these values:
   - **Bearer Token** → `TWITTER_BEARER_TOKEN`
   - **API Key** → `TWITTER_API_KEY`
   - **API Key Secret** → `TWITTER_API_SECRET`
6. Under **Authentication Tokens**, generate:
   - **Access Token** → `TWITTER_ACCESS_TOKEN`
   - **Access Token Secret** → `TWITTER_ACCESS_TOKEN_SECRET`

**Important:** Set your app's permissions to **Read** (read-only is enough for verification).

**Twitter API Tier:** The free tier has limited lookups. For production use with many users,
apply for **Basic** access ($100/month) or use **Elevated** (free, apply via the portal).

---

## Step 3: Configure Environment Variables

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in all values:
   ```
   BOT_TOKEN=your_telegram_bot_token
   TWITTER_BEARER_TOKEN=your_bearer_token
   TWITTER_API_KEY=your_api_key
   TWITTER_API_SECRET=your_api_secret
   TWITTER_ACCESS_TOKEN=your_access_token
   TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
   ADMIN_IDS=your_telegram_user_id
   ```

3. To find your Telegram user ID, message **@userinfobot** on Telegram.
   If you have multiple admins, separate IDs with commas: `123456,789012`

---

## Step 4: Install and Run

```bash
cd telegram-raid-bot
npm install
npm start
```

For production (keep it running):
```bash
npm install -g pm2
pm2 start index.js --name raid-bot
pm2 save
pm2 startup
```

---

## Step 5: Set Up Your Group

1. Add the bot to your Telegram group
2. Make the bot an **Admin** in the group (required to read messages and post)
3. Message `/admin` to the bot **in private** (DM the bot)
4. The admin panel will appear

### Optional: Leaderboard Topic
If your group uses Topics (forum mode):
1. Go to Settings → click "Settings:Set Leaderboard Topic" in the admin panel
2. Send the topic ID where you want the leaderboard auto-posted every 24 hours

---

## How to Use

### As Admin

1. DM the bot and send `/admin`
2. Click **Create Raid**
3. Follow the prompts: Title → Link → Reward points
4. Add Twitter or Telegram tasks
5. Click **Done Adding Tasks** — the raid posts to your group automatically

### As a User

1. In the group, tap **Submit** on a raid
2. The bot DMs you with the list of tasks
3. Tap each task to verify it
4. For Twitter tasks, you'll be asked for your Twitter username once
5. The bot verifies via Twitter API automatically
6. When all tasks are done, you earn the points

### Leaderboard

- Auto-posts to the group leaderboard topic every 24 hours
- Users can check anytime: `/leaderboard` in DM
- If in multiple groups, a group selector appears

---

## Twitter Task Verification Details

| Task | What is verified |
|------|-----------------|
| Follow | User's Twitter account follows the target |
| Like | User liked the specified tweet |
| Retweet | User retweeted the specified tweet |
| Quote Tweet | User quoted the tweet, min character check, no spam words |
| Comment | User replied to the tweet, min character check, no spam words |

---

## Anti-Spam

- Admins set a minimum reply length via Settings
- Emoji-only messages trigger a warning
- Messages below the minimum length trigger a warning
- Warning counts are tracked per user per group

---

## Deploying to a Server (VPS/Cloud)

The bot only needs Node.js 18+ and no open ports. Any cheap VPS works:

- **Railway**: Connect your GitHub repo, add environment variables in the dashboard
- **Render**: Free tier, connect repo, add env vars, deploy as a background worker
- **DigitalOcean / Linode / Vultr**: SSH in, clone repo, copy `.env`, run with PM2
- **Fly.io**: `fly launch` → add secrets → `fly deploy`

The SQLite database (`data/bot.db`) is stored locally. For persistence across deploys,
mount a volume to the `data/` directory or switch to PostgreSQL if needed.

---

## File Structure

```
telegram-raid-bot/
├── index.js              Entry point
├── .env.example          Environment variable template
├── .gitignore
├── package.json
├── SETUP.md              This file
└── src/
    ├── bot.js            Bot initialization and all handlers
    ├── database.js       SQLite database layer
    ├── scheduler.js      24-hour leaderboard cron job
    ├── twitter.js        Twitter API verification functions
    ├── commands/
    │   ├── start.js      /start, /settwitter, /mypoints
    │   ├── leaderboard.js /leaderboard
    │   └── raids.js      /raids, raid submit flow
    ├── handlers/
    │   ├── adminHandler.js Admin panel, raid/task creation
    │   ├── taskHandler.js  Task verification flow
    │   └── antiSpam.js     Emoji and short message detection
    └── utils/
        ├── formatter.js    MarkdownV2 message formatting
        └── keyboards.js    Inline keyboard builders
```

---

## Troubleshooting

**Bot does not respond in group**
- Make sure the bot is an admin in the group
- Check that privacy mode is disabled in BotFather (`/setprivacy` → Disable)

**Twitter verification fails**
- Confirm all 5 Twitter API credentials are correct in `.env`
- Free tier has rate limits — wait a few minutes if getting 429 errors
- Twitter usernames are case-insensitive but must be exact

**"Session expired" errors**
- Admin session expired — run `/admin` or `/createraid` again

**Database not found**
- The `data/` folder is created automatically on first run
- Make sure the process has write permissions to the directory
