#!/usr/bin/env bash
# Permanent local-dev install of the Hanzo browser extension on Linux — NO snap,
# NO web store, NO signing service. Builds from source and installs into:
#
#   • Firefox ESR   (/opt/firefox-esr) via an enterprise policy that
#     force-installs the unsigned XPI into EVERY profile (signatures disabled).
#     Truly permanent + launch-independent: any launch of that Firefox has it.
#
#   • Brave         (Chromium-family; arm64 has no Google-Chrome build) via a
#     --load-extension launcher (/usr/local/bin/hanzo-brave + a desktop entry).
#     The extension loads from the live dist dir, so a rebuild + relaunch picks
#     up new code — the correct dev loop (no re-pack per change).
#
# Why these two: on this box (aarch64) apt ships ONLY snap redirects for
# firefox/chromium, and Google Chrome has no Linux arm64 build. Firefox ESR and
# Brave are the reliable non-snap arm64 browsers. On x86_64 the same script
# works; swap Brave for google-chrome if preferred.
#
# Re-run after any `node src/build.js` to redeploy. Idempotent.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_ROOT="$(cd "$REPO_DIR/../.." && pwd)"          # ~/work/hanzo/extension
DIST="$EXT_ROOT/dist"
STABLE=/opt/hanzo-ext                              # stable install location
FF=/opt/firefox-esr

echo "==> building extension from source"
( cd "$REPO_DIR" && node src/build.js )
[ -d "$DIST/firefox" ] && [ -d "$DIST/chrome" ] || { echo "build did not produce dist/{firefox,chrome}"; exit 1; }

echo "==> packaging Firefox XPI"
XPI=/tmp/hanzo-ai.xpi
( cd "$DIST/firefox" && rm -f "$XPI" && zip -qr -X "$XPI" . )
GECKO_ID=$(python3 -c 'import json;m=json.load(open("'"$DIST"'/firefox/manifest.json"));print((m.get("browser_specific_settings") or m.get("applications") or {}).get("gecko",{}).get("id",""))')
[ -n "$GECKO_ID" ] || { echo "firefox manifest has no gecko id"; exit 1; }

echo "==> staging stable copies under $STABLE (needs sudo)"
sudo mkdir -p "$STABLE"
sudo cp "$XPI" "$STABLE/hanzo-ai.xpi"
sudo rm -rf "$STABLE/chrome" && sudo cp -r "$DIST/chrome" "$STABLE/chrome"

if [ -x "$FF/firefox" ]; then
  echo "==> Firefox ESR enterprise policy (force-install + signatures off)"
  sudo mkdir -p "$FF/distribution"
  sudo tee "$FF/distribution/policies.json" >/dev/null <<JSON
{
  "policies": {
    "ExtensionSettings": {
      "$GECKO_ID": { "installation_mode": "force_installed", "install_url": "file://$STABLE/hanzo-ai.xpi" }
    },
    "Preferences": { "xpinstall.signatures.required": { "Value": false, "Status": "locked" } },
    "DisableAppUpdate": true
  }
}
JSON
else
  echo "!! Firefox ESR not at $FF — install it (Mozilla arm64 ESR tarball) then re-run"
fi

if command -v brave-browser >/dev/null 2>&1; then
  echo "==> Brave --load-extension launcher + desktop entry"
  sudo tee /usr/local/bin/hanzo-brave >/dev/null <<'SH'
#!/bin/bash
exec /usr/bin/brave-browser --load-extension=/opt/hanzo-ext/chrome "$@"
SH
  sudo chmod +x /usr/local/bin/hanzo-brave
  sudo tee /usr/share/applications/brave-hanzo-dev.desktop >/dev/null <<'DESK'
[Desktop Entry]
Version=1.0
Name=Brave (Hanzo Dev)
Comment=Brave with the local Hanzo browser extension
Exec=/usr/local/bin/hanzo-brave %U
Terminal=false
Type=Application
Icon=brave-browser
Categories=Network;WebBrowser;
DESK
else
  echo "!! brave-browser not found — install it, then re-run"
fi

CHROME_ID=$(python3 - <<PY
import json,base64,hashlib
m=json.load(open("$DIST/chrome/manifest.json")); k=m.get("key")
if k:
    h=hashlib.sha256(base64.b64decode(k)).hexdigest()[:32]
    print(''.join(chr(ord('a')+int(c,16)) for c in h))
PY
)
echo
echo "DONE."
echo "  Firefox: launch  $FF/firefox   (extension $GECKO_ID force-installed, every profile)"
echo "  Brave:   launch  hanzo-brave    (extension ${CHROME_ID:-<key-derived>} via --load-extension)"
echo "  Rebuild loop: node src/build.js && ./install-linux.sh   (then relaunch the browser)"
