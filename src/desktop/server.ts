import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
import { createApp } from '../server/app';
let shareUrl = process.env.WFC_PUBLIC_URL || '';
const port = Number(process.env.PORT || 8790);
const runtime = await createApp({
  dataDir: process.env.DATA_DIR!,
  webDir: path.join(here, '..', 'web'),
  skillDir: process.env.WFC_SKILL_DIR,
  publicUrl: () => shareUrl,
  allowedHosts: () => shareUrl ? [new URL(shareUrl).hostname] : [],
});
runtime.server.on('error', (error) => { process.parentPort?.postMessage({ type: 'error', error: error.message }); });
runtime.server.listen(port, '127.0.0.1', () => process.parentPort?.postMessage({ type: 'ready', port }));
process.parentPort?.on('message', async ({ data }: { data: { type: string; url?: string; id?: number; docId?: string; file?: string } }) => {
  if (data.type === 'file' || data.type === 'save') {
    try {
      if (!data.docId || !runtime.store.has(data.docId)) throw new Error('Document not found.');
      if (data.type === 'save') {
        const result = data.file ? await runtime.files.attach(data.docId, data.file) : await runtime.files.save(data.docId);
        if (!result.ok) throw new Error(result.error || 'Could not save the file.');
      }
      process.parentPort?.postMessage({ id: data.id, file: runtime.files.fileFor(data.docId) || null });
    } catch (error) { process.parentPort?.postMessage({ id: data.id, error: (error as Error).message }); }
  }
  if (data.type === 'share') shareUrl = data.url || '';
  if (data.type === 'shutdown') {
    try { await runtime.close(); process.parentPort?.postMessage({ type: 'stopped' }); }
    catch (error) { process.parentPort?.postMessage({ type: 'error', error: (error as Error).message }); }
  }
});
