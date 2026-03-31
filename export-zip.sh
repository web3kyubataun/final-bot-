#!/bin/bash
# =============================================
# Export the Telegram Bot project as a ZIP file
# =============================================

OUTPUT="telegram-premium-bot.zip"

echo "📦 Creating ZIP: $OUTPUT ..."

# Remove old zip if exists
rm -f "$OUTPUT"

# Create zip, excluding node_modules, .env, and git files
zip -r "$OUTPUT" . \
  --exclude "node_modules/*" \
  --exclude ".env" \
  --exclude ".git/*" \
  --exclude "*.log" \
  --exclude "$OUTPUT"

echo ""
echo "✅ Done! File created: $OUTPUT"
echo "   Size: $(du -sh "$OUTPUT" | cut -f1)"
echo ""
echo "📁 Contents:"
unzip -l "$OUTPUT" | tail -n +4 | head -n -2
