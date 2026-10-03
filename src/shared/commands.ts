import type { CanvasDocument, CanvasEdge, CanvasNode, DocSettings, NodeKind, NodeShape, Side, TreeLayout } from './types';
import { childrenMap, descendants, hiddenIds, isAncestor, nodeMap, rootOf } from './graph';
import { defaultSize, bounds, center, containsPoint } from './sizes';
import { alignNodes, distributeNodes, fitFrame, layoutGraph, layoutGrid, layoutLanes, layoutTree, type Align, type GraphDirection, type Pos } from './layout';

export type NodeInput = Partial<Omit<CanvasNode, 'id' | 'order'>> & { id?: string };
export type NodePatch = Partial<Omit<CanvasNode, 'order'>> & { id: string };
export type EdgeInput = Partial<Omit<CanvasEdge, 'id' | 'source' | 'target'>> & { id?: string; source: string; target: string };
export type EdgePatch = Partial<CanvasEdge> & { id: string };
export type LayoutMode = 'tree' | 'graph' | 'grid' | 'lanes';
export type LayoutDirection = TreeLayout | GraphDirection;

export type Command =
  | { type: 'add_nodes'; nodes: CanvasNode[] }
  | { type: 'update_nodes'; updates: NodePatch[] }
  | { type: 'delete_nodes'; ids: string[]; withDescendants?: boolean }
  | { type: 'move_nodes'; moves: { id: string; x: number; y: number }[] }
  | { type: 'reparent'; id: string; parentId: string | null }
  | { type: 'set_collapsed'; ids: string[]; collapsed: boolean }
  | { type: 'add_edges'; edges: CanvasEdge[] }
  | { type: 'update_edges'; updates: EdgePatch[] }
  | { type: 'delete_edges'; ids: string[] }
  | { type: 'layout'; mode: LayoutMode; direction?: LayoutDirection; rootId?: string; nodeIds?: string[]; spacing?: number }
  | { type: 'align'; ids: string[]; align: Align }
  | { type: 'distribute'; ids: string[]; axis: 'horizontal' | 'vertical' }
  | { type: 'fit_frame'; id: string; padding?: number }
  | { type: 'update_document'; title?: string; description?: string; settings?: Partial<DocSettings> }
  | { type: 'replace_content'; nodes: CanvasNode[]; edges: CanvasEdge[] }
  | { type: 'patch'; nodes: Record<string, CanvasNode | null>; edges: Record<string, CanvasEdge | null>; meta?: { title: string; description?: string; settings: DocSettings } }
  | { type: 'batch'; commands: Command[] };

/** Commands as authored by a human UI or an AI before ids/positions are resolved. */
export type CommandInput =
  | { type: 'add_nodes'; nodes: NodeInput[] }
  | { type: 'add_edges'; edges: EdgeInput[] }
  | { type: 'move_nodes'; moves: { id: string; x: number; y: number }[]; includeContents?: boolean }
  | { type: 'batch'; commands: CommandInput[] }
  | Exclude<Command, { type: 'add_nodes' } | { type: 'add_edges' } | { type: 'move_nodes' } | { type: 'batch' }>;

export interface NormalizeOptions {
  genId: () => string;
  /** Where to drop nodes that have no position and no parent (e.g. viewport centre). */
  anchor?: { x: number; y: number };
}

export class CommandError extends Error {}

const SIDE_GAP = 40;

function maxOrder(doc: CanvasDocument) {
  return doc.nodes.reduce((m, n) => Math.max(m, n.order), 0);
}

function treeDirection(doc: CanvasDocument, parent: CanvasNode, siblings: CanvasNode[]): 'right' | 'left' | 'down' {
  if (siblings.length) {
    const last = siblings[siblings.length - 1];
    if (last.y >= parent.y + parent.height && Math.abs(center(last).x - center(parent).x) < last.width * 3) return 'down';
    return last.x + last.width <= parent.x ? 'left' : 'right';
  }
  const mode = doc.settings.treeLayout;
  if (mode === 'down') return 'down';
  if (mode === 'left') return 'left';
  return 'right';
}

