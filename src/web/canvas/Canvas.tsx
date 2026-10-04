import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, SelectionMode,
  type Edge, type Node, type NodeChange, type EdgeChange, type Connection, type OnNodeDrag, type Viewport,
} from '@xyflow/react';
import { useApp, get, set } from '../store';
import { nodeTypes, type NodeData } from './nodes';
import { autoSides, edgeTypes, MarkerDefs } from './edges';
import { NEON_BURST_MS, NEON_SNAP_RADIUS, NeonConnectionLine, neonWireColors } from './neon';
import { strokePath } from './sketch';
import { childrenMap, descendants, hiddenIds, depthOf, branchAncestor, isAncestor } from '../../shared/graph';
import { containsPoint, defaultSize } from '../../shared/sizes';
import { getTheme } from '../../shared/themes';
import type { CanvasNode, Side } from '../../shared/types';
import { dispatch, reportSession } from '../sync';
import { setFlow } from '../flowApi';
import * as actions from '../actions';
import type { CommandInput } from '../../shared/commands';

const FLASH_MS = 1800;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
/** Parallel connectors between the same pair are spread so labels (about 20px tall) don't overlap. */
const PARALLEL_EDGE_GAP = 28;

function childSideOf(n: CanvasNode, kids: CanvasNode[]): NodeData['childSide'] {
  if (!kids.length) return null;
  const k = kids[0];
  if (k.x + k.width <= n.x) return 'left';
  if (k.x >= n.x + n.width - 4) return 'right';
  return 'bottom';
}

/** Neon Flow: connectors that appear in the open document (from the UI, an AI or undo) play the connect animation once. */
function useNeonBursts(neon: boolean) {
  const doc = useApp((s) => s.doc);
  const prev = useRef<{ docId: string | null; ids: Set<string> }>({ docId: null, ids: new Set() });
  useEffect(() => {
    if (!doc) return;
    const before = prev.current;
    prev.current = { docId: doc.id, ids: new Set(doc.edges.map((e) => e.id)) };
    if (!neon || before.docId !== doc.id) return;
    const born = doc.edges.filter((e) => !before.ids.has(e.id));
    if (!born.length) return;
    const at = Date.now();
    const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
    const rect = (n: CanvasNode) => ({ x: n.x, y: n.y, w: n.width, h: n.height });
    const wires = neonWireColors(doc.edges);
    const newEdges = { ...get().newEdges };
    const bursts = { ...get().bursts };
    for (const e of born) {
      newEdges[e.id] = at;
      const s = nodes.get(e.source), t = nodes.get(e.target);
      if (s && t) bursts[e.target] = { color: wires.get(e.id)!, side: (e.targetSide as Side) || autoSides(rect(s), rect(t))[1], at };
    }
    set({ newEdges, bursts });
    setTimeout(() => {
      const s = get();
      set({
        newEdges: Object.fromEntries(Object.entries(s.newEdges).filter(([, v]) => v !== at)),
        bursts: Object.fromEntries(Object.entries(s.bursts).filter(([, v]) => v.at !== at)),
      });
    }, NEON_BURST_MS);
  }, [doc, neon]);
}

