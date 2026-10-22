import { cp, lstat, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
export async function exportDesktopPlugin(source: string, target: string, executable: string, launcher: string, userData: string) {
  try { await lstat(target); throw new Error('That folder already contains workflow-canvas. Choose a different folder to preserve its files.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  const command = { command: executable, args: [launcher], env: { ELECTRON_RUN_AS_NODE: '1', WFC_USER_DATA: userData } };
  await writeFile(path.join(target, 'mcp.json'), JSON.stringify({ mcpServers: { 'workflow-canvas': { type: 'stdio', ...command } } }, null, 2));
  await writeFile(path.join(target, '.mcp.json'), JSON.stringify({ mcpServers: { 'workflow-canvas': { type: 'local', ...command, tools: ['*'] } } }, null, 2));
  return target;
}

async function treeEqual(source: string, dest: string): Promise<boolean> {
  try {
    if ((await lstat(dest)).isSymbolicLink()) return false;
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const a = path.join(source, entry.name), b = path.join(dest, entry.name);
      if (entry.isDirectory()) { if (!await treeEqual(a, b)) return false; }
      else if (!(await readFile(a)).equals(await readFile(b))) return false;
    }
    return true;
  } catch { return false; }
}
export async function installBundledSkill(source: string, home: string, harness: string) {
  if (!['codex', 'claude', 'cursor'].includes(harness)) throw new Error('Choose a supported agent.');
  const target = path.join(home, '.' + harness, 'skills', 'workflow-canvas');
  try {
    await lstat(target);
    if (await treeEqual(source, target)) return target;
    throw new Error('A different Workflow Canvas skill already exists at ' + target + '. Your files were preserved. Export the plugin to review its skill first.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}