/** Resolve ids, defaults and positions so the reducer is deterministic everywhere. */
export function normalizeCommand(doc: CanvasDocument, input: CommandInput, opts: NormalizeOptions): Command {
  switch (input.type) {
    case 'add_nodes': {
      let working = doc;
      let order = maxOrder(doc);
      const out: CanvasNode[] = [];
      const loose: CanvasNode[] = [];
      const inputs = orderByDependencies(input.nodes);
      for (const raw of inputs) {
        const id = raw.id?.trim() || opts.genId();
        if (working.nodes.some((n) => n.id === id)) throw new CommandError('Node id "' + id + '" already exists');
        const kind: NodeKind = (raw.kind as NodeKind) ?? 'topic';
        const parentId = raw.parentId ?? null;
        const parent = parentId ? working.nodes.find((n) => n.id === parentId) : undefined;
        if (parentId && !parent) throw new CommandError('Parent "' + parentId + '" not found');
        const isRoot = kind === 'topic' && !parentId;
        const shape: NodeShape | undefined = kind === 'topic' ? ((raw.shape as NodeShape) ?? (parent ? 'rounded' : 'card')) : undefined;
        const size = defaultSize(kind, shape, false);
        const node: CanvasNode = {
          id, kind, title: raw.title ?? (kind === 'frame' ? 'Frame' : kind === 'sticky' ? '' : 'Topic'),
          x: 0, y: 0,
          width: raw.width ?? (parent && shape === 'rounded' ? 200 : size.width),
          height: raw.height ?? (parent && shape === 'rounded' ? 48 : size.height),
          order: ++order,
        };
        if (shape) node.shape = shape;
        for (const k of ['subtitle', 'notes', 'badge', 'icon', 'color', 'collapsed', 'tags', 'link', 'status', 'priority', 'locked'] as const) {
          if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') (node as unknown as Record<string, unknown>)[k] = raw[k];
        }
        if (parentId) node.parentId = parentId;
        void isRoot;
        const hasPos = typeof raw.x === 'number' && typeof raw.y === 'number';
        if (kind === 'drawing') {
          if (!raw.points || raw.points.length < 2) throw new CommandError('A drawing needs at least two points');
          const pts = raw.points.map(([px, py]) => [Number(px), Number(py)] as [number, number]);
          const minX = Math.min(...pts.map((p) => p[0])), minY = Math.min(...pts.map((p) => p[1]));
          const maxX = Math.max(...pts.map((p) => p[0])), maxY = Math.max(...pts.map((p) => p[1]));
          const ox = hasPos ? 0 : Math.round(minX), oy = hasPos ? 0 : Math.round(minY);
          node.points = pts.map(([px, py]) => [Math.round((px - ox) * 10) / 10, Math.round((py - oy) * 10) / 10]);
          node.x = hasPos ? raw.x! : ox;
          node.y = hasPos ? raw.y! : oy;
          node.width = raw.width ?? Math.max(4, Math.round(maxX - ox));
          node.height = raw.height ?? Math.max(4, Math.round(maxY - oy));
          node.title = raw.title ?? '';
        } else if (hasPos) { node.x = raw.x!; node.y = raw.y!; }
        else if (parent) {
          const sibs = childrenMap(working).get(parent.id) ?? [];
          const dir = treeDirection(working, parent, sibs);
          const last = sibs[sibs.length - 1];
          if (dir === 'down') {
            node.x = last ? last.x + last.width + 28 : parent.x + parent.width / 2 - node.width / 2;
            node.y = last ? last.y : parent.y + parent.height + 72;
          } else {
            node.x = dir === 'right' ? (last ? last.x : parent.x + parent.width + 72) : (last ? last.x + last.width - node.width : parent.x - 72 - node.width);
            node.y = last ? last.y + last.height + 20 : parent.y + parent.height / 2 - node.height / 2;
          }
        } else if (raw.frameId) {
          const frame = working.nodes.find((n) => n.id === raw.frameId);
          if (frame) {
            const ms = working.nodes.filter((n) => n.frameId === frame.id);
            const lowest = ms.reduce((m, n) => Math.max(m, n.y + n.height), frame.y + 24);
            node.x = frame.x + 24; node.y = lowest + 24;
          }
        } else {
          loose.push(node);
        }
        if (raw.frameId !== undefined) node.frameId = raw.frameId;
        else if (parent?.frameId) node.frameId = parent.frameId;
        out.push(node);
        working = { ...working, nodes: [...working.nodes, node] };
      }
      if (loose.length) {
        const existing = bounds(doc.nodes);
        const anchor = opts.anchor ?? (existing ? { x: existing.x + existing.width + 120, y: existing.y } : { x: 0, y: 0 });
        const cols = Math.ceil(Math.sqrt(loose.length));
        const cw = Math.max(...loose.map((n) => n.width)) + SIDE_GAP;
        const ch = Math.max(...loose.map((n) => n.height)) + SIDE_GAP;
        const totalW = Math.min(cols, loose.length) * cw - SIDE_GAP;
        const totalH = Math.ceil(loose.length / cols) * ch - SIDE_GAP;
        const ox = opts.anchor ? anchor.x - totalW / 2 : anchor.x;
        const oy = opts.anchor ? anchor.y - totalH / 2 : anchor.y;
        loose.forEach((n, i) => { n.x = Math.round(ox + (i % cols) * cw); n.y = Math.round(oy + Math.floor(i / cols) * ch); });
      }
      const frames = [...doc.nodes, ...out].filter((n) => n.kind === 'frame');
      for (const n of out) {
        if (n.kind === 'frame' || n.frameId !== undefined) continue;
        const raw = inputs[out.indexOf(n)];
        if (raw && raw.frameId === undefined) {
          const host = smallestFrameAt(frames, center(n));
          if (host) n.frameId = host.id;
        }
      }
      return { type: 'add_nodes', nodes: out };
    }
    case 'add_edges': {
      const ids = new Set(doc.nodes.map((n) => n.id));
      const edgeIds = new Set(doc.edges.map((e) => e.id));
      return {
        type: 'add_edges',
        edges: input.edges.map((raw) => {
          if (!ids.has(raw.source)) throw new CommandError('Edge source "' + raw.source + '" not found');
          if (!ids.has(raw.target)) throw new CommandError('Edge target "' + raw.target + '" not found');
          const id = raw.id?.trim() || opts.genId();
          if (edgeIds.has(id)) throw new CommandError('Edge id "' + id + '" already exists');
          edgeIds.add(id);
          const e: CanvasEdge = { id, source: raw.source, target: raw.target, style: raw.style ?? 'solid', arrow: raw.arrow ?? 'end', routing: raw.routing ?? 'smooth' };
          if (raw.label) e.label = raw.label;
          if (raw.style === null) e.style = 'solid';
          if (raw.color) e.color = raw.color;
          if (raw.animated) e.animated = true;
          if (raw.sourceSide) e.sourceSide = raw.sourceSide as Side;
          if (raw.targetSide) e.targetSide = raw.targetSide as Side;
          return e;
        }),
      };
    }
    case 'move_nodes': {
      if (!input.includeContents) return { type: 'move_nodes', moves: input.moves };
      const nodes = nodeMap(doc);
      const kids = childrenMap(doc);
      const moves = new Map(input.moves.map((m) => [m.id, m]));
      for (const m of input.moves) {
        const n = nodes.get(m.id);
        if (!n) continue;
        const dx = m.x - n.x, dy = m.y - n.y;
        const companions = n.kind === 'frame' ? doc.nodes.filter((c) => c.frameId === n.id).map((c) => c.id) : descendants(doc, n.id, kids);
        for (const cid of companions) {
          if (moves.has(cid)) continue;
          const c = nodes.get(cid)!;
          moves.set(cid, { id: cid, x: c.x + dx, y: c.y + dy });
        }
      }
      return { type: 'move_nodes', moves: [...moves.values()] };
    }
    case 'batch': {
      let working = doc;
      const cmds: Command[] = [];
      for (const c of input.commands) {
        const n = normalizeCommand(working, c, opts);
        cmds.push(n);
        working = applyCommand(working, n);
      }
      return { type: 'batch', commands: cmds };
    }
    default:
      return input;
  }
}

