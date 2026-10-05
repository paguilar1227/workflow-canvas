/**
 * Interop with Excalidraw (MIT, https://github.com/excalidraw/excalidraw) using its documented
 * .excalidraw scene format: { type: 'excalidraw', version: 2, elements, appState, files }.
 */
import type { CanvasDocument, CanvasEdge, CanvasNode, ColorName, DocSettings } from './types';
import { isRole } from './logic';
import { applyCommand, normalizeCommand, type EdgeInput, type NodeInput } from './commands';
import { childrenMap } from './graph';

const STROKE: Record<string, string> = { default: '#1e1e1e', blue: '#1971c2', green: '#2f9e44', amber: '#f08c00', red: '#e03131', purple: '#9c36b5', pink: '#c2255c', teal: '#0c8599', gray: '#868e96' };
const FILL: Record<string, string> = { default: 'transparent', blue: '#a5d8ff', green: '#b2f2bb', amber: '#ffec99', red: '#ffc9c9', purple: '#eebefa', pink: '#fcc2d7', teal: '#99e9f2', gray: '#e9ecef' };
const STICKY_FILL = '#ffec99';
const EXCALIFONT = 5;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 2147483647;
}

type El = Record<string, unknown> & { id: string; type: string };

function base(id: string, type: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): El {
  return {
    id, type, x, y, width, height, angle: 0, strokeColor: STROKE.default, backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
    seed: hash(id), version: 1, versionNonce: hash(id + ':v'), isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, index: null,
    ...extra,
  };
}

function textEl(id: string, text: string, x: number, y: number, width: number, height: number, containerId: string | null, extra: Record<string, unknown> = {}): El {
  return base(id, 'text', x, y, width, height, {
    text, originalText: text, fontSize: 18, fontFamily: EXCALIFONT, textAlign: containerId ? 'center' : 'left', verticalAlign: containerId ? 'middle' : 'top',
    containerId, autoResize: true, lineHeight: 1.25, ...extra,
  });
}

/** Everything about a node except what the Excalidraw element itself carries (geometry), so files round-trip exactly. */
function nodeRecord(n: CanvasNode) {
  const { x: _x, y: _y, width: _w, height: _h, points: _p, ...rest } = n;
  return rest;
}

const label = (n: CanvasNode) => [n.icon ? n.icon + ' ' + n.title : n.title, n.subtitle].filter(Boolean).join('\n');

/** File name for a document: its title without characters file systems reject. */
export function excalidrawFileName(title: string) {
  return (title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'canvas') + '.excalidraw';
}

