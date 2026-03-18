#!/usr/bin/env bash
# Build, install, and launch on the TV in one step.
#
# Usage:
#   DEVICE=mytv bash scripts/deploy.sh
#
# Prerequisites:
#   ares-setup-device  →  configure your TV once
#   ares-cli           →  npm install -g @webos-tools/cli

set -euo pipefail
cd "$(dirname "$0")/.."

# Ensure nvm-managed Node/npm tools are in PATH
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"

DEVICE="${DEVICE:-tv}"
APP_ID="com.homebrew.havoice"

echo "==> Building..."
bash scripts/build.sh

IPK=$(ls ${APP_ID}_*.ipk 2>/dev/null | sort -V | tail -1)

echo "==> Installing $IPK on device '$DEVICE'..."
npx ares-install --verbose --device "$DEVICE" "$IPK"

# Elevate the service so ls-hubd can launch it on demand (survives reboots
# because HBChannel writes to /var/luna-service2-dev which persists).
echo "==> Elevating Luna service..."
SSH_KEY="$HOME/.ssh/webos_tv_unencrypted"
TV_IP=$(npx ares-setup-device --list 2>/dev/null | grep -F "$DEVICE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [ -n "$TV_IP" ] && [ -f "$SSH_KEY" ]; then
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "root@$TV_IP" \
    "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service ${APP_ID}.service" 2>&1 | grep -E '^\[.\]|ERROR' || true

  # elevate-service writes the service definition with -n; patch to -k so the
  # service stays alive for the HTTP server (no idle-exit timer).
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "root@$TV_IP" \
    "sed -i 's|run-js-service -n |run-js-service -k |' /var/luna-service2-dev/services.d/${APP_ID}.service.service" || true

  # ares-package re-processes JS files; push the raw esbuild output directly.
  echo "==> Pushing bundles via SSH (bypasses ares-package reprocessing)..."
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    dist/bundle.js \
    "root@$TV_IP:/media/developer/apps/usr/palm/applications/${APP_ID}/bundle.js"
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    dist/services/index.js \
    "root@$TV_IP:/media/developer/apps/usr/palm/services/${APP_ID}.service/index.js"
else
  echo "  (skip SSH steps – could not determine TV IP or SSH key)"
fi

echo "==> Launching..."
npx ares-launch --close --device "$DEVICE" "$APP_ID" 2>/dev/null || true
sleep 1
npx ares-launch --verbose --device "$DEVICE" "$APP_ID"

echo ""
echo "==> Done."
