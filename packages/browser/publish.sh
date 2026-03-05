#!/bin/bash
# Publish Hanzo AI browser extension to Chrome Web Store and Firefox Add-ons
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION="$(jq -r '.version // empty' package.json)"
if [ -z "$VERSION" ]; then
  echo "Failed to resolve version from package.json" >&2
  exit 1
fi

CHROME_ZIP="hanzo-ai-chrome-${VERSION}.zip"
FIREFOX_ZIP="hanzo-ai-firefox-${VERSION}.zip"

echo "=== Building browser extension ==="
node src/build.js

echo "=== Packaging ==="
rm -f "$CHROME_ZIP" "$FIREFOX_ZIP"
(cd dist/browser-extension/chrome && zip -qr "../../../$CHROME_ZIP" . -x '*.DS_Store')
(cd dist/browser-extension/firefox && zip -qr "../../../$FIREFOX_ZIP" . -x '*.DS_Store')
echo "Chrome: $CHROME_ZIP ($(du -h "$CHROME_ZIP" | cut -f1))"
echo "Firefox: $FIREFOX_ZIP ($(du -h "$FIREFOX_ZIP" | cut -f1))"

# --- Chrome Web Store ---
if [ -n "${CHROME_EXTENSION_ID:-}" ] && [ -n "${CHROME_CLIENT_ID:-}" ]; then
  echo
  echo "=== Publishing to Chrome Web Store ==="
  ACCESS_TOKEN=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
    -d "client_id=$CHROME_CLIENT_ID" \
    -d "client_secret=$CHROME_CLIENT_SECRET" \
    -d "refresh_token=$CHROME_REFRESH_TOKEN" \
    -d "grant_type=refresh_token" | jq -r '.access_token')

  echo "Uploading..."
  curl -s -X PUT \
    "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$CHROME_EXTENSION_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-api-version: 2" \
    -T "$CHROME_ZIP" | jq .

  echo "Publishing..."
  curl -s -X POST \
    "https://www.googleapis.com/chromewebstore/v1.1/items/$CHROME_EXTENSION_ID/publish" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-api-version: 2" \
    -H "Content-Length: 0" | jq .
else
  echo
  echo "=== Chrome Web Store (manual) ==="
  echo "Upload $CHROME_ZIP at: https://chrome.google.com/webstore/devconsole"
  echo
  echo "To automate, set these env vars:"
  echo "  CHROME_EXTENSION_ID  - Your extension ID from the Chrome Web Store"
  echo "  CHROME_CLIENT_ID     - OAuth2 client ID"
  echo "  CHROME_CLIENT_SECRET - OAuth2 client secret"
  echo "  CHROME_REFRESH_TOKEN - OAuth2 refresh token"
  echo
  echo "Setup guide: https://developer.chrome.com/docs/webstore/using-api"
fi

# --- Firefox Add-ons ---
if [ -n "${AMO_API_KEY:-}" ]; then
  echo
  echo "=== Publishing to Firefox Add-ons ==="
  npx web-ext sign \
    --source-dir dist/browser-extension/firefox \
    --api-key "$AMO_API_KEY" \
    --api-secret "$AMO_API_SECRET" \
    --channel listed \
    --id "hanzo-ai@hanzo.ai"
else
  echo
  echo "=== Firefox Add-ons (manual) ==="
  echo "Upload $FIREFOX_ZIP at: https://addons.mozilla.org/developers/"
  echo
  echo "To automate, set these env vars:"
  echo "  AMO_API_KEY    - Firefox Add-ons API key"
  echo "  AMO_API_SECRET - Firefox Add-ons API secret"
  echo
  echo "Setup guide: https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign"
fi

echo

echo "=== Done ==="
echo "Chrome zip: $SCRIPT_DIR/$CHROME_ZIP"
echo "Firefox zip: $SCRIPT_DIR/$FIREFOX_ZIP"
