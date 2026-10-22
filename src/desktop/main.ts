import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
import os from 'node:os';
import { readSettings, writeSettings, defaults, type DesktopSettings } from './settings';
import { exportDesktopPlugin, installBundledSkill } from './plugin';
import * as tailscale from './tailscale';
import { readOwnership, writeOwnership, recordCanvas, cleanupIntegrations } from './ownership';
import { backupCanvases, cleanupRoots, prepareRemoval, registerWindowsUninstall, validateRemoval } from './uninstall';

if (process.env.WFC_USER_DATA) app.setPath('userData', process.env.WFC_USER_DATA);
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let worker: UtilityProcess | null = null;
let preferences: DesktopSettings = { ...defaults };
let quitting = false;
let stopped = false;
let localUrl = '';
let uninstalling = false;
let startupWarning = '';
const appDir = app.getAppPath();
const pluginDir = path.join(appDir, 'plugins', 'workflow-canvas');
let mutation = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = mutation.then(action);
  mutation = result.then(() => {}, () => {});
  return result;
}
function dataDir() { return process.env.WFC_DATA_DIR || path.join(app.getPath('userData'), 'canvas'); }
async function info() {
  return { preferences, dataDir: dataDir(), localUrl, platform: process.platform, version: app.getVersion(), startupWarning, tailscale: await tailscale.status() };
}
function show() { if (win) { win.show(); win.focus(); } }
function settings() { show(); win?.webContents.send('desktop:settings'); }
function safeExternal(url: string) {
  try { const u = new URL(url); if (['https:', 'http:'].includes(u.protocol)) void shell.openExternal(u.href); } catch {}
}
function register(channel: string, handler: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (quitting || !win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || new URL(event.senderFrame.url).origin !== localUrl) throw new Error('Untrusted desktop request.');
    return handler(...args);
  });
}
async function installSkill(harness: string) {
  return installBundledSkill(path.join(pluginDir, 'skills', 'workflow-canvas'), os.homedir(), harness, app.getPath('userData'));
}
async function exportPlugin() {
  const result = await dialog.showOpenDialog(win!, { title: 'Choose a folder for the Workflow Canvas plugin', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return null;
  return exportDesktopPlugin(pluginDir, path.join(result.filePaths[0], 'workflow-canvas'), process.execPath, path.join(here, 'mcp.mjs'), app.getPath('userData'));
}
let openedFile: { token: string; path: string } | null = null;
let requestId = 0;
function requestFile(type: 'file' | 'save' | 'checkpoint' | 'resume', docId: string, file?: string): Promise<string | null> {
  if (!worker || (!docId && !['checkpoint', 'resume'].includes(type))) return Promise.reject(new Error('Canvas is not ready.'));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const child = worker!;
    const exit = () => { cleanup(); reject(new Error('Canvas server stopped.')); };
    const message = (value: any) => { if (value.id === id) { cleanup(); if (value.error) reject(new Error(value.error)); else resolve(value.file); } };
    const cleanup = () => { child.off('message', message); child.off('exit', exit); };
    child.on('message', message); child.once('exit', exit);
    child.postMessage({ type, docId, file, id });
  });
}
async function start() {
  if (process.env.WFC_USER_DATA) app.setPath('userData', process.env.WFC_USER_DATA);
  try { preferences = await readSettings(app.getPath('userData')); }
  catch (error) { startupWarning = (error as Error).message; }
  if (app.isPackaged && process.platform === 'win32') {
    try { await registerWindowsUninstall(process.execPath); } catch (error) { startupWarning = (error as Error).message; }
  }
  const activePort = Number(process.env.WFC_PORT || preferences.port);
  localUrl = 'http://127.0.0.1:' + activePort;
  worker = utilityProcess.fork(path.join(here, 'server.mjs'), [], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(activePort), DATA_DIR: dataDir(), WFC_PUBLIC_URL: preferences.shareUrl, WFC_SKILL_DIR: path.join(pluginDir, 'skills', 'workflow-canvas') },
    stdio: 'pipe', serviceName: 'Workflow Canvas server',
  });
  worker.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  await new Promise<void>((resolve, reject) => {
    worker!.on('message', (message) => {
      if (message.type === 'ready') resolve();
      if (message.type === 'error') reject(new Error(message.error));
    });
    worker!.once('exit', (code) => reject(new Error('Canvas server exited during startup (' + code + ').')));
  });
  worker.on('exit', () => {
    worker = null;
    stopped = true;
    if (uninstalling) return;
    if (!quitting) dialog.showErrorBox('Canvas server stopped', 'Your server stopped unexpectedly. Quit and reopen Workflow Canvas to reconnect.');
    else app.quit();
  });
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 360, minHeight: 500, title: 'Workflow Canvas', backgroundColor: '#131619', show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { safeExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== localUrl) { event.preventDefault(); safeExternal(url); } });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === win?.webContents && permission === 'clipboard-sanitized-write'));
  win.once('ready-to-show', show);
  win.on('close', (event) => {
    if (stopped) return;
    event.preventDefault();
    if (quitting) return;
    if (preferences.closeToTray && tray) win!.hide();
    else app.quit();
  });
  win.on('closed', () => { win = null; if (!quitting) app.quit(); });
  register('desktop:info', info);
  register('desktop:uninstall', () => serialized(uninstall));
  register('desktop:save', (value) => serialized(async () => {
    preferences = await writeSettings(app.getPath('userData'), value);
    if (process.platform === 'darwin' || process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: preferences.openAtLogin, path: process.execPath });
    worker!.postMessage({ type: 'share', url: preferences.shareUrl });
    return info();
  }));
  register('desktop:share', (port) => serialized(async () => {
    const url = await tailscale.enable(activePort, port, async (url, target) => {
      const record = await readOwnership(app.getPath('userData'));
      record.routes.push({ url, target });
      await writeOwnership(app.getPath('userData'), record);
    });
    worker!.postMessage({ type: 'share', url });
    preferences = await writeSettings(app.getPath('userData'), { ...preferences, shareUrl: url });
    const response = await fetch(url + '/health');
    const health = await response.json() as { name?: string };
    if (!response.ok || health.name !== 'workflow-canvas') throw new Error('Tailscale was configured, but the app could not verify its HTTPS endpoint. Check Tailscale access and refresh.');
    return info();
  }));
  register('desktop:unshare', () => serialized(async () => {
    await tailscale.disable(activePort, preferences.shareUrl);
    const record = await readOwnership(app.getPath('userData'));
    record.routes = record.routes.filter(route => route.url !== preferences.shareUrl);
    await writeOwnership(app.getPath('userData'), record);
    preferences = await writeSettings(app.getPath('userData'), { ...preferences, shareUrl: '' });
    worker!.postMessage({ type: 'share', url: '' });
    return info();
  }));
  register('desktop:document-file', (id) => requestFile('file', id));
  register('desktop:save-document', (id, saveAs) => serialized(async () => {
    let file = await requestFile('file', id);
    if (!file || saveAs) {
      const result = await dialog.showSaveDialog(win!, { title: 'Save canvas', defaultPath: file || 'Canvas.excalidraw', filters: [{ name: 'Excalidraw drawing', extensions: ['excalidraw'] }] });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath.endsWith('.excalidraw') ? result.filePath : result.filePath + '.excalidraw';
    }
    const existed = await lstat(file).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; });
    const result = await requestFile('save', id, file);
    if (!existed) await recordCanvas(app.getPath('userData'), file, id);
    return result;
  }));
  register('desktop:attach-document', (id, token) => serialized(async () => {
    if (!openedFile || openedFile.token !== token) throw new Error('Choose the file again to attach it.');
    const file = await requestFile('save', id, openedFile.path);
    openedFile = null;
    return file;
  }));
  register('desktop:open-document', () => serialized(async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Canvas drawing', extensions: ['excalidraw', 'json'] }] });
    if (result.canceled) return null;
    openedFile = { token: randomUUID(), path: result.filePaths[0] };
    return { name: path.basename(openedFile.path), content: await readFile(openedFile.path, 'utf8'), token: openedFile.token };
  }));
  register('desktop:data', async () => { const error = await shell.openPath(dataDir()); if (error) throw new Error(error); });
  register('desktop:skill', (harness) => serialized(() => installSkill(harness)));
  register('desktop:plugin', () => serialized(exportPlugin));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Workflow Canvas', submenu: [{ role: 'about' as const }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: settings }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
    { label: 'File', submenu: [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: settings }, { label: 'Show canvas', click: show }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  // A small, bundled PNG; tray availability varies on Linux desktop environments.
  const icon = nativeImage.createFromPath(path.join(appDir, 'assets', 'tray.png'));
  try {
    tray = new Tray(icon);
    tray.setToolTip('Workflow Canvas');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Workflow Canvas', click: show }, { label: 'Settings…', click: settings }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
    tray.on('click', show);
  } catch { preferences.closeToTray = false; }
  await win.loadURL(localUrl);
}
async function runBridge() {
  if (process.env.WFC_USER_DATA) app.setPath('userData', process.env.WFC_USER_DATA);
  const saved = await readSettings(app.getPath('userData'));
  const url = process.env.WFC_URL || 'http://127.0.0.1:' + (process.env.WFC_PORT || saved.port);
  process.env.WFC_PUBLIC_URL ||= saved.shareUrl;
  const healthy = async () => { try { const r = await fetch(url + '/health'); return r.ok && (await r.json() as any).name === 'workflow-canvas'; } catch { return false; } };
  if (!await healthy()) {
    const child = spawn(process.execPath, [], { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(async () => { if (await healthy()) { clearInterval(check); resolve(); } }, 250);
      child.once('error', (error) => { clearInterval(check); reject(error); });
      child.once('exit', async () => { if (!await healthy()) { clearInterval(check); reject(new Error('Workflow Canvas exited before its server was ready. Open the app to check the error.')); } });
    });
  }
  process.env.WFC_URL = url;
  await import(pathToFileURL(path.join(here, 'stdio.mjs')).href);
  process.stdin.once('end', () => app.exit(0));
}

