#!/bin/sh
# Launch Brave with the Hanzo browser extension loaded so it registers on the
# hanzo-mcp bridge and Claude can drive THIS real browser (not a headless one).
#
# The extension is already built at:
#   ~/work/hanzo/extension/dist/chrome
# (rebuild with: cd ~/work/hanzo/extension/packages/browser && node src/build.js)
#
# Usage:  ~/work/hanzo/extension/launch-brave-hanzo.sh [url]
# A dedicated profile keeps this separate from your normal Brave windows.
set -e

EXT="${HANZO_EXT_DIR:-$HOME/work/hanzo/extension/dist/chrome}"
PROFILE="${HANZO_BRAVE_PROFILE:-$HOME/.config/hanzo-brave}"
BRAVE="$(command -v brave-browser || command -v brave-browser-stable || echo /opt/brave.com/brave/brave)"

[ -d "$EXT" ] || { echo "extension not built at $EXT — run: cd ~/work/hanzo/extension/packages/browser && node src/build.js"; exit 1; }
mkdir -p "$PROFILE"

echo "Brave:      $BRAVE"
echo "extension:  $EXT"
echo "profile:    $PROFILE"

exec "$BRAVE" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --disable-extensions-except="$EXT" \
  --no-first-run --no-default-browser-check \
  --restore-last-session=false \
  "${1:-https://admin.hanzo.ai/}"