/** Parents and frames referenced inside the same batch must be created first. */
function orderByDependencies(inputs: NodeInput[]): NodeInput[] {
  const byId = new Map(inputs.filter((n) => n.id).map((n) => [n.id as string, n]));
  const done = new Set<NodeInput>();
  const visiting = new Set<NodeInput>();
  const out: NodeInput[] = [];
  const visit = (n: NodeInput) => {
    if (done.has(n) || visiting.has(n)) return;
    visiting.add(n);
    for (const dep of [n.parentId, n.frameId]) { const d = dep ? byId.get(dep) : undefined; if (d && d !== n) visit(d); }
    visiting.delete(n);
    done.add(n);
    out.push(n);
  };
  for (const n of inputs.filter((x) => x.kind === 'frame')) visit(n);
  for (const n of inputs) visit(n);
  return out;
}

function smallestFrameAt(frames: CanvasNode[], p: { x: number; y: number }) {
  return frames.filter((f) => containsPoint(f, p)).sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

function applyPositions(doc: CanvasDocument, pos: Map<string, Pos>): CanvasDocument {
  if (!pos.size) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const p = pos.get(n.id);
      if (!p) return n;
      const next = { ...n, x: Math.round(p.x), y: Math.round(p.y) };
      if (p.width) next.width = Math.round(p.width);
      if (p.height) next.height = Math.round(p.height);
      if (next.x === n.x && next.y === n.y && next.width === n.width && next.height === n.height) return n;
      return next;
    }),
  };
}

