import { z } from 'zod';
import type { CanvasDocument, CanvasNode, SessionState } from '../shared/types';
import { TREE_LAYOUTS } from '../shared/types';
import { edgeInputSchema, edgePatchSchema, layoutDirectionSchema, layoutModeSchema, nodeInputSchema, nodePatchSchema } from '../shared/schema';
import type { CommandInput, EdgeInput, LayoutDirection, LayoutMode, NodeInput } from '../shared/commands';
import { CommandError } from '../shared/commands';
import { THEMES, getTheme } from '../shared/themes';
import { exportMarkdown, exportMermaid, planImport, type ImportFormat } from '../shared/io';
import { cloneNodes } from '../shared/clipboard';
import { excalidrawFileName, exportExcalidraw } from '../shared/excalidraw';
import { TEMPLATE_IDS, type TemplateId } from '../shared/templates';
import { genId, type OpEvent, type Store } from './store';
import type { Hub } from './hub';
import type { FileSaver } from './files';
import { isAncestor } from '../shared/graph';
import { describeLogic } from '../shared/logic';

export interface ToolContext { origin: string }
export interface ToolOutput { json?: unknown; text?: string; image?: { data: string; mimeType: string } }
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: any, ctx: ToolContext) => Promise<ToolOutput>;
}

const docIdArg = z.string().min(1).optional().describe('Target document id. Defaults to the document currently open in the UI.');

export const SERVER_INSTRUCTIONS = [
  'Workflow Canvas is an infinite canvas (mind maps, architecture diagrams, workflows, codebase maps) shared live between a human UI and you.',
  'Everything a person can do in the UI is available as a tool; changes you make appear instantly in their browser and are undoable.',
  'Model: a document has nodes and edges. Node kinds: topic (cards/shapes), frame (swimlane/boundary drawn behind nodes; members move with it), sticky, text, drawing (freehand pen stroke from points).',
  'Hierarchy: set parentId to build XMind-style mind-map branches (auto-arranged when document setting autoArrange=true). Use edges for any other relationship (labels, arrows, dashed, animated).',
  'Coordinates are canvas pixels (x right, y down, top-left of node). Omit x/y to auto-place, then call auto_layout (graph | tree | lanes | grid).',
  'Fast path for a whole diagram: create_diagram with nodes (give each a short id) + edges referencing those ids + layout. Frames: create frame nodes and set frameId on members, then layout lanes.',
  'Read state with get_document (format summary), get_canvas_state, find_nodes. Verify visually with capture_screenshot (needs a browser tab open).',
  'View & UI: control_view (fit/focus/zoom), select, set_theme / list_themes (includes hand-drawn Excalidraw-style themes in light and dark), set_ui (panels, minimap, snap, search, zen/view mode, pen mode, inline edit), open_document. undo/redo are shared with the human.',
  'Text: sticky and text nodes render GitHub-flavoured Markdown (task lists toggle with a click); topic/frame titles and connector labels render inline Markdown. :shortcodes: (GitHub names, e.g. :rocket: :white_check_mark:) are converted to emoji in every text field, for people and AI alike.',
  'Logic: give topics a role (start, end, decision, parallel, wait, data, store, subprocess, external; none = an ordinary step) and label every connector leaving a decision with its condition (Yes/No or the case). describe_logic reads the diagram back as a numbered flow (branches with conditions, loops, merges, parallel paths, lanes as owners, data stores, external actors, attached notes) and lists gaps such as unlabelled branches or dead ends. Call it before you implement, review or write requirements from a diagram, and after you build one to check it says what you meant.',
  'Interop: import_content/export_document support Mermaid, Markdown outlines and Excalidraw (.excalidraw) scenes.',
  'Files: save_to_file with a path (a .excalidraw file or a folder such as your session artifacts folder) saves the document there and keeps it autosaved after every change; without a path it saves to the file already attached (by you or by the person pressing Save). If the server cannot reach the path (for example a hosted preview), it returns the file contents for you to write.',
].join('\n');

