import { nanoid } from 'nanoid';
import { toPng, toSvg } from 'html-to-image';
import { get, recompute, set, toast, useApp } from './store';
import { normalizeCommand, CommandError, type Command, type CommandInput } from '../shared/commands';
import type { CanvasDocument, SessionState } from '../shared/types';
import { flow, nextFrame, sleep, viewportCenter } from './flowApi';

let ws: WebSocket | null = null;
let retry = 0;
const params = new URLSearchParams(location.search);
export const pinnedDoc = params.get('pin') === '1' ? params.get('doc') : null;
let snapshotWaiters: ((docId: string) => void)[] = [];
let activitySeq = 0;

function send(msg: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function connect() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(url);
  ws.onopen = () => { retry = 0; set({ connected: true }); };
  ws.onclose = () => {
    set({ connected: false });
    setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
}

const sameIds = (x: string[], y: string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
useApp.subscribe((s, prev) => {
  if (s.docId !== prev.docId || s.selection === prev.selection) return;
  if (sameIds(s.selection.nodes, prev.selection.nodes) && sameIds(s.selection.edges, prev.selection.edges)) return;
  reportSession({ selection: s.selection });
});

export function openDocument(docId: string) {
  if (!docId) return;
  if (get().docId !== docId) set({ docId, doc: null, confirmed: null, pending: [], version: 0, selection: { nodes: [], edges: [] }, editingId: null, overlay: {} });
  const url = new URL(location.href);
  url.searchParams.set('doc', docId);
  history.replaceState(null, '', url);
  send({ type: 'open', docId });
}

/** Normalize locally (so ids/positions are identical everywhere), apply optimistically, send. */
export function dispatch(input: CommandInput): Command | null {
  const s = get();
  if (!s.doc || !s.docId) return null;
  if (s.session.viewMode) { toast('View mode is on — editing is disabled (Alt+R to edit)'); return null; }
  let cmd: Command;
  try {
    cmd = normalizeCommand(s.doc, input, { genId: () => nanoid(10), anchor: viewportCenter() });
  } catch (err) {
    if (err instanceof CommandError) { toast(err.message); return null; }
    throw err;
  }
  const opId = nanoid(8);
  const pending = [...s.pending, { opId, cmd }];
  set({ pending, doc: recompute(s.confirmed, pending) });
  send({ type: 'command', docId: s.docId, opId, cmd });
  return cmd;
}

export const undo = () => send({ type: 'undo' });
export const redo = () => send({ type: 'redo' });

let sessionTimer: ReturnType<typeof setTimeout> | undefined;
let sessionPatch: Partial<SessionState> = {};
export function reportSession(patch: Partial<SessionState>, immediate = false) {
  sessionPatch = { ...sessionPatch, ...patch };
  clearTimeout(sessionTimer);
  const flush = () => { send({ type: 'session', patch: sessionPatch }); sessionPatch = {}; };
  if (immediate) flush(); else sessionTimer = setTimeout(flush, 150);
}

export function updateSession(patch: Partial<SessionState>, share = true) {
  set({ session: { ...get().session, ...patch } });
  if (share) reportSession(patch, true);
}

export async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch('/api/tools/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-origin': 'user' }, body: JSON.stringify(args) });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error);
  return body.result;
}

function originLabel(origin: string) {
  return origin.startsWith('ai:') ? origin.slice(3) : origin;
}