function relayoutTrees(doc: CanvasDocument, touched: Iterable<string>): CanvasDocument {
  if (!doc.settings.autoArrange) return doc;
  const nodes = nodeMap(doc);
  const roots = new Set<string>();
  for (const id of touched) if (nodes.has(id)) roots.add(rootOf(doc, id, nodes));
  let out = doc;
  for (const r of roots) {
    const hasKids = out.nodes.some((n) => n.parentId === r);
    if (hasKids) out = clearSpaceAround(applyPositions(out, layoutTree(out, r, out.settings.treeLayout)), r);
  }
  return out;
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, m: number) =>
  a.x < b.x + b.width + m && b.x < a.x + a.width + m && a.y < b.y + b.height + m && b.y < a.y + a.height + m;

/** After a tree auto-arranges, push unrelated topics (or whole other trees) that it now covers out of the way. */
function clearSpaceAround(doc: CanvasDocument, rootId: string): CanvasDocument {
  const nodes = nodeMap(doc);
  const kids = childrenMap(doc);
  const hidden = hiddenIds(doc);
  const tree = new Set([rootId, ...descendants(doc, rootId, kids)]);
  const treeNodes = doc.nodes.filter((n) => tree.has(n.id) && !hidden.has(n.id));
  const root = nodes.get(rootId);
  if (!root || !treeNodes.length) return doc;
  const rc = center(root);
  const units = new Set<string>();
  for (const n of doc.nodes) {
    if (tree.has(n.id) || n.kind === 'frame' || n.kind === 'drawing' || hidden.has(n.id)) continue;
    units.add(rootOf(doc, n.id, nodes));
  }
  const moves = new Map<string, Pos>();
  for (const u of units) {
    if (tree.has(u)) continue;
    const members = [u, ...descendants(doc, u, kids)].map((id) => nodes.get(id)!).filter((n) => n && !hidden.has(n.id));
    const ub = bounds(members);
    if (!ub) continue;
    const hits = treeNodes.filter((t) => overlaps(t, ub, 12));
    if (!hits.length) continue;
    const hb = bounds(hits)!;
    const dx = center(ub).x >= rc.x ? hb.x + hb.width + 40 - ub.x : hb.x - 40 - (ub.x + ub.width);
    for (const m of members) moves.set(m.id, { x: m.x + dx, y: m.y });
  }
  return applyPositions(doc, moves);
}

const NODE_PATCH_KEYS = ['kind', 'title', 'subtitle', 'notes', 'badge', 'icon', 'shape', 'color', 'x', 'y', 'width', 'height', 'parentId', 'frameId', 'collapsed', 'tags', 'link', 'status', 'priority', 'locked', 'points'] as const;
const EDGE_PATCH_KEYS = ['source', 'target', 'label', 'style', 'arrow', 'routing', 'color', 'animated', 'sourceSide', 'targetSide'] as const;

function mergeDefined<T extends object>(base: T, patch: Record<string, unknown>, keys: readonly string[]): T {
  let changed = false;
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of keys) {
    if (!(k in patch) || patch[k] === undefined) continue;
    const v = patch[k];
    if (v === null || v === '') { if (k in next) { delete next[k]; changed = true; } continue; }
    if (JSON.stringify(next[k]) !== JSON.stringify(v)) { next[k] = v; changed = true; }
  }
  return changed ? (next as T) : base;
}

