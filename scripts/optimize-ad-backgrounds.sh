#!/bin/bash
# Resizes/compresses the generated 1536x1024 PNGs down to a web-reasonable
# JPEG for use as a CSS background-image. Run once after
# generate-static-ad-backgrounds.ts finishes. Idempotent: skips files that
# already have a .jpg sibling.
set -e
cd "$(dirname "$0")/../public/ad-backgrounds"

for dir in trucker veteran mortgage_protection; do
  for png in "$dir"/*.png; do
    [ -f "$png" ] || continue
    jpg="${png%.png}.jpg"
    if [ -f "$jpg" ]; then
      echo "skip (exists): $jpg"
      continue
    fi
    sips -s format jpeg -s formatOptions 78 -Z 1200 "$png" --out "$jpg" >/dev/null
    echo "optimized: $jpg"
  done
done
