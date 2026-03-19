#!/bin/bash

# Launch Chrome with Ultimate Dark Mode extension loaded.
#
# Usage:
#   ./scripts/install.sh              # launch with extension
#   ./scripts/install.sh [url]        # launch and open a URL
#
# This starts Chrome with your default profile + the extension loaded.
# The extension persists as long as Chrome is running.

EXTENSION_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -f "$CHROME" ]; then
  # Try Chromium or other locations
  CHROME="$(which google-chrome 2>/dev/null || which chromium 2>/dev/null)"
fi

if [ -z "$CHROME" ] || [ ! -f "$CHROME" ]; then
  echo "Error: Chrome not found. Install Google Chrome or set CHROME= path."
  exit 1
fi

URL="${1:-}"

echo "Loading extension from: $EXTENSION_DIR"
echo "Starting Chrome..."

if [ -n "$URL" ]; then
  "$CHROME" --load-extension="$EXTENSION_DIR" "$URL" &
else
  "$CHROME" --load-extension="$EXTENSION_DIR" &
fi

echo "Chrome launched with Ultimate Dark Mode extension."
echo "Look for the moon icon in the toolbar."