export function exportExcalidraw(doc: CanvasDocument): Record<string, unknown> {
  const els: El[] = [];
  const bound = new Map<string, { id: string; type: string }[]>();
  const addBound = (id: string, b: { id: string; type: string }) => { const l = bound.get(id) ?? []; l.push(b); bound.set(id, l); };
  const nodeEl = new Map<string, El>();
  const frames = new Set(doc.nodes.filter((n) => n.kind === 'frame').map((n) => n.id));
  const color = (n: { color?: ColorName }) => (n.color && n.color !== 'default' ? n.color : 'default');
  for (const n of [...doc.nodes].sort((a, b) => (a.kind === 'frame' ? 1 : 0) - (b.kind === 'frame' ? 1 : 0))) {
    const frameId = n.frameId && frames.has(n.frameId) ? n.frameId : null;
    const c = color(n);
    if (n.kind === 'frame') {
      const el = base(n.id, 'frame', n.x, n.y, n.width, n.height, { name: n.title || 'Frame', roughness: 0, customData: { workflowCanvas: { kind: 'frame', subtitle: n.subtitle, color: n.color, notes: n.notes, node: nodeRecord(n) } } });
      els.push(el); nodeEl.set(n.id, el); continue;
    }
    if (n.kind === 'text') {
      const el = textEl(n.id, n.title, n.x, n.y, n.width, n.height, null, { frameId, strokeColor: STROKE[c], fontSize: 24, customData: { workflowCanvas: { node: nodeRecord(n) } } });
      els.push(el); nodeEl.set(n.id, el); continue;
    }
    if (n.kind === 'drawing') {
      const pts = (n.points ?? []).map(([px, py]) => [px, py]);
      const el = base(n.id, 'freedraw', n.x, n.y, n.width, n.height, { frameId, strokeColor: STROKE[c], points: pts, pressures: [], simulatePressure: true, lastCommittedPoint: null, customData: { workflowCanvas: { node: nodeRecord(n) } } });
      els.push(el); nodeEl.set(n.id, el); continue;
    }
    const type = n.kind === 'topic' && n.shape === 'diamond' ? 'diamond' : n.kind === 'topic' && n.shape === 'circle' ? 'ellipse' : 'rectangle';
    const rounded = n.kind === 'sticky' ? null : n.shape === 'rectangle' || type !== 'rectangle' ? null : { type: 3 };
    const el = base(n.id, type, n.x, n.y, n.width, n.height, {
      frameId, roundness: rounded, strokeColor: STROKE[c],
      backgroundColor: n.kind === 'sticky' ? (c === 'default' ? STICKY_FILL : FILL[c]) : FILL[c], fillStyle: n.kind === 'sticky' ? 'solid' : 'hachure',
      link: n.link ?? null, locked: !!n.locked, customData: { workflowCanvas: { kind: n.kind, shape: n.shape, role: n.role, color: n.color ?? 'default', subtitle: n.subtitle, badge: n.badge, icon: n.icon, notes: n.notes, tags: n.tags, status: n.status, priority: n.priority, parentId: n.parentId, node: nodeRecord(n) } },
    });
    els.push(el); nodeEl.set(n.id, el);
    const text = label(n);
    if (text) {
      const tid = n.id + '-label';
      els.push(textEl(tid, text, n.x + 8, n.y + n.height / 2 - 12, n.width - 16, 24, n.id, { frameId, fontSize: n.subtitle ? 16 : 18 }));
      addBound(n.id, { id: tid, type: 'text' });
    }
  }
  const arrow = (id: string, s: CanvasNode, t: CanvasNode, opts: { label?: string; style?: string; arrow?: string; color?: string; edge?: CanvasEdge }) => {
    const sc = { x: s.x + s.width / 2, y: s.y + s.height / 2 }, tc = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    const c = opts.color && opts.color !== 'default' ? opts.color : 'default';
    els.push(base(id, 'arrow', sc.x, sc.y, Math.abs(tc.x - sc.x), Math.abs(tc.y - sc.y), {
      strokeColor: STROKE[c], strokeStyle: opts.style === 'dashed' ? 'dashed' : opts.style === 'dotted' ? 'dotted' : 'solid', roundness: { type: 2 },
      points: [[0, 0], [tc.x - sc.x, tc.y - sc.y]], lastCommittedPoint: null, elbowed: false,
      startBinding: { elementId: s.id, focus: 0, gap: 6 }, endBinding: { elementId: t.id, focus: 0, gap: 6 },
      startArrowhead: opts.arrow === 'start' || opts.arrow === 'both' ? 'arrow' : null, endArrowhead: opts.arrow === 'end' || opts.arrow === 'both' ? 'arrow' : null,
      ...(opts.edge ? { customData: { workflowCanvas: { edge: opts.edge } } } : { customData: { workflowCanvas: { tree: true } } }),
    }));
    addBound(s.id, { id, type: 'arrow' }); addBound(t.id, { id, type: 'arrow' });
    if (opts.label) {
      const tid = id + '-label';
      els.push(textEl(tid, opts.label, (sc.x + tc.x) / 2 - 40, (sc.y + tc.y) / 2 - 10, 80, 20, id, { fontSize: 14 }));
      addBound(id, { id: tid, type: 'text' });
    }
  };
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const n of doc.nodes) { const p = n.parentId ? byId.get(n.parentId) : undefined; if (p) arrow('tree-' + n.id, p, n, { arrow: 'none', color: n.color }); }
  for (const e of doc.edges) { const s = byId.get(e.source), t = byId.get(e.target); if (s && t) arrow(e.id, s, t, { label: e.label, style: e.style, arrow: e.arrow, color: e.color, edge: e }); }
  for (const el of els) { const b = bound.get(el.id); if (b) el.boundElements = b; }
  void childrenMap;
  return {
    type: 'excalidraw', version: 2, source: 'https://github.com/paguilar1227/workflow-canvas', elements: els, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {},
    workflowCanvas: { version: 1, title: doc.title, description: doc.description, settings: doc.settings },
  };
}

