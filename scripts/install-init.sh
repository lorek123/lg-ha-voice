#!/usr/bin/env bash
# Install the HA Voice background service as a webosbrew init.d script
# so it starts automatically on every TV boot.
#
# Must be run ON THE TV (via SSH) with root access.
# The app must already be installed (via ares-install or Homebrew Channel).
set -euo pipefail

APP_ID="com.homebrew.havoice"

# webosbrew places apps under /media/developer/apps/usr/palm/applications/
SERVICE_DIR="/media/developer/apps/usr/palm/applications/${APP_ID}/service"
INIT_SCRIPT="/var/lib/webosbrew/init.d/ha-voice"
LOG_FILE="/tmp/ha-voice-service.log"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "ERROR: Service directory not found: $SERVICE_DIR"
  echo "Make sure the app is installed first."
  exit 1
fi

cat > "$INIT_SCRIPT" << SCRIPT
#!/bin/sh
# HA Voice background service – auto-started by webosbrew on boot

NODE_BIN="\$(which node 2>/dev/null || echo /usr/bin/node)"
SERVICE="${SERVICE_DIR}/index.js"
PID_FILE="/tmp/ha-voice-service.pid"
LOG="${LOG_FILE}"

start() {
  echo "Starting HA Voice service..."
  if [ -f "\$PID_FILE" ] && kill -0 "\$(cat \$PID_FILE)" 2>/dev/null; then
    echo "Already running."
    return
  fi
  "\$NODE_BIN" "\$SERVICE" >> "\$LOG" 2>&1 &
  echo \$! > "\$PID_FILE"
  echo "Started (PID \$(cat \$PID_FILE))"
}

stop() {
  echo "Stopping HA Voice service..."
  if [ -f "\$PID_FILE" ]; then
    kill "\$(cat \$PID_FILE)" 2>/dev/null || true
    rm -f "\$PID_FILE"
  fi
}

case "\$1" in
  start) start ;;
  stop)  stop  ;;
  restart) stop; sleep 1; start ;;
  *)     start ;;  # default: start
esac
SCRIPT

chmod +x "$INIT_SCRIPT"
echo "==> Installed: $INIT_SCRIPT"

# Start it right now without rebooting
"$INIT_SCRIPT" start
echo "==> Service started. Logs: $LOG_FILE"