function summarizeDoc(doc: CanvasDocument, canUndo: boolean, canRedo: boolean): string {
  const lines: string[] = [];
  const fmt = (n: CanvasNode) => {
    const bits = ['[' + n.id + '] ' + n.kind + (n.shape ? '/' + n.shape : '') + ' "' + n.title + '"'];
    if (n.role) bits.push('role=' + n.role);
    if (n.subtitle) bits.push('sub="' + n.subtitle + '"');
    if (n.badge) bits.push('badge="' + n.badge + '"');
    if (n.icon) bits.push('icon=' + n.icon);
    if (n.color) bits.push('color=' + n.color);
    if (n.parentId) bits.push('parent=' + n.parentId);
    if (n.frameId) bits.push('frame=' + n.frameId);
    if (n.status && n.status !== 'none') bits.push('status=' + n.status);
    if (n.priority) bits.push('P' + n.priority);
    if (n.tags?.length) bits.push('tags=' + n.tags.join(','));
    if (n.collapsed) bits.push('collapsed');
    if (n.locked) bits.push('locked');
    if (n.notes) bits.push('notes=' + JSON.stringify(n.notes.length > 80 ? n.notes.slice(0, 80) + '…' : n.notes));
    if (n.points) bits.push('points=' + n.points.length);
    bits.push('@(' + n.x + ',' + n.y + ') ' + n.width + 'x' + n.height);
    return '- ' + bits.join(' ');
  };
  lines.push('Document "' + doc.title + '" [' + doc.id + '] — ' + doc.nodes.length + ' nodes, ' + doc.edges.length + ' edges. autoArrange=' + doc.settings.autoArrange + ' treeLayout=' + doc.settings.treeLayout + ' canUndo=' + canUndo + ' canRedo=' + canRedo);
  if (doc.description) lines.push('Description: ' + doc.description);
  const frames = doc.nodes.filter((n) => n.kind === 'frame');
  if (frames.length) { lines.push('Frames:'); for (const f of frames) lines.push(fmt(f)); }
  const rest = doc.nodes.filter((n) => n.kind !== 'frame');
  if (rest.length) { lines.push('Nodes:'); for (const n of rest) lines.push(fmt(n)); }
  if (doc.edges.length) {
    lines.push('Edges:');
    for (const e of doc.edges) lines.push('- [' + e.id + '] ' + e.source + (e.arrow === 'both' ? ' <-> ' : e.arrow === 'start' ? ' <- ' : e.arrow === 'none' ? ' -- ' : ' -> ') + e.target + (e.label ? ' "' + e.label + '"' : '') + ' (' + e.style + ', ' + e.routing + (e.color ? ', ' + e.color : '') + (e.animated ? ', animated' : '') + ')');
  }
  return lines.join('\n');
}

