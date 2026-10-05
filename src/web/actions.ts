import { nanoid } from 'nanoid';
import { get, set, toast } from './store';
import { dispatch, callTool, undo as wsUndo, redo as wsRedo, updateSession, renderCanvasImage, openDocument } from './sync';
import { flow, viewportCenter } from './flowApi';
import type { CanvasNode, ColorName, NodeKind, NodeRole, NodeShape, NodeStatus, Side } from '../shared/types';
import { ROLE_INFO, describeLogic, roleOf } from '../shared/logic';
import type { CommandInput, EdgePatch, LayoutDirection, LayoutMode, NodePatch } from '../shared/commands';
import { childrenMap, descendants } from '../shared/graph';
import { cloneNodes } from '../shared/clipboard';
import { defaultSize, bounds } from '../shared/sizes';
import { exportMarkdown, exportMermaid, planImport, type ImportFormat } from '../shared/io';
import { FRAME_HEADER, FRAME_PAD } from '../shared/layout';
import type { TemplateId } from '../shared/templates';
import { exportExcalidraw } from '../shared/excalidraw';

const doc = () => get().doc;
const sel = () => get().selection;
const nodeById = (id: string) => doc()?.nodes.find((n) => n.id === id);

export function select(nodes: string[], edges: string[] = []) { set({ selection: { nodes, edges } }); }
export function edit(id: string | null) { set({ editingId: id }); }

function created(cmd: ReturnType<typeof dispatch>): string[] {
  if (!cmd) return [];
  if (cmd.type === 'add_nodes') return cmd.nodes.map((n) => n.id);
  if (cmd.type === 'batch') return cmd.commands.flatMap((c) => (c.type === 'add_nodes' ? c.nodes.map((n) => n.id) : []));
  return [];
}

export function addNode(kind: NodeKind = 'topic', at?: { x: number; y: number }, extra: Partial<CanvasNode> = {}) {
  const shape: NodeShape | undefined = kind === 'topic' ? (extra.shape ?? 'card') : undefined;
  const size = defaultSize(kind, shape);
  const p = kind === 'frame' && at ? at : freeSpotNear(at ?? viewportCenter(), size);
  const ids = created(dispatch({ type: 'add_nodes', nodes: [{ kind, shape, x: Math.round(p.x - size.width / 2), y: Math.round(p.y - size.height / 2), title: kind === 'frame' ? 'New frame' : kind === 'sticky' ? '' : kind === 'text' ? 'Text' : 'New topic', ...extra }] }));
  if (ids[0]) { select([ids[0]]); edit(ids[0]); }
  return ids[0];
}

/** Toolbar and shortcut inserts: next to the selected element, or arm a placement cursor for the next canvas click. */
export function insert(kind: NodeKind, extra: Partial<CanvasNode> = {}) {
  const s = get();
  if (s.session.viewMode) return;
  const selected = sel().nodes.map(nodeById).filter((n): n is CanvasNode => !!n);
  if (kind === 'frame' && selected.some((n) => n.kind !== 'frame')) { frameSelection(); return; }
  const anchor = selected.find((n) => n.kind !== 'drawing') ?? selected[0];
  if (anchor) { spawnBeside(kind, anchor, extra); return; }
  if (s.session.mode !== 'select') setMode('select');
  set({ placing: { kind, extra }, areaSelect: false, menu: null, openMenu: null });
}

/** Place the armed element at a canvas point, or in free space at the view centre when no point is given. */
export function placeAt(point?: { x: number; y: number }) {
  const p = get().placing;
  if (!p) return;
  set({ placing: null });
  addNode(p.kind, point, p.extra);
}

export function cancelPlacing() { set({ placing: null }); }

function spawnBeside(kind: NodeKind, anchor: CanvasNode, extra: Partial<CanvasNode>) {
  const size = defaultSize(kind, kind === 'topic' ? (extra.shape ?? 'card') : undefined);
  const id = addNode(kind, { x: anchor.x + anchor.width + 48 + size.width / 2, y: anchor.y + anchor.height / 2 }, extra);
  if (id) revealSoon(id);
}

export function addChild(parentId?: string) {
  const id = parentId ?? sel().nodes[0];
  const parent = id ? nodeById(id) : undefined;
  if (!parent || parent.kind === 'frame') return addNode('topic');
  if (parent.collapsed) dispatch({ type: 'set_collapsed', ids: [parent.id], collapsed: false });
  const ids = created(dispatch({ type: 'add_nodes', nodes: [{ parentId: parent.id, title: 'Subtopic' }] }));
  if (ids[0]) { select([ids[0]]); edit(ids[0]); revealSoon(ids[0]); }
}

