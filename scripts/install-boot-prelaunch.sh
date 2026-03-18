#!/bin/sh
# Install a webosbrew init.d script that silently pre-launches the HA Voice app
# at every TV boot, so the app is already running when the user first presses
# the mic button (no cold-start delay).
#
# Must be run ON THE TV (via SSH) with root access.

set -e

APP_ID="com.homebrew.havoice"
INIT_SCRIPT="/var/lib/webosbrew/init.d/ha-voice-prelaunch"

cat > "$INIT_SCRIPT" << SCRIPT
#!/bin/sh
# Pre-launch HA Voice app at boot so it is ready for the first mic press.
# The app stays in the background (no UI shown until mic button is pressed).

# Wait for the application manager to be ready
sleep 8

luna-send -n 1 luna://com.webos.applicationManager/launch \
  '{"id":"${APP_ID}"}' \
  >> /tmp/ha-voice-prelaunch.log 2>&1 || true
SCRIPT

chmod +x "$INIT_SCRIPT"
echo "==> Installed: $INIT_SCRIPT"

# Run it now without rebooting
echo "==> Pre-launching app now..."
"$INIT_SCRIPT"
echo "==> Done. App is pre-launched and ready."
