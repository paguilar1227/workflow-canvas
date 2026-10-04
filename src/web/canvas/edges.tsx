import { memo, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, Position, useInternalNode, type EdgeProps } from '@xyflow/react';
import type { CanvasEdge, Side } from '../../shared/types';
import { COLOR_NAMES } from '../../shared/types';
import { InlineEdit } from './nodes';
import { useApp, set } from '../store';
import { roughPath, seedOf, useSketch } from './sketch';
import * as actions from '../actions';
import { InlineMarkdown } from '../markdown';

type Rect = { x: number; y: number; w: number; h: number };
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

export function autoSides(s: Rect, t: Rect): [Side, Side] {
  if (t.x >= s.x + s.w + 8) return ['right', 'left'];
  if (t.x + t.w <= s.x - 8) return ['left', 'right'];
  if (t.y >= s.y + s.h) return ['bottom', 'top'];
  return ['top', 'bottom'];
}

const markerUrl = (c: string | undefined, selected: boolean) => 'url(#wfc-arrow-' + (selected ? 'selected' : c && c !== 'default' ? c : 'default') + ')';

export const SmartEdge = memo(function SmartEdge({ id, source, target, data, selected }: EdgeProps) {
  const e = (data as { edge: CanvasEdge; offset?: number }).edge;
  const offset = (data as { offset?: number }).offset ?? 0;
  const s = useRect(source);
  const t = useRect(target);
  const editing = useApp((st) => st.editingEdgeId === id);
  const sketch = useSketch();
  if (!s || !t) return null;
  const [as, at] = autoSides(s, t);
  const ss = (e.sourceSide as Side) || as;
  const ts = (e.targetSide as Side) || at;
  const a = shift(anchor(s, ss), ss, offset), b = shift(anchor(t, ts), ts, offset);
  const params = { sourceX: a.x, sourceY: a.y, sourcePosition: POS[ss], targetX: b.x, targetY: b.y, targetPosition: POS[ts] };
  const [path, lx, ly] = e.routing === 'bezier' ? getBezierPath(params)
    : e.routing === 'straight' ? getStraightPath(params)
    : getSmoothStepPath({ ...params, borderRadius: e.routing === 'step' ? 0 : 10, offset: 18 });
  const cls = ['wfc-edge-path', selected ? 'selected' : '', e.animated ? 'animated' : e.style !== 'solid' ? e.style : '', sketch ? 'sk-base' : ''].join(' ');
  const color = e.color && e.color !== 'default' ? 'var(--c-' + e.color + ')' : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={cls}
        interactionWidth={18}
        style={color ? ({ ['--ec' as string]: color } as CSSProperties) : undefined}
        markerEnd={e.arrow === 'end' || e.arrow === 'both' ? markerUrl(e.color, !!selected) : undefined}
        markerStart={e.arrow === 'start' || e.arrow === 'both' ? markerUrl(e.color, !!selected) : undefined}
      />
      {sketch ? (
        <g className={'wfc-sk-edge' + (selected ? ' selected' : '') + (e.animated ? ' animated' : e.style !== 'solid' ? ' ' + e.style : '')} style={color ? ({ ['--ec' as string]: color } as CSSProperties) : undefined}>
          {roughPath(path, seedOf(id)).map((p, i) => <path key={i} d={p.d} />)}
        </g>
      ) : null}
      {e.label || editing ? (
        <EdgeLabelRenderer>
          <div
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
  const d = data as { color?: string; depth: number };
  const s = useRect(source);
  const t = useRect(target);
  const sketch = useSketch();
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
  const stroke = d.color && d.color !== 'default' ? 'var(--c-' + d.color + ')' : 'var(--edge)';
  if (sketch) return <g className="wfc-branch" style={{ stroke }}>{roughPath(path, seedOf(id), d.depth <= 1 ? 2.2 : 1.5).map((p, i) => <path key={i} d={p.d} style={{ strokeWidth: p.strokeWidth }} />)}</g>;
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

