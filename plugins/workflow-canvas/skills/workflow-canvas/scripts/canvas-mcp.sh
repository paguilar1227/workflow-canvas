#!/usr/bin/env bash
# stdio MCP entry point used by the plugin: start the canvas if needed, then bridge stdio to its tool API.
# Prefer the installed desktop runtime; its stdio entry point starts the app if needed.
desktop="${WFC_DESKTOP_EXECUTABLE:-}"
if [ -z "$desktop" ]; then
  for candidate in "/Applications/Workflow Canvas.app/Contents/MacOS/workflow-canvas" "$HOME/Applications/Workflow Canvas.app/Contents/MacOS/workflow-canvas"; do
    if [ -x "$candidate" ]; then desktop="$candidate"; break; fi
  done
fi
if [ -n "$desktop" ]; then exec "$desktop" --mcp-stdio; fi
dir="$(cd "$(dirname "$0")" && pwd)"
bash "$dir/ensure-canvas.sh" || exit 1
exec docker exec -i -e WFC_PUBLIC_URL="${WFC_URL:-http://localhost:8790}" "${WFC_CONTAINER:-workflow-canvas}" node dist/server/stdio.js