export function Canvas() {
  useLongPressMenu();
  useTouchPinch();
  const doc = useApp((s) => s.doc);
  const coarse = useApp((s) => s.coarse);
  /** On touch one finger pans (React Flow's touch default); the Area tool arms a single box-select drag. */
  const areaSelect = useApp((s) => s.areaSelect);
  const selection = useApp((s) => s.selection);
  const overlay = useApp((s) => s.overlay);
  const editingId = useApp((s) => s.editingId);
  const flashing = useApp((s) => s.flashing);
  const dropTargetId = useApp((s) => s.dropTargetId);
  const session = useApp((s) => s.session);
  const searchOpen = useApp((s) => s.searchOpen);
  const searchIndex = useApp((s) => s.searchIndex);
  const theme = getTheme(session.theme);
  const neon = !!theme.neon;
  useNeonBursts(neon);
  const drag = useRef<{ start: Map<string, { x: number; y: number }>; companions: string[]; anchorId: string } | null>(null);

  const matches = useMemo(() => {
    const q = searchOpen ? session.search.trim().toLowerCase() : '';
    if (!q || !doc) return [] as string[];
    return doc.nodes.filter((n) => [n.title, n.subtitle, n.notes, n.badge, ...(n.tags ?? [])].some((v) => v?.toLowerCase().includes(q))).map((n) => n.id);
  }, [doc, session.search, searchOpen]);

  const lockedView = session.mode === 'pan' || !!session.viewMode;
  const rfNodes: Node[] = useMemo(() => {
    if (!doc) return [];
    const kids = childrenMap(doc);
    const hidden = hiddenIds(doc);
    const sel = new Set(selection.nodes);
    const now = Date.now();
    const current = matches.length ? matches[((searchIndex % matches.length) + matches.length) % matches.length] : null;
    const matchSet = new Set(matches);
    const ordered = [...doc.nodes].sort((a, b) => (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1));
    return ordered.filter((n) => !hidden.has(n.id)).map((n) => {
      const o = overlay[n.id];
      const ks = kids.get(n.id) ?? [];
      const width = o?.width ?? n.width;
      const height = o?.height ?? n.height;
      const data: NodeData = {
        node: n, childCount: ks.length, childSide: childSideOf(n, ks), isRoot: !n.parentId && ks.length > 0,
        editing: editingId === n.id, flashing: flashing[n.id] && now - flashing[n.id] < FLASH_MS ? flashing[n.id] : 0,
        match: current === n.id ? 'current' : matchSet.has(n.id) ? 'match' : 'none', dropTarget: dropTargetId === n.id,
      };
      return {
        id: n.id, type: n.kind, position: { x: o?.x ?? n.x, y: o?.y ?? n.y }, data, width, height, measured: { width, height },
        selected: sel.has(n.id), draggable: !n.locked && editingId !== n.id && !lockedView, zIndex: n.kind === 'frame' ? -1 : 1,
        className: n.kind === 'frame' ? 'is-frame' : undefined,
      } satisfies Node;
    });
  }, [doc, selection.nodes, overlay, editingId, flashing, dropTargetId, matches, searchIndex, lockedView]);

  const rfEdges: Edge[] = useMemo(() => {
    if (!doc) return [];
    const hidden = hiddenIds(doc);
    const ids = new Set(doc.nodes.map((n) => n.id));
    const sel = new Set(selection.edges);
    const out: Edge[] = [];
    for (const n of doc.nodes) {
      if (!n.parentId || !ids.has(n.parentId) || hidden.has(n.id)) continue;
      const branch = branchAncestor(doc, n.id);
      out.push({ id: 'tree:' + n.id, source: n.parentId, target: n.id, type: 'branch', selectable: false, focusable: false, data: { color: branch?.color, branchId: branch?.id, depth: depthOf(doc, n.id) } });
    }
    const wires = neon ? neonWireColors(doc.edges) : null;
    const lanes = new Map<string, string[]>();
    for (const e of doc.edges) {
      const key = [e.source, e.target].sort().join('|');
      lanes.set(key, [...(lanes.get(key) ?? []), e.id]);
    }
    for (const e of doc.edges) {
      if (hidden.has(e.source) || hidden.has(e.target)) continue;
      const group = lanes.get([e.source, e.target].sort().join('|'))!;
      const i = group.indexOf(e.id);
      const offset = group.length > 1 ? (i - (group.length - 1) / 2) * PARALLEL_EDGE_GAP : 0;
      out.push({ id: e.id, source: e.source, target: e.target, type: 'smart', data: { edge: e, offset, wire: wires?.get(e.id) }, selected: sel.has(e.id), zIndex: 0 });
    }
    return out;
  }, [doc, selection.edges, neon]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const s = get();
    let selNodes: string[] | null = null;
    const ov = { ...s.overlay };
    let ovChanged = false;
    for (const c of changes) {
      if (c.type === 'select') {
        selNodes = selNodes ?? [...s.selection.nodes];
        if (c.selected && !selNodes.includes(c.id)) selNodes.push(c.id);
        if (!c.selected) selNodes = selNodes.filter((x) => x !== c.id);
      } else if (c.type === 'position' && c.position) {
        ov[c.id] = { ...ov[c.id], x: c.position.x, y: c.position.y };
        ovChanged = true;
      } else if (c.type === 'dimensions' && c.dimensions && c.resizing !== undefined) {
        if (c.resizing) ov[c.id] = { ...ov[c.id], width: c.dimensions.width, height: c.dimensions.height };
        else delete ov[c.id];
        ovChanged = true;
      }
    }
    const patch: Partial<ReturnType<typeof get>> = {};
    if (selNodes) patch.selection = { nodes: selNodes, edges: get().selection.edges };
    if (ovChanged) patch.overlay = ov;
    if (Object.keys(patch).length) set(patch);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const s = get();
    let edges: string[] | null = null;
    for (const c of changes) {
      if (c.type !== 'select') continue;
      edges = edges ?? [...s.selection.edges];
      if (c.selected && !edges.includes(c.id)) edges.push(c.id);
      if (!c.selected) edges = edges.filter((x) => x !== c.id);
    }
    if (edges) set({ selection: { nodes: get().selection.nodes, edges } });
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    actions.connect(c.source, c.target, (c.sourceHandle as Side) || undefined, (c.targetHandle as Side) || undefined);
  }, []);

  const onNodeDragStart: OnNodeDrag = useCallback((_e, node, nodes) => {
    const d = get().doc; if (!d) return;
    const dragged = new Set(nodes.map((n) => n.id));
    const kids = childrenMap(d);
    const companions = new Set<string>();
    for (const id of dragged) {
      const n = d.nodes.find((x) => x.id === id);
      if (!n) continue;
      const extra = n.kind === 'frame' ? d.nodes.filter((m) => m.frameId === n.id).flatMap((m) => [m.id, ...descendants(d, m.id, kids)]) : descendants(d, n.id, kids);
      for (const x of extra) if (!dragged.has(x)) companions.add(x);
    }
    const start = new Map<string, { x: number; y: number }>();
    for (const n of d.nodes) if (dragged.has(n.id) || companions.has(n.id)) start.set(n.id, { x: n.x, y: n.y });
    drag.current = { start, companions: [...companions], anchorId: node.id };
    if (!get().selection.nodes.includes(node.id)) set({ selection: { nodes: [node.id], edges: [] } });
  }, []);

  const onNodeDrag: OnNodeDrag = useCallback((_e, node, nodes) => {
    const st = drag.current; const d = get().doc;
    if (!st || !d) return;
    const s0 = st.start.get(node.id); if (!s0) return;
    const dx = node.position.x - s0.x, dy = node.position.y - s0.y;
    const ov = { ...get().overlay };
    for (const id of st.companions) { const p = st.start.get(id)!; ov[id] = { ...ov[id], x: p.x + dx, y: p.y + dy }; }
    let drop: string | null = null;
    if (nodes.length === 1 && node.type === 'topic') {
      const me = d.nodes.find((x) => x.id === node.id)!;
      const c = { x: node.position.x + me.width / 2, y: node.position.y + me.height / 2 };
      const inTree = (n: CanvasNode) => !!n.parentId || d.nodes.some((m) => m.parentId === n.id);
      const target = d.nodes.find((t) => t.kind === 'topic' && t.id !== me.id && t.id !== me.parentId && !isAncestor(d, me.id, t.id) && containsPoint(t, c) && (inTree(t) || inTree(me)));
      drop = target?.id ?? null;
    }
    set({ overlay: ov, dropTargetId: drop });
  }, []);

  const onNodeDragStop: OnNodeDrag = useCallback((_e, node, nodes) => {
    const st = drag.current; const d = get().doc; const s = get();
    drag.current = null;
    if (!st || !d) { set({ overlay: {}, dropTargetId: null }); return; }
    const s0 = st.start.get(node.id);
    const dx = s0 ? node.position.x - s0.x : 0, dy = s0 ? node.position.y - s0.y : 0;
    const cmds: CommandInput[] = [];
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
      const moves = [...st.start.entries()].map(([id, p]) => ({ id, x: Math.round(p.x + dx), y: Math.round(p.y + dy) }));
      cmds.push({ type: 'move_nodes', moves });
      const frames = d.nodes.filter((f) => f.kind === 'frame' && !st.start.has(f.id));
      const updates = [];
      for (const rn of nodes) {
        const n = d.nodes.find((x) => x.id === rn.id);
        if (!n || n.kind === 'frame') continue;
        const c = { x: n.x + dx + n.width / 2, y: n.y + dy + n.height / 2 };
        const host = frames.filter((f) => containsPoint(f, c)).sort((a, b) => a.width * a.height - b.width * b.height)[0];
        if ((host?.id ?? null) !== (n.frameId ?? null)) updates.push({ id: n.id, frameId: host?.id ?? null });
      }
      if (updates.length) cmds.push({ type: 'update_nodes', updates });
    }
    if (s.dropTargetId) cmds.push({ type: 'reparent', id: node.id, parentId: s.dropTargetId });
    if (cmds.length) dispatch(cmds.length === 1 ? cmds[0] : { type: 'batch', commands: cmds });
    set({ overlay: {}, dropTargetId: null });
  }, []);

  const onMoveEnd = useCallback((_e: unknown, viewport: Viewport) => {
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    reportSession({ viewport, viewportSize: el ? { width: el.clientWidth, height: el.clientHeight } : undefined } as never);
  }, []);

  const docKey = doc?.id;
  useEffect(() => {
    if (!docKey) return;
    const t = setTimeout(() => { if (get().doc?.nodes.length) flow()?.fitView({ padding: 0.12, maxZoom: 1, duration: 0 }); }, 60);
    return () => clearTimeout(t);
  }, [docKey]);

  const bgVariant = (session.background === 'theme' ? theme.background : session.background) as string;
  const variant = bgVariant === 'lines' ? BackgroundVariant.Lines : bgVariant === 'cross' ? BackgroundVariant.Cross : BackgroundVariant.Dots;

  const viewMode = session.viewMode;
  const placing = useApp((s) => s.placing);
  return (
    <>
    {session.mode === 'draw' && !viewMode ? <PenLayer /> : null}
    {placing && !viewMode ? <PlaceLayer /> : null}
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      connectionLineComponent={theme.neon ? NeonConnectionLine : undefined}
      connectionRadius={theme.neon ? NEON_SNAP_RADIUS : undefined}
      onConnectEnd={(event, state) => {
        if (state.isValid || !state.fromNode) return;
        const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
        const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest('.react-flow__node') as HTMLElement | null;
        const target = el?.dataset.id;
        if (target && target !== state.fromNode.id) actions.connect(state.fromNode.id, target, (state.fromHandle?.id as Side) || undefined);
      }}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeDoubleClick={(_e, n) => { if (viewMode || n.type === 'drawing') return; set({ selection: { nodes: [n.id], edges: [] }, editingId: n.id }); }}
      onEdgeDoubleClick={(_e, edge) => { if (!viewMode && edge.type === 'smart') set({ selection: { nodes: [], edges: [edge.id] }, editingEdgeId: edge.id }); }}
      onPaneClick={() => { set({ selection: { nodes: [], edges: [] }, menu: null, openMenu: null, editingId: null }); }}
      onPaneContextMenu={(e) => { e.preventDefault(); openCtx(e as unknown as MouseEvent); }}
      onNodeContextMenu={(e, n) => { e.preventDefault(); if (!get().selection.nodes.includes(n.id)) set({ selection: { nodes: [n.id], edges: [] } }); openCtx(e as unknown as MouseEvent, n.id); }}
      onEdgeContextMenu={(e, edge) => { e.preventDefault(); if (edge.type !== 'smart') return; set({ selection: { nodes: [], edges: [edge.id] } }); openCtx(e as unknown as MouseEvent, undefined, edge.id); }}
      onMoveEnd={onMoveEnd}
      onInit={(inst) => { setFlow(inst as never); if (get().doc?.nodes.length) inst.fitView({ padding: 0.12, maxZoom: 1 }); }}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement;
        if (!t.classList.contains('react-flow__pane') || viewMode) return;
        if (taps.lastTouch && !taps.prevOnPane) return;
        actions.addNode('topic', flowPoint(e.clientX, e.clientY));
      }}
      nodesDraggable={!viewMode && session.mode !== 'pan'}
      nodesConnectable={!viewMode}
      connectionMode={ConnectionMode.Loose}
      selectionOnDrag={session.mode === 'select'}
      selectionMode={SelectionMode.Partial}
      panOnDrag={session.mode === 'pan' ? true : areaSelect ? false : [1, 2]}
      onSelectionEnd={() => { if (get().areaSelect) set({ areaSelect: false }); }}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      zoomActivationKeyCode={['Meta', 'Control']}
      multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
      deleteKeyCode={null}
      disableKeyboardA11y
      elevateNodesOnSelect={false}
      snapToGrid={session.snapToGrid}
      snapGrid={[theme.gap, theme.gap]}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      nodeDragThreshold={coarse ? TOUCH_SLOP_PX : undefined}
      autoPanOnSelection={!coarse}
      attributionPosition="bottom-right"
      className={(session.mode === 'pan' ? 'mode-pan' : 'mode-select') + (selection.nodes.length > 1 ? ' multi-select' : '')}
    >
      <MarkerDefs />
      {bgVariant !== 'none' ? <Background variant={variant} gap={theme.gap} size={variant === BackgroundVariant.Dots ? 1.3 : 1} color="var(--grid)" /> : null}
      {session.panels.minimap && !session.zenMode ? <MiniMap pannable zoomable position="bottom-right" style={{ width: 180, height: 120, marginBottom: 'var(--minimap-lift, 28px)' }} nodeStrokeWidth={0} nodeColor={(n) => (n.type === 'frame' ? 'var(--frame-border)' : 'var(--text-3)')} nodeBorderRadius={3} /> : null}
    </ReactFlow>
    </>
  );
}