async function uninstall(): Promise<{ canceled: boolean }> {
  if (!app.isPackaged) throw new Error('Uninstall is available in the installed app.');
  const userData = app.getPath('userData');
  const record = await readOwnership(userData);
  const roots = cleanupRoots(process.platform, os.homedir(), userData, dataDir());
  const message = async (options: Electron.MessageBoxOptions) => win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  const choice = await message({ type: 'warning', title: 'Uninstall Workflow Canvas', message: 'Keep your canvases?', detail: 'The app, settings, caches, login entry and app-created integrations will be removed. Keep saves a verified backup of your canvas data. Delete also removes unchanged .excalidraw files created by the app. Pre-existing and customized files are preserved.', buttons: ['Keep canvases…', 'Delete canvases', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
  if (choice.response === 2) return { canceled: true };
  const keep = choice.response === 0;
  let backup: string | undefined;
  if (keep) {
    const options: Electron.SaveDialogOptions = { title: 'Choose a new folder for your canvas backup', defaultPath: path.join(app.getPath('documents'), 'Workflow Canvas canvases') };
    const selected = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return { canceled: true };
    backup = selected.filePath;
  }
  const confirm = await message({ type: 'warning', title: 'Confirm uninstall', message: 'Permanently remove Workflow Canvas?', detail: (backup ? 'Your canvases will be kept in: ' + backup : 'Your app-stored canvases and unchanged app-created canvas files will be deleted.') + '\n\nThe app will quit and remove its files. Other apps, Tailscale itself, and pre-existing or customized files are preserved.', buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
  if (confirm.response !== 0) return { canceled: true };
  await validateRemoval(roots, appDir, os.homedir());
  const removal = await prepareRemoval(process.execPath, appDir, roots);
  let paused = false;
  let helperStarted = false;
  try {
    if (worker) { await requestFile('checkpoint', ''); paused = true; }
    if (backup) await backupCanvases(dataDir(), backup, [...roots, appDir, removal.installRoot]);
    // Removing a route is allowed only if it still points to this app's recorded server.
    for (const route of record.routes) {
      await tailscale.removeOwnedRoute(route.url, route.target);
    }
    const preserved = await cleanupIntegrations(record, keep, dataDir());
    if (preserved.length) await message({ type: 'info', title: 'Your edited files are preserved', message: 'Some integration files were edited or added after installation.', detail: 'These belong to you and will be kept:\n' + preserved.join('\n'), buttons: ['Continue'], noLink: true });
    if (process.platform === 'darwin' || process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: false, path: process.execPath });
    uninstalling = true;
    if (worker) {
      await new Promise<void>((resolve, reject) => {
        const child = worker!;
        const listener = (value: any) => {
          if (value.type === 'stopped') { child.off('message', listener); resolve(); }
          if (value.type === 'error' && !value.id) { child.off('message', listener); reject(new Error(value.error)); }
        };
        child.on('message', listener); child.postMessage({ type: 'shutdown' });
      });
      worker.kill(); worker = null;
    }
    await removal.launch(); helperStarted = true;
    stopped = true; app.quit();
    return { canceled: false };
  } catch (error) {
    uninstalling = false;
    if (!helperStarted) await removal.discard();
    if (paused && worker) await requestFile('resume', '');
    throw error;
  }
}

const squirrelEvent = process.platform === 'win32' ? process.argv.find((arg) => ['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete'].includes(arg)) : undefined;
if (squirrelEvent) {
  if (squirrelEvent === '--squirrel-obsolete') app.quit();
  else {
    const updater = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    const action = squirrelEvent === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut';
    const child = spawn(updater, [action, path.basename(process.execPath)], { windowsHide: true });
    child.once('exit', () => app.quit()); child.once('error', () => app.quit());
  }
} else if (process.argv.includes('--mcp-stdio')) {
  void app.whenReady().then(runBridge).catch((error) => { process.stderr.write(String(error) + '\n'); app.exit(1); });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { if (argv.includes('--uninstall')) void serialized(uninstall).catch(error => dialog.showErrorBox('Could not uninstall', String(error))); else show(); });
  app.on('activate', show);
  app.on('before-quit', (event) => {
    if (stopped || !worker) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    if (worker) {
      const onShutdown = (message: any) => {
        if (message.type === 'stopped') { worker?.off('message', onShutdown); stopped = true; worker?.kill(); app.quit(); }
        else if (message.type === 'error' && !message.id) { worker?.off('message', onShutdown); quitting = false; dialog.showErrorBox('Could not save before quitting', message.error + '\nYour app remains open.'); show(); }
      };
      worker.on('message', onShutdown);
      worker.postMessage({ type: 'shutdown' });
    }
  });
  void app.whenReady().then(async () => {
    if (process.argv.includes('--uninstall')) { preferences = await readSettings(app.getPath('userData')); await uninstall(); if (!uninstalling) app.quit(); }
    else await start();
  }).catch((error) => { dialog.showErrorBox('Workflow Canvas could not start', String(error) + '\nIf another canvas is using the port, stop it or set WFC_PORT to a free port.'); stopped = true; app.quit(); });
}