export function addSibling(id?: string) {
  const nid = id ?? sel().nodes[0];
  const n = nid ? nodeById(nid) : undefined;
  if (!n) return addNode('topic');
  if (!n.parentId) return addChild(n.id);
  const ids = created(dispatch({ type: 'add_nodes', nodes: [{ parentId: n.parentId, title: 'Topic' }] }));
  if (ids[0]) { select([ids[0]]); edit(ids[0]); revealSoon(ids[0]); }
}

/** Nearest free slot (rings of node-sized cells around the centre) so toolbar/shortcut-created nodes never cover others. */
function freeSpotNear(c: { x: number; y: number }, size: { width: number; height: number }) {
  const gap = 24;
  const nodes = (doc()?.nodes ?? []).filter((n) => n.kind !== 'frame' && n.kind !== 'drawing');
  const free = (p: { x: number; y: number }) => {
    const x = p.x - size.width / 2, y = p.y - size.height / 2;
    return !nodes.some((n) => x < n.x + n.width + gap && n.x < x + size.width + gap && y < n.y + n.height + gap && n.y < y + size.height + gap);
  };
  const stepX = size.width + gap, stepY = size.height + gap;
  for (let ring = 0; ring <= nodes.length; ring++) {
    const cells: { dx: number; dy: number }[] = [];
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) cells.push({ dx, dy });
    cells.sort((a, b) => Math.hypot(a.dx * stepX, a.dy * stepY) - Math.hypot(b.dx * stepX, b.dy * stepY) || b.dx - a.dx || b.dy - a.dy);
    for (const { dx, dy } of cells) { const p = { x: c.x + dx * stepX, y: c.y + dy * stepY }; if (free(p)) return p; }
  }
  return c;
}

function revealSoon(id: string) {
  setTimeout(() => {
    const n = nodeById(id); const f = flow();
    if (!n || !f) return;
    const el = document.querySelector('.react-flow') as HTMLElement;
    const r = el.getBoundingClientRect();
    const tl = f.flowToScreenPosition({ x: n.x, y: n.y });
    const br = f.flowToScreenPosition({ x: n.x + n.width, y: n.y + n.height });
    if (tl.x < r.left || tl.y < r.top || br.x > r.right || br.y > r.bottom) f.setCenter(n.x + n.width / 2, n.y + n.height / 2, { zoom: f.getZoom(), duration: 250 });
  }, 30);
}

export function updateNodes(updates: NodePatch[]) { if (updates.length) dispatch({ type: 'update_nodes', updates }); }
export function updateNode(id: string, patch: Omit<NodePatch, 'id'>) { updateNodes([{ id, ...patch }]); }
export function updateSelected(patch: Omit<NodePatch, 'id'>) { updateNodes(sel().nodes.map((id) => ({ id, ...patch }))); }
export function updateEdge(id: string, patch: Omit<EdgePatch, 'id'>) { dispatch({ type: 'update_edges', updates: [{ id, ...patch }] }); }

export function setColor(color: ColorName | null) {
  const s = sel();
  if (s.nodes.length) updateNodes(s.nodes.map((id) => ({ id, color: (color ?? null) as unknown as ColorName })));
  if (s.edges.length) dispatch({ type: 'update_edges', updates: s.edges.map((id) => ({ id, color: (color ?? null) as unknown as ColorName })) });
}
export function setShape(shape: NodeShape) { updateSelected({ shape }); }
/** A role also switches the topic to that role's shape; 'none' keeps the shape and makes it an ordinary step. */
export function setRole(role: NodeRole | 'none') {
  const topics = sel().nodes.filter((id) => nodeById(id)?.kind === 'topic');
  updateNodes(topics.map((id) => ({ id, role: role === 'none' ? (null as unknown as NodeRole) : role })));
}
/** Toolbar Logic menu and the D shortcut: insert a topic that carries a logic role. */
export function insertRole(role: NodeRole) {
  const info = ROLE_INFO[role];
  insert('topic', { role, shape: info.shape, title: info.title });
}
export function setStatus(status: NodeStatus) { updateSelected({ status: status === 'none' ? (null as unknown as NodeStatus) : status }); }