/** The last two pointer presses: a touch double-tap only adds a topic when both taps landed on empty canvas. */
const taps = { prevOnPane: false, lastTouch: false };

/** Android's default long-press timeout and touch slop (ViewConfiguration); iOS Safari never fires contextmenu for touch. */
const LONG_PRESS_MS = 500;
const TOUCH_SLOP_PX = 8;

/** A touch long-press on a node, connector or empty canvas opens the same context menu as a right-click. */
function useLongPressMenu() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number; id: number; pane: boolean } | null = null;
    let fired = false;
    const cancel = () => { clearTimeout(timer); start = null; };
    let lastOnPane = false;
    const down = (e: PointerEvent) => {
      fired = false;
      const onPane = !!(e.target as HTMLElement | null)?.classList?.contains('react-flow__pane');
      taps.prevOnPane = lastOnPane;
      taps.lastTouch = e.pointerType !== 'mouse';
      lastOnPane = onPane;
      if (e.pointerType === 'mouse') return;
      if (start) { cancel(); return; }
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.react-flow') || t.closest('.react-flow__panel, .react-flow__resize-control, textarea, input')) return;
      const s = get();
      if (s.session.mode !== 'select' || s.placing || s.areaSelect || s.editingId || s.editingEdgeId) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, pane: t.classList.contains('react-flow__pane') };
      timer = setTimeout(() => {
        if (!start) return;
        const { x, y } = start;
        start = null;
        fired = true;
        // A press on a connection dot means its node: the dots sit on the node's edge.
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        const nodeId = (el?.closest('.react-flow__node') as HTMLElement | null)?.dataset.id;
        const edgeEl = nodeId ? null : (el?.closest('.react-flow__edge') as HTMLElement | null);
        const edgeId = edgeEl?.dataset.id && get().doc?.edges.some((d) => d.id === edgeEl.dataset.id) ? edgeEl.dataset.id : undefined;
        if (nodeId && !get().selection.nodes.includes(nodeId)) set({ selection: { nodes: [nodeId], edges: [] } });
        if (edgeId) set({ selection: { nodes: [], edges: [edgeId] } });
        openCtx({ clientX: x, clientY: y } as MouseEvent, nodeId, edgeId);
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => { if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TOUCH_SLOP_PX) cancel(); };
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      // React Flow drops pane clicks from touch while drag-to-select is on, so a tap on empty canvas clears the selection here.
      if (e.type === 'pointerup' && start.pane) set({ selection: { nodes: [], edges: [] }, menu: null, openMenu: null, editingId: null });
      cancel();
    };
    const click = (e: MouseEvent) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } };
    const nativeMenu = (e: MouseEvent) => { if (fired || start) e.preventDefault(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('click', click, true);
    window.addEventListener('contextmenu', nativeMenu, true);
    return () => {
      cancel();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('contextmenu', nativeMenu, true);
    };
  }, []);
}

