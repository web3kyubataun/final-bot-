#!/bin/bash
# =============================================
# Export the Telegram Bot project as a tar.gz archive
# =============================================

OUTPUT="telegram-premium-bot.tar.gz"
PARENT_DIR=$(dirname "$0")

echo " Creating archive: $OUTPUT ..."

cd "$PARENT_DIR/.." || exit 1

# Create archive, excluding node_modules, .env, and git files
tar \
  --exclude="tgbot/node_modules" \
  --exclude="tgbot/.env" \
  --exclude="tgbot/.git" \
  --exclude="tgbot/*.log" \
  --exclude="tgbot/$OUTPUT" \
  -czf "$OUTPUT" tgbot

echo ""
echo " Done! File created: $OUTPUT"
ls -lh "$OUTPUT"
