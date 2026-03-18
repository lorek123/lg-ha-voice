#!/usr/bin/env bash
# Package the app as a .ipk for installation via Homebrew Channel or ares-cli.
# Requires: ares-cli (npm i -g @webos-tools/cli)
set -euo pipefail

APP_ID="com.homebrew.havoice"
OUT_DIR="dist"

echo "==> Packaging $APP_ID"
mkdir -p "$OUT_DIR"

ares-package . --outdir "$OUT_DIR"

echo "==> Done: $OUT_DIR/${APP_ID}_*.ipk"
