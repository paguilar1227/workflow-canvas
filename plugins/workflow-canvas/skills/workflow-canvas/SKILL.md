---
name: workflow-canvas
description: Use whenever you work on Workflow Canvas, the infinite editable canvas the user and you share live through the workflow-canvas MCP tools (by default at http://localhost:8790), including before your first workflow-canvas tool call. Applies when the user asks to put, map, draw, diagram or visualize something on the canvas (a plan, system architecture, codebase, workflow or decision flow, pipeline or mind map), mentions a canvas document, or asks you to implement, review or write requirements (a BRD) from a diagram on it. Covers building diagrams people can keep editing, logic roles and describe_logic, saving .excalidraw files, screenshots, and starting the canvas when it is not running. Not for a standalone file the user does not want to keep editing (an HTML page, a Mermaid snippet or an image).
---

# Workflow Canvas

Workflow Canvas is an infinite canvas: XMind-style mind maps plus free-form diagrams with cards, shapes, frames (lanes or boundaries), stickies, text, freehand drawing and logic nodes (start, decision, end and more). The user works in the browser while you work through the `workflow-canvas` MCP tools on the same documents; every change appears live in their tab and can be undone by either of you. The tool descriptions document every argument; this skill covers how to use them well.

When the tools come from the workflow-canvas plugin, its server launcher starts Docker and the canvas container if needed, so they are usually ready. If they are missing or cannot connect, see "When the canvas is not available".

## Workflow

1. **Orient.** Call get_canvas_state: it gives the canvas address (canvasUrl), lists documents and tells you which one the user has open and what they selected. When the request refers to "this diagram" or "the selected step", that is where to look.
2. **Reuse before creating.** Prefer an existing document on the topic (list_documents, then open_document). Otherwise create_document with a short title and a template (blank, mindmap, architecture or workflow). It opens in the user's tab; pass open: false only for background work they did not ask to watch.
3. **Build in one call.** create_diagram adds all nodes and edges at once as a single undo step and lays them out. Give nodes short stable ids ("api", "orders-db") so edges, parentId and frameId can refer to them. Keep titles short and put details in subtitle, notes, badge, icon, tags, status, priority or link. Text fields accept Markdown and :shortcode: emoji. For content that already exists as Mermaid, a Markdown outline or an Excalidraw scene, import_content converts it.
4. **Use the recipe for the diagram type.** Read [references/recipes.md](references/recipes.md) for architecture maps, codebase maps, workflows and decision flows, mind maps, plans and roadmaps, and editing a diagram someone else made. Read only the section you need.
5. **Check, then hand over.** For flows, call describe_logic and make sure it reads the way you meant; its Issues list should be empty or deliberate. capture_screenshot shows exactly what the user sees (it needs their browser tab open). Then call control_view with action fit and give the user the link <canvasUrl>/?doc=<documentId>, using the canvasUrl from get_canvas_state (the port may not be the default).
6. **Save when a file is wanted.** save_to_file with an absolute path (a .excalidraw file, or a folder ending in /) writes an .excalidraw file and keeps it autosaved after every change by either of you. Without a path it saves to the file already attached, including one the user picked with Save; report the file the response names. If the server cannot reach the path (for example a folder outside the one shared with its container), the response has saved: false plus file.name and file.content: write that content yourself and tell the user this copy is not autosaved. Never overwrite an existing file unless the user asked (overwrite: true).

## Logic: making a diagram readable as a flow

Whenever a diagram describes a process, a workflow or decisions, encode its meaning, not just its look:

- Give topics a `role`: start (trigger), end (outcome), decision (yes/no or multi-way choice), parallel (paths that run at once, or a join), wait (timer, event or message), data (input/output such as a form or file), store (database), subprocess (a flow detailed elsewhere; link its document), external (a person, team or outside system). No role means an ordinary step. A role picks its shape unless you set one.
- Label every connector leaving a decision with its condition ("Yes", "No", "> $10k", "EU customer").
- Use frames as lanes for who owns each step, connect stickies to the steps they qualify (rules, open questions), and connect steps to the stores and external systems they read, write or call.

Before you implement, review, estimate or write requirements (a BRD, user stories, a test plan) from a diagram, call describe_logic on it first. It returns numbered steps from each start, every decision's conditions and where they lead, loops and merges, parallel splits and joins, lane owners, data stores read and written, external actors, notes, and an Issues list (unlabelled branches, dead ends, steps no start reaches, loops with no exit, a missing start). Treat each issue as an open question for the user instead of guessing. Use format json when you need node ids, and get_document for fields it does not cover.

## Rules

- The theme, side panels, zen mode and view mode are shared with the user's tab. Change them only when asked, and restore anything you changed to check your work.
- Do not delete documents, nodes or connectors the user made unless asked. Use undo for your own mistakes.
- Prefer one create_diagram or batched call over many small ones; each call shows up in the user's activity feed.
- Work only through the tools (MCP or the REST mirror below); do not edit the server's data files.

## When the canvas is not available

Check once, tell the user once, and carry on.

1. **The workflow-canvas tools are missing, or a call fails because the server cannot be reached.** Run `bash scripts/ensure-canvas.sh` from this skill's folder (the folder containing this SKILL.md). It starts Docker Desktop and the canvas container if needed, waits until the server answers and exits 0; on failure it prints the reason. It reads WFC_URL (default http://localhost:8790), WFC_CONTAINER and WFC_REPO. Then retry the tool once. If the tools are still missing from this session (many clients load MCP servers only at startup), use the REST mirror: POST <canvas url>/api/tools/<tool name> (the canvas url is WFC_URL when set, otherwise http://localhost:8790) with the tool's JSON arguments. The result is under result.json or result.text; a screenshot's PNG is base64 in result.image.data. Tell the user the MCP tools will be there in their next session.
2. **ensure-canvas.sh fails.** Pass on the reason it printed (Docker not installed, Docker Desktop would not start, or no canvas container or checkout to start). If a diagram is still needed, offer a standalone alternative such as Mermaid.
3. **A tool call returns an error.** Read the message (it names the bad argument or id), fix the call and retry once; do not loop.