/**
 * Two-finger pinch/pan that starts on a node or connector. React Flow only zooms when the gesture starts on empty
 * canvas (draggable nodes are "nopan"), which makes zooming a dense diagram on a phone hit-or-miss.
 */
function useTouchPinch() {
  useEffect(() => {
    type Pt = { x: number; y: number };
    let g: { ids: [number, number]; d0: number; m0: Pt; v0: Viewport; rect: DOMRect } | null = null;
    const at = (t: Touch, r: DOMRect): Pt => ({ x: t.clientX - r.left, y: t.clientY - r.top });
    const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const byId = (list: TouchList, id: number) => [...list].find((t) => t.identifier === id);
    const start = (e: TouchEvent) => {
      if (g || e.touches.length !== 2) return;
      const rf = (e.target as HTMLElement | null)?.closest?.('.react-flow') as HTMLElement | null;
      const f = flow();
      if (!rf || !f) return;
      const onElement = [...e.touches].some((t) => (t.target as HTMLElement | null)?.closest?.('.react-flow__node, .react-flow__edge'));
      if (!onElement) return;
      const rect = rf.getBoundingClientRect();
      const [a, b] = [at(e.touches[0], rect), at(e.touches[1], rect)];
      g = { ids: [e.touches[0].identifier, e.touches[1].identifier], d0: dist(a, b), m0: mid(a, b), v0: f.getViewport(), rect };
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      e.preventDefault();
      e.stopPropagation();
      const ta = byId(e.touches, g.ids[0]), tb = byId(e.touches, g.ids[1]);
      const f = flow();
      if (!ta || !tb || !f) return;
      const a = at(ta, g.rect), b = at(tb, g.rect), m = mid(a, b);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.v0.zoom * dist(a, b) / g.d0));
      const fx = (g.m0.x - g.v0.x) / g.v0.zoom, fy = (g.m0.y - g.v0.y) / g.v0.zoom;
      f.setViewport({ x: m.x - fx * zoom, y: m.y - fy * zoom, zoom });
    };
    const end = (e: TouchEvent) => { if (g && (!byId(e.touches, g.ids[0]) || !byId(e.touches, g.ids[1]))) g = null; };
    const opts = { capture: true, passive: false } as const;
    window.addEventListener('touchstart', start, opts);
    window.addEventListener('touchmove', move, opts);
    window.addEventListener('touchend', end, true);
    window.addEventListener('touchcancel', end, true);
    return () => {
      window.removeEventListener('touchstart', start, opts);
      window.removeEventListener('touchmove', move, opts);
      window.removeEventListener('touchend', end, true);
      window.removeEventListener('touchcancel', end, true);
    };
  }, []);
}

