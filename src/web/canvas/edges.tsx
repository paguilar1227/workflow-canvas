import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, Position, useInternalNode, ViewportPortal, type EdgeProps } from '@xyflow/react';
import type { CanvasEdge, CanvasNode, NodeShape, Side } from '../../shared/types';
import { COLOR_NAMES } from '../../shared/types';
import { InlineEdit } from './nodes';
import { useApp, set } from '../store';
import { roughPath, seedOf, useSketch } from './sketch';
import * as actions from '../actions';
import { InlineMarkdown } from '../markdown';
import { neonBranch, useNeon } from './neon';

export type Rect = { x: number; y: number; w: number; h: number; shape?: NodeShape };
const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
const NEON_ARROW_SIZE = 21;
const NEON_DASH_GAP = 9;

function useRect(id: string): Rect | null {
  const n = useInternalNode(id);
  if (!n) return null;
  const p = n.internals.positionAbsolute;
  const node = (n.data as { node: CanvasNode }).node;
  return { x: p.x, y: p.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0, shape: node?.kind === 'topic' ? node.shape : undefined };
}

function anchor(r: Rect, side: Side) {
  switch (side) {
    case 'top': return { x: r.x + r.w / 2, y: r.y };
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'left': return { x: r.x, y: r.y + r.h / 2 };
    case 'right': return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

function shift(p: { x: number; y: number }, side: Side, offset: number) {
  return side === 'left' || side === 'right' ? { x: p.x, y: p.y + offset } : { x: p.x + offset, y: p.y };
}

/**
 * Where to put a bezier connector's label: the point nearest the middle of the curve whose label box (half-size
 * \`half\`) stays clear of both end nodes, so a wire curving into a node's port never hides its label under the node.
 */
export function clearLabelPoint(path: string, rects: Rect[], half: { w: number; h: number }, middle: { x: number; y: number }) {
  const n = path.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number);
  if (!n || n.length !== 8) return middle;
  const at = (t: number) => {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * n[0] + b * n[2] + c * n[4] + d * n[6], y: a * n[1] + b * n[3] + c * n[5] + d * n[7] };
  };
  const clear = (p: { x: number; y: number }) => rects.every((r) => p.x + half.w <= r.x || p.x - half.w >= r.x + r.w || p.y + half.h <= r.y || p.y - half.h >= r.y + r.h);
  for (let i = 0; i <= 50; i++) for (const t of i ? [0.5 - i / 100, 0.5 + i / 100] : [0.5]) { const p = at(t); if (clear(p)) return p; }
  return middle;
}

/** A point a fraction of the way along one side of a node (0.5 is the side's middle). */
function alongSide(r: Rect, side: Side, f: number) {
  const horizontal = side === 'top' || side === 'bottom';
  let across = side === 'left' || side === 'top' ? 0 : 1;
  const direction = across ? 1 : -1;
  if (r.shape === 'circle') across = 0.5 + direction * Math.sqrt(Math.max(0, 0.49 ** 2 - (f - 0.5) ** 2));
  if (r.shape === 'diamond') across = 0.5 + direction * Math.max(0, 0.49 - Math.abs(f - 0.5));
  if (r.shape === 'pill') {
    const radius = Math.min(r.w, r.h) / 2;
    const length = horizontal ? r.w : r.h;
    const fromCorner = Math.max(radius - length * f, length * f - length + radius, 0);
    const inset = radius - Math.sqrt(Math.max(0, radius ** 2 - fromCorner ** 2));
    across -= direction * inset / (horizontal ? r.h : r.w);
  }
  if (r.shape === 'cylinder') {
    if (horizontal) across = (side === 'top' ? 0.14 : 0.86) + direction * 0.13 * Math.sqrt(Math.max(0, 1 - ((f - 0.5) / 0.49) ** 2));
    else {
      const capDistance = Math.max(0.14 - f, f - 0.86, 0) / 0.13;
      across = 0.5 + direction * 0.49 * Math.sqrt(Math.max(0, 1 - capDistance ** 2));
    }
  }
  const polygons: Partial<Record<NodeShape, number[][]>> = {
    hexagon: [[0.14, 0.01], [0.86, 0.01], [0.99, 0.5], [0.86, 0.99], [0.14, 0.99], [0.01, 0.5]],
    parallelogram: [[0.07, 0.01], [1.07, 0.01], [0.93, 0.99], [-0.07, 0.99]],
  };
  const polygon = r.shape && polygons[r.shape];
  if (polygon) {
    const hits = polygon.flatMap((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      const axis = horizontal ? 0 : 1;
      const delta = next[axis] - point[axis];
      const fraction = delta ? (f - point[axis]) / delta : -1;
      return fraction >= 0 && fraction <= 1 ? [point[1 - axis] + fraction * (next[1 - axis] - point[1 - axis])] : [];
    });
    if (hits.length) across = direction < 0 ? Math.min(...hits) : Math.max(...hits);
  }
  return horizontal ? { x: r.x + r.w * f, y: r.y + r.h * across } : { x: r.x + r.w * across, y: r.y + r.h * f };
}

