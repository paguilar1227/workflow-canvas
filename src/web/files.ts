import { get, set, toast, useApp } from './store';
import { callTool, dispatch, openDocument, waitForDoc } from './sync';
import { exportExcalidraw, documentFromExcalidraw, excalidrawFileName } from '../shared/excalidraw';

/** Saving and autosaving to a .excalidraw file on the user's disk (File System Access API; Chromium browsers). */
export type FileState = 'none' | 'saving' | 'saved' | 'paused' | 'error' | 'unsupported';

type FsHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};
const picker = window as unknown as {
  showSaveFilePicker?: (o: unknown) => Promise<FsHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>;
};
export const fileApiSupported = !!window.workflowDesktop || typeof picker.showSaveFilePicker === 'function';

const SAVE_TYPES = [{ description: 'Excalidraw drawing', accept: { 'application/vnd.excalidraw+json': ['.excalidraw'] } }];
const OPEN_TYPES = [{ description: 'Excalidraw drawing', accept: { 'application/vnd.excalidraw+json': ['.excalidraw'], 'application/json': ['.excalidraw', '.json'] } }];

const handles = new Map<string, FsHandle>();

function idb<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('workflow-canvas', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('file-handles');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = op(open.result.transaction('file-handles', mode).objectStore('file-handles'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

function remember(docId: string, h: FsHandle) {
  handles.set(docId, h);
  idb('readwrite', (s) => s.put(h, docId)).catch(() => {});
}

function setFile(patch: Partial<ReturnType<typeof get>['file']>) { set({ file: { ...get().file, ...patch } }); }

async function permitted(h: FsHandle, ask: boolean) {
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return ask && !!h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** One in-flight write per document; callers that arrive mid-write get a promise that settles after a pass that includes their change. */
const inflight = new Map<string, Promise<void>>();
const again = new Set<string>();
async function write(docId: string): Promise<void> {
  if (window.workflowDesktop) {
    try {
      setFile({ state: 'saving' });
      const file = await window.workflowDesktop.saveDocument(docId);
      if (get().docId === docId) setFile(file ? { state: 'saved', name: file.split(/[\\/]/).pop()!, savedAt: Date.now() } : { state: 'none' });
    } catch (e) { setFile({ state: 'error', error: (e as Error).message }); }
    return;
  }
  const h = handles.get(docId);
  if (!h || get().doc?.id !== docId) return Promise.resolve();
  const running = inflight.get(docId);
  if (running) { again.add(docId); return running; }
  setFile({ state: 'saving' });
  const job = (async () => {
    try {
      do {
        again.delete(docId);
        const doc = get().doc;
        if (!doc || doc.id !== docId) break;
        const out = await h.createWritable();
        await out.write(JSON.stringify(exportExcalidraw(doc), null, 2));
        await out.close();
      } while (again.has(docId));
      if (get().file.docId === docId) setFile({ state: 'saved', savedAt: Date.now(), error: undefined });
    } catch (err) {
      if (get().file.docId === docId) setFile({ state: 'error', error: (err as Error).message });
    } finally {
      inflight.delete(docId);
      again.delete(docId);
    }
  })();
  inflight.set(docId, job);
  return job;
}

async function bindDoc(docId: string | null) {
  setFile({ docId, name: null, state: fileApiSupported ? 'none' : 'unsupported', error: undefined, savedAt: undefined });
  if (!docId || !fileApiSupported) return;
  if (window.workflowDesktop) {
    const file = await window.workflowDesktop.documentFile(docId).catch(() => null);
    if (get().docId === docId && file) setFile({ state: 'saved', name: file.split(/[\\/]/).pop()! });
    return;
  }
  const h = handles.get(docId) ?? (await idb<FsHandle | undefined>('readonly', (s) => s.get(docId)).catch(() => undefined));
  if (!h || get().docId !== docId) return;
  handles.set(docId, h);
  if (await permitted(h, false)) {
    setFile({ name: h.name, state: 'saved' });
    await waitForDoc(docId);
    void write(docId);
  } else setFile({ name: h.name, state: 'paused' });
}

useApp.subscribe((s, prev) => {
  if (s.docId !== prev.docId) { void bindDoc(s.docId); return; }
  if (!s.doc || !prev.doc || s.doc === prev.doc || s.doc.id !== s.file.docId) return;
  if ((s.file.state === 'saved' || s.file.state === 'saving') && (window.workflowDesktop || handles.has(s.doc.id))) void write(s.doc.id);
});

function download(name: string, content: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/vnd.excalidraw+json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Save (⌘S): write to the attached file, or ask where to save it first. Save as (⇧⌘S) always asks. */
export async function save(opts: { as?: boolean } = {}) {
  const doc = get().doc;
  if (!doc) return;
  if (window.workflowDesktop) {
    try {
      const file = await window.workflowDesktop.saveDocument(doc.id, opts.as);
      if (file) { setFile({ docId: doc.id, name: file.split(/[\\/]/).pop()!, state: 'saved', savedAt: Date.now() }); toast('Saved · autosave is on'); }
    } catch (error) { setFile({ state: 'error', error: (error as Error).message }); toast('Save failed: ' + (error as Error).message); }
    return;
  }
  if (!fileApiSupported) {
    download(excalidrawFileName(doc.title), JSON.stringify(exportExcalidraw(doc), null, 2));
    toast('Downloaded a copy. This browser cannot autosave to a file; use Chrome or Edge for autosave.');
    return;
  }
  try {
    let h = opts.as ? undefined : handles.get(doc.id);
    if (h && !(await permitted(h, true))) { setFile({ state: 'paused' }); toast('Autosave needs permission to write to ' + h.name); return; }
    if (!h) {
      h = await picker.showSaveFilePicker!({ suggestedName: excalidrawFileName(doc.title), types: SAVE_TYPES });
      remember(doc.id, h);
    }
    setFile({ docId: doc.id, name: h.name, state: 'saved' });
    await write(doc.id);
    if (get().file.state === 'saved') toast('Saved to ' + h.name + ' · autosave is on');
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return;
    setFile({ state: 'error', error: (err as Error).message });
    toast('Save failed: ' + (err as Error).message);
  }
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.excalidraw,.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Open (⌘O): load a .excalidraw file as a new document and keep autosaving to it. */
export async function openFile() {
  let h: FsHandle | undefined;
  let file: File | null;
  let nativeToken: string | undefined;
  try {
    if (window.workflowDesktop) {
      const result = await window.workflowDesktop.openDocumentFile();
      file = result ? new File([result.content], result.name, { type: 'application/json' }) : null;
      nativeToken = result?.token;
    }
    else if (picker.showOpenFilePicker) { [h] = await picker.showOpenFilePicker({ types: OPEN_TYPES, multiple: false }); file = await h.getFile(); }
    else file = await pickWithInput();
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return;
    toast('Could not open the file: ' + (err as Error).message);
    return;
  }
  if (!file) return;
  let opened;
  try { opened = documentFromExcalidraw(await file.text()); } catch (err) { toast('Could not read ' + file.name + ': ' + (err as Error).message); return; }
  const title = opened.title || file.name.replace(/\.(excalidraw|json)$/i, '');
  const created = (await callTool('create_document', { title, open: false })) as { json: { documentId: string } };
  const id = created.json.documentId;
  if (h) {
    remember(id, h);
    try { await h.requestPermission?.({ mode: 'readwrite' }); } catch { /* resumes from the Save button */ }
  }
  openDocument(id);
  await waitForDoc(id);
  dispatch({ type: 'batch', commands: [
    { type: 'replace_content', nodes: opened.nodes, edges: opened.edges },
    { type: 'update_document', ...(opened.description ? { description: opened.description } : {}), ...(opened.settings ? { settings: opened.settings } : {}) },
  ] });
  if (nativeToken && window.workflowDesktop) {
    try {
      if (get().pending.length) await new Promise<void>((resolve, reject) => {
        const stop = useApp.subscribe((state) => {
          if (!state.connected) { stop(); reject(new Error('The canvas disconnected before the file was loaded.')); }
          else if (!state.pending.length) { stop(); resolve(); }
        });
      });
      const attached = await window.workflowDesktop.attachDocumentFile(id, nativeToken);
      if (attached) setFile({ docId: id, name: file.name, state: 'saved', savedAt: Date.now() });
    } catch (error) { toast('Opened a copy, but could not attach autosave: ' + (error as Error).message); return; }
  }
  toast('Opened ' + file.name + (h || nativeToken ? ' · autosave is on' : ' (this browser cannot autosave back to it)'));
}

/** For the AI save_to_file tool: browsers only open file pickers from a person's click. */
export async function saveForAi(): Promise<Record<string, unknown>> {
  const doc = get().doc;
  if (!doc) return { ok: false, reason: 'No document is open in this tab.' };
  if (window.workflowDesktop) {
    const file = await window.workflowDesktop.documentFile(doc.id);
    if (!file) return { ok: false, reason: 'Press Save once to choose a file before AI can save to it.' };
    await write(doc.id);
    return { ok: get().file.state === 'saved', file, autosave: true, error: get().file.error };
  }
  const h = handles.get(doc.id);
  if (!fileApiSupported) return { ok: false, reason: 'This browser cannot write files; the person can use File > Save to download a copy.' };
  if (!h) return { ok: false, reason: 'No file is attached to this document. The person must press Save once to choose where to save it.' };
  if (!(await permitted(h, false))) return { ok: false, file: h.name, reason: 'Autosave to ' + h.name + ' is paused until the person clicks Save to allow writing.' };
  await write(doc.id);
  const { state, error } = get().file;
  if (state === 'saved') return { ok: true, file: h.name, autosave: true };
  return { ok: false, file: h.name, autosave: true, reason: error ? 'Writing ' + h.name + ' failed: ' + error : 'The save did not finish (state: ' + state + ').' };
}