export function deleteSelection() {
  const s = sel();
  const cmds: CommandInput[] = [];
  if (s.nodes.length) cmds.push({ type: 'delete_nodes', ids: s.nodes });
  if (s.edges.length) cmds.push({ type: 'delete_edges', ids: s.edges });
  if (!cmds.length) return;
  const n = s.nodes.length === 1 ? nodeById(s.nodes[0]) : undefined;
  dispatch(cmds.length === 1 ? cmds[0] : { type: 'batch', commands: cmds });
  select(n?.parentId && nodeById(n.parentId) ? [n.parentId] : []);
}

export function toggleCollapse(ids = sel().nodes) {
  const d = doc(); if (!d) return;
  const kids = childrenMap(d);
  const withKids = ids.filter((id) => kids.get(id)?.length);
  if (!withKids.length) return;
  const anyOpen = withKids.some((id) => !nodeById(id)?.collapsed);
  dispatch({ type: 'set_collapsed', ids: withKids, collapsed: anyOpen });
}

let clipboard: { nodes: CanvasNode[]; edges: NonNullable<ReturnType<typeof doc>>['edges'] } | null = null;
export function copy() {
  const d = doc(); if (!d) return;
  const ids = sel().nodes;
  if (!ids.length) return;
  const keep = new Set(ids);
  for (const id of ids) for (const x of descendants(d, id)) keep.add(x);
  clipboard = { nodes: d.nodes.filter((n) => keep.has(n.id)), edges: d.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  toast('Copied ' + keep.size + ' node' + (keep.size === 1 ? '' : 's'));
}
export function cut() { copy(); deleteSelection(); }
export function paste(at?: { x: number; y: number }) {
  const d = doc(); if (!d || !clipboard) return;
  const temp = { ...d, nodes: clipboard.nodes, edges: clipboard.edges };
  const roots = clipboard.nodes.filter((n) => !n.parentId || !clipboard!.nodes.some((m) => m.id === n.parentId)).map((n) => n.id);
  const b = bounds(clipboard.nodes)!;
  const target = at ?? viewportCenter();
  const offset = { x: Math.round(target.x - (b.x + b.width / 2)), y: Math.round(target.y - (b.y + b.height / 2)) };
  const { nodes, edges } = cloneNodes(temp, roots, offset, () => nanoid(10));
  for (const n of nodes) if (n.parentId && !nodes.some((m) => m.id === n.parentId)) n.parentId = null;
  for (const n of nodes) if (n.frameId && !nodes.some((m) => m.id === n.frameId) && !d.nodes.some((m) => m.id === n.frameId)) n.frameId = null;
  const ids = created(dispatch({ type: 'batch', commands: [{ type: 'add_nodes', nodes }, { type: 'add_edges', edges }] }));
  select(ids);
}
export function duplicate() {
  const d = doc(); if (!d) return;
  const ids = sel().nodes;
  if (!ids.length) return;
  const { nodes, edges } = cloneNodes(d, ids, { x: 40, y: 40 }, () => nanoid(10));
  const made = created(dispatch({ type: 'batch', commands: [{ type: 'add_nodes', nodes }, { type: 'add_edges', edges }] }));
  select(made.filter((id) => nodes.find((n) => n.id === id && (!n.parentId || !nodes.some((m) => m.id === n.parentId)))));
}

export function connectSelected() {
  const ids = sel().nodes;
  if (ids.length < 2) { toast('Select two or more nodes to connect them in order'); return; }
  dispatch({ type: 'add_edges', edges: ids.slice(1).map((t, i) => ({ source: ids[i], target: t })) });
}
export function connect(source: string, target: string, sourceSide?: Side, targetSide?: Side) {
  if (source === target) return;
  dispatch({ type: 'add_edges', edges: [{ source, target, sourceSide, targetSide, ...branchLabel(source) }] });
}

/** A new connector out of a decision starts labelled Yes, then No, so every branch states its condition. */
function branchLabel(source: string): { label?: string } {
  const n = nodeById(source);
  if (!n || roleOf(n).role !== 'decision') return {};
  const used = new Set((doc()?.edges ?? []).filter((e) => e.source === source && e.label).map((e) => e.label!.trim().toLowerCase()));
  const label = ['Yes', 'No'].find((l) => !used.has(l.toLowerCase()));
  return label ? { label } : {};
}
export function reverseEdge(id: string) {
  const e = doc()?.edges.find((x) => x.id === id); if (!e) return;
  updateEdge(id, { source: e.target, target: e.source, sourceSide: e.targetSide ?? null, targetSide: e.sourceSide ?? null });
}

export function frameSelection() {
  const d = doc(); if (!d) return;
  const pool = sel().nodes.map(nodeById).filter((n): n is CanvasNode => !!n && n.kind !== 'frame');
  if (!pool.length) { addNode('frame'); return; }
  const b = bounds(pool)!;
  const id = nanoid(10);
  dispatch({ type: 'batch', commands: [
    { type: 'add_nodes', nodes: [{ id, kind: 'frame', title: 'Group', x: b.x - FRAME_PAD, y: b.y - FRAME_HEADER, width: b.width + FRAME_PAD * 2, height: b.height + FRAME_HEADER + FRAME_PAD }] },
    { type: 'update_nodes', updates: pool.map((n) => ({ id: n.id, frameId: id })) },
  ] });
  select([id]); edit(id);
}

export function layout(mode: LayoutMode, direction?: LayoutDirection) {
  const ids = sel().nodes;
  dispatch({ type: 'layout', mode, direction, nodeIds: ids.length > 1 ? ids : undefined, rootId: mode === 'tree' && ids.length === 1 ? ids[0] : undefined });
  setTimeout(() => flow()?.fitView({ padding: 0.15, duration: 350, maxZoom: 1.2 }), 40);
}
export function align(a: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') { dispatch({ type: 'align', ids: sel().nodes, align: a }); }
export function distribute(axis: 'horizontal' | 'vertical') { dispatch({ type: 'distribute', ids: sel().nodes, axis }); }
export function fitFrame(id: string) { dispatch({ type: 'fit_frame', id }); }
export function setDocSettings(settings: { autoArrange?: boolean; treeLayout?: 'mindmap' | 'right' | 'left' | 'down' }) { dispatch({ type: 'update_document', settings }); }
export function renameDocument(title: string) { dispatch({ type: 'update_document', title }); }
export function describeDocument(description: string) { dispatch({ type: 'update_document', description }); }

/** View mode is read-only for every path, not just the keyboard. */
export const undo = () => { if (get().session.viewMode) { toast('View mode is read-only'); return; } wsUndo(); };
export const redo = () => { if (get().session.viewMode) { toast('View mode is read-only'); return; } wsRedo(); };

export const zoomIn = () => flow()?.zoomIn({ duration: 200 });
export const zoomOut = () => flow()?.zoomOut({ duration: 200 });
export const zoomTo = (z: number) => flow()?.zoomTo(z, { duration: 200 });
export const fitView = () => flow()?.fitView({ padding: 0.15, duration: 300, maxZoom: 1.5 });
export function focusNodes(ids: string[]) { if (ids.length) flow()?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.5, duration: 300, maxZoom: 1.25 }); }

