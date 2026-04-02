#!/bin/sh
# Run this ON THE TV (via SSH) to identify which /dev/input/eventN
# is your Magic Remote. Press the mic button while it runs.
#
# Usage: sh find-remote-device.sh

echo "Scanning input devices. Press the MIC button on your Magic Remote..."
echo ""

# Show known devices
echo "=== /proc/bus/input/devices ==="
cat /proc/bus/input/devices
echo ""

echo "=== Listening on all event devices for 10 seconds ==="
echo "    (look for the device that shows activity when you press MIC)"
echo ""

for dev in /dev/input/event*; do
  (
    dd if="$dev" bs=1 2>/dev/null | od -An -tx1 -w1 | while read -r byte; do
      printf "%s %s\n" "$dev" "$byte"
    done
  ) &
done

sleep 10
kill %% 2>/dev/null
pkill -f "dd if=/dev/input" 2>/dev/null || true
echo ""
echo "Done. Look for which /dev/input/eventN produced output."