function onMessage(msg: any) {
  const s = get();
  switch (msg.type) {
    case 'hello': {
      set({ clientId: msg.clientId, documents: msg.documents, session: { ...s.session, ...pick(msg.session, ['theme', 'panels', 'snapToGrid', 'background']) } });
      const fromUrl = params.get('doc');
      const target = [fromUrl, s.docId, msg.session.activeDocumentId, msg.documents[0]?.id].find((id) => id && msg.documents.some((d: { id: string }) => d.id === id));
      if (target) openDocument(target);
      break;
    }
    case 'documents':
      set({ documents: msg.documents });
      break;
    case 'doc_deleted':
      if (s.docId === msg.docId) {
        const next = s.documents.find((d) => d.id !== msg.docId);
        set({ docId: null, doc: null, confirmed: null });
        if (next) openDocument(next.id);
      }
      break;
    case 'snapshot': {
      if (msg.docId !== s.docId) return;
      const patch: Partial<typeof s> = { confirmed: msg.doc, doc: msg.doc, version: msg.version, pending: [], canUndo: msg.canUndo, canRedo: msg.canRedo };
      if (!s.doc && msg.selection) {
        const nodeIds = new Set((msg.doc as CanvasDocument).nodes.map((n) => n.id));
        const edgeIds = new Set((msg.doc as CanvasDocument).edges.map((e) => e.id));
        patch.selection = { nodes: (msg.selection.nodes as string[]).filter((id) => nodeIds.has(id)), edges: (msg.selection.edges as string[]).filter((id) => edgeIds.has(id)) };
      }
      set(patch);
      for (const w of snapshotWaiters) w(msg.docId);
      snapshotWaiters = [];
      break;
    }
    case 'op': {
      if (msg.docId !== s.docId || !s.confirmed) return;
      const confirmed = applyRemote(s.confirmed, msg.cmd);
      const pending = s.pending[0]?.opId === msg.opId ? s.pending.slice(1) : s.pending;
      const patch: Partial<typeof s> = { confirmed, pending, doc: recompute(confirmed, pending), version: msg.version, canUndo: msg.canUndo, canRedo: msg.canRedo };
      if (msg.origin !== 'user') {
        const now = Date.now();
        const flashing = { ...s.flashing };
        for (const id of msg.touched as string[]) flashing[id] = now;
        patch.flashing = flashing;
        patch.activity = [...s.activity.slice(-30), { id: ++activitySeq, origin: originLabel(msg.origin), summary: msg.summary, at: now }];
      }
      set(patch);
      break;
    }
    case 'reject': {
      const pending = s.pending.filter((p) => p.opId !== msg.opId);
      set({ pending, doc: recompute(s.confirmed, pending) });
      toast('Change rejected: ' + msg.error);
      break;
    }
    case 'session':
      set({ session: { ...s.session, ...msg.patch } });
      break;
    case 'view':
      handleView(msg).then((result) => send({ type: 'ack', requestId: msg.requestId, result }));
      break;
    case 'capture':
      enqueueCapture(msg).then((result) => send({ type: 'ack', requestId: msg.requestId, result }));
      break;
  }
}

import { applyCommand } from '../shared/commands';
function applyRemote(doc: CanvasDocument, cmd: Command) { return applyCommand(doc, cmd); }

function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const DURATION = 350;

async function handleView(msg: { action: string; args: any; docId?: string }): Promise<unknown> {
  const s = get();
  const f = flow();
  if (msg.action === 'open_document') {
    if (pinnedDoc && msg.args.documentId !== pinnedDoc) return { ignored: true, reason: 'pinned tab' };
    openDocument(msg.args.documentId);
    return { ok: true, opened: msg.args.documentId };
  }
  if (msg.docId && msg.docId !== s.docId) return { ignored: true, reason: 'tab shows another document' };
  if (msg.action === 'select') {
    set({ selection: { nodes: msg.args.nodes ?? [], edges: msg.args.edges ?? [] } });
    return { ok: true, selection: get().selection };
  }
  if (msg.action === 'set_ui') {
    const a = msg.args;
    const sess = get().session;
    const patch: Partial<SessionState> = {};
    if (a.inspector !== undefined || a.outline !== undefined || a.minimap !== undefined) patch.panels = { inspector: a.inspector ?? sess.panels.inspector, outline: a.outline ?? sess.panels.outline, minimap: a.minimap ?? sess.panels.minimap };
    if (a.snapToGrid !== undefined) patch.snapToGrid = a.snapToGrid;
    if (a.zenMode !== undefined) patch.zenMode = a.zenMode;
    if (a.viewMode !== undefined) patch.viewMode = a.viewMode;
    if (a.mode) patch.mode = a.mode;
    if (a.background) patch.background = a.background;
    if (a.search !== undefined) { patch.search = a.search; set({ searchOpen: !!a.search, searchIndex: 0 }); }
    set({ session: { ...sess, ...patch } });
    if (a.editNodeId) {
      set({ selection: { nodes: [a.editNodeId], edges: [] }, editingId: a.editNodeId });
      const n = get().doc?.nodes.find((x) => x.id === a.editNodeId);
      if (n && f) f.setCenter(n.x + n.width / 2, n.y + n.height / 2, { zoom: Math.max(f.getZoom(), 1), duration: DURATION });
    }
    return { ok: true };
  }
  if (msg.action === 'viewport' && f) {
    const a = msg.args;
    const nodes = a.nodeIds?.length ? a.nodeIds.map((id: string) => ({ id })) : undefined;
    switch (a.action) {
      case 'fit': await f.fitView({ nodes, padding: typeof a.padding === 'number' ? ((a.padding + 'px') as never) : 0.15, duration: DURATION, maxZoom: 1.5 }); break;
      case 'focus': await f.fitView({ nodes, padding: typeof a.padding === 'number' ? ((a.padding + 'px') as never) : 0.4, duration: DURATION, maxZoom: a.zoom ?? 1.25, minZoom: a.zoom ?? undefined }); break;
      case 'zoom_in': await f.zoomIn({ duration: DURATION }); break;
      case 'zoom_out': await f.zoomOut({ duration: DURATION }); break;
      case 'set_zoom': await f.zoomTo(a.zoom ?? 1, { duration: DURATION }); break;
      case 'set_viewport': await f.setViewport({ x: a.x ?? 0, y: a.y ?? 0, zoom: a.zoom ?? f.getZoom() }, { duration: DURATION }); break;
      case 'center': await f.setCenter(a.x ?? 0, a.y ?? 0, { zoom: a.zoom ?? f.getZoom(), duration: DURATION }); break;
      case 'pan': { const v = f.getViewport(); await f.setViewport({ x: v.x - (a.dx ?? 0), y: v.y - (a.dy ?? 0), zoom: v.zoom }, { duration: DURATION }); break; }
    }
    await sleep(DURATION + 40);
    const viewport = f.getViewport();
    reportSession({ viewport }, true);
    return { ok: true, viewport };
  }
  return { ok: false, error: 'unknown view action ' + msg.action };
}

