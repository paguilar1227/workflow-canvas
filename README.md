# Workflow Canvas

An infinite canvas for plans, architecture, workflows and codebase maps — XMind-style mind mapping plus free-form diagramming, with swappable themes and a **complete AI toolset** (MCP) so an AI agent can do everything a person can do in the UI, live, in the same document.

![Architecture](docs/architecture.png)

## Run it (Docker)

```bash
docker compose up -d --build
open http://localhost:8790
```

Data lives in the `workflow-canvas-data` volume (`/data/documents/*.json`; deleted documents go to `/data/trash`). Change the host port with `WFC_PORT=9000 docker compose up -d`.

There is no login, so by default the app only listens on this machine (`127.0.0.1`) and rejects requests from other websites or unknown host names. To open it to your network (e.g. a phone), run `WFC_BIND=0.0.0.0 WFC_ALLOWED_HOSTS=192.168.1.20,my-mac.local docker compose up -d` with the address you will type in the browser.

## What you can do (human)

| Area | Features |
| --- | --- |
| Canvas | Infinite pan/zoom (scroll, ⌘+scroll / pinch, Space+drag, hand tool), fit view, minimap, dot/line/cross grid, snap to grid |
| Mind maps (XMind-style) | Tab = child, Enter = sibling, F2 edit, `/` collapse/expand with counts, arrow-key navigation, drag a topic onto another to re-parent, auto-arranged branches, layouts: balanced mind map, logic chart →/←, org chart ↓ |
| Diagrams | Cards (icon + title + monospace subtitle + badge, like the pr-lens reference), rounded/pill/rectangle/diamond/circle/hexagon/cylinder shapes, stickies, free text, frames/swimlanes (members move with the frame), connectors via handle drag (drop anywhere on the target), labels, arrows, solid/dashed/dotted, smooth/bezier/straight/step routing, animated flow |
| Excalidraw-inspired | Freehand pen (P), hand-drawn "Excalidraw Sketch" theme (rough.js), R/D/O shape shortcuts, zen mode (Alt+Z), view-only mode (Alt+R), copy PNG to clipboard, `.excalidraw` import/export |
| Editing | Inspector for every property (title, subtitle, badge, emoji icon, color, shape, status, priority, tags, link, notes, size, lock), multi-select align/distribute/frame/connect, copy/cut/paste/duplicate, context menus, undo/redo (shared with AI) |
| Layout | Graph (dagre) LR/TB with frames as clusters, swimlanes, grid, tree layouts |
| Documents | Multiple canvases from templates (blank, mind map, architecture lanes, workflow), rename, duplicate, delete, outline panel, search (⌘F) |
| Import / export | Import Mermaid flowcharts (subgraphs → frames), Markdown outlines (→ mind map), Excalidraw scenes, JSON. Export PNG, SVG, Markdown, Mermaid, Excalidraw, JSON |
| Collaboration | Every open tab and every AI client sees changes live; AI edits show an activity feed and highlight the touched nodes |

Press **?** in the app for the full shortcut list.

## Themes

Themes are token sets (CSS variables) swappable at runtime by humans or AI. Directions were researched with the **Refero** MCP (via Composio) and adapted, not cloned:

| Theme | Mode | Source |
| --- | --- | --- |
| Lens Dark (default) | dark | Your pr-lens `mapping-web-dark.svg` reference |
| Warp Graphite | dark | Refero style: Warp |
| Paper Blueprint | light | Refero style: Paper |
| Whimsical Studio | light | Refero style: Whimsical |
| Modal Terminal | dark | Refero style: Modal |
| Nornorm Ink | light | Refero style: Nornorm |
| Hyperstudio Amber | dark | Refero style: Hyperstudio |
| Excalidraw Sketch | light | Excalidraw (MIT) · rough.js hand-drawn rendering |

Fonts are bundled open-source substitutes (Inter, Manrope, Space Grotesk, Fraunces, JetBrains Mono, Geist Mono, Patrick Hand).

## AI toolset

The server exposes the same command model the UI uses, so AI and human actions are interchangeable, live and undoable.