/** Freehand pen (Excalidraw-style "draw" tool): drag to draw, release to commit a 'drawing' node. */
function PenLayer() {
  const ref = useRef<{ pts: [number, number][]; id: number } | null>(null);
  const [, force] = useState(0);
  const local = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };
  return (
    <div
      className="pen-layer"
      data-testid="pen-layer"
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); ref.current = { pts: [local(e)], id: e.pointerId }; force((x) => x + 1); }}
      onPointerMove={(e) => {
        const cur = ref.current; if (!cur || cur.id !== e.pointerId) return;
        const r = e.currentTarget.getBoundingClientRect();
        const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
        let added = false;
        for (const s of samples.length ? samples : [e.nativeEvent]) {
          const p: [number, number] = [s.clientX - r.left, s.clientY - r.top];
          const last = cur.pts[cur.pts.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1) { cur.pts.push(p); added = true; }
        }
        if (added) force((x) => x + 1);
      }}
      onPointerUp={(e) => {
        const cur = ref.current; ref.current = null; force((x) => x + 1);
        if (!cur || cur.pts.length < 2) return;
        const r = e.currentTarget.getBoundingClientRect();
        const f = flow(); if (!f) return;
        const pts = cur.pts.map(([x, y]) => { const q = f.screenToFlowPosition({ x: x + r.left, y: y + r.top }); return [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10] as [number, number]; });
        dispatch({ type: 'add_nodes', nodes: [{ kind: 'drawing', points: pts }] });
      }}
      onWheel={wheelPassThrough}
    >
      <svg>{ref.current ? <path d={strokePath(ref.current.pts)} /> : null}</svg>
    </div>
  );
}