let captureChain: Promise<unknown> = Promise.resolve();
function enqueueCapture(msg: { docId: string; format: 'png' | 'svg'; fit: boolean }) {
  const p = captureChain.then(() => capture(msg)).catch((err) => ({ error: String(err?.message ?? err) }));
  captureChain = p;
  return p;
}

export async function renderCanvasImage(format: 'png' | 'svg'): Promise<string> {
  const el = document.querySelector('.react-flow') as HTMLElement;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const opts = {
    backgroundColor: bg,
    pixelRatio: Math.max(1, window.devicePixelRatio || 1),
    filter: (node: HTMLElement) => !(node.classList && (node.classList.contains('react-flow__minimap') || node.classList.contains('react-flow__panel') || node.classList.contains('react-flow__attribution'))),
  };
  // html-to-image does not carry stylesheet rules onto SVG children, so inline the computed paint.
  const props = ['stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity'];
  const touched: [SVGElement, string | null][] = [];
  el.querySelectorAll<SVGElement>('svg *').forEach((node) => {
    const cs = getComputedStyle(node);
    touched.push([node, node.getAttribute('style')]);
    for (const p of props) node.style.setProperty(p, cs.getPropertyValue(p));
  });
  try {
    return await (format === 'svg' ? toSvg(el, opts) : toPng(el, opts));
  } finally {
    for (const [node, style] of touched) { if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style); }
  }
}

async function capture(msg: { docId: string; format: 'png' | 'svg'; fit: boolean }) {
  if (!flow()) return { error: 'canvas not ready' };
  const prevDoc = get().docId;
  const prevViewport = flow()!.getViewport();
  const switching = msg.docId && msg.docId !== prevDoc;
  if (switching) {
    const loaded = new Promise<void>((resolve) => { snapshotWaiters.push(() => resolve()); });
    openDocument(msg.docId);
    await Promise.race([loaded, sleep(4000)]);
    await nextFrame(); await sleep(250);
  }
  const f = flow();
  if (!f) return { error: 'canvas not ready' };
  const prevSel = get().selection;
  set({ selection: { nodes: [], edges: [] } });
  if (msg.fit) { await f.fitView({ padding: 0.08, duration: 0, maxZoom: 1.5 }); }
  await nextFrame(); await sleep(120);
  const dataUrl = await renderCanvasImage(msg.format);
  set({ selection: prevSel });
  if (switching && prevDoc) openDocument(prevDoc);
  else await f.setViewport(prevViewport, { duration: 0 });
  return { dataUrl };
}

