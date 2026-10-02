import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { CanvasDocument, DocumentSummary, SessionState } from '../shared/types';
import { DEFAULT_SESSION, DEFAULT_SETTINGS } from '../shared/types';
import { applyCommand, diffDocs, normalizeCommand, summarizeCommand, touchedNodeIds, type Command, type CommandInput } from '../shared/commands';
import { createFromTemplate, seedDocuments, type TemplateId } from '../shared/templates';

type Patch = Extract<Command, { type: 'patch' }>;
interface Entry { doc: CanvasDocument; version: number; undo: { undo: Patch; redo: Patch }[]; redo: { undo: Patch; redo: Patch }[] }

export interface OpEvent { docId: string; version: number; cmd: Command; origin: string; opId?: string; summary: string; touched: string[] }

export const genId = () => nanoid(10);

export class Store extends EventEmitter {
  private docs = new Map<string, Entry>();
  session: SessionState = structuredClone(DEFAULT_SESSION);
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private dir: string) { super(); }

  private get docDir() { return path.join(this.dir, 'documents'); }

  async init() {
    await mkdir(this.docDir, { recursive: true });
    await mkdir(path.join(this.dir, 'trash'), { recursive: true });
    for (const f of await readdir(this.docDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const doc = JSON.parse(await readFile(path.join(this.docDir, f), 'utf8')) as CanvasDocument;
        doc.settings = { ...DEFAULT_SETTINGS, ...(doc.settings ?? {}) };
        this.docs.set(doc.id, { doc, version: 1, undo: [], redo: [] });
      } catch (err) { console.error('[store] failed to load', f, err); }
    }
    const sessionFile = path.join(this.dir, 'session.json');
    if (existsSync(sessionFile)) {
      try { this.session = { ...this.session, ...JSON.parse(await readFile(sessionFile, 'utf8')) }; } catch { /* keep defaults */ }
    }
    if (!this.docs.size) {
      for (const d of seedDocuments(genId)) { this.docs.set(d.id, { doc: d, version: 1, undo: [], redo: [] }); this.persist(d.id); }
    }
    if (!this.session.activeDocumentId || !this.docs.has(this.session.activeDocumentId)) this.session.activeDocumentId = this.list()[0]?.id ?? null;
    this.session.selection = { nodes: [], edges: [] };
    this.session = { ...structuredClone(DEFAULT_SESSION), ...this.session };
  }

  list(): DocumentSummary[] {
    return [...this.docs.values()].map(({ doc }) => ({ id: doc.id, title: doc.title, description: doc.description, nodeCount: doc.nodes.length, edgeCount: doc.edges.length, updatedAt: doc.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  has(id: string) { return this.docs.has(id); }
  get(id: string): CanvasDocument | undefined { return this.docs.get(id)?.doc; }
  version(id: string) { return this.docs.get(id)?.version ?? 0; }
  canUndo(id: string) { return !!this.docs.get(id)?.undo.length; }
  canRedo(id: string) { return !!this.docs.get(id)?.redo.length; }

  create(title: string, template: TemplateId = 'blank', description?: string, id = genId()): CanvasDocument {
    if (this.docs.has(id)) throw new Error('Document id "' + id + '" already exists');
    const doc = createFromTemplate(id, title || 'Untitled', template, genId);
    if (description) doc.description = description;
    this.docs.set(doc.id, { doc, version: 1, undo: [], redo: [] });
    this.persist(doc.id);
    this.emit('documents', this.list());
    return doc;
  }

  duplicate(id: string, title?: string): CanvasDocument {
    const src = this.get(id);
    if (!src) throw new Error('Document not found: ' + id);
    const now = new Date().toISOString();
    const doc: CanvasDocument = { ...structuredClone(src), id: genId(), title: title ?? src.title + ' (copy)', createdAt: now, updatedAt: now };
    this.docs.set(doc.id, { doc, version: 1, undo: [], redo: [] });
    this.persist(doc.id);
    this.emit('documents', this.list());
    return doc;
  }

  async remove(id: string) {
    if (!this.docs.has(id)) throw new Error('Document not found: ' + id);
    this.docs.delete(id);
    this.selections.delete(id);
    const file = path.join(this.docDir, id + '.json');
    if (existsSync(file)) await rename(file, path.join(this.dir, 'trash', id + '-' + Date.now() + '.json'));
    if (this.session.activeDocumentId === id) this.setSession({ activeDocumentId: this.list()[0]?.id ?? null });
    this.emit('deleted', id);
    this.emit('documents', this.list());
  }

  /** Apply a command (normalizing it first unless the caller already did). */
  apply(docId: string, input: CommandInput | Command, opts: { origin: string; opId?: string; normalized?: boolean; anchor?: { x: number; y: number } }): OpEvent {
    const entry = this.docs.get(docId);
    if (!entry) throw new Error('Document not found: ' + docId);
    const cmd = opts.normalized ? (input as Command) : normalizeCommand(entry.doc, input as CommandInput, { genId, anchor: opts.anchor });
    const next = applyCommand(entry.doc, cmd);
    const redo = diffDocs(entry.doc, next);
    if (redo) {
      const undo = diffDocs(next, entry.doc)!;
      entry.undo.push({ undo, redo });
      entry.redo = [];
    }
    return this.commit(entry, next, cmd, opts.origin, opts.opId);
  }

  undo(docId: string, origin: string): OpEvent | null {
    const entry = this.docs.get(docId);
    const step = entry?.undo.pop();
    if (!entry || !step) return null;
    entry.redo.push(step);
    return this.commit(entry, applyCommand(entry.doc, step.undo), step.undo, origin);
  }

  redo(docId: string, origin: string): OpEvent | null {
    const entry = this.docs.get(docId);
    const step = entry?.redo.pop();
    if (!entry || !step) return null;
    entry.undo.push(step);
    return this.commit(entry, applyCommand(entry.doc, step.redo), step.redo, origin);
  }

  private commit(entry: Entry, next: CanvasDocument, cmd: Command, origin: string, opId?: string): OpEvent {
    const changed = next !== entry.doc;
    entry.doc = changed ? { ...next, updatedAt: new Date().toISOString() } : next;
    entry.version++;
    const ev: OpEvent = { docId: entry.doc.id, version: entry.version, cmd, origin, opId, summary: summarizeCommand(cmd), touched: touchedNodeIds(cmd) };
    if (changed) this.persist(entry.doc.id);
    this.emit('op', ev);
    if (changed && (cmd.type === 'add_nodes' || cmd.type === 'delete_nodes' || cmd.type === 'update_document' || cmd.type === 'batch' || cmd.type === 'patch' || cmd.type === 'replace_content')) this.emit('documents', this.list());
    return ev;
  }

  /** Each document keeps its own selection; session.selection mirrors the active document's. */
  private selections = new Map<string, SessionState['selection']>();
  selectionFor(docId: string): SessionState['selection'] { return this.selections.get(docId) ?? { nodes: [], edges: [] }; }
  setSelection(docId: string, selection: SessionState['selection']) {
    this.selections.set(docId, { nodes: [...selection.nodes], edges: [...selection.edges] });
    if (docId === this.session.activeDocumentId) this.setSession({ selection: this.selectionFor(docId) });
  }
  selectionsView(): Record<string, SessionState['selection']> {
    return Object.fromEntries([...this.selections].filter(([id, s]) => this.docs.has(id) && (s.nodes.length || s.edges.length)));
  }

  setSession(patch: Partial<SessionState>) {
    if (patch.activeDocumentId !== undefined && patch.activeDocumentId !== this.session.activeDocumentId && !patch.selection) patch = { ...patch, selection: patch.activeDocumentId ? this.selectionFor(patch.activeDocumentId) : { nodes: [], edges: [] } };
    this.session = { ...this.session, ...patch };
    this.emit('session', this.session, patch);
    this.persistSession();
  }

  private persist(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      const doc = this.get(id);
      if (doc) writeFile(path.join(this.docDir, id + '.json'), JSON.stringify(doc, null, 1)).catch((e) => console.error('[store] write failed', e));
    }, 150));
  }

  private persistSession() {
    clearTimeout(this.timers.get('__session'));
    this.timers.set('__session', setTimeout(() => {
      const { activeDocumentId, theme, panels, snapToGrid, background } = this.session;
      writeFile(path.join(this.dir, 'session.json'), JSON.stringify({ activeDocumentId, theme, panels, snapToGrid, background }, null, 1)).catch(() => {});
    }, 150));
  }
}