function nearestColor(hex: unknown): ColorName | undefined {
  if (typeof hex !== 'string' || hex === 'transparent') return undefined;
  const h = hex.toLowerCase();
  for (const [name, v] of Object.entries(STROKE)) if (v === h) return name === 'default' ? undefined : (name as ColorName);
  for (const [name, v] of Object.entries(FILL)) if (v === h) return name === 'default' ? undefined : (name as ColorName);
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(h);
  if (!m) return undefined;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 24) return max > 200 || max < 60 ? undefined : 'gray';
  const hue = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  const deg = hue * 60;
  if (deg < 15 || deg >= 345) return 'red';
  if (deg < 60) return 'amber';
  if (deg < 160) return 'green';
  if (deg < 200) return 'teal';
  if (deg < 255) return 'blue';
  if (deg < 300) return 'purple';
  return 'pink';
}

export interface ExcalidrawImport { nodes: NodeInput[]; edges: EdgeInput[]; skipped: string[] }

export function importExcalidraw(content: string | Record<string, unknown>, prefix: string): ExcalidrawImport {
  const scene = (typeof content === 'string' ? JSON.parse(content) : content) as { type?: string; elements?: El[] };
  const elements = (Array.isArray(scene) ? scene : scene.elements ?? []).filter((e: El) => e && !e.isDeleted) as El[];
  if (!elements.length) throw new Error('No Excalidraw elements found (expected a .excalidraw scene with an "elements" array).');
  const out: ExcalidrawImport = { nodes: [], edges: [], skipped: [] };
  const byId = new Map(elements.map((e) => [e.id, e]));
  const id = (raw: string) => prefix + raw;
  const textFor = new Map<string, string>();
  for (const e of elements) if (e.type === 'text' && e.containerId) textFor.set(String(e.containerId), String(e.text ?? e.originalText ?? ''));
  const nodeIds = new Set<string>();
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  for (const e of elements) {
    const frameId = e.frameId && byId.get(String(e.frameId)) ? id(String(e.frameId)) : undefined;
    const x = Math.round(num(e.x)), y = Math.round(num(e.y));
    const width = Math.max(8, Math.round(Math.abs(num(e.width, 120)))), height = Math.max(8, Math.round(Math.abs(num(e.height, 60))));
    const color = nearestColor(e.strokeColor) ?? nearestColor(e.backgroundColor);
    const meta = ((e.customData as Record<string, unknown> | undefined)?.workflowCanvas ?? {}) as Partial<CanvasNode>;
    if (e.type === 'frame' || e.type === 'magicframe') {
      const f: NodeInput = { id: id(e.id), kind: 'frame', title: String(e.name ?? 'Frame'), x, y, width, height };
      if (meta.subtitle) f.subtitle = meta.subtitle;
      if (meta.notes) f.notes = meta.notes;
      const fc = (meta as { color?: ColorName }).color;
      if (fc) f.color = fc;
      out.nodes.push(f);
      nodeIds.add(e.id); continue;
    }
    if (e.type === 'rectangle' || e.type === 'diamond' || e.type === 'ellipse') {
      const label = textFor.get(e.id) ?? '';
      const [first, ...rest] = label.split('\n');
      const sticky = meta.kind === 'sticky' || (!meta.kind && String(e.backgroundColor).toLowerCase() === STICKY_FILL && e.fillStyle === 'solid' && !e.roundness);
      const n: NodeInput = {
        id: id(e.id), kind: sticky ? 'sticky' : 'topic', title: sticky ? label : first ?? '', x, y, width, height,
        shape: sticky ? undefined : e.type === 'diamond' ? 'diamond' : e.type === 'ellipse' ? 'circle' : meta.shape ?? (e.roundness ? 'rounded' : 'rectangle'),
      };
      if (!sticky && rest.length) n.subtitle = meta.subtitle ?? rest.join(' ');
      const metaColor = (meta as { color?: string }).color;
      const chosen = metaColor !== undefined ? (metaColor === 'default' ? undefined : (metaColor as ColorName)) : sticky ? nearestColor(e.strokeColor) : color;
      if (chosen) n.color = chosen;
      if (frameId) n.frameId = frameId;
      if (typeof e.link === 'string' && e.link) n.link = e.link;
      for (const k of ['badge', 'icon', 'role', 'notes', 'tags', 'status', 'priority'] as const) if (meta[k] !== undefined && meta[k] !== null) (n as Record<string, unknown>)[k] = meta[k];
      if (n.role !== undefined && !isRole(n.role)) delete n.role;
      if (meta.icon && n.title?.startsWith(meta.icon + ' ')) n.title = n.title.slice(meta.icon.length + 1);
      if (meta.parentId && byId.has(meta.parentId)) n.parentId = id(meta.parentId);
      out.nodes.push(n); nodeIds.add(e.id); continue;
    }
    if (e.type === 'text' && !e.containerId) {
      const n: NodeInput = { id: id(e.id), kind: 'text', title: String(e.text ?? ''), x, y, width: Math.max(width, 40), height: Math.max(height, 24) };
      if (color) n.color = color;
      if (frameId) n.frameId = frameId;
      out.nodes.push(n); nodeIds.add(e.id); continue;
    }
    if (e.type === 'freedraw' || ((e.type === 'line' || e.type === 'arrow') && !(e.startBinding && e.endBinding))) {
      const pts = ((e.points as [number, number][] | undefined) ?? []).map(([px, py]) => [x + px, y + py] as [number, number]);
      if (pts.length >= 2) {
        const n: NodeInput = { id: id(e.id), kind: 'drawing', points: pts };
        if (color) n.color = color;
        if (frameId) n.frameId = frameId;
        out.nodes.push(n); nodeIds.add(e.id);
      }
      continue;
    }
    if (e.type === 'arrow' || e.type === 'line' || (e.type === 'text' && e.containerId)) continue;
    out.skipped.push(e.type);
  }
  const resolve = (b: unknown) => {
    const target = (b as { elementId?: string } | null)?.elementId;
    if (!target) return undefined;
    const el = byId.get(target);
    if (el?.type === 'text' && el.containerId) return String(el.containerId);
    return target;
  };
  const treeParents = new Set(out.nodes.filter((n) => n.parentId).map((n) => n.id + '<' + n.parentId));
  for (const e of elements) {
    if ((e.type !== 'arrow' && e.type !== 'line') || !e.startBinding || !e.endBinding) continue;
    const s = resolve(e.startBinding), t = resolve(e.endBinding);
    if (!s || !t || !nodeIds.has(s) || !nodeIds.has(t) || s === t) continue;
    if (treeParents.has(id(t) + '<' + id(s))) continue;
    const start = !!e.startArrowhead, end = e.type === 'arrow' && !!e.endArrowhead;
    const edge: EdgeInput = { id: id(e.id), source: id(s), target: id(t), arrow: start && end ? 'both' : end ? 'end' : start ? 'start' : 'none', style: e.strokeStyle === 'dashed' ? 'dashed' : e.strokeStyle === 'dotted' ? 'dotted' : 'solid' };
    const label = textFor.get(e.id);
    if (label) edge.label = label;
    const c = nearestColor(e.strokeColor);
    if (c) edge.color = c;
    if (e.elbowed) edge.routing = 'step';
    out.edges.push(edge);
  }
  return out;
}


