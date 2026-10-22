import { createHash } from 'node:crypto';
import { realpath, lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { exportExcalidraw } from '../shared/excalidraw';

const fileSchema = z.object({ relative: z.string(), hash: z.string(), dev: z.number(), ino: z.number() });
const treeSchema = z.object({ root: z.string(), kind: z.enum(['skill', 'plugin']), files: z.array(fileSchema), directories: z.array(z.string()) });
const schema = z.object({ version: z.literal(1), directories: z.array(z.string()).default([]), trees: z.array(treeSchema), canvases: z.array(z.object({ path: z.string(), hash: z.string(), docId: z.string() })), routes: z.array(z.object({ url: z.string(), target: z.string() })) });
export type Ownership = z.infer<typeof schema>;
export const emptyOwnership = (): Ownership => ({ version: 1, directories: [], trees: [], canvases: [], routes: [] });
export async function readOwnership(userData: string): Promise<Ownership> {
  try { return schema.parse(JSON.parse(await readFile(path.join(userData, 'ownership.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyOwnership(); throw new Error('The app ownership record could not be read. Repair it before uninstalling; no files were removed.', { cause: error }); }
}
export async function writeOwnership(userData: string, value: Ownership) {
  await mkdir(userData, { recursive: true });
  const file = path.join(userData, 'ownership.json');
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2));
  await rename(file + '.tmp', file);
}
export const hashFile = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
export async function assertNoLinks(file: string) {
  let current = path.resolve(file);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink() && !(process.platform === 'darwin' && ['/var', '/tmp', '/etc'].includes(current) && await realpath(current) === '/private' + current)) throw new Error('Refusing to remove or copy a symbolic link: ' + current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}
export async function snapshotTree(root: string) {
  await assertNoLinks(root);
  const files: z.infer<typeof fileSchema>[] = [], directories: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name); const st = await lstat(file);
      if (st.isSymbolicLink()) throw new Error('Refusing to copy a symbolic link: ' + file);
      if (st.isDirectory()) { directories.push(path.relative(root, file)); await visit(file); }
      else if (st.isFile()) files.push({ relative: path.relative(root, file), hash: await hashFile(file), dev: st.dev, ino: st.ino });
      else throw new Error('Unsupported file in ' + file);
    }
  }
  await visit(root); return { files, directories };
}
export async function recordTree(userData: string, root: string, kind: 'skill' | 'plugin') {
  const record = await readOwnership(userData);
  if (record.trees.some(tree => tree.root === root)) return;
  record.trees.push({ root, kind, ...await snapshotTree(root) });
  await writeOwnership(userData, record);
}
export async function recordCanvas(userData: string, file: string, docId: string, created = true) {
  const record = await readOwnership(userData);
  const previous = record.canvases.find(item => item.path === file);
  if (!previous && !created) return;
  await assertNoLinks(file);
  const value = { path: file, hash: await hashFile(file), docId };
  if (previous) Object.assign(previous, value); else record.canvases.push(value);
  await writeOwnership(userData, record);
}
export function ownedPath(root: string, relative: string) {
  const file = path.resolve(root, relative);
  if (!relative || path.isAbsolute(relative) || !file.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid path in ownership record.');
  return file;
}
export async function cleanupIntegrations(record: Ownership, keepCanvases: boolean, dataDir: string) {
  const preserved: string[] = [];
  // Validate every removal target before changing any external file.
  for (const tree of record.trees) {
    if (path.basename(tree.root) !== 'workflow-canvas') throw new Error('Invalid integration folder in ownership record.');
    await assertNoLinks(tree.root);
    for (const file of tree.files) await assertNoLinks(ownedPath(tree.root, file.relative));
    for (const dir of tree.directories) await assertNoLinks(ownedPath(tree.root, dir));
  }
  for (const dir of record.directories) {
    if (!['.codex', '.claude', '.cursor', 'skills'].includes(path.basename(dir))) throw new Error('Invalid parent folder in ownership record.');
    await assertNoLinks(dir);
  }
  if (!keepCanvases) for (const file of record.canvases) {
    if (!file.path.endsWith('.excalidraw')) throw new Error('Invalid canvas path in ownership record.');
    await assertNoLinks(file.path);
  }
  for (const tree of record.trees) {
    if (path.basename(tree.root) !== 'workflow-canvas') throw new Error('Invalid integration folder in ownership record.');
    await assertNoLinks(tree.root);
    for (const file of tree.files) {
      const target = ownedPath(tree.root, file.relative);
      try {
        await assertNoLinks(target); const st = await lstat(target);
        if (!st.isFile() || st.dev !== file.dev || st.ino !== file.ino || await hashFile(target) !== file.hash) { preserved.push(target); continue; }
        await unlink(target);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    for (const relative of [...tree.directories].sort((a,b) => b.length - a.length)) {
      try { await rmdir(ownedPath(tree.root, relative)); } catch (error) { if (!['ENOENT','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error; }
    }
    try { await rmdir(tree.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') preserved.push(tree.root); else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!keepCanvases) for (const canvas of record.canvases) {
    if (!canvas.path.endsWith('.excalidraw')) throw new Error('Invalid canvas path in ownership record.');
    try { await assertNoLinks(canvas.path); const st = await lstat(canvas.path);
      let expected = canvas.hash;
      if (!/^[a-zA-Z0-9_-]+$/.test(canvas.docId)) throw new Error('Invalid canvas id.');
      try { const doc = JSON.parse(await readFile(path.join(dataDir, 'documents', canvas.docId + '.json'), 'utf8')); expected = createHash('sha256').update(JSON.stringify(exportExcalidraw(doc), null, 2)).digest('hex'); } catch {}
      const actual = await hashFile(canvas.path);
      if (!st.isFile() || (actual !== expected && actual !== canvas.hash)) { preserved.push(canvas.path); continue; }
      await unlink(canvas.path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const directory of [...record.directories].sort((a,b) => b.length - a.length)) {
    await assertNoLinks(directory);
    try { await rmdir(directory); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error; }
  }
  return [...new Set(preserved)];
}

export async function recordParentDirectories(userData: string, directories: string[]) {
  const record = await readOwnership(userData);
  record.directories = [...new Set([...record.directories, ...directories])];
  await writeOwnership(userData, record);
}
