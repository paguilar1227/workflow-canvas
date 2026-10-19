import { useEffect, useRef, type CSSProperties } from 'react';
import { EdgeLabelRenderer, useStore } from '@xyflow/react';
import { Button } from '../components/Button';
import { flow } from '../flowApi';
import { get, useApp } from '../store';
import { openContextMenu, updateEdge } from '../actions';
import { getTheme } from '../../shared/themes';
import type { Point } from './labels';

/** The same bend control as Kitchen, committed through the shared undo/MCP model. */
export function RouteHandle({ id, point, displayPoint = point, style, onPreview, zIndex }: { id: string; point: Point; displayPoint?: Point; style?: CSSProperties; onPreview: (point: Point | null) => void; zIndex: number }) {
  const threshold = useStore((s) => s.nodeDragThreshold);
  const step = useApp((s) => getTheme(s.session.theme).gap);
  const drag = useRef<{ pointer: number; x: number; y: number; at: Point; zoom: number; moved: boolean; docId: string | null } | null>(null);
  const cancel = () => { drag.current = null; onPreview(null); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { drag.current = null; onPreview(null); } };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); onPreview(null); };
  }, [onPreview]);
  const canEdit = () => !get().session.viewMode && get().session.mode === 'select';
  return <EdgeLabelRenderer>
    <Button className="wfc-route-handle nodrag nopan" data-testid={'edge-bend-' + id} data-edge-id={id}
      aria-label="Move connector bend" title="Drag to reroute connector · arrow keys to adjust · Delete to reset"
      style={{ ...style, left: displayPoint.x, top: displayPoint.y, zIndex }} onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openContextMenu(event.clientX, event.clientY, undefined, id); }}
      onKeyDown={(event) => {
        const deltas: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
        if (!canEdit()) return;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); updateEdge(id, { routePoint: null as never }); return; }
        const delta = deltas[event.key];
        if (!delta) return;
        event.preventDefault(); event.stopPropagation();
        updateEdge(id, { routePoint: { x: point.x + delta.x, y: point.y + delta.y } });
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !canEdit()) return;
        event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, at: point, zoom: flow()?.getZoom() ?? 1, moved: false, docId: get().docId };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointer !== event.pointerId || !canEdit()) return;
        if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) <= threshold) return;
        event.preventDefault(); event.stopPropagation(); active.moved = true;
        onPreview({ x: active.at.x + (event.clientX - active.x) / active.zoom, y: active.at.y + (event.clientY - active.y) / active.zoom });
      }}
      onPointerUp={(event) => {
        const active = drag.current;
        if (!active || active.pointer !== event.pointerId) return;
        if (active.moved && canEdit() && active.docId === get().docId) updateEdge(id, { routePoint: { x: active.at.x + (event.clientX - active.x) / active.zoom, y: active.at.y + (event.clientY - active.y) / active.zoom } });
        cancel();
      }} onPointerCancel={cancel} onLostPointerCapture={cancel} />
  </EdgeLabelRenderer>;
}
