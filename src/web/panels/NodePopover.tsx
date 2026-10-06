import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useInternalNode, useViewport } from '@xyflow/react';
import { useApp, get, set } from '../store';
import { NodeInspector, nodeKindLabel } from './Inspector';

/** Space between the node and the popover, the margin it keeps inside the canvas, and its width (the inspector column's). */
const GAP = 12;
const MARGIN = 8;
const WIDTH = 292;
/** Tall enough to show the title through status, priority and tags without scrolling; the rest scrolls inside it. */
const MAX_HEIGHT = 520;

type Bounds = { left: number; top: number; right: number; bottom: number };

/** The canvas area the popover may use: the flow pane, above the bottom toolbar (the dock layout's --dock-lift). */
function canvasBounds(): Bounds | null {
  const r = document.querySelector('.react-flow')?.getBoundingClientRect();
  if (!r) return null;
  const wrap = document.querySelector<HTMLElement>('[data-testid="canvas"]');
  const lift = wrap ? parseFloat(getComputedStyle(wrap).getPropertyValue('--dock-lift')) || 0 : 0;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom - lift };
}

function dismiss() {
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest('[data-testid="node-popover"]')) active.blur();
  set({ nodeMenu: null, openMenu: null });
}

/**
 * Desktop quick edit: a mouse double-click on a node opens its inspector in a popover beside it, so a person edits
 * it where they are looking. It follows the node through pans, zooms and drags, and closes on Esc, its close
 * button, a click on empty canvas, inline editing (F2), or when the selection moves to something else.
 */
export function NodePopover() {
  const id = useApp((s) => s.nodeMenu);
  const kind = useApp((s) => (s.nodeMenu ? s.doc?.nodes.find((n) => n.id === s.nodeMenu)?.kind : undefined));
  const alone = useApp((s) => s.capturing || (s.selection.edges.length === 0 && s.selection.nodes.length === 1 && s.selection.nodes[0] === s.nodeMenu));
  const blocked = useApp((s) => s.session.viewMode || s.coarse || !!s.editingId);
  const open = !!id && !!kind && kind !== 'drawing' && alone && !blocked;
  useEffect(() => { if (id && !open) set({ nodeMenu: null }); }, [id, open]);
  return open ? <Popover key={id} id={id!} /> : null;
}

function Popover({ id }: { id: string }) {
  const node = useApp((s) => s.doc?.nodes.find((n) => n.id === id));
  const internal = useInternalNode(id);
  const { x, y, zoom } = useViewport();
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState(canvasBounds);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const flow = document.querySelector('.react-flow');
    const update = () => setBounds(canvasBounds());
    const ro = new ResizeObserver(update);
    if (flow) ro.observe(flow);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const field = ref.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="insp-title"]');
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  if (!node || !bounds || !internal) return null;
  const at = internal.internals.positionAbsolute;
  const nl = bounds.left + x + at.x * zoom;
  const nt = bounds.top + y + at.y * zoom;
  const nr = nl + (internal.measured.width ?? node.width) * zoom;
  const nb = nt + (internal.measured.height ?? node.height) * zoom;
  const onScreen = nr > bounds.left && nl < bounds.right && nb > bounds.top && nt < bounds.bottom;
  const maxHeight = Math.max(160, Math.min(MAX_HEIGHT, bounds.bottom - bounds.top - 2 * MARGIN));
  const h = Math.min(height || maxHeight, maxHeight);
  const minLeft = bounds.left + MARGIN;
  const maxLeft = bounds.right - MARGIN - WIDTH;
  const side = nr + GAP <= maxLeft ? 'right' : nl - GAP - WIDTH >= minLeft ? 'left' : 'over';
  const left = side === 'right' ? nr + GAP : side === 'left' ? nl - GAP - WIDTH : Math.max(minLeft, Math.min(nr + GAP, maxLeft));
  const top = Math.max(bounds.top + MARGIN, Math.min(nt, bounds.bottom - MARGIN - h));

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || get().openMenu) return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  };
  return (
    <div ref={ref} className={'panel node-popover ' + side} role="dialog" aria-label={'Edit ' + nodeKindLabel(node).toLowerCase() + ': ' + (node.title || 'untitled')}
      data-testid="node-popover" data-node-id={id} data-side={side}
      style={{ left, top, width: WIDTH, maxHeight, visibility: onScreen ? undefined : 'hidden' }}
      onKeyDownCapture={onKey} onClick={() => set({ openMenu: null })} onContextMenu={(e) => e.stopPropagation()}>
      <NodeInspector n={node} scope="pop-" onClose={dismiss} />
    </div>
  );
}
