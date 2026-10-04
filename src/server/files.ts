import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { excalidrawFileName, exportExcalidraw } from '../shared/excalidraw';
import type { Store } from './store';

/**
 * Folders this server can write .excalidraw files into: host folders shared into the container at the same path
 * (docker-compose.yml), listed in WFC_SAVE_ROOTS and separated like PATH. None on hosted previews.
 */
export function saveRoots(value = process.env.WFC_SAVE_ROOTS): string[] {
  return (value ?? '').split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((r) => path.resolve(r));
}

export type Placement =
  | { ok: true; file: string }
  | { ok: false; unreachable: boolean; reason: string };

export interface SaveResult { ok: boolean; file?: string; error?: string }

/**
 * Server-side save and autosave for documents an AI session saved to a path (a person's Save button uses the
 * browser's file access instead). Like the browser: after every change, one write in flight per document, and a
 * change that lands mid-write gets one more pass.
 */
export class FileSaver {
  private files = new Map<string, string>();
  private errors = new Map<string, string>();
  private inflight = new Map<string, Promise<void>>();
  private again = new Set<string>();

  constructor(private store: Store, readonly roots: string[], private indexFile: string) {}

  async init() {
    try {
      const saved = JSON.parse(await readFile(this.indexFile, 'utf8')) as Record<string, unknown>;
      for (const [id, file] of Object.entries(saved)) if (this.store.has(id) && typeof file === 'string') this.files.set(id, file);
    } catch { /* nothing saved to a file yet */ }
    this.store.on('op', (ev: { docId: string }) => { if (this.files.has(ev.docId)) void this.write(ev.docId); });
    this.store.on('deleted', (id: string) => { if (this.files.delete(id)) void this.persistIndex(); });
  }

  fileFor(docId: string) { return this.files.get(docId); }

  /** Where a save to the requested path would land: a .excalidraw file, or a folder to put "<title>.excalidraw" in. */
  async place(docId: string, requested: string, overwrite = false): Promise<Placement> {
    if (!path.isAbsolute(requested)) return { ok: false, unreachable: false, reason: 'Give an absolute path to a .excalidraw file or a folder (got "' + requested + '").' };
    let file = path.resolve(requested);
    const isDir = /[\\/]$/.test(requested) || (await stat(file).then((s) => s.isDirectory(), () => false));
    if (isDir) file = path.join(file, excalidrawFileName(this.store.get(docId)?.title ?? ''));
    else if (!/\.excalidraw$/i.test(file)) file += '.excalidraw';
    if (!this.roots.length) return { ok: false, unreachable: true, reason: 'This server has no shared folder, so it cannot write files on your machine (for example, a hosted preview).' };
    if (!this.roots.some((r) => file.startsWith(r + path.sep))) return { ok: false, unreachable: true, reason: 'The server can only write inside ' + this.roots.join(', ') + ', and ' + file + ' is outside it.' };
    if (!overwrite && this.files.get(docId) !== file && existsSync(file)) return { ok: false, unreachable: false, reason: file + ' already exists. Pass overwrite: true to replace it, or choose another name.' };
    return { ok: true, file };
  }

  /** Save to this file now and keep it autosaved after every change. */
  async attach(docId: string, file: string): Promise<SaveResult> {
    const before = this.files.get(docId);
    this.files.set(docId, file);
    const res = await this.save(docId);
    if (!res.ok) { if (before) this.files.set(docId, before); else this.files.delete(docId); }
    await this.persistIndex();
    return res;
  }

  async save(docId: string): Promise<SaveResult> {
    const file = this.files.get(docId);
    if (!file) return { ok: false, error: 'No file is attached.' };
    await this.write(docId);
    const error = this.errors.get(docId);
    return error ? { ok: false, file, error } : { ok: true, file };
  }

  private write(docId: string): Promise<void> {
    const running = this.inflight.get(docId);
    if (running) { this.again.add(docId); return running; }
    const job = (async () => {
      try {
        do {
          this.again.delete(docId);
          const file = this.files.get(docId);
          const doc = this.store.get(docId);
          if (!file || !doc) break;
          await mkdir(path.dirname(file), { recursive: true });
          const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.saving');
          await writeFile(tmp, JSON.stringify(exportExcalidraw(doc), null, 2));
          await rename(tmp, file);
          this.errors.delete(docId);
        } while (this.again.has(docId));
      } catch (err) {
        this.errors.set(docId, (err as Error).message);
        console.error('[files] save failed', docId, (err as Error).message);
      } finally {
        this.inflight.delete(docId);
        this.again.delete(docId);
      }
    })();
    this.inflight.set(docId, job);
    return job;
  }

  private async persistIndex() {
    try { await writeFile(this.indexFile, JSON.stringify(Object.fromEntries(this.files), null, 1)); }
    catch (err) { console.error('[files] could not record attached files', (err as Error).message); }
  }
}