function arrowBase(point: { x: number; y: number }, side: Side, length: number) {
  switch (side) {
    case 'top': return { x: point.x, y: point.y - length };
    case 'bottom': return { x: point.x, y: point.y + length };
    case 'left': return { x: point.x - length, y: point.y };
    case 'right': return { x: point.x + length, y: point.y };
  }
}

export type PortSlot = { s: number; t: number; side: Side };

/**
 * Neon Flow ports: wires that share a side of a node are spread evenly along it, ordered by where their other end sits
 * so they don't cross. Returns, per edge, the fraction along the source side (s) and target side (t), and the target side.
 */
export function portSlots(rects: Map<string, Rect>, edges: CanvasEdge[]): Map<string, PortSlot> {
  const ends = new Map<string, { edge: string; end: 's' | 't'; key: number }[]>();
  const out = new Map<string, PortSlot>();
  for (const e of edges) {
    const s = rects.get(e.source), t = rects.get(e.target);
    if (!s || !t) continue;
    const [as, at] = autoSides(s, t);
    const ss = (e.sourceSide as Side) || as, ts = (e.targetSide as Side) || at;
    out.set(e.id, { s: 0.5, t: 0.5, side: ts });
    const add = (node: string, side: Side, end: 's' | 't', other: Rect) => {
      const k = node + ':' + side;
      const key = side === 'top' || side === 'bottom' ? other.x + other.w / 2 : other.y + other.h / 2;
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k)!.push({ edge: e.id, end, key });
    };
    add(e.source, ss, 's', t);
    add(e.target, ts, 't', s);
  }
  for (const list of ends.values()) {
    list.sort((a, b) => a.key - b.key || (a.edge < b.edge ? -1 : a.edge > b.edge ? 1 : 0));
    list.forEach((p, i) => { out.get(p.edge)![p.end] = (i + 1) / (list.length + 1); });
  }
  return out;
}

export function autoSides(s: Rect, t: Rect): [Side, Side] {
  if (t.x >= s.x + s.w + 8) return ['right', 'left'];
  if (t.x + t.w <= s.x - 8) return ['left', 'right'];
  if (t.y >= s.y + s.h) return ['bottom', 'top'];
  return ['top', 'bottom'];
}

const markerUrl = (c: string | undefined, selected: boolean) => 'url(#wfc-arrow-' + (selected ? 'selected' : c && c !== 'default' ? c : 'default') + ')';