export function applyCommand(doc: CanvasDocument, cmd: Command): CanvasDocument {
  switch (cmd.type) {
    case 'add_nodes': {
      const existing = new Set(doc.nodes.map((n) => n.id));
      const fresh = cmd.nodes.filter((n) => !existing.has(n.id));
      if (!fresh.length) return doc;
      const next = { ...doc, nodes: [...doc.nodes, ...fresh] };
      return relayoutTrees(next, fresh.filter((n) => n.parentId).map((n) => n.id));
    }
    case 'update_nodes': {
      const byId = new Map(cmd.updates.map((u) => [u.id, u]));
      const touched: string[] = [];
      let next = {
        ...doc,
        nodes: doc.nodes.map((n) => {
          const u = byId.get(n.id);
          if (!u) return n;
          const patch: Record<string, unknown> = { ...u };
          if (u.parentId !== undefined && u.parentId !== null && (u.parentId === n.id || !doc.nodes.some((p) => p.id === u.parentId) || isAncestor(doc, n.id, u.parentId))) delete patch.parentId;
          const m = mergeDefined(n, patch, NODE_PATCH_KEYS);
          if (m !== n && (m.parentId !== n.parentId || m.collapsed !== n.collapsed || m.width !== n.width || m.height !== n.height)) touched.push(n.id, ...(n.parentId ? [n.parentId] : []));
          return m;
        }),
      };
      if (touched.length) next = relayoutTrees(next, touched);
      return next;
    }
    case 'delete_nodes': {
      const kids = childrenMap(doc);
      const nodes = nodeMap(doc);
      const del = new Set<string>();
      for (const id of cmd.ids) {
        if (!nodes.has(id)) continue;
        del.add(id);
        if (cmd.withDescendants !== false) for (const d of descendants(doc, id, kids)) del.add(d);
      }
      if (!del.size) return doc;
      const parents = new Set<string>();
      const nodesOut = doc.nodes.filter((n) => !del.has(n.id)).map((n) => {
        let m = n;
        if (n.parentId && del.has(n.parentId)) {
          let p = nodes.get(n.parentId);
          while (p && del.has(p.id)) p = p.parentId ? nodes.get(p.parentId) : undefined;
          m = { ...m };
          if (p) m.parentId = p.id; else delete m.parentId;
        }
        if (n.frameId && del.has(n.frameId)) { m = { ...m }; delete m.frameId; }
        return m;
      });
      for (const id of del) { const p = nodes.get(id)?.parentId; if (p && !del.has(p)) parents.add(p); }
      const next = { ...doc, nodes: nodesOut, edges: doc.edges.filter((e) => !del.has(e.source) && !del.has(e.target)) };
      return relayoutTrees(next, parents);
    }
    case 'move_nodes': {
      const pos = new Map<string, Pos>(cmd.moves.map((m) => [m.id, { x: m.x, y: m.y }]));
      return applyPositions(doc, pos);
    }
    case 'reparent': {
      const n = doc.nodes.find((x) => x.id === cmd.id);
      if (!n) return doc;
      if (cmd.parentId && (cmd.parentId === n.id || !doc.nodes.some((p) => p.id === cmd.parentId) || isAncestor(doc, n.id, cmd.parentId))) return doc;
      const oldParent = n.parentId;
      const order = maxOrder(doc) + 1;
      const next = {
        ...doc,
        nodes: doc.nodes.map((x) => {
          if (x.id !== n.id) return x;
          const m: CanvasNode = { ...x, order };
          if (cmd.parentId) {
            m.parentId = cmd.parentId;
            const parentShape = doc.nodes.find((p) => p.id === cmd.parentId);
            if (parentShape?.frameId) m.frameId = parentShape.frameId;
          } else delete m.parentId;
          return m;
        }),
      };
      return relayoutTrees(next, [n.id, ...(oldParent ? [oldParent] : [])]);
    }
    case 'set_collapsed': {
      const ids = new Set(cmd.ids);
      const next = { ...doc, nodes: doc.nodes.map((n) => (ids.has(n.id) && !!n.collapsed !== cmd.collapsed ? { ...n, collapsed: cmd.collapsed } : n)) };
      return relayoutTrees(next, cmd.ids);
    }
    case 'add_edges': {
      const ids = new Set(doc.nodes.map((n) => n.id));
      const have = new Set(doc.edges.map((e) => e.id));
      const fresh = cmd.edges.filter((e) => !have.has(e.id) && ids.has(e.source) && ids.has(e.target));
      return fresh.length ? { ...doc, edges: [...doc.edges, ...fresh] } : doc;
    }
    case 'update_edges': {
      const byId = new Map(cmd.updates.map((u) => [u.id, u]));
      return { ...doc, edges: doc.edges.map((e) => { const u = byId.get(e.id); return u ? mergeDefined(e, u as Record<string, unknown>, EDGE_PATCH_KEYS) : e; }) };
    }
    case 'delete_edges': {
      const ids = new Set(cmd.ids);
      return { ...doc, edges: doc.edges.filter((e) => !ids.has(e.id)) };
    }
    case 'layout': {
      let pos = new Map<string, Pos>();
      if (cmd.mode === 'tree') {
        const mode = (['mindmap', 'right', 'left', 'down'].includes(cmd.direction ?? '') ? cmd.direction : doc.settings.treeLayout) as TreeLayout;
        const nodes = nodeMap(doc);
        const roots = cmd.rootId ? [rootOf(doc, cmd.rootId, nodes)]
          : cmd.nodeIds?.length ? [...new Set(cmd.nodeIds.filter((id) => nodes.has(id)).map((id) => rootOf(doc, id, nodes)))]
          : doc.nodes.filter((n) => !n.parentId && doc.nodes.some((c) => c.parentId === n.id)).map((n) => n.id);
        let next = doc;
        for (const r of roots) next = clearSpaceAround(applyPositions(next, layoutTree(next, r, mode)), r);
        return next;
      }
      if (cmd.mode === 'graph') pos = layoutGraph(doc, cmd.nodeIds, (['LR', 'TB', 'RL', 'BT'].includes(cmd.direction ?? '') ? cmd.direction : 'LR') as GraphDirection, cmd.spacing);
      if (cmd.mode === 'grid') pos = layoutGrid(doc, cmd.nodeIds, cmd.spacing);
      if (cmd.mode === 'lanes') pos = layoutLanes(doc, cmd.spacing, cmd.nodeIds);
      return applyPositions(doc, pos);
    }
    case 'align':
      return applyPositions(doc, alignNodes(doc, cmd.ids, cmd.align));
    case 'distribute':
      return applyPositions(doc, distributeNodes(doc, cmd.ids, cmd.axis));
    case 'fit_frame': {
      const p = fitFrame(doc, cmd.id, cmd.padding);
      return p ? applyPositions(doc, new Map([[cmd.id, p]])) : doc;
    }
    case 'update_document': {
      const next: CanvasDocument = { ...doc };
      if (cmd.title !== undefined) next.title = cmd.title;
      if (cmd.description !== undefined) next.description = cmd.description;
      if (cmd.settings) next.settings = { ...doc.settings, ...Object.fromEntries(Object.entries(cmd.settings).filter(([, v]) => v !== undefined)) };
      const relayout = cmd.settings && ((cmd.settings.autoArrange && !doc.settings.autoArrange) || (cmd.settings.treeLayout && cmd.settings.treeLayout !== doc.settings.treeLayout));
      return relayout ? relayoutTrees(next, next.nodes.filter((n) => !n.parentId).map((n) => n.id)) : next;
    }
    case 'replace_content':
      return { ...doc, nodes: cmd.nodes, edges: cmd.edges };
    case 'patch': {
      const out: CanvasDocument = { ...doc };
      if (cmd.meta) { out.title = cmd.meta.title; out.description = cmd.meta.description; out.settings = cmd.meta.settings; }
      const nodeIds = new Set(Object.keys(cmd.nodes));
      if (nodeIds.size) {
        const seen = new Set<string>();
        const nodes: CanvasNode[] = [];
        for (const n of doc.nodes) {
          if (!nodeIds.has(n.id)) { nodes.push(n); continue; }
          seen.add(n.id);
          const v = cmd.nodes[n.id];
          if (v) nodes.push(v);
        }
        for (const [id, v] of Object.entries(cmd.nodes)) if (v && !seen.has(id)) nodes.push(v);
        out.nodes = nodes;
      }
      const edgeIds = new Set(Object.keys(cmd.edges));
      if (edgeIds.size) {
        const seen = new Set<string>();
        const edges: CanvasEdge[] = [];
        for (const e of doc.edges) {
          if (!edgeIds.has(e.id)) { edges.push(e); continue; }
          seen.add(e.id);
          const v = cmd.edges[e.id];
          if (v) edges.push(v);
        }
        for (const [id, v] of Object.entries(cmd.edges)) if (v && !seen.has(id)) edges.push(v);
        out.edges = edges;
      }
      return out;
    }
    case 'batch':
      return cmd.commands.reduce(applyCommand, doc);
  }
}