export function createTools(store: Store, hub: Hub, files: FileSaver): ToolDef[] {
  const resolveDoc = (id?: string): string => {
    if (id) { if (!store.has(id)) throw new Error('Document not found: ' + id + '. Use list_documents.'); return id; }
    const active = store.session.activeDocumentId;
    if (active && store.has(active)) return active;
    const first = store.list()[0];
    if (first) return first.id;
    return store.create('Untitled').id;
  };
  const anchorFor = (docId: string) => {
    const s = store.session;
    if (s.activeDocumentId !== docId || !s.viewportSize.width) return undefined;
    return { x: Math.round((-s.viewport.x + s.viewportSize.width / 2) / s.viewport.zoom), y: Math.round((-s.viewport.y + s.viewportSize.height / 2) / s.viewport.zoom) };
  };
  const run = (docId: string, input: CommandInput, ctx: ToolContext): OpEvent => {
    try { return store.apply(docId, input, { origin: ctx.origin, anchor: anchorFor(docId) }); }
    catch (err) { if (err instanceof CommandError) throw new Error(err.message); throw err; }
  };
  const brief = (n: CanvasNode) => ({ id: n.id, kind: n.kind, title: n.title, x: n.x, y: n.y, width: n.width, height: n.height, ...(n.parentId ? { parentId: n.parentId } : {}), ...(n.frameId ? { frameId: n.frameId } : {}) });
  const requireIds = (docId: string, ids: string[], kind: 'node' | 'edge') => {
    const d = store.get(docId)!;
    const have = new Set((kind === 'node' ? d.nodes : d.edges).map((x) => x.id));
    const missing = [...new Set(ids)].filter((x) => !have.has(x));
    if (missing.length) throw new Error('Unknown ' + kind + ' ids in document ' + docId + ': ' + missing.join(', ') + '. Nothing was changed. Use get_document or find_nodes to look up current ids.');
  };
  const checkParent = (docId: string, nodeId: string, parentId: string | null | undefined) => {
    if (!parentId) return;
    const d = store.get(docId)!;
    if (parentId === nodeId) throw new Error('A topic cannot be its own parent (' + nodeId + '). Nothing was changed.');
    if (!d.nodes.some((n) => n.id === parentId)) throw new Error('Unknown parent id: ' + parentId + '. Nothing was changed.');
    if (isAncestor(d, nodeId, parentId)) throw new Error('Cannot move ' + nodeId + ' under its own descendant ' + parentId + '. Nothing was changed.');
  };
  const resultFor = (docId: string, ev: OpEvent, extra: Record<string, unknown> = {}) => {
    const doc = store.get(docId)!;
    return { json: { ok: true, documentId: docId, change: ev.summary, nodeCount: doc.nodes.length, edgeCount: doc.edges.length, ...extra } };
  };
  const sessionView = (s: SessionState) => ({ activeDocumentId: s.activeDocumentId, theme: s.theme, selection: s.selection, selections: store.selectionsView(), viewport: s.viewport, viewportSize: s.viewportSize, panels: s.panels, snapToGrid: s.snapToGrid, background: s.background, mode: s.mode, search: s.search, zenMode: s.zenMode, viewMode: s.viewMode });

  const tools: ToolDef[] = [
    {
      name: 'get_canvas_state', title: 'Get canvas state',
      description: 'Overview of the app: documents, the document open in the UI, theme, connected browser UIs, the human\'s current selection (session.selection is for the active document; session.selections maps every document id to its current selection) and viewport. Call this first.',
      input: {}, annotations: { readOnlyHint: true },
      run: async () => ({ json: { connectedUIs: hub.uiCount, session: sessionView(store.session), documents: store.list(), themes: THEMES.map((t) => t.id) } }),
    },
    {
      name: 'list_documents', title: 'List documents', description: 'List all canvases (id, title, counts, last update).',
      input: {}, annotations: { readOnlyHint: true },
      run: async () => ({ json: { activeDocumentId: store.session.activeDocumentId, documents: store.list() } }),
    },
    {
      name: 'get_document', title: 'Read a document',
      description: "Read a canvas. format 'summary' (default) gives a compact line per frame/node/edge with ids, text, colours, hierarchy and geometry; 'json' gives the full document.",
      input: { documentId: docIdArg, format: z.enum(['summary', 'json']).optional() }, annotations: { readOnlyHint: true },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const doc = store.get(id)!;
        return a.format === 'json' ? { json: doc } : { text: summarizeDoc(doc, store.canUndo(id), store.canRedo(id)) };
      },
    },
    {
      name: 'describe_logic', title: 'Describe the logic',
      description: "Read a canvas as a flow you can implement or turn into requirements: numbered steps following the arrows from each start, decisions with each condition and where it leads, loops, merges, parallel splits/joins, lanes (frames) as owners, data stores read/written, external actors, notes, and an Issues list of gaps (unlabelled decision branches, dead ends, unreachable steps, loops with no exit, missing start). Roles come from each topic's role (diamond/cylinder/parallelogram shapes count as decision/store/data when no role is set). format 'markdown' (default) or 'json'.",
      input: { documentId: docIdArg, format: z.enum(['markdown', 'json']).optional() }, annotations: { readOnlyHint: true },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const res = describeLogic(store.get(id)!);
        return a.format === 'json' ? { json: res.report } : { text: res.markdown };
      },
    },
    {
      name: 'find_nodes', title: 'Find nodes',
      description: 'Case-insensitive search across titles, subtitles, notes, badges and tags. Set highlight=true to also highlight matches in the UI search bar.',
      input: { documentId: docIdArg, query: z.string().min(1), highlight: z.boolean().optional() }, annotations: { readOnlyHint: true },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const q = String(a.query).toLowerCase();
        const matches = store.get(id)!.nodes.filter((n) => [n.title, n.subtitle, n.notes, n.badge, ...(n.tags ?? [])].some((v) => v?.toLowerCase().includes(q))).map(brief);
        if (a.highlight) { store.setSession({ search: a.query }); await hub.view('set_ui', { search: a.query }, id); }
        return { json: { documentId: id, query: a.query, count: matches.length, matches } };
      },
    },
    {
      name: 'create_document', title: 'Create document',
      description: "Create a new canvas from a template ('blank', 'mindmap', 'architecture' lanes, 'workflow'). By default it is opened in the UI.",
      input: { title: z.string().min(1), template: z.enum(TEMPLATE_IDS as unknown as [string, ...string[]]).optional(), description: z.string().optional(), open: z.boolean().optional().describe('Open it in the browser UI (default true).') },
      run: async (a) => {
        const doc = store.create(a.title, (a.template ?? 'blank') as TemplateId, a.description);
        if (a.open !== false) { store.setSession({ activeDocumentId: doc.id }); await hub.view('open_document', { documentId: doc.id }); }
        return { json: { ok: true, documentId: doc.id, title: doc.title, nodes: doc.nodes.map(brief) } };
      },
    },
    {
      name: 'save_to_file', title: 'Save to file',
      description: 'Save the document as an .excalidraw file and keep it autosaved after every change (yours and the person\'s). The first time, give path: a .excalidraw file, or a folder such as your session artifacts folder (the file is named after the document title). Later calls without path save to the attached file, whether you attached it or the person did with Save. If the server cannot reach the path (a hosted preview, or a folder outside the one shared with the server), nothing is written and the response carries the file contents for you to write yourself.',
      input: {
        documentId: docIdArg,
        path: z.string().min(1).optional().describe('Absolute path to a .excalidraw file, or to a folder to save "<title>.excalidraw" in. Omit to save to the file already attached.'),
        overwrite: z.boolean().optional().describe('Replace an existing file that is not already this document\'s file (default false).'),
      },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const doc = store.get(id)!;
        const handBack = (reason: string, extra: Record<string, unknown> = {}) => ({ json: { ok: false, saved: false, documentId: id, reason, ...extra, file: { name: excalidrawFileName(doc.title), content: JSON.stringify(exportExcalidraw(doc)) }, next: 'Write file.content to a .excalidraw file yourself. That copy is not autosaved: save again after later changes.' } });
        if (a.path) {
          const place = await files.place(id, a.path, a.overwrite === true);
          if (!place.ok) { if (place.unreachable) return handBack(place.reason); throw new Error(place.reason); }
          const res = await files.attach(id, place.file);
          if (!res.ok) return handBack('Writing ' + place.file + ' failed: ' + res.error);
          return { json: { ok: true, documentId: id, file: res.file, autosave: true } };
        }
        const server = files.fileFor(id) ? await files.save(id) : null;
        // Several tabs can show the document; only the one with the file attached can save it, so prefer its answer.
        const ui = (await hub.view('save_file', {}, id, (r) => r.ok === true)) as Record<string, unknown>;
        if (server?.ok || ui?.ok === true) {
          const person = ui?.ok === true && typeof ui.file === 'string' ? ui.file : undefined;
          if (!person) return { json: { ok: true, documentId: id, file: server!.file, autosave: true, ui } };
          return { json: { ok: true, documentId: id, file: person, savedTo: 'the file the person picked with Save (report this one to them)', ...(server?.ok ? { alsoSaved: server.file, autosave: true } : {}), ui } };
        }
        if (server) return handBack('Writing ' + server.file + ' failed: ' + server.error, { ui });
        // The person's browser has a file attached but could not write it (for example autosave is paused): report that, not "no file".
        if (ui?.file) return { json: { ok: false, documentId: id, reason: String(ui.reason ?? 'The browser could not save ' + ui.file + '.'), ui } };
        if (!files.roots.length) return handBack('No file is attached, and this server cannot write files on your machine (for example, a hosted preview).', { ui });
        return { json: { ok: false, documentId: id, reason: 'No file is attached yet. Call again with path set to the folder where your session keeps its files (its artifacts folder) to save it there and keep it autosaved. If the server cannot reach that folder, the response carries the file contents for you to write there. The person can also press Save to pick a file.', ui } };
      },
    },
    {
      name: 'open_document', title: 'Open document', description: 'Switch the browser UI to a document (it becomes the default target for other tools).',
      input: { documentId: z.string().min(1) },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        store.setSession({ activeDocumentId: id });
        const ack = await hub.view('open_document', { documentId: id });
        return { json: { ok: true, documentId: id, ui: ack } };
      },
    },
    {
      name: 'update_document', title: 'Update document',
      description: "Rename/describe a document or change its mind-map settings: autoArrange (keep tree branches auto-positioned) and treeLayout ('mindmap' balanced, 'right' logic chart, 'left', 'down' org chart).",
      input: { documentId: docIdArg, title: z.string().optional(), description: z.string().optional(), autoArrange: z.boolean().optional(), treeLayout: z.enum(TREE_LAYOUTS as [string, ...string[]]).optional() },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const settings = a.autoArrange !== undefined || a.treeLayout ? { autoArrange: a.autoArrange, treeLayout: a.treeLayout } : undefined;
        const ev = run(id, { type: 'update_document', title: a.title, description: a.description, settings }, ctx);
        const doc = store.get(id)!;
        return resultFor(id, ev, { title: doc.title, settings: doc.settings });
      },
    },
    {
      name: 'duplicate_document', title: 'Duplicate document', description: 'Copy a whole canvas into a new document.',
      input: { documentId: docIdArg, title: z.string().optional() },
      run: async (a) => { const doc = store.duplicate(resolveDoc(a.documentId), a.title); return { json: { ok: true, documentId: doc.id, title: doc.title } }; },
    },
    {
      name: 'delete_document', title: 'Delete document', description: 'Delete a canvas (the file is moved to the data/trash folder).',
      input: { documentId: z.string().min(1).describe('Exact id of the document to delete (never defaulted).') }, annotations: { destructiveHint: true },
      run: async (a) => {
        if (!store.has(a.documentId)) throw new Error('Document not found: ' + a.documentId + '. Use list_documents.');
        await store.remove(a.documentId);
        return { json: { ok: true, deleted: a.documentId, documents: store.list() } };
      },
    },
    {
      name: 'add_nodes', title: 'Add nodes',
      description: 'Add topics, frames, stickies or text. Give your own ids to reference them later. With parentId the node becomes a mind-map child (auto-placed); without x/y nodes are placed in view and can be arranged with auto_layout.',
      input: { documentId: docIdArg, nodes: z.array(nodeInputSchema).min(1) },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const ev = run(id, { type: 'add_nodes', nodes: a.nodes as NodeInput[] }, ctx);
        const ids = ev.touched;
        const doc = store.get(id)!;
        return resultFor(id, ev, { created: doc.nodes.filter((n) => ids.includes(n.id)).map(brief) });
      },
    },
    {
      name: 'update_nodes', title: 'Update nodes',
      description: 'Edit any node fields (title, subtitle, notes, badge, icon, shape, role, color, size, position, parentId, frameId, tags, link, status, priority, collapsed, locked). Send "" or null to clear a field.',
      input: { documentId: docIdArg, updates: z.array(nodePatchSchema).min(1) },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const missing = a.updates.filter((u: { id: string }) => !store.get(id)!.nodes.some((n) => n.id === u.id)).map((u: { id: string }) => u.id);
        if (missing.length) throw new Error('Unknown node ids: ' + missing.join(', '));
        for (const u of a.updates as { id: string; parentId?: string | null }[]) checkParent(id, u.id, u.parentId);
        const ev = run(id, { type: 'update_nodes', updates: a.updates }, ctx);
        return resultFor(id, ev);
      },
    },
    {
      name: 'delete_nodes', title: 'Delete nodes',
      description: 'Delete nodes and their connectors. withDescendants (default true) also removes mind-map children; otherwise children move up to the grandparent. Deleting a frame keeps its members.',
      input: { documentId: docIdArg, ids: z.array(z.string()).min(1), withDescendants: z.boolean().optional() }, annotations: { destructiveHint: true },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); requireIds(id, a.ids, 'node'); return resultFor(id, run(id, { type: 'delete_nodes', ids: a.ids, withDescendants: a.withDescendants }, ctx)); },
    },
    {
      name: 'move_nodes', title: 'Move nodes',
      description: 'Move nodes to absolute x/y or by dx/dy. includeContents (default true) carries frame members and mind-map descendants along, like dragging in the UI. Resize with update_nodes width/height.',
      input: { documentId: docIdArg, moves: z.array(z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), dx: z.number().optional(), dy: z.number().optional() })).min(1), includeContents: z.boolean().optional() },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const doc = store.get(id)!;
        const moves = a.moves.map((m: { id: string; x?: number; y?: number; dx?: number; dy?: number }) => {
          const n = doc.nodes.find((x) => x.id === m.id);
          if (!n) throw new Error('Unknown node id: ' + m.id);
          return { id: m.id, x: (m.x ?? n.x) + (m.dx ?? 0), y: (m.y ?? n.y) + (m.dy ?? 0) };
        });
        return resultFor(id, run(id, { type: 'move_nodes', moves, includeContents: a.includeContents !== false }, ctx));
      },
    },
    {
      name: 'duplicate_nodes', title: 'Duplicate nodes', description: 'Copy nodes (with their branches, frame members and internal connectors) with an offset — like Cmd+D / copy-paste.',
      input: { documentId: docIdArg, ids: z.array(z.string()).min(1), offsetX: z.number().optional(), offsetY: z.number().optional() },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const { nodes, edges, idMap } = cloneNodes(store.get(id)!, a.ids, { x: a.offsetX ?? 40, y: a.offsetY ?? 40 }, genId);
        const ev = run(id, { type: 'batch', commands: [{ type: 'add_nodes', nodes }, { type: 'add_edges', edges }] }, ctx);
        return resultFor(id, ev, { idMap });
      },
    },
    {
      name: 'reparent_node', title: 'Re-parent topic', description: 'Move a topic under another topic in the mind-map hierarchy (parentId null detaches it as a floating root). Cycles are rejected.',
      input: { documentId: docIdArg, id: z.string(), parentId: z.string().nullable() },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); requireIds(id, [a.id], 'node'); checkParent(id, a.id, a.parentId); return resultFor(id, run(id, { type: 'reparent', id: a.id, parentId: a.parentId }, ctx)); },
    },
    {
      name: 'set_collapsed', title: 'Collapse / expand', description: 'Collapse or expand mind-map branches (hides/shows descendants).',
      input: { documentId: docIdArg, ids: z.array(z.string()).min(1), collapsed: z.boolean() },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); return resultFor(id, run(id, { type: 'set_collapsed', ids: a.ids, collapsed: a.collapsed }, ctx)); },
    },
    {
      name: 'add_edges', title: 'Connect nodes', description: 'Add connectors between nodes (relationships, data flow, dependencies) with optional label, arrows, dash style, colour, routing and animation.',
      input: { documentId: docIdArg, edges: z.array(edgeInputSchema).min(1) },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const ev = run(id, { type: 'add_edges', edges: a.edges as EdgeInput[] }, ctx);
        const cmd = ev.cmd as Extract<typeof ev.cmd, { type: 'add_edges' }>;
        return resultFor(id, ev, { created: cmd.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label })) });
      },
    },
    {
      name: 'update_edges', title: 'Update connectors', description: 'Edit connector label, endpoints, arrows, style, routing, colour, animation or forced sides.',
      input: { documentId: docIdArg, updates: z.array(edgePatchSchema).min(1) },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); return resultFor(id, run(id, { type: 'update_edges', updates: a.updates }, ctx)); },
    },
    {
      name: 'delete_edges', title: 'Delete connectors', description: 'Remove connectors by id.',
      input: { documentId: docIdArg, ids: z.array(z.string()).min(1) }, annotations: { destructiveHint: true },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); requireIds(id, a.ids, 'edge'); return resultFor(id, run(id, { type: 'delete_edges', ids: a.ids }, ctx)); },
    },
    {
      name: 'create_diagram', title: 'Create a whole diagram',
      description: "Atomically add many nodes + edges and arrange them (one undo step). Reference node ids you choose in edges, parentId and frameId. layout: 'auto' (default: lanes if frames, tree if only hierarchy, else graph LR), 'graph', 'tree', 'lanes', 'grid' or 'none'. clear=true replaces the current content. For flows, set each topic's role (start, decision, end, …) and label the connectors leaving a decision with their conditions, then check the result with describe_logic.",
      input: {
        documentId: docIdArg,
        nodes: z.array(nodeInputSchema).min(1),
        edges: z.array(edgeInputSchema).optional(),
        layout: z.enum(['auto', 'graph', 'tree', 'lanes', 'grid', 'none']).optional(),
        direction: layoutDirectionSchema.optional().describe("graph: LR|TB|RL|BT; tree: mindmap|right|left|down"),
        clear: z.boolean().optional(),
        fitView: z.boolean().optional().describe('Fit the UI viewport to the result (default true).'),
      },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const nodes = (a.nodes as NodeInput[]).map((n) => ({ ...n, id: n.id?.trim() || genId() }));
        const ids = nodes.map((n) => n.id as string);
        const cmds: CommandInput[] = [];
        if (a.clear) cmds.push({ type: 'replace_content', nodes: [], edges: [] });
        cmds.push({ type: 'add_nodes', nodes: nodes.filter((n) => n.kind === 'frame') }, { type: 'add_nodes', nodes: nodes.filter((n) => n.kind !== 'frame') });
        if (a.edges?.length) cmds.push({ type: 'add_edges', edges: a.edges });
        let mode = a.layout ?? 'auto';
        if (mode === 'auto') mode = nodes.some((n) => n.kind === 'frame') ? 'lanes' : nodes.some((n) => n.parentId) && !a.edges?.length ? 'tree' : 'graph';
        if (mode !== 'none') cmds.push({ type: 'layout', mode: mode as LayoutMode, direction: a.direction as LayoutDirection | undefined, nodeIds: ids });
        const ev = run(id, { type: 'batch', commands: cmds.filter((c) => c.type !== 'add_nodes' || c.nodes.length) }, ctx);
        if (a.fitView !== false) await hub.view('viewport', { action: 'fit' }, id);
        return resultFor(id, ev, { layout: mode, summary: summarizeDoc(store.get(id)!, store.canUndo(id), store.canRedo(id)) });
      },
    },
    {
      name: 'auto_layout', title: 'Auto layout',
      description: "Arrange nodes. 'graph' = layered dagre layout (direction LR/TB/RL/BT, frames become clusters); 'tree' = XMind layouts for parentId hierarchies (mindmap/right/left/down); 'lanes' = frames as equal-height swimlane columns; 'grid'. Optional nodeIds/rootId scope it.",
      input: { documentId: docIdArg, mode: layoutModeSchema, direction: layoutDirectionSchema.optional(), rootId: z.string().optional(), nodeIds: z.array(z.string()).optional(), spacing: z.number().positive().optional().describe('Spacing multiplier, 1 = default.'), fitView: z.boolean().optional() },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        const ev = run(id, { type: 'layout', mode: a.mode, direction: a.direction, rootId: a.rootId, nodeIds: a.nodeIds, spacing: a.spacing }, ctx);
        if (a.fitView !== false) await hub.view('viewport', { action: 'fit' }, id);
        return resultFor(id, ev);
      },
    },
    {
      name: 'align_nodes', title: 'Align nodes', description: 'Align 2+ nodes: left, center, right, top, middle, bottom.',
      input: { documentId: docIdArg, ids: z.array(z.string()).min(2), align: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']) },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); return resultFor(id, run(id, { type: 'align', ids: a.ids, align: a.align }, ctx)); },
    },
    {
      name: 'distribute_nodes', title: 'Distribute nodes', description: 'Evenly space 3+ nodes horizontally or vertically.',
      input: { documentId: docIdArg, ids: z.array(z.string()).min(3), axis: z.enum(['horizontal', 'vertical']) },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); return resultFor(id, run(id, { type: 'distribute', ids: a.ids, axis: a.axis }, ctx)); },
    },
    {
      name: 'fit_frame_to_contents', title: 'Fit frame', description: 'Resize a frame to wrap its member nodes.',
      input: { documentId: docIdArg, frameId: z.string(), padding: z.number().nonnegative().optional() },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); return resultFor(id, run(id, { type: 'fit_frame', id: a.frameId, padding: a.padding }, ctx)); },
    },
    {
      name: 'import_content', title: 'Import',
      description: "Import Mermaid flowchart text (subgraphs become frames), a Markdown outline (headings/bullets become a mind map), an Excalidraw scene (.excalidraw JSON: shapes, bound text, bound arrows, frames, freedraw) or Workflow Canvas JSON. mode 'append' (default) or 'replace'.",
      input: { documentId: docIdArg, format: z.enum(['mermaid', 'markdown', 'excalidraw', 'json']), content: z.string().min(1), mode: z.enum(['append', 'replace']).optional(), placement: z.enum(['keep', 'beside']).optional().describe("For json/excalidraw appends: 'keep' (default) honours the coordinates in the content; 'beside' shifts the import to the right of existing content (offset is reported). Markdown and Mermaid have no coordinates, so appends of those are always laid out and placed beside existing content.") },
      annotations: { destructiveHint: true },
      run: async (a, ctx) => {
        const id = resolveDoc(a.documentId);
        let plan: ReturnType<typeof planImport>;
        try { plan = planImport(a.format as ImportFormat, a.content, a.mode ?? 'append', store.get(id)!, () => 'i' + genId().slice(0, 4) + '-', a.placement ?? 'keep'); }
        catch (err) { throw new Error('Import failed: ' + (err as Error).message); }
        const ev = run(id, plan.cmd, ctx);
        await hub.view('viewport', { action: 'fit' }, id);
        const notes = [plan.prefix ? 'Imported ids were prefixed with "' + plan.prefix + '" to avoid collisions with existing ids; call get_document for current ids.' : 'Source ids were kept.'];
        if (plan.offset) notes.push('Content was shifted by (' + plan.offset.dx + ', ' + plan.offset.dy + ') to sit beside existing content.');
        else if (a.format === 'json' || a.format === 'excalidraw') notes.push('Coordinates from the content were kept.');
        return resultFor(id, ev, { ...(plan.prefix ? { idPrefix: plan.prefix } : {}), ...(plan.offset ? { offset: plan.offset } : {}), note: notes.join(' ') });
      },
    },
    {
      name: 'export_document', title: 'Export',
      description: "Export as 'markdown' outline, 'logic' (the describe_logic reading as Markdown), 'mermaid' flowchart, 'excalidraw' scene JSON (open it at excalidraw.com or any Excalidraw editor), 'json', or render 'png' / 'svg' through the connected browser UI.",
      input: { documentId: docIdArg, format: z.enum(['markdown', 'logic', 'mermaid', 'excalidraw', 'json', 'png', 'svg']) }, annotations: { readOnlyHint: true },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const doc = store.get(id)!;
        if (a.format === 'markdown') return { text: exportMarkdown(doc) };
        if (a.format === 'logic') return { text: describeLogic(doc).markdown };
        if (a.format === 'mermaid') return { text: exportMermaid(doc) };
        if (a.format === 'json') return { text: JSON.stringify(doc, null, 1) };
        if (a.format === 'excalidraw') return { text: JSON.stringify(exportExcalidraw(doc), null, 1) };
        const res = await hub.capture(id, a.format, true);
        if (!res.dataUrl) throw new Error(res.error ?? 'Capture failed');
        if (a.format === 'svg') return { text: decodeURIComponent(res.dataUrl.replace(/^data:image\/svg\+xml;charset=utf-8,/, '')) };
        return { image: { data: res.dataUrl.split(',')[1], mimeType: 'image/png' }, text: 'PNG export of "' + doc.title + '"' };
      },
    },
    {
      name: 'capture_screenshot', title: 'Screenshot the canvas',
      description: 'Render the document as the human sees it (theme included) and return a PNG so you can visually verify layout. Needs a browser tab open on the app. fit=true (default) frames the whole document.',
      input: { documentId: docIdArg, fit: z.boolean().optional() }, annotations: { readOnlyHint: true },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const res = await hub.capture(id, 'png', a.fit !== false);
        if (!res.dataUrl) throw new Error(res.error ?? 'Capture failed');
        return { image: { data: res.dataUrl.split(',')[1], mimeType: 'image/png' }, text: 'Screenshot of "' + store.get(id)!.title + '" (theme ' + store.session.theme + ')' };
      },
    },
    {
      name: 'undo', title: 'Undo', description: 'Undo the last change on a document (shared history with the human).',
      input: { documentId: docIdArg },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); const ev = store.undo(id, ctx.origin); return ev ? resultFor(id, ev) : { json: { ok: false, documentId: id, note: 'Nothing to undo' } }; },
    },
    {
      name: 'redo', title: 'Redo', description: 'Redo the last undone change.',
      input: { documentId: docIdArg },
      run: async (a, ctx) => { const id = resolveDoc(a.documentId); const ev = store.redo(id, ctx.origin); return ev ? resultFor(id, ev) : { json: { ok: false, documentId: id, note: 'Nothing to redo' } }; },
    },
    {
      name: 'select', title: 'Select', description: "Change the selection shown in the UI (and inspector). mode: 'replace' (default), 'add', 'remove', 'clear'. Read the human's selection via get_canvas_state.",
      input: { documentId: docIdArg, nodeIds: z.array(z.string()).optional(), edgeIds: z.array(z.string()).optional(), mode: z.enum(['replace', 'add', 'remove', 'clear']).optional() },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const doc = store.get(id)!;
        const unknownNodes = (a.nodeIds ?? []).filter((x: string) => !doc.nodes.some((n) => n.id === x));
        const unknownEdges = (a.edgeIds ?? []).filter((x: string) => !doc.edges.some((e) => e.id === x));
        if (unknownNodes.length || unknownEdges.length) throw new Error('Unknown ids in document ' + id + ': ' + [...unknownNodes, ...unknownEdges].join(', ') + '. Use get_document or find_nodes to look up current ids.');
        const cur = store.selectionFor(id);
        const mode = a.mode ?? 'replace';
        const apply = (base: string[], ids: string[] = []) => mode === 'clear' ? [] : mode === 'replace' ? ids : mode === 'add' ? [...new Set([...base, ...ids])] : base.filter((x) => !ids.includes(x));
        const selection = { nodes: apply(cur.nodes, a.nodeIds), edges: apply(cur.edges, a.edgeIds) };
        store.setSelection(id, selection);
        const ack = await hub.view('select', selection, id);
        return { json: { ok: true, documentId: id, selection, ui: ack } };
      },
    },
    {
      name: 'control_view', title: 'Control the viewport',
      description: "Zoom and pan the UI. action: 'fit' (whole doc or nodeIds), 'focus' (centre nodeIds, optional zoom), 'zoom_in', 'zoom_out', 'set_zoom' (zoom), 'set_viewport' (x, y, zoom in screen transform terms), 'center' (canvas x,y), 'pan' (dx, dy screen px).",
      input: { documentId: docIdArg, action: z.enum(['fit', 'focus', 'zoom_in', 'zoom_out', 'set_zoom', 'set_viewport', 'center', 'pan']), nodeIds: z.array(z.string()).optional(), zoom: z.number().positive().optional(), x: z.number().optional(), y: z.number().optional(), dx: z.number().optional(), dy: z.number().optional(), padding: z.number().nonnegative().optional().describe('Margin around the fitted nodes in screen pixels (fit/focus).') },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        const unknown = (a.nodeIds ?? []).filter((x: string) => !store.get(id)!.nodes.some((n) => n.id === x));
        if (unknown.length) throw new Error('Unknown node ids in document ' + id + ': ' + unknown.join(', ') + '. Use get_document or find_nodes to look up current ids.');
        const { documentId: _d, ...args } = a;
        const ack = await hub.view('viewport', args, id);
        return { json: { ok: true, documentId: id, ui: ack } };
      },
    },
    {
      name: 'list_themes', title: 'List themes', description: 'Available UI themes (id, name, light/dark, description, design reference).',
      input: {}, annotations: { readOnlyHint: true },
      run: async () => ({ json: { active: store.session.theme, themes: THEMES.map(({ tokens: _t, ...t }) => t) } }),
    },
    {
      name: 'set_theme', title: 'Set theme', description: 'Switch the UI theme for everyone viewing (persisted).',
      input: { themeId: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]) },
      run: async (a) => { store.setSession({ theme: a.themeId }); const t = getTheme(a.themeId); return { json: { ok: true, theme: t.id, name: t.name, mode: t.mode } }; },
    },
    {
      name: 'set_ui', title: 'Set UI options',
      description: "Toggle panels and canvas options: inspector, outline, minimap, snapToGrid, mode ('select' | 'pan' | 'draw' freehand pen), zenMode (hide chrome), viewMode (read-only for the human), background ('theme' | 'dots' | 'lines' | 'cross' | 'none'), search (highlights matches; '' clears), editNodeId (open inline title editing for the human).",
      input: { documentId: docIdArg, inspector: z.boolean().optional(), outline: z.boolean().optional(), minimap: z.boolean().optional(), snapToGrid: z.boolean().optional(), mode: z.enum(['select', 'pan', 'draw']).optional(), zenMode: z.boolean().optional(), viewMode: z.boolean().optional(), background: z.enum(['theme', 'dots', 'lines', 'cross', 'none']).optional(), search: z.string().optional(), editNodeId: z.string().optional() },
      run: async (a) => {
        const id = resolveDoc(a.documentId);
        if (a.editNodeId) requireIds(id, [a.editNodeId], 'node');
        const s = store.session;
        const patch: Partial<SessionState> = {};
        if (a.inspector !== undefined || a.outline !== undefined || a.minimap !== undefined) patch.panels = { inspector: a.inspector ?? s.panels.inspector, outline: a.outline ?? s.panels.outline, minimap: a.minimap ?? s.panels.minimap };
        if (a.snapToGrid !== undefined) patch.snapToGrid = a.snapToGrid;
        if (a.zenMode !== undefined) patch.zenMode = a.zenMode;
        if (a.viewMode !== undefined) patch.viewMode = a.viewMode;
        if (a.mode) patch.mode = a.mode;
        if (a.background) patch.background = a.background;
        if (a.search !== undefined) patch.search = a.search;
        store.setSession(patch);
        const { documentId: _d, ...args } = a;
        const ack = await hub.view('set_ui', args, id);
        return { json: { ok: true, session: sessionView(store.session), ui: ack } };
      },
    },
  ];
  return tools;
}

export function toolJsonSchemas(tools: ToolDef[]) {
  return tools.map((t) => ({ name: t.name, title: t.title, description: t.description, annotations: t.annotations ?? {}, inputSchema: z.toJSONSchema(z.object(t.input)) }));
}

export async function invokeTool(tools: ToolDef[], name: string, args: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error('Unknown tool: ' + name);
  const parsed = z.object(tool.input).safeParse(args ?? {});
  if (!parsed.success) throw new Error('Invalid arguments for ' + name + ': ' + parsed.error.message);
  return tool.run(parsed.data, ctx);
}

