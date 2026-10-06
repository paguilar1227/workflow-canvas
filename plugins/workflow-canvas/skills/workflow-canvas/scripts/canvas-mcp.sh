#!/usr/bin/env bash
# stdio MCP entry point used by the plugin: start the canvas if needed, then bridge stdio to its tool API.
dir="$(cd "$(dirname "$0")" && pwd)"
bash "$dir/ensure-canvas.sh" || exit 1
exec docker exec -i -e WFC_PUBLIC_URL="${WFC_URL:-http://localhost:8790}" "${WFC_CONTAINER:-workflow-canvas}" node dist/server/stdio.js