- **MCP (streamable HTTP):** `http://localhost:8790/mcp`
  - Codex: `codex mcp add workflow-canvas --url http://localhost:8790/mcp`
  - Claude Code: `claude mcp add --transport http workflow-canvas http://localhost:8790/mcp`
- **MCP over stdio** (Claude Desktop and other stdio-only clients): `docker exec -i workflow-canvas node dist/server/stdio.js`
- **Plain HTTP:** `GET /api/tools` (JSON Schemas), `POST /api/tools/<name>` with JSON arguments. `GET /api/documents/<id>?format=markdown|mermaid`.
- **Script client:** `node scripts/mcp-call.mjs list` / `node scripts/mcp-call.mjs call <tool> '<json>' [--save shot.png]`

### 34 tools

`get_canvas_state`, `list_documents`, `get_document`, `find_nodes`, `create_document`, `open_document`, `update_document`, `duplicate_document`, `delete_document`, `add_nodes`, `update_nodes`, `delete_nodes`, `move_nodes`, `duplicate_nodes`, `reparent_node`, `set_collapsed`, `add_edges`, `update_edges`, `delete_edges`, `create_diagram`, `auto_layout`, `align_nodes`, `distribute_nodes`, `fit_frame_to_contents`, `import_content`, `export_document`, `capture_screenshot`, `undo`, `redo`, `select`, `control_view`, `list_themes`, `set_theme`, `set_ui`.

### UI ↔ AI parity

| Human action in the UI | AI tool |
| --- | --- |
| New / rename / duplicate / delete / switch documents | `create_document`, `update_document`, `duplicate_document`, `delete_document`, `open_document` |
| Add topic, sticky, text, frame, pen stroke; Tab / Enter | `add_nodes` (kinds topic/frame/sticky/text/drawing, `parentId` for branches) |
| Edit any field in the inspector, resize, lock | `update_nodes` |
| Drag nodes / frames (members follow) | `move_nodes` (`includeContents`) |
| Duplicate / copy-paste | `duplicate_nodes` |
| Drop a topic on another (re-parent) | `reparent_node` |
| Collapse / expand branches | `set_collapsed` |
| Connect, label, style, reverse, delete connectors | `add_edges`, `update_edges`, `delete_edges` |
| Delete | `delete_nodes` |
| Layout menu, align / distribute, fit frame | `auto_layout`, `align_nodes`, `distribute_nodes`, `fit_frame_to_contents` |
| Mind-map structure & auto-arrange settings | `update_document` (`treeLayout`, `autoArrange`) |
| Import / export menus | `import_content`, `export_document` |
| Undo / redo | `undo`, `redo` (shared history) |
| Select / multi-select | `select` (and read the human's selection via `get_canvas_state`) |
| Zoom, pan, fit, focus | `control_view` |
| Theme picker | `list_themes`, `set_theme` |
| Panels, minimap, snap, background, search, pen/hand/select tool, zen, view-only, start inline editing | `set_ui` |
| Look at the canvas | `capture_screenshot`, `get_document`, `find_nodes` |

Bulk drawing for AI: `create_diagram` adds nodes + edges and arranges them in one undoable step.

## Development

```bash
npm install
npm run dev          # server + Vite middleware on http://localhost:8790 (DATA_DIR=./data)
npm run typecheck
npm run build && npm start
```

Architecture: `src/shared` holds the document model, the deterministic command reducer (`commands.ts`), layouts, themes and import/export — used by both the browser and the server. The server (`src/server`) persists documents, keeps undo history as structural diffs, broadcasts operations over WebSocket, and exposes the tool registry over MCP and REST. The UI (`src/web`) is React + React Flow and dispatches the same commands optimistically.

## Testing

User-perspective tests are the primary suite:

- **Human journeys (Playwright, with video):** `BASE_URL=http://localhost:8790 npx playwright test`
- **AI agents in parallel (real `codex exec` agents over MCP, recorded):** `node scripts/ai-tests/run.mjs --base http://localhost:8790`

## Known limitations

- `capture_screenshot` and PNG/SVG export render in a connected browser tab; with no tab open the tool returns an error explaining how to fix it.
- Undo history is kept in server memory (it resets when the container restarts); documents persist.
- The server has no authentication — run it on localhost or a trusted network.

