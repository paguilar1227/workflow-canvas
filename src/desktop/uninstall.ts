import { execFile, spawn } from 'node:child_process';
import { cp, rm, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { exportExcalidraw } from '../shared/excalidraw';
import type { CanvasDocument } from '../shared/types';
import { assertNoLinks, hashFile, snapshotTree } from './ownership';
const exec = promisify(execFile);
const appId = 'com.paguilar.workflowcanvas';
const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WorkflowCanvas';
const sh = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const ps = (value: string) => "'" + value.replace(/'/g, "''") + "'";
export async function registerWindowsUninstall(executable: string) {
  if (process.platform !== 'win32') return;
  try {
    await exec('reg.exe', ['query', uninstallKey]);
    for (const value of ['UninstallString', 'QuietUninstallString']) await exec('reg.exe', ['add', uninstallKey, '/v', value, '/t', 'REG_SZ', '/d', '"' + executable + '" --uninstall', '/f'], { windowsHide: true });
  } catch (error) { throw new Error('Could not register the clean uninstaller in Windows Installed apps.', { cause: error }); }
}
export async function backupCanvases(dataDir: string, target: string, forbidden: string[]) {
  for (const root of forbidden) if (path.resolve(target) === path.resolve(root) || path.resolve(target).startsWith(path.resolve(root) + path.sep)) throw new Error('Choose a backup folder outside the application and its data folders.');
  await assertNoLinks(dataDir); await assertNoLinks(target);
  try { await lstat(target); throw new Error('The backup folder already exists. Choose a new name to preserve its files.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const original = await snapshotTree(dataDir);
  await cp(dataDir, target, { recursive: true, errorOnExist: true, force: false });
  for (const file of original.files) if (await hashFile(path.join(target, file.relative)) !== file.hash) throw new Error('Canvas backup verification failed. The app has not been removed.');
  // Keep the original store and provide drawings that Open can import directly.
  const docs = await readdir(path.join(dataDir, 'documents')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (docs.length) await mkdir(path.join(target, 'drawings'));
  for (const file of docs.filter(name => name.endsWith('.json'))) {
    const doc = JSON.parse(await readFile(path.join(dataDir, 'documents', file), 'utf8')) as CanvasDocument;
    const drawing = JSON.stringify(exportExcalidraw(doc), null, 2);
    const saved = path.join(target, 'drawings', file.slice(0, -5) + '.excalidraw');
    await writeFile(saved, drawing, { flag: 'wx' });
    if (await readFile(saved, 'utf8') !== drawing) throw new Error('Canvas drawing backup verification failed.');
  }
  await writeFile(path.join(target, 'README.txt'), 'Your canvas data is preserved here. Open files from drawings/ in Workflow Canvas or Excalidraw. The original documents/, trash/ and session files are also retained. Files you saved elsewhere remain in their original locations.\n', { flag: 'wx' });
}
export function cleanupRoots(platform: NodeJS.Platform, home: string, userData: string, dataDir: string) {
  const roots = [userData];
  if (!path.resolve(dataDir).startsWith(path.resolve(userData) + path.sep)) roots.push(dataDir);
  if (platform === 'darwin') roots.push(
    path.join(home, 'Library', 'Caches', 'Workflow Canvas'), path.join(home, 'Library', 'Caches', appId),
    path.join(home, 'Library', 'Logs', 'Workflow Canvas'), path.join(home, 'Library', 'Saved Application State', appId + '.savedState'),
    path.join(home, 'Library', 'Preferences', appId + '.plist'), path.join(home, 'Library', 'HTTPStorages', appId),
  );
  return [...new Set(roots)];
}
export async function validateRemoval(roots: string[], appPath: string, home: string) {
  for (const file of [...roots, appPath]) {
    const absolute = path.resolve(file);
    if ([path.parse(absolute).root, path.resolve(home), path.resolve(os.tmpdir())].includes(absolute)) throw new Error('Refusing to remove a shared system or home directory.');
    // Never follow a user-replaced data folder or application symlink.
    await assertNoLinks(file);
  }
}
export async function prepareRemoval(executable: string, appPath: string, roots: string[]) {
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'win32') throw new Error('Self-uninstall is available in the installed Windows and Mac apps.');
  const installRoot = platform === 'darwin' ? path.resolve(appPath, '..', '..', '..') : path.dirname(path.dirname(executable));
  if (platform === 'darwin' && path.basename(installRoot) !== 'Workflow Canvas.app') throw new Error('Run uninstall from the installed Workflow Canvas app.');
  const updater = path.join(installRoot, 'Update.exe');
  if (platform === 'win32') await lstat(updater);
  await validateRemoval(roots, installRoot, os.homedir());
  const helperDir = await mkdtemp(path.join(os.tmpdir(), 'workflow-canvas-uninstall-'));
  const file = path.join(helperDir, platform === 'darwin' ? 'remove.sh' : 'remove.ps1');
  const allRoots = [...new Set([installRoot, ...roots])];
  const script = platform === 'darwin'
    ? `#!/bin/sh\nset -eu\ntrap 'printf \"Cleanup failed; diagnostic folder: %s\\n\" \"$0\" > \"$0.failure\"' EXIT\nwhile kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done\n` + allRoots.map(root => `rm -rf -- ${sh(root)}\n[ ! -e ${sh(root)} ] || exit 1\n`).join('') + `trap - EXIT\nrm -rf -- ${sh(helperDir)}\n`
    : `$ErrorActionPreference = 'Stop'\nWait-Process -Id ${process.pid} -ErrorAction SilentlyContinue\ntry {\n  $p = Start-Process -FilePath ${ps(updater)} -ArgumentList '--uninstall','--silent' -Wait -PassThru\n  if ($p.ExitCode -ne 0) { throw 'Windows uninstaller failed' }\n` + allRoots.map(root => `  if (Test-Path -LiteralPath ${ps(root)}) { Remove-Item -LiteralPath ${ps(root)} -Recurse -Force }\n  if (Test-Path -LiteralPath ${ps(root)}) { throw 'A Workflow Canvas folder could not be removed' }\n`).join('') + `  Remove-Item -LiteralPath ${ps(helperDir)} -Recurse -Force\n} catch {\n  $_ | Out-File -LiteralPath ${ps(path.join(helperDir, 'failure.txt'))}\n  Add-Type -AssemblyName System.Windows.Forms\n  [System.Windows.Forms.MessageBox]::Show('Cleanup could not finish. Details: ' + ${ps(helperDir)}, 'Workflow Canvas uninstall')\n  exit 1\n}\n`;
  await writeFile(file, script, { mode: 0o700 });
  return { helperDir, installRoot, discard: () => rm(helperDir, { recursive: true, force: true }), launch: async () => {
    const child = platform === 'darwin' ? spawn('/bin/sh', [file], { detached: true, stdio: 'ignore' })
      : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  }};
}