import { flow } from '../flowApi';

/** Overlays (pen, placement) keep wheel zoom and pan working underneath them. */
function wheelPassThrough(e: React.WheelEvent<HTMLElement>) {
  const f = flow(); if (!f) return;
  const v = f.getViewport();
  if (e.ctrlKey || e.metaKey) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const z = Math.min(4, Math.max(0.05, v.zoom * (1 - e.deltaY * 0.002)));
    f.setViewport({ x: px - ((px - v.x) * z) / v.zoom, y: py - ((py - v.y) * z) / v.zoom, zoom: z });
  } else f.setViewport({ x: v.x - e.deltaX, y: v.y - e.deltaY, zoom: v.zoom });
}

/** Placement cursor: a ghost of the armed element follows the pointer; a click drops it there. */
function PlaceLayer() {
  const placing = useApp((s) => s.placing);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!placing) return null;
  const zoom = flow()?.getZoom() ?? 1;
  const size = defaultSize(placing.kind, placing.kind === 'topic' ? (placing.extra.shape ?? 'card') : undefined);
  return (
    <div
      className="place-layer"
      data-testid="place-layer"
      onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
      onPointerLeave={() => setPos(null)}
      onClick={(e) => actions.placeAt(flowPoint(e.clientX, e.clientY))}
      onContextMenu={(e) => { e.preventDefault(); actions.cancelPlacing(); }}
      onWheel={wheelPassThrough}
    >
      {pos ? <div className={'place-ghost kind-' + placing.kind} style={{ left: pos.x - (size.width * zoom) / 2, top: pos.y - (size.height * zoom) / 2, width: size.width * zoom, height: size.height * zoom }} /> : null}
    </div>
  );
}
function flowPoint(x: number, y: number) {
  return flow()?.screenToFlowPosition({ x, y }) ?? { x: 0, y: 0 };
}

function openCtx(e: MouseEvent, nodeId?: string, edgeId?: string) {
  set({ menu: { x: e.clientX, y: e.clientY, flow: flowPoint(e.clientX, e.clientY), nodeId, edgeId } });
}