export function navigate(dir: 'left' | 'right' | 'up' | 'down') {
  const d = doc(); const cur = sel().nodes[0] ? nodeById(sel().nodes[0]) : undefined;
  if (!d) return;
  if (!cur) { const first = d.nodes.find((n) => n.kind !== 'frame'); if (first) select([first.id]); return; }
  const cx = cur.x + cur.width / 2, cy = cur.y + cur.height / 2;
  let best: CanvasNode | undefined; let bestScore = Infinity;
  for (const n of d.nodes) {
    if (n.id === cur.id || n.kind === 'frame') continue;
    const dx = n.x + n.width / 2 - cx, dy = n.y + n.height / 2 - cy;
    const ok = dir === 'left' ? dx < -4 : dir === 'right' ? dx > 4 : dir === 'up' ? dy < -4 : dy > 4;
    if (!ok) continue;
    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.5;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  if (best) { select([best.id]); revealSoon(best.id); }
}

export function setTheme(theme: string) { updateSession({ theme }); }
export function togglePanel(panel: 'inspector' | 'outline' | 'minimap') {
  if (get().compact && panel !== 'minimap') { set({ drawer: get().drawer === panel ? null : panel, drawerFull: false }); return; }
  const p = get().session.panels;
  updateSession({ panels: { ...p, [panel]: !p[panel] } });
}
/** Dismiss a column from the column itself: closes the drawer on phones, hides the docked column elsewhere. */
export function closePanel(panel: 'inspector' | 'outline') {
  if (get().compact) { set({ drawer: null, drawerFull: false }); return; }
  const p = get().session.panels;
  if (p[panel]) updateSession({ panels: { ...p, [panel]: false } });
}
export function openDrawer(panel: 'inspector' | 'outline') {
  if (panel === 'inspector' && get().session.viewMode) return;
  if (get().compact) set({ drawer: panel, drawerFull: false, menu: null, openMenu: null });
  else if (!get().session.panels[panel]) togglePanel(panel);
}
export function toggleDrawerFull() { set({ drawerFull: !get().drawerFull }); }
/** After jumping somewhere from a drawer on a phone, get the drawer out of the way so the canvas is visible. */
export function revealCanvas() { if (get().compact && get().drawer) set({ drawer: null, drawerFull: false }); }
export function setMode(mode: 'select' | 'pan' | 'draw') { set({ areaSelect: false }); updateSession({ mode }); }
/** Touch: arm (or disarm) one box-select drag; one finger otherwise pans. */
export function toggleAreaSelect() {
  const on = !get().areaSelect;
  if (on && get().session.mode !== 'select') updateSession({ mode: 'select' });
  set({ areaSelect: on, placing: null });
}
export function toggleZen() { updateSession({ zenMode: !get().session.zenMode }); }
export function toggleViewMode() { const v = !get().session.viewMode; updateSession({ viewMode: v, mode: 'select' }); set({ editingId: null, editingEdgeId: null }); toast(v ? 'View mode: read-only (Alt+R to edit)' : 'Editing enabled'); }
export async function copyPng() {
  const f = flow(); if (!f) return;
  const vp = f.getViewport(); const prevSel = sel();
  select([]);
  await f.fitView({ padding: 0.08, duration: 0 });
  await new Promise((r) => setTimeout(r, 120));
  const url = await renderCanvasImage('png');
  await f.setViewport(vp); set({ selection: prevSel });
  try {
    const blob = await (await fetch(url)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('PNG copied to clipboard');
  } catch { toast('Clipboard is not available here — use Export › PNG'); }
}
export function toggleSnap() { updateSession({ snapToGrid: !get().session.snapToGrid }); }
export function setBackground(background: 'theme' | 'dots' | 'lines' | 'cross' | 'none') { updateSession({ background }); }
export function openSearch(q?: string) { set({ searchOpen: true, searchIndex: 0 }); if (q !== undefined) updateSession({ search: q }); }
export function closeSearch() { set({ searchOpen: false }); updateSession({ search: '' }); }

function download(name: string, content: string | Blob, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileBase = () => (doc()?.title ?? 'canvas').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'canvas';

export async function exportAs(format: 'png' | 'svg' | 'json' | 'markdown' | 'logic' | 'mermaid' | 'excalidraw') {
  const d = doc(); if (!d) return;
  if (format === 'excalidraw') return download(fileBase() + '.excalidraw', JSON.stringify(exportExcalidraw(d), null, 2), 'application/json');
  if (format === 'json') return download(fileBase() + '.json', JSON.stringify(d, null, 2), 'application/json');
  if (format === 'markdown') return download(fileBase() + '.md', exportMarkdown(d), 'text/markdown');
  if (format === 'logic') return download(fileBase() + '-logic.md', describeLogic(d).markdown, 'text/markdown');
  if (format === 'mermaid') return download(fileBase() + '.mmd', exportMermaid(d));
  const f = flow(); if (!f) return;
  const vp = f.getViewport();
  const prevSel = sel();
  select([]);
  await f.fitView({ padding: 0.08, duration: 0 });
  await new Promise((r) => setTimeout(r, 120));
  const url = await renderCanvasImage(format);
  await f.setViewport(vp);
  set({ selection: prevSel });
  const blob = await (await fetch(url)).blob();
  download(fileBase() + '.' + format, blob);
}

export function importContent(format: ImportFormat, content: string, mode: 'append' | 'replace') {
  const d = doc(); if (!d) return;
  const { cmd } = planImport(format, content, mode, d, () => 'i' + nanoid(4) + '-', 'beside');
  dispatch(cmd);
  setTimeout(() => fitView(), 60);
}

export async function createDocument(title: string, template: TemplateId = 'blank') {
  const res = await callTool('create_document', { title, template, open: false });
  openDocument(res.json.documentId);
  return res.json.documentId as string;
}
export async function duplicateDocument(id: string) {
  const res = await callTool('duplicate_document', { documentId: id });
  openDocument(res.json.documentId);
}
export async function deleteDocument(id: string) {
  const d = get().documents.find((x) => x.id === id);
  if (!confirm('Delete "' + (d?.title ?? id) + '"? It will be moved to the data/trash folder.')) return;
  await callTool('delete_document', { documentId: id });
}
export async function renameDocumentById(id: string, title: string) {
  if (id === get().docId) renameDocument(title);
  else await callTool('update_document', { documentId: id, title });
}

