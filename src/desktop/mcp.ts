import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { watchUninstall } from './uninstall-marker';
import { readSettings } from './settings';

// Run with ELECTRON_RUN_AS_NODE=1 so Windows provides real stdio handles.
const here = path.dirname(fileURLToPath(import.meta.url));
async function startBridge() {
  const configHome = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const userData = process.env.WFC_USER_DATA || path.join(configHome, 'Workflow Canvas');
  const watching = watchUninstall(userData);
  const saved = await readSettings(userData);
  const url = (process.env.WFC_URL || 'http://127.0.0.1:' + (process.env.WFC_PORT || saved.port)).replace(/\/$/, '');
  process.env.WFC_PUBLIC_URL ||= saved.shareUrl;
  const healthy = async () => {
    try { const response = await fetch(url + '/health'); return response.ok && (await response.json() as { name?: string }).name === 'workflow-canvas'; }
    catch { return false; }
  };
  if (!await healthy()) {
    const appDir = path.resolve(here, '..', '..');
    const env: NodeJS.ProcessEnv = { ...process.env, WFC_USER_DATA: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, appDir.endsWith('.asar') ? [] : [appDir], { detached: true, stdio: 'ignore', env });
    child.unref();
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(async () => { if (await healthy()) { clearInterval(check); resolve(); } }, 250);
      child.once('error', error => { clearInterval(check); reject(error); });
      child.once('exit', async () => {
        if (!await healthy()) { clearInterval(check); reject(new Error('Workflow Canvas exited before its server was ready. Open the app to check the error.')); }
      });
    });
  }
  if (!watching) watchUninstall(userData);
  process.env.WFC_URL = url;
  await import(pathToFileURL(path.join(here, 'stdio.mjs')).href);
  process.stdin.once('end', () => process.exit(0));
}
void startBridge().catch(error => { process.stderr.write(String(error) + '\n'); process.exit(1); });