/** Structural diff used for undo/redo: entries map id -> value in "to" (null = absent). */
export function diffDocs(from: CanvasDocument, to: CanvasDocument): Extract<Command, { type: 'patch' }> | null {
  const nodes: Record<string, CanvasNode | null> = {};
  const edges: Record<string, CanvasEdge | null> = {};
  const fromNodes = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodes = new Map(to.nodes.map((n) => [n.id, n]));
  for (const [id, n] of toNodes) if (fromNodes.get(id) !== n && JSON.stringify(fromNodes.get(id)) !== JSON.stringify(n)) nodes[id] = n;
  for (const id of fromNodes.keys()) if (!toNodes.has(id)) nodes[id] = null;
  const fromEdges = new Map(from.edges.map((e) => [e.id, e]));
  const toEdges = new Map(to.edges.map((e) => [e.id, e]));
  for (const [id, e] of toEdges) if (fromEdges.get(id) !== e && JSON.stringify(fromEdges.get(id)) !== JSON.stringify(e)) edges[id] = e;
  for (const id of fromEdges.keys()) if (!toEdges.has(id)) edges[id] = null;
  const metaChanged = from.title !== to.title || from.description !== to.description || JSON.stringify(from.settings) !== JSON.stringify(to.settings);
  if (!Object.keys(nodes).length && !Object.keys(edges).length && !metaChanged) return null;
  const patch: Extract<Command, { type: 'patch' }> = { type: 'patch', nodes, edges };
  if (metaChanged) patch.meta = { title: to.title, description: to.description, settings: to.settings };
  return patch;
}

