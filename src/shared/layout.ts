import dagre from '@dagrejs/dagre';
import type { CanvasDocument, CanvasNode, TreeLayout } from './types';
import { childrenMap, hiddenIds, nodeMap } from './graph';
import { bounds, center } from './sizes';

export type Pos = { x: number; y: number; width?: number; height?: number };
export type GraphDirection = 'LR' | 'TB' | 'RL' | 'BT';

const TREE_H_GAP = 72;
const TREE_V_GAP = 20;
const ORG_H_GAP = 28;
const ORG_V_GAP = 72;
export const FRAME_HEADER = 48;
export const FRAME_PAD = 24;

function visibleChildren(n: CanvasNode, kids: Map<string, CanvasNode[]>) {
  return n.collapsed ? [] : (kids.get(n.id) ?? []).filter((c) => c.kind !== 'frame');
}

/** XMind-style tree layouts. The root keeps its position. */
export function layoutTree(doc: CanvasDocument, rootId: string, mode: TreeLayout): Map<string, Pos> {
  const nodes = nodeMap(doc);
  const kids = childrenMap(doc);
  const root = nodes.get(rootId);
  const out = new Map<string, Pos>();
  if (!root) return out;

  if (mode === 'down') {
    const ext = new Map<string, number>();
    const measure = (n: CanvasNode): number => {
      const cs = visibleChildren(n, kids);
      const total = cs.reduce((s, c) => s + measure(c), 0) + Math.max(0, cs.length - 1) * ORG_H_GAP;
      const e = Math.max(n.width, total);
      ext.set(n.id, e);
      return e;
    };
    measure(root);
    const place = (n: CanvasNode, cx: number, y: number) => {
      out.set(n.id, { x: cx - n.width / 2, y });
      const cs = visibleChildren(n, kids);
      const total = cs.reduce((s, c) => s + (ext.get(c.id) ?? c.width), 0) + Math.max(0, cs.length - 1) * ORG_H_GAP;
      let cursor = cx - total / 2;
      for (const c of cs) {
        const e = ext.get(c.id) ?? c.width;
        place(c, cursor + e / 2, y + n.height + ORG_V_GAP);
        cursor += e + ORG_H_GAP;
      }
    };
    place(root, root.x + root.width / 2, root.y);
    return out;
  }

  const ext = new Map<string, number>();
  const measure = (n: CanvasNode): number => {
    const cs = visibleChildren(n, kids);
    const total = cs.reduce((s, c) => s + measure(c), 0) + Math.max(0, cs.length - 1) * TREE_V_GAP;
    const e = Math.max(n.height, total);
    ext.set(n.id, e);
    return e;
  };
  measure(root);
  const placeSide = (n: CanvasNode, anchorX: number, cy: number, side: 'right' | 'left') => {
    const x = side === 'right' ? anchorX : anchorX - n.width;
    out.set(n.id, { x, y: cy - n.height / 2 });
    placeChildren(n, side === 'right' ? x + n.width + TREE_H_GAP : x - TREE_H_GAP, cy, visibleChildren(n, kids), side);
  };
  const placeChildren = (_p: CanvasNode, anchorX: number, cy: number, cs: CanvasNode[], side: 'right' | 'left') => {
    const total = cs.reduce((s, c) => s + (ext.get(c.id) ?? c.height), 0) + Math.max(0, cs.length - 1) * TREE_V_GAP;
    let cursor = cy - total / 2;
    for (const c of cs) {
      const e = ext.get(c.id) ?? c.height;
      placeSide(c, anchorX, cursor + e / 2, side);
      cursor += e + TREE_V_GAP;
    }
  };
  const rc = center(root);
  out.set(root.id, { x: root.x, y: root.y });
  const cs = visibleChildren(root, kids);
  if (mode === 'mindmap' && cs.length > 1) {
    const right: CanvasNode[] = [];
    const left: CanvasNode[] = [];
    let rs = 0, ls = 0;
    for (const c of cs) {
      const e = ext.get(c.id) ?? c.height;
      if (rs <= ls) { right.push(c); rs += e; } else { left.push(c); ls += e; }
    }
    placeChildren(root, root.x + root.width + TREE_H_GAP, rc.y, right, 'right');
    placeChildren(root, root.x - TREE_H_GAP, rc.y, left, 'left');
  } else if (mode === 'left') {
    placeChildren(root, root.x - TREE_H_GAP, rc.y, cs, 'left');
  } else {
    placeChildren(root, root.x + root.width + TREE_H_GAP, rc.y, cs, 'right');
  }
  return out;
}

