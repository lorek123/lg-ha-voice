#!/usr/bin/env bash
# Generate placeholder icons using ImageMagick.
# Replace assets/icon.png and assets/icon-large.png with your own artwork.
set -euo pipefail

command -v convert >/dev/null 2>&1 || { echo "ImageMagick required: sudo apt install imagemagick"; exit 1; }

mkdir -p assets

convert -size 80x80 xc:'#03A9F4' \
  -fill white -font DejaVu-Sans-Bold -pointsize 18 \
  -gravity center -annotate 0 'HA\nVoice' \
  assets/icon.png

convert -size 130x130 xc:'#03A9F4' \
  -fill white -font DejaVu-Sans-Bold -pointsize 28 \
  -gravity center -annotate 0 'HA\nVoice' \
  assets/icon-large.png

echo "Icons generated in assets/"
