# Recipes by diagram type

Read only the section for the diagram you are building. Each recipe states what tends to make that kind of diagram useful; adapt it to what the user asked for.

## Architecture or system map

- Group components into frames by boundary (clients, edge, services, data, third parties, or one frame per deployment unit) and set frameId on the members. Draw a flat sketch without frames only when the user asks for one.
- Cards (the default topic shape) for components: icon for the kind (🌐 web, ⚙️ service, 🗄️ database, 📨 queue), title for the name, subtitle for the repo path, runtime or endpoint, badge for ownership or status ("Proposed", "v2").
- Role store for databases and caches, external for third-party APIs and people.
- Label edges with what flows (HTTPS, gRPC, "order events"); dashed for async, animated for streaming.
- Layout graph LR (frames become clusters and the flow reads left to right), or TB for layered stacks. Use lanes only when the frames are meant as side-by-side columns; they keep the order you list them in.

## Codebase map

- Look at the code first: the top-level layout, entry points, packages and their main imports or calls. Build from what you read, not from file names alone.
- Pick a granularity that fits the screen: frames for top-level areas (app, server, shared, infra), topics for modules or packages; the module path goes in the subtitle and a one-line purpose in notes.
- Edges for the dependencies or data flows that matter to the user's question, labelled with what crosses them. Leave out incidental utility imports.
- For a large codebase, keep the overview at a coarse level and give big areas the subprocess role with a link to a detail document (create one per area). Offer to drill down rather than drawing everything at once.
- Verify with capture_screenshot that the layout is readable; regroup if it is too dense.

## Workflow, process or decision flow

- One start per trigger, an end per distinct outcome, and decisions with labelled branches (see "Logic" in SKILL.md).
- Frames as swimlanes for actors or teams; put each step in the lane of whoever does it.
- Stores for data the flow reads or writes and external for outside systems, connected to the steps that use them.
- Stickies connected to a step for business rules, SLAs and open questions.
- Layout graph LR (or lanes when using swimlanes). Then call describe_logic, fix any unintended issue (usually an unlabelled branch or a dead end) and check again.

## Mind map or brainstorm

- create_document with template mindmap, or a central topic plus children with parentId; auto-arrange keeps branches tidy (layout tree, direction mindmap, right or down).
- Keep each topic to a few words; put detail in notes. Colour the first-level branches.
- Use set_collapsed to fold deep branches when the map gets large.

## Plan or roadmap

- Frames for phases or time boxes; topics for work items with status (todo, doing, done, blocked), priority, tags and owner in the badge.
- Edges for dependencies ("blocks"). Stickies for risks and decisions.
- If the plan contains a process with decisions, give those steps roles so describe_logic can read them.

## Editing a diagram someone else made

- Read before writing: get_document (summary) for structure and ids, describe_logic for flows, find_nodes to locate things, and the user's selection from get_canvas_state.
- Keep their layout. Put new nodes in free space next to the ones they relate to (explicit x/y or parentId). When an insertion needs room, such as a step inserted into a chain, shift only the nodes in the way, all by the same offset, and leave everything else where it is. Never re-run a layout over their whole canvas; scope any auto_layout to the nodeIds you added, and ask before rearranging more.
- Prefer update_nodes over delete-and-recreate so ids, connections and history stay intact.
