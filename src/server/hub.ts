import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { commandSchema } from '../shared/schema';
import type { Command } from '../shared/commands';
import type { SessionState } from '../shared/types';
import type { OpEvent, Store } from './store';
import { isTrustedRequest } from './guard';

interface Client { id: string; ws: WebSocket; docId: string | null; connectedAt: number; lastActive: number }
interface Pending {
  resolve: (v: unknown) => void;
  timer: NodeJS.Timeout;
  /** When set, wait for the first answer this accepts, or for every target, instead of the first answer. */
  prefer?: (result: Record<string, unknown>) => boolean;
  expected?: number;
  results?: Record<string, unknown>[];
}

/** Session fields that are global preferences and therefore mirrored to every open UI. */
const SHARED_FIELDS: (keyof SessionState)[] = ['theme', 'background'];
/** Upper bound on how long an AI tool waits for a browser to acknowledge a view action. */
const VIEW_ACK_TIMEOUT_MS = 4000;
/** Rendering a large canvas to PNG in the browser can take several seconds. */
const CAPTURE_TIMEOUT_MS = 20000;

export class Hub {
  private clients = new Map<string, Client>();
  private pending = new Map<string, Pending>();

  constructor(private store: Store) {
    store.on('op', (ev: OpEvent) => this.broadcastDoc(ev.docId, { type: 'op', ...ev, canUndo: store.canUndo(ev.docId), canRedo: store.canRedo(ev.docId) }));
    store.on('documents', (list) => this.broadcast({ type: 'documents', documents: list }));
    store.on('deleted', (docId) => this.broadcast({ type: 'doc_deleted', docId }));
    store.on('session', (session: SessionState, patch: Partial<SessionState>) => {
      const shared = Object.fromEntries(Object.entries(patch).filter(([k]) => SHARED_FIELDS.includes(k as keyof SessionState)));
      if (Object.keys(shared).length) this.broadcast({ type: 'session', patch: shared });
    });
  }

