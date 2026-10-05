---
name: workflow-canvas
description: Build, edit, read and show plans, architectures, workflows, pipelines, decision flows, codebase maps and mind maps on the user's local Workflow Canvas (an infinite, editable canvas at localhost:8790) through the workflow-canvas MCP tools. Use when the user asks to visualize, diagram, map, sketch or lay out a plan, system, codebase, process or set of ideas, asks to put something on the canvas, mentions a canvas document or localhost:8790, asks you to implement, review or write requirements (a BRD) from a diagram you built together, or when an editable picture they can keep working on would explain relationships better than prose. Also covers reading a flow's logic with describe_logic, saving the drawing as an .excalidraw file, checking it with a screenshot, and starting the canvas when it is not running. Not for standalone HTML deliverables; use html-diagram or html-plan for those.
---

# Workflow Canvas

Workflow Canvas is the user's infinite canvas: XMind-style mind maps plus free-form diagrams with frames (lanes), stickies, text, freehand drawing and logic nodes (start, decision, end and more). It runs locally in Docker at http://localhost:8790. The user edits it in the browser and you edit the same documents live through the `workflow-canvas` MCP tools; every change appears in their open tab with an activity note.

This skill ships in the workflow-canvas plugin with the MCP server. The plugin's server launcher (`scripts/canvas-mcp.sh` next to this file) starts Docker Desktop and the canvas container if they are not running, so the tools are usually there from the start.

## When to use it

- The user asks to visualize, diagram, map or lay out a plan, architecture, workflow, pipeline, codebase, decision tree or brainstorm, or says "put it on the canvas".
- You are explaining structure, flow or dependencies and an editable picture the user can keep refining helps more than prose.
- The user asks you to implement, review, estimate or write requirements from a diagram on the canvas: read it with describe_logic first (see "Reading the logic").
- Use the html-diagram (or html-plan) skill instead when the deliverable is a standalone HTML artifact rather than something to keep editing.

## How to build one

1. **Check it is up.** Call get_canvas_state first. It also tells you which document the user has open and what they have selected. If the tools are missing or fail to connect, see "When the canvas is not available".
2. **Reuse before creating.** Look for an existing document on the topic with list_documents (titles; find_nodes searches inside one document) and open it with open_document. Otherwise call create_document with a title and a template (blank, mindmap, architecture or workflow). create_document opens the new document in the user's tab; pass open: false when you work in the background on something they did not ask to watch.
3. **Build it in one call.** Use create_diagram with all nodes and edges at once (one undo step). Give nodes short stable ids such as "api-gateway" so edges, parentId and frameId can reference them. Let layout: 'auto' arrange it, or call auto_layout afterwards (graph LR/TB for systems and pipelines, tree for parentId hierarchies, lanes for frames). For an existing outline or diagram, import_content takes Mermaid, a Markdown outline, an Excalidraw scene or Workflow Canvas JSON.
   - Node kinds: topic (cards; shapes card, rounded, pill, rectangle, diamond, circle, hexagon, cylinder, parallelogram), frame (a lane or boundary drawn behind its members), sticky (Markdown notes, task lists), text, drawing.
   - Keep titles short. Put details in subtitle, notes, badge, tags, status, priority and link instead of long titles. Titles, stickies and edge labels accept Markdown and :shortcode: emoji.
   - Mind maps: give children a parentId and use auto_layout mode tree.
4. **Make flows readable as logic.** For any process, workflow or decision flow, give topics a `role` and label the branches:
   - Roles: start (entry or trigger), end (outcome), decision (yes/no or multi-way choice), parallel (split into paths that run at once, or join them), wait (timer, event or message), data (input or output such as a form or file), store (database the flow reads or writes), subprocess (flow detailed elsewhere; link its document), external (person, team or outside system). No role means an ordinary step. A role picks the matching shape unless you set one.
   - Label every connector that leaves a decision with its condition ("Yes", "No", "> $10k", "EU customer"). Use frames as lanes for who owns each step, connect stickies to the step they qualify (rules, open questions), and connect steps to the stores and external systems they use.
5. **Frame it and hand it over.** Call control_view with action fit, then give the user the link http://localhost:8790/?doc=<documentId>.
6. **Check it.** For flows, call describe_logic and make sure it reads the way you meant and its Issues list is empty or intended. capture_screenshot returns a PNG of what the user sees (theme included) so you can verify the layout, or show it in your reply. It renders in a connected browser tab, briefly switching that tab to the document and back; if no tab is connected, give the user the link and ask them to open it.
7. **Save it when a file is wanted.** save_to_file with an absolute path (a .excalidraw file, or a folder ending in /) writes an .excalidraw file and then keeps it autosaved after every change. The server can only reach the folder shared into its container (by default ~/Documents); for any other path, such as your session artifacts folder, nothing is written and the response has saved: false, a reason, and file.name plus file.content (the .excalidraw JSON as a string): write file.content to that folder yourself as-is, and tell the user that copy does not autosave. Never overwrite an existing file unless the user asked (overwrite: true).
8. **Session tracker (Codex).** If you have the session tracker, canvases you edit through the workflow-canvas MCP tools are linked to your session automatically. After using the REST mirror, or for a document you did not touch, call its link_canvas with the documentId.

## Reading the logic

When the user wants you to act on a diagram (implement it, review it, estimate it, or draft a BRD or test plan from it), call describe_logic on that document before anything else. It returns the flow as numbered steps from each start, every decision's conditions and where they lead, loops ("loops back to step N"), merges ("continues at step N"), parallel splits and joins, lanes (frames) as owners, data stores read and written, external actors, notes attached to steps and loose notes, and an Issues list (unlabelled branches, dead ends, steps no start reaches, loops with no exit, a missing start). Use format json when you need ids. Treat each issue as an open question to raise with the user rather than guessing; get_document gives the remaining fields (notes, links, status) if you need them.

## Rules

- The theme, side panels, zen mode and view mode are shared with every open tab, including the user's. Do not change them unless asked, and restore anything you changed for your own checks.
- Do not delete documents, nodes or connectors the user made unless they asked. Use undo for your own mistakes.
- Prefer one create_diagram or batched call over many small ones; each call shows up in the user's activity feed.
- Only use the tools (MCP, or the REST mirror below). Do not edit the server's data files.

## When the canvas is not available

Check once, tell the user once, and carry on.

1. **The workflow-canvas tools are missing, or a call fails because the server cannot be reached.** Run `bash scripts/ensure-canvas.sh` from this skill's folder (the folder containing this SKILL.md). It starts Docker Desktop and the canvas container if needed, waits until the server answers, and exits 0; on failure it prints why. Then retry the tool once. If the tools are still missing from this session (some clients only load MCP servers at startup), use the REST mirror: POST http://localhost:8790/api/tools/<tool name> with the tool's JSON arguments (same names and arguments; the result is under result.json or result.text, and a screenshot's PNG is base64 in result.image.data). Tell the user once that the MCP tools will be available in their next session.
2. **ensure-canvas.sh fails.** Tell the user the reason it printed (Docker not installed, Docker Desktop would not start, or no canvas checkout to start). Fall back to the html-diagram skill if a diagram is still needed.
3. **A tool call fails with an error.** Read the message (it names the bad argument or id), fix the call and retry once; do not loop.