function anchorTo(positions: Map<string, Pos>, nodes: Map<string, CanvasNode>, ids: string[]) {
  const before = bounds(ids.map((id) => nodes.get(id)!).filter(Boolean));
  const after = bounds(ids.filter((id) => positions.has(id)).map((id) => {
    const p = positions.get(id)!; const n = nodes.get(id)!;
    return { x: p.x, y: p.y, width: p.width ?? n.width, height: p.height ?? n.height };
  }));
  if (!before || !after) return positions;
  const dx = before.x - after.x, dy = before.y - after.y;
  for (const [id, p] of positions) positions.set(id, { ...p, x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
  return positions;
}

/** Layered graph layout (dagre). Frames become compound clusters. */
export function layoutGraph(doc: CanvasDocument, ids: string[] | undefined, direction: GraphDirection = 'LR', spacing = 1): Map<string, Pos> {
  const nodes = nodeMap(doc);
  const hidden = hiddenIds(doc);
  const pool = (ids?.length ? ids : doc.nodes.map((n) => n.id))
    .map((id) => nodes.get(id)).filter((n): n is CanvasNode => !!n && !hidden.has(n.id));
  const frames = pool.filter((n) => n.kind === 'frame');
  const members = pool.filter((n) => n.kind !== 'frame');
  const memberIds = new Set(members.map((n) => n.id));
  const frameIds = new Set(frames.map((f) => f.id));
  const useCompound = frames.length > 0;
  const g = new dagre.graphlib.Graph({ compound: useCompound, multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: (useCompound ? 64 : 40) * spacing, ranksep: 90 * spacing, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const f of frames) g.setNode(f.id, {});
  for (const n of members) {
    g.setNode(n.id, { width: n.width, height: n.height });
    if (useCompound && n.frameId && frameIds.has(n.frameId)) g.setParent(n.id, n.frameId);
  }
  for (const n of members) if (n.parentId && memberIds.has(n.parentId)) g.setEdge(n.parentId, n.id, { minlen: 1 }, 'tree-' + n.id);
  for (const e of doc.edges) if (memberIds.has(e.source) && memberIds.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target, { minlen: 1 }, e.id);
  dagre.layout(g);
  const out = new Map<string, Pos>();
  for (const n of members) {
    const p = g.node(n.id) as { x: number; y: number } | undefined;
    if (p) out.set(n.id, { x: p.x - n.width / 2, y: p.y - n.height / 2 });
  }
  for (const f of frames) {
    const ms = members.filter((m) => m.frameId === f.id && out.has(m.id));
    const b = bounds(ms.map((m) => ({ ...out.get(m.id)!, width: m.width, height: m.height })));
    if (b) out.set(f.id, { x: b.x - FRAME_PAD, y: b.y - FRAME_HEADER, width: b.width + FRAME_PAD * 2, height: b.height + FRAME_HEADER + FRAME_PAD });
  }
  return anchorTo(out, nodes, [...out.keys()]);
}

export function layoutGrid(doc: CanvasDocument, ids: string[] | undefined, spacing = 1): Map<string, Pos> {
  const nodes = nodeMap(doc);
  const hidden = hiddenIds(doc);
  const pool = (ids?.length ? ids : doc.nodes.map((n) => n.id)).map((id) => nodes.get(id))
    .filter((n): n is CanvasNode => !!n && n.kind !== 'frame' && !hidden.has(n.id))
    .sort((a, b) => (Math.round(a.y / 40) - Math.round(b.y / 40)) || a.x - b.x);
  const out = new Map<string, Pos>();
  if (!pool.length) return out;
  const cols = Math.ceil(Math.sqrt(pool.length));
  const cw = Math.max(...pool.map((n) => n.width)) + 32 * spacing;
  const ch = Math.max(...pool.map((n) => n.height)) + 32 * spacing;
  const b = bounds(pool)!;
  pool.forEach((n, i) => out.set(n.id, { x: b.x + (i % cols) * cw, y: b.y + Math.floor(i / cols) * ch }));
  return out;
}

/** Swimlane layout: frames become equal-height columns, members flow top-to-bottom inside. */
export function layoutLanes(doc: CanvasDocument, spacing = 1, frameIds?: string[]): Map<string, Pos> {
  const nodes = nodeMap(doc);
  const hidden = hiddenIds(doc);
  const frames = doc.nodes.filter((n) => n.kind === 'frame' && (!frameIds?.length || frameIds.includes(n.id))).sort((a, b) => a.x - b.x);
  const out = new Map<string, Pos>();
  if (!frames.length) return out;
  const startX = Math.min(...frames.map((f) => f.x));
  const startY = Math.min(...frames.map((f) => f.y));
  const lanes = frames.map((f) => {
    const ms = doc.nodes.filter((n) => n.frameId === f.id && n.kind !== 'frame' && !hidden.has(n.id));
    if (!ms.length) return { f, ms, pos: new Map<string, Pos>(), w: f.width, h: f.height - FRAME_HEADER - FRAME_PAD };
    const set0 = new Set(ms.map((m) => m.id));
    const linked = ms.some((m) => m.parentId && set0.has(m.parentId)) || doc.edges.some((e) => set0.has(e.source) && set0.has(e.target) && e.source !== e.target);
    if (!linked) {
      const pos = new Map<string, Pos>();
      const ordered = [...ms].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const w = Math.max(...ordered.map((m) => m.width));
      let y = 0;
      for (const m of ordered) { pos.set(m.id, { x: (w - m.width) / 2, y }); y += m.height + 28 * spacing; }
      return { f, ms, pos, w: Math.max(w + FRAME_PAD * 2, 280), h: y - 28 * spacing };
    }
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: 'TB', nodesep: 28 * spacing, ranksep: 56 * spacing, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    const set = new Set(ms.map((m) => m.id));
    for (const m of ms) g.setNode(m.id, { width: m.width, height: m.height });
    for (const m of ms) if (m.parentId && set.has(m.parentId)) g.setEdge(m.parentId, m.id, {}, 't' + m.id);
    for (const e of doc.edges) if (set.has(e.source) && set.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target, {}, e.id);
    dagre.layout(g);
    const pos = new Map<string, Pos>();
    for (const m of ms) { const p = g.node(m.id) as { x: number; y: number }; pos.set(m.id, { x: p.x - m.width / 2, y: p.y - m.height / 2 }); }
    const b = bounds(ms.map((m) => ({ ...pos.get(m.id)!, width: m.width, height: m.height })))!;
    for (const [id, p] of pos) pos.set(id, { x: p.x - b.x, y: p.y - b.y });
    return { f, ms, pos, w: Math.max(b.width + FRAME_PAD * 2, 280), h: b.height };
  });
  const laneH = Math.max(...lanes.map((l) => l.h)) + FRAME_HEADER + FRAME_PAD * 2;
  let x = startX;
  for (const lane of lanes) {
    out.set(lane.f.id, { x, y: startY, width: lane.w, height: laneH });
    const contentW = lane.ms.length ? Math.max(...lane.ms.map((m) => lane.pos.get(m.id)!.x + m.width)) : 0;
    const offX = x + (lane.w - contentW) / 2;
    for (const m of lane.ms) {
      const p = lane.pos.get(m.id)!;
      out.set(m.id, { x: Math.round(offX + p.x), y: Math.round(startY + FRAME_HEADER + FRAME_PAD + p.y) });
    }
    x += lane.w + 32 * spacing;
  }
  void nodes;
  return out;
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignNodes(doc: CanvasDocument, ids: string[], align: Align): Map<string, Pos> {
  const nodes = nodeMap(doc);
  const pool = ids.map((id) => nodes.get(id)).filter((n): n is CanvasNode => !!n);
  const out = new Map<string, Pos>();
  const b = bounds(pool);
  if (!b || pool.length < 2) return out;
  for (const n of pool) {
    let { x, y } = n;
    if (align === 'left') x = b.x;
    if (align === 'right') x = b.x + b.width - n.width;
    if (align === 'center') x = b.x + b.width / 2 - n.width / 2;
    if (align === 'top') y = b.y;
    if (align === 'bottom') y = b.y + b.height - n.height;
    if (align === 'middle') y = b.y + b.height / 2 - n.height / 2;
    out.set(n.id, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

export function distributeNodes(doc: CanvasDocument, ids: string[], axis: 'horizontal' | 'vertical'): Map<string, Pos> {
  const nodes = nodeMap(doc);
  const pool = ids.map((id) => nodes.get(id)).filter((n): n is CanvasNode => !!n);
  const out = new Map<string, Pos>();
  if (pool.length < 3) return out;
  const key = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';
  pool.sort((a, b) => a[key] - b[key]);
  const first = pool[0], last = pool[pool.length - 1];
  const span = last[key] + last[size] - first[key];
  const used = pool.reduce((s, n) => s + n[size], 0);
  const gap = (span - used) / (pool.length - 1);
  let cursor = first[key];
  for (const n of pool) {
    out.set(n.id, axis === 'horizontal' ? { x: Math.round(cursor), y: n.y } : { x: n.x, y: Math.round(cursor) });
    cursor += n[size] + gap;
  }
  return out;
}

export function fitFrame(doc: CanvasDocument, frameId: string, padding = FRAME_PAD): Pos | null {
  const ms = doc.nodes.filter((n) => n.frameId === frameId && n.kind !== 'frame');
  const b = bounds(ms);
  if (!b) return null;
  return { x: b.x - padding, y: b.y - FRAME_HEADER, width: b.width + padding * 2, height: b.height + FRAME_HEADER + padding };
}