  attach(server: Server) {
    const wss = new WebSocketServer({ noServer: true });
    const echo = new WebSocketServer({ noServer: true });
    echo.on('connection', (ws) => ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary })));
    server.on('upgrade', (req, socket, head) => {
      const route = (req.url ?? '').split('?')[0];
      if (route !== '/sync' && route !== '/ws') return;
      if (!isTrustedRequest(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
      const target = route === '/sync' ? wss : echo;
      target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
    });
    wss.on('connection', (ws) => {
      const client: Client = { id: nanoid(8), ws, docId: null, connectedAt: Date.now(), lastActive: Date.now() };
      this.clients.set(client.id, client);
      this.send(client, { type: 'hello', clientId: client.id, session: this.store.session, documents: this.store.list() });
      ws.on('message', (raw) => this.onMessage(client, raw.toString()));
      ws.on('close', () => this.clients.delete(client.id));
    });
  }

  get uiCount() { return this.clients.size; }

  clientsFor(docId?: string) {
    const all = [...this.clients.values()];
    return docId ? all.filter((c) => c.docId === docId) : all;
  }

  private send(c: Client, msg: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: unknown) { for (const c of this.clients.values()) this.send(c, msg); }

  private broadcastDoc(docId: string, msg: unknown) { for (const c of this.clients.values()) if (c.docId === docId) this.send(c, msg); }

  private openFor(c: Client, docId: string) {
    const doc = this.store.get(docId);
    if (!doc) return this.send(c, { type: 'error', error: 'Document not found: ' + docId });
    c.docId = docId;
    this.send(c, { type: 'snapshot', docId, doc, version: this.store.version(docId), canUndo: this.store.canUndo(docId), canRedo: this.store.canRedo(docId), selection: this.store.selectionFor(docId) });
  }

  private onMessage(c: Client, raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    c.lastActive = Date.now();
    switch (msg.type) {
      case 'open':
        this.openFor(c, msg.docId);
        if (this.store.has(msg.docId)) this.store.setSession({ activeDocumentId: msg.docId });
        break;
      case 'command': {
        if (!c.docId) return;
        const parsed = commandSchema.safeParse(msg.cmd);
        if (!parsed.success) { this.send(c, { type: 'reject', opId: msg.opId, error: parsed.error.message }); return; }
        try { this.store.apply(c.docId, msg.cmd as Command, { origin: 'user', opId: msg.opId, normalized: true }); }
        catch (err) { this.send(c, { type: 'reject', opId: msg.opId, error: (err as Error).message }); }
        break;
      }
      case 'undo':
      case 'redo':
        if (c.docId) (msg.type === 'undo' ? this.store.undo(c.docId, 'user') : this.store.redo(c.docId, 'user'));
        break;
      case 'session':
        if (msg.patch && typeof msg.patch === 'object') {
          const { selection, ...rest } = msg.patch as Partial<SessionState>;
          if (selection && c.docId) this.store.setSelection(c.docId, selection);
          if (Object.keys(rest).length) this.store.setSession(rest);
        }
        break;
      case 'ack': {
        const p = this.pending.get(msg.requestId);
        if (!p) break;
        const result = (msg.result ?? { ok: true }) as Record<string, unknown>;
        if (p.prefer) {
          p.results!.push(result);
          if (!p.prefer(result) && p.results!.length < p.expected!) break;
          clearTimeout(p.timer); this.pending.delete(msg.requestId);
          p.resolve(p.results!.find(p.prefer) ?? p.results!.find((r) => r.file) ?? p.results![0]);
          break;
        }
        clearTimeout(p.timer); this.pending.delete(msg.requestId); p.resolve(result);
        break;
      }
    }
  }

  private request(targets: Client[], msg: Record<string, unknown>, timeoutMs: number, prefer?: Pending['prefer']): Promise<unknown> {
    if (!targets.length) return Promise.resolve({ delivered: false, note: 'No browser UI is connected. Open the app in a browser to see view changes live.' });
    const requestId = nanoid(8);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(requestId);
        this.pending.delete(requestId);
        const got = p?.results ?? [];
        resolve(got.length ? (got.find((r) => r.file) ?? got[0]) : { delivered: true, acknowledged: false });
      }, timeoutMs);
      this.pending.set(requestId, prefer ? { resolve, timer, prefer, expected: targets.length, results: [] } : { resolve, timer });
      for (const t of targets) this.send(t, { ...msg, requestId });
    });
  }

  /** Ask connected UIs to perform a view action (zoom, select, open, panels...). */
  view(action: string, args: Record<string, unknown>, docId?: string, prefer?: Pending['prefer']) {
    const targets = action === 'open_document' ? [...this.clients.values()] : this.clientsFor(docId).length ? this.clientsFor(docId) : docId ? [] : [...this.clients.values()];
    return this.request(targets, { type: 'view', action, args, docId }, VIEW_ACK_TIMEOUT_MS, prefer);
  }

  /** Render the canvas to an image in a browser that can show the document. */
  async capture(docId: string, format: 'png' | 'svg', fit: boolean): Promise<{ dataUrl?: string; error?: string }> {
    const viewing = this.clientsFor(docId).sort((a, b) => b.lastActive - a.lastActive);
    const any = [...this.clients.values()].sort((a, b) => b.lastActive - a.lastActive);
    const target = viewing[0] ?? any[0];
    if (!target) return { error: 'No browser UI is connected, so there is nothing to render. Open the app (e.g. http://localhost:8790) and retry.' };
    const res = (await this.request([target], { type: 'capture', docId, format, fit }, CAPTURE_TIMEOUT_MS)) as { dataUrl?: string; error?: string; acknowledged?: boolean };
    if (res.acknowledged === false) return { error: 'The browser did not return a capture in time.' };
    return res;
  }
}

