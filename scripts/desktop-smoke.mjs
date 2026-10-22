import { _electron, chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
const root = process.cwd();
const userData = await mkdtemp(path.join(os.tmpdir(), 'wfc-electron-'));
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const evidence = path.join(root, 'test-results', 'desktop');
await mkdir(evidence, { recursive: true });
const electron = await _electron.launch({ executablePath: process.env.WFC_TEST_EXECUTABLE || undefined, args: [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), ...(process.env.WFC_TEST_EXECUTABLE ? [] : [root])], env: { ...process.env, WFC_USER_DATA: userData, WFC_PORT: String(port) } });
let browser;
try {
  const page = await electron.firstWindow();
  page.setDefaultTimeout(15000); // Match the project's Playwright actionTimeout.
  page.on('pageerror', e => console.error('renderer:', e));
  await page.waitForSelector('[data-testid="doc-title"]');
  await page.waitForFunction(() => window.__wfc.state().connected);
  if (!await page.getByTestId('open-settings').isVisible()) await page.getByTestId('menu-more').click();
  await page.getByTestId('open-settings').click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.getByLabel('Keep running when the window closes').uncheck();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.getByRole('status').filter({ hasText: 'Desktop preferences saved' }).waitFor();
  const preferences = JSON.parse(await readFile(path.join(userData, 'desktop-settings.json'), 'utf8'));
  assert.equal(preferences.closeToTray, false);
  await page.getByLabel('Keep running when the window closes').check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.getByRole('button', { name: 'AI connections', exact: true }).click();
  await page.getByText('http://127.0.0.1:' + port + '/mcp', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Skills & plugin' }).click();
  const exportFolder = path.join(userData, 'plugins');
  await mkdir(exportFolder);
  await electron.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, exportFolder);
  await page.getByRole('button', { name: 'Export desktop plugin…' }).click();
  await page.getByRole('status').filter({ hasText: 'Plugin exported' }).waitFor();
  for (const manifest of ['mcp.json', '.mcp.json']) {
    const config = JSON.parse(await readFile(path.join(exportFolder, 'workflow-canvas', manifest), 'utf8')).mcpServers['workflow-canvas'];
    assert.deepEqual(config.args, ['--mcp-stdio']);
    assert.notEqual(config.command, 'bash');
  }
  await page.getByText('Read the bundled skill', { exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'desktop-skills.png') });
  await page.getByRole('button', { name: 'Close settings' }).click();
  const savePath = path.join(userData, 'native-save.excalidraw');
  await electron.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, savePath);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.waitForFunction(() => window.__wfc.state().file.state === 'saved');
  assert.equal(JSON.parse(await readFile(savePath, 'utf8')).type, 'excalidraw');
  await electron.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, savePath);
  const beforeOpenId = await page.evaluate(() => window.__wfc.state().docId);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+o' : 'Control+o');
  await page.waitForFunction(id => window.__wfc.state().docId !== id, beforeOpenId);
  await page.waitForFunction(() => window.__wfc.state().file.state === 'saved' && !window.__wfc.state().pending.length);
  assert.equal(await page.evaluate(() => window.__wfc.state().file.name), 'native-save.excalidraw');
  const title = 'Shared desktop phone ' + Date.now();
  await page.getByTestId('doc-title').fill(title);
  await page.getByTestId('doc-title').press('Enter');
  await page.waitForFunction(t => window.__wfc.state().doc.title === t, title);
  const docId = await page.evaluate(() => window.__wfc.state().docId);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto('http://127.0.0.1:' + port + '/?doc=' + docId);
  await phone.waitForFunction(t => window.__wfc.state().doc?.title === t, title);
  await phone.getByTestId('menu-more').click();
  await phone.getByTestId('open-settings').click();
  await phone.getByRole('button', { name: 'Phone access', exact: true }).click();
  await phone.screenshot({ path: path.join(evidence, 'phone-settings.png') });
  await phone.getByRole('button', { name: 'Close settings' }).click();
  await phone.getByTestId('doc-title').fill(title + ' edited on phone');
  await phone.getByTestId('doc-title').press('Enter');
  await page.waitForFunction(t => window.__wfc.state().doc.title === t, title + ' edited on phone');
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  const health = await fetch('http://127.0.0.1:' + port + '/health').then(r => r.json());
  assert.equal(health.name, 'workflow-canvas');
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  const finalTitle = title + ' final before quit';

  await rename(savePath, savePath + '.backup');
  await mkdir(savePath);
  await fetch('http://127.0.0.1:' + port + '/api/tools/update_document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: docId, title: finalTitle }) });
  const saveError = await page.evaluate(async (id) => {
    try { await window.workflowDesktop.saveDocument(id); return ''; }
    catch (error) { return error.message; }
  }, docId);
  assert.match(saveError, /EISDIR|EEXIST|EPERM|EACCES/);
  await page.evaluate(async () => {
    const info = await window.workflowDesktop.info();
    await window.workflowDesktop.savePreferences({ ...info.preferences, closeToTray: false });
  });
  const failure = electron.evaluate(({ dialog }) => new Promise(resolve => { dialog.showErrorBox = () => resolve(true); }));
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await failure;
  assert.equal(page.isClosed(), false);
  assert.equal((await fetch('http://127.0.0.1:' + port + '/health')).status, 200);
  await rename(savePath, savePath + '.blocked');
  await rename(savePath + '.backup', savePath);
  await electron.close();
  const file = JSON.parse(await readFile(path.join(userData, 'canvas', 'documents', docId + '.json'), 'utf8'));
  assert.equal(file.title, finalTitle);
  assert.match(await readFile(savePath, 'utf8'), new RegExp(finalTitle));
  console.log(JSON.stringify({ ok: true, platform: process.platform, checks: ['native file save', 'both desktop plugin manifests', 'settings persistence', 'skills UI', 'phone responsive UI', 'desktop/phone live sync', 'close-to-tray keeps server alive', 'immediate quit flush', 'failed-save window-close recovery'], evidence, userData }));
} finally {
  await browser?.close();
  await electron.close().catch(() => {});
}

const recovery = await _electron.launch({ executablePath: process.env.WFC_TEST_EXECUTABLE || undefined, args: [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), ...(process.env.WFC_TEST_EXECUTABLE ? [] : [root])], env: { ...process.env, WFC_USER_DATA: userData, WFC_PORT: String(port) } });
try {
  const recoveryPage = await recovery.firstWindow();
  recoveryPage.setDefaultTimeout(15000);
  await recoveryPage.waitForSelector('[data-testid="doc-title"]');
  await recovery.evaluate(({ app, dialog }) => new Promise((resolve, reject) => {
    dialog.showErrorBox = () => resolve(true);
    const worker = app.getAppMetrics().find(metric => metric.name === 'Workflow Canvas server');
    if (!worker) { reject(new Error('Could not find the canvas worker')); return; }
    process.kill(worker.pid);
  }));
  await recovery.close();
  console.log(JSON.stringify({ ok: true, check: 'Quit remains available after a server crash' }));
} finally { await recovery.close().catch(() => {}); }
