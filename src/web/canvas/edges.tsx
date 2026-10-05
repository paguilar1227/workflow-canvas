import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, Position, useInternalNode, ViewportPortal, type EdgeProps } from '@xyflow/react';
import type { CanvasEdge, Side } from '../../shared/types';
import { COLOR_NAMES } from '../../shared/types';
import { InlineEdit } from './nodes';
import { useApp, set } from '../store';
import { roughPath, seedOf, useSketch } from './sketch';
import * as actions from '../actions';
import { InlineMarkdown } from '../markdown';
import { neonBranch, useNeon } from './neon';

export type Rect = { x: number; y: number; w: number; h: number };
const POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

function useRect(id: string): Rect | null {
  const n = useInternalNode(id);
  if (!n) return null;
  const p = n.internals.positionAbsolute;
  return { x: p.x, y: p.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 };
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
  switch (side) {
    case 'top': return { x: r.x + r.w * f, y: r.y };
    case 'bottom': return { x: r.x + r.w * f, y: r.y + r.h };
    case 'left': return { x: r.x, y: r.y + r.h * f };
    case 'right': return { x: r.x + r.w, y: r.y + r.h * f };
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
  const params = { sourceX: a.x, sourceY: a.y, sourcePosition: POS[ss], targetX: b.x, targetY: b.y, targetPosition: POS[ts] };
  const routing = neon && e.routing === 'smooth' ? 'bezier' : e.routing;
  const [path, mx, my] = routing === 'bezier' ? getBezierPath(params)
    : routing === 'straight' ? getStraightPath(params)
    : getSmoothStepPath({ ...params, borderRadius: routing === 'step' ? 0 : 10, offset: 18 });
  const { x: lx, y: ly } = routing === 'bezier' && (e.label || editing) ? clearLabelPoint(path, [s, t], labelHalf, { x: mx, y: my }) : { x: mx, y: my };
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
        markerEnd={!neon && (e.arrow === 'end' || e.arrow === 'both') ? markerUrl(e.color, !!selected) : undefined}
        markerStart={!neon && (e.arrow === 'start' || e.arrow === 'both') ? markerUrl(e.color, !!selected) : undefined}
      />
      {neon ? (
        <ViewportPortal>
          {[a, b].map((p, i) => <span key={i} className="wfc-port-dot" style={{ ...ecStyle, transform: 'translate(' + p.x + 'px,' + p.y + 'px)' }} />)}
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
  const colors = ['default', 'selected', ...COLOR_NAMES.filter((c) => c !== 'default')];
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {colors.map((c) => (
          <marker key={c} id={'wfc-arrow-' + c} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: c === 'default' ? 'var(--edge)' : c === 'selected' ? 'var(--selection)' : 'var(--c-' + c + ')' }} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