export const SmartEdge = memo(function SmartEdge({ id, source, target, data, selected }: EdgeProps) {
  const e = (data as { edge: CanvasEdge; offset?: number; wire?: string }).edge;
  const wire = (data as { wire?: string }).wire;
  const slot = (data as { slot?: PortSlot }).slot;
  const offset = (data as { offset?: number }).offset ?? 0;
  const s = useRect(source);
  const t = useRect(target);
  const editing = useApp((st) => st.editingEdgeId === id);
  const sketch = useSketch();
  const neon = useNeon();
  const born = useApp((st) => !!st.newEdges[id]);
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelHalf, setLabelHalf] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (el && (el.offsetWidth / 2 !== labelHalf.w || el.offsetHeight / 2 !== labelHalf.h)) setLabelHalf({ w: el.offsetWidth / 2, h: el.offsetHeight / 2 });
  });
  if (!s || !t) return null;
  const [as, at] = autoSides(s, t);
  const ss = (e.sourceSide as Side) || as;
  const ts = (e.targetSide as Side) || at;
  const a = neon && slot ? alongSide(s, ss, slot.s) : shift(anchor(s, ss), ss, offset);
  const b = neon && slot ? alongSide(t, ts, slot.t) : shift(anchor(t, ts), ts, offset);
  const startArrow = e.arrow === 'start' || e.arrow === 'both';
  const endArrow = e.arrow === 'end' || e.arrow === 'both';
  const patterned = neon && (e.style !== 'solid' || !!e.animated);
  const terminalLength = NEON_ARROW_SIZE + (patterned ? NEON_DASH_GAP : 0);
  const routing = neon && e.routing === 'smooth' ? 'bezier' : e.routing;
  const startLead = neon && startArrow && routing !== 'straight';
  const endLead = neon && endArrow && routing !== 'straight';
  const routeStart = startLead ? arrowBase(a, ss, terminalLength) : a;
  const routeEnd = endLead ? arrowBase(b, ts, terminalLength) : b;
  const params = { sourceX: routeStart.x, sourceY: routeStart.y, sourcePosition: POS[ss], targetX: routeEnd.x, targetY: routeEnd.y, targetPosition: POS[ts] };
  const [body, mx, my] = routing === 'bezier' ? getBezierPath(params)
    : routing === 'straight' ? getStraightPath(params)
    : getSmoothStepPath({ ...params, borderRadius: routing === 'step' ? 0 : 10, offset: 18 });
  const path = (startLead ? body.replace(/^M[^A-Za-z]+/, 'M' + a.x + ',' + a.y + ' L' + routeStart.x + ',' + routeStart.y + ' ') : body) + (endLead ? ' L' + b.x + ',' + b.y : '');
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const straightScale = distance ? Math.min(terminalLength, distance / 2) / distance : 0;
  const sourceStem = routing === 'straight' ? { x: a.x + (b.x - a.x) * straightScale, y: a.y + (b.y - a.y) * straightScale } : routeStart;
  const targetStem = routing === 'straight' ? { x: b.x - (b.x - a.x) * straightScale, y: b.y - (b.y - a.y) * straightScale } : routeEnd;
  const terminalPath = [startArrow ? 'M' + a.x + ',' + a.y + ' L' + sourceStem.x + ',' + sourceStem.y : '', endArrow ? 'M' + targetStem.x + ',' + targetStem.y + ' L' + b.x + ',' + b.y : ''].join(' ');
  const { x: lx, y: ly } = routing === 'bezier' && (e.label || editing) ? clearLabelPoint(body, [s, t], labelHalf, { x: mx, y: my }) : { x: mx, y: my };
  const cls = ['wfc-edge-path', selected ? 'selected' : '', e.animated ? 'animated' : e.style !== 'solid' ? e.style : '', sketch ? 'sk-base' : '', neon ? 'neon' : '', neon && born ? 'born' : ''].join(' ');
  const colorName = neon && wire ? wire : e.color;
  const color = colorName && colorName !== 'default' ? 'var(--c-' + colorName + ')' : undefined;
  const ecStyle = color ? ({ ['--ec' as string]: color } as CSSProperties) : undefined;
  return (
    <>
      {neon ? <path d={path} className={'wfc-neon-halo' + (selected ? ' selected' : '')} style={ecStyle} /> : null}
      <BaseEdge
        id={id}
        path={path}
        className={cls}
        interactionWidth={18}
        style={ecStyle}
        markerEnd={endArrow ? markerUrl(colorName, !neon && !!selected) : undefined}
        markerStart={startArrow ? markerUrl(colorName, !neon && !!selected) : undefined}
      />
      {patterned && (startArrow || endArrow) ? <path d={terminalPath} className={'wfc-neon-terminal' + (selected ? ' selected' : '')} style={ecStyle} /> : null}
      {neon ? (
        <ViewportPortal>
          {[a, b].map((p, i) => (i === 0 ? startArrow : endArrow) ? null : <span key={i} className="wfc-port-dot" style={{ ...ecStyle, transform: 'translate(' + p.x + 'px,' + p.y + 'px)' }} />)}
        </ViewportPortal>
      ) : null}
      {sketch ? (
        <g className={'wfc-sk-edge' + (selected ? ' selected' : '') + (e.animated ? ' animated' : e.style !== 'solid' ? ' ' + e.style : '')} style={color ? ({ ['--ec' as string]: color } as CSSProperties) : undefined}>
          {roughPath(path, seedOf(id)).map((p, i) => <path key={i} d={p.d} />)}
        </g>
      ) : null}
      {e.label || editing ? (
        <EdgeLabelRenderer>
          <div
            ref={labelRef}
            className={'wfc-edge-label nodrag nopan' + (selected ? ' selected' : '')}
            style={{ left: lx, top: ly }}
            data-testid={'edge-label-' + id}
            onClick={(ev) => { ev.stopPropagation(); set({ selection: { nodes: [], edges: [id] } }); }}
            onDoubleClick={(ev) => { ev.stopPropagation(); set({ editingEdgeId: id }); }}
          >
            {editing ? (
              <InlineEdit className="wfc-edge-edit" value={e.label ?? ''} onDone={(v) => { set({ editingEdgeId: null }); if (v !== null && v !== (e.label ?? '')) actions.updateEdge(id, { label: v }); }} />
            ) : <InlineMarkdown source={e.label ?? ''} />}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

export const BranchEdge = memo(function BranchEdge({ id, source, target, data }: EdgeProps) {
  const d = data as { color?: string; depth: number; branchId?: string };
  const s = useRect(source);
  const t = useRect(target);
  const sketch = useSketch();
  const neon = useNeon();
  if (!s || !t) return null;
  const tc = t.x + t.w / 2;
  let ss: Side, ts: Side;
  if (t.x >= s.x + s.w - 4) { ss = 'right'; ts = 'left'; }
  else if (t.x + t.w <= s.x + 4) { ss = 'left'; ts = 'right'; }
  else if (t.y > s.y) { ss = 'bottom'; ts = 'top'; }
  else { ss = 'top'; ts = 'bottom'; }
  void tc;
  const a = anchor(s, ss), b = anchor(t, ts);
  const [path] = getBezierPath({ sourceX: a.x, sourceY: a.y, sourcePosition: POS[ss], targetX: b.x, targetY: b.y, targetPosition: POS[ts], curvature: 0.35 });
  const colorName = neon ? neonBranch(d.branchId ?? target, d.color) : d.color;
  const stroke = colorName && colorName !== 'default' ? 'var(--c-' + colorName + ')' : 'var(--edge)';
  if (sketch) return <g className="wfc-branch" style={{ stroke }}>{roughPath(path, seedOf(id), d.depth <= 1 ? 2.2 : 1.5).map((p, i) => <path key={i} d={p.d} style={{ strokeWidth: p.strokeWidth }} />)}</g>;
  if (neon) return <path d={path} className="wfc-branch neon" style={{ stroke, strokeWidth: d.depth <= 1 ? 3 : 2.2, ['--ec' as string]: stroke } as CSSProperties} />;
  return <path d={path} className="wfc-branch" style={{ stroke, strokeWidth: d.depth <= 1 ? 2.4 : 1.6 }} />;
});

export const edgeTypes = { smart: SmartEdge, branch: BranchEdge };

export function MarkerDefs() {
  const neon = useNeon();
  const colors = ['default', 'selected', ...COLOR_NAMES.filter((c) => c !== 'default')];
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {colors.map((c) => (
          <marker key={c} id={'wfc-arrow-' + c} viewBox="0 0 10 10" refX={neon ? 10 : 8.5} refY="5" markerWidth={neon ? NEON_ARROW_SIZE : 7} markerHeight={neon ? NEON_ARROW_SIZE : 7} markerUnits={neon ? 'userSpaceOnUse' : 'strokeWidth'} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: c === 'default' ? 'var(--edge)' : c === 'selected' ? 'var(--selection)' : 'var(--c-' + c + ')' }} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