export function summarizeCommand(cmd: Command): string {
  switch (cmd.type) {
    case 'add_nodes': return 'added ' + cmd.nodes.length + ' node' + (cmd.nodes.length === 1 ? '' : 's');
    case 'update_nodes': return 'edited ' + cmd.updates.length + ' node' + (cmd.updates.length === 1 ? '' : 's');
    case 'delete_nodes': return 'deleted ' + cmd.ids.length + ' node' + (cmd.ids.length === 1 ? '' : 's');
    case 'move_nodes': return 'moved ' + cmd.moves.length + ' node' + (cmd.moves.length === 1 ? '' : 's');
    case 'reparent': return 're-parented a topic';
    case 'set_collapsed': return (cmd.collapsed ? 'collapsed ' : 'expanded ') + cmd.ids.length + ' branch' + (cmd.ids.length === 1 ? '' : 'es');
    case 'add_edges': return 'connected ' + cmd.edges.length + ' edge' + (cmd.edges.length === 1 ? '' : 's');
    case 'update_edges': return 'edited ' + cmd.updates.length + ' edge' + (cmd.updates.length === 1 ? '' : 's');
    case 'delete_edges': return 'deleted ' + cmd.ids.length + ' edge' + (cmd.ids.length === 1 ? '' : 's');
    case 'layout': return 'arranged the canvas (' + cmd.mode + ')';
    case 'align': return 'aligned ' + cmd.ids.length + ' nodes';
    case 'distribute': return 'distributed ' + cmd.ids.length + ' nodes';
    case 'fit_frame': return 'fitted a frame';
    case 'update_document': return 'updated document settings';
    case 'replace_content': return 'replaced the canvas content';
    case 'patch': return 'restored a previous state';
    case 'batch': return cmd.commands.map(summarizeCommand).join(', ');
  }
}

export function touchedNodeIds(cmd: Command): string[] {
  switch (cmd.type) {
    case 'add_nodes': return cmd.nodes.map((n) => n.id);
    case 'update_nodes': return cmd.updates.map((u) => u.id);
    case 'move_nodes': return cmd.moves.map((m) => m.id);
    case 'reparent': return [cmd.id];
    case 'set_collapsed': return cmd.ids;
    case 'add_edges': return cmd.edges.flatMap((e) => [e.source, e.target]);
    case 'align': case 'distribute': return cmd.ids;
    case 'fit_frame': return [cmd.id];
    case 'patch': return Object.keys(cmd.nodes);
    case 'batch': return cmd.commands.flatMap(touchedNodeIds);
    default: return [];
  }
}