export interface OpenedDocument { title?: string; description?: string; settings?: DocSettings; nodes: CanvasNode[]; edges: CanvasEdge[]; foreign: number }

/**
 * Rebuild a full document from a .excalidraw file. Elements written by Workflow Canvas carry their complete node/edge
 * record, so they come back exactly; geometry, labels and bindings are read from the element so edits made in Excalidraw
 * win. Elements drawn natively in Excalidraw are converted like an import.
 */
export function documentFromExcalidraw(content: string | Record<string, unknown>): OpenedDocument {
  const scene = (typeof content === 'string' ? JSON.parse(content) : content) as { elements?: El[]; workflowCanvas?: { title?: string; description?: string; settings?: DocSettings } };
  const elements = (scene.elements ?? []).filter((e) => e && !e.isDeleted) as El[];
  const byId = new Map(elements.map((e) => [e.id, e]));
  const meta = (e: El) => ((e.customData as Record<string, unknown> | undefined)?.workflowCanvas ?? {}) as { node?: Omit<CanvasNode, 'x' | 'y' | 'width' | 'height'>; edge?: CanvasEdge; tree?: boolean };
  const textFor = new Map<string, string>();
  for (const e of elements) if (e.type === 'text' && e.containerId) textFor.set(String(e.containerId), String(e.text ?? e.originalText ?? ''));
  const exact: CanvasNode[] = [];
  for (const e of elements) {
    const rec = meta(e).node;
    if (!rec) continue;
    const n = { ...rec, x: Number(e.x), y: Number(e.y), width: Number(e.width), height: Number(e.height) } as CanvasNode;
    if (n.role !== undefined && !isRole(n.role)) delete n.role;
    if (n.kind === 'drawing') n.points = ((e.points as [number, number][] | undefined) ?? []).map(([px, py]) => [px, py] as [number, number]);
    if (n.kind === 'frame' && typeof e.name === 'string') n.title = e.name;
    if (n.kind === 'text' && typeof e.text === 'string') n.title = e.text;
    if (n.kind === 'topic' || n.kind === 'sticky') {
      const text = textFor.get(e.id);
      if (text !== undefined && text !== label(n)) {
        if (n.kind === 'sticky') n.title = text;
        else { const [first = '', ...rest] = text.split('\n'); n.title = n.icon && first.startsWith(n.icon + ' ') ? first.slice(n.icon.length + 1) : first; if (rest.length) n.subtitle = rest.join(' '); else delete n.subtitle; }
      }
    }
    const frameId = e.frameId ? String(e.frameId) : null;
    if (frameId && byId.has(frameId)) n.frameId = frameId; else if (n.kind !== 'frame' && e.frameId === null && n.frameId) delete n.frameId;
    if (typeof e.link === 'string' && e.link) n.link = e.link;
    exact.push(n);
  }
  const exactIds = new Set(exact.map((n) => n.id));
  const resolve = (b: unknown) => { const t = (b as { elementId?: string } | null)?.elementId; const el = t ? byId.get(t) : undefined; return el?.type === 'text' && el.containerId ? String(el.containerId) : t; };
  const edges: CanvasEdge[] = [];
  for (const e of elements) {
    const m = meta(e);
    if (e.type !== 'arrow' || !m.edge) continue;
    const s = resolve(e.startBinding) ?? m.edge.source, t = resolve(e.endBinding) ?? m.edge.target;
    const edge: CanvasEdge = { ...m.edge, source: s, target: t };
    const text = textFor.get(e.id);
    if (text !== undefined) edge.label = text; else delete edge.label;
    edges.push(edge);
  }
  const ours = (e: El) => exactIds.has(e.id) || !!meta(e).edge || !!meta(e).tree || (e.type === 'text' && !!e.containerId && (exactIds.has(String(e.containerId)) || !!meta(byId.get(String(e.containerId)) ?? ({} as El)).edge || !!meta(byId.get(String(e.containerId)) ?? ({} as El)).tree));
  let nodes = exact;
  let foreign = 0;
  if (elements.some((e) => !ours(e))) {
    const imported = importExcalidraw({ elements: elements.filter((e) => !meta(e).edge && !meta(e).tree) }, '');
    const keep = imported.nodes.filter((n) => !exactIds.has(n.id as string));
    foreign = keep.length;
    let scratch: CanvasDocument = { id: 'open', title: '', nodes: exact, edges: [], settings: scene.workflowCanvas?.settings ?? { autoArrange: true, treeLayout: 'mindmap' }, createdAt: '', updatedAt: '' };
    let seq = 0;
    const genId = () => 'x' + ++seq;
    if (keep.length) scratch = applyCommand(scratch, normalizeCommand(scratch, { type: 'add_nodes', nodes: keep }, { genId }));
    const ids = new Set(scratch.nodes.map((n) => n.id));
    const extraEdges = imported.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && !edges.some((x) => x.id === e.id));
    if (extraEdges.length) { const withEdges = applyCommand({ ...scratch, edges }, normalizeCommand({ ...scratch, edges }, { type: 'add_edges', edges: extraEdges }, { genId })); edges.splice(0, edges.length, ...withEdges.edges); }
    nodes = scratch.nodes;
  }
  const ids = new Set(nodes.map((n) => n.id));
  return {
    title: scene.workflowCanvas?.title, description: scene.workflowCanvas?.description, settings: scene.workflowCanvas?.settings,
    nodes: nodes.map((n) => (n.parentId && !ids.has(n.parentId) ? { ...n, parentId: undefined } : n)),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    foreign,
  };
}
