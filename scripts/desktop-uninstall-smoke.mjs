import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec = promisify(execFile);
const exists = file => lstat(file).then(() => true, () => false);
if (!process.env.CI && process.env.WFC_UNINSTALL_TEST !== '1') throw new Error('Run only in a disposable test machine with WFC_UNINSTALL_TEST=1. This test installs and uninstalls the app.');
if (!['darwin', 'win32'].includes(process.platform)) throw new Error('A native Mac or Windows test machine is required.');
if (!process.env.WFC_TEST_INSTALLER) throw new Error('WFC_TEST_INSTALLER must point to the tested DMG or Setup.exe.');
// Stop only the preceding CI smoke-test installation, which used its own test data.
if (process.env.WFC_TEST_EXECUTABLE) {
  if (process.platform === 'darwin') {
    const exactProcess = '^' + process.env.WFC_TEST_EXECUTABLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([[:space:]]|$)';
    await exec('pkill', ['-TERM', '-f', exactProcess]).catch(error => { if (error.code !== 1) throw error; });
  }
  else await exec('powershell.exe', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.Path -eq '" + process.env.WFC_TEST_EXECUTABLE.replace(/'/g, "''") + "' } | Stop-Process -Force"]);
}
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'wfc-uninstall-evidence-'));
const evidence = path.resolve('test-results/desktop'); await mkdir(evidence, { recursive: true });
const extraRoots = process.platform === 'darwin' ? [
  path.join(os.homedir(), 'Library', 'Caches', 'Workflow Canvas'), path.join(os.homedir(), 'Library', 'Caches', 'com.paguilar.workflowcanvas'),
  path.join(os.homedir(), 'Library', 'Logs', 'Workflow Canvas'), path.join(os.homedir(), 'Library', 'Saved Application State', 'com.paguilar.workflowcanvas.savedState'),
  path.join(os.homedir(), 'Library', 'Preferences', 'com.paguilar.workflowcanvas.plist'), path.join(os.homedir(), 'Library', 'HTTPStorages', 'com.paguilar.workflowcanvas'),
] : [];
const helperFolders = async () => (await readdir(os.tmpdir())).filter(name => name.startsWith('workflow-canvas-uninstall-')).sort();
const originalHelpers = await helperFolders();
const summaries = [];
const ps = s => "'" + s.replace(/'/g, "''") + "'";
async function install() {
  if (process.platform === 'darwin') {
    const mount = path.join(testRoot, 'mount-' + Date.now()); await mkdir(mount);
    await exec('hdiutil', ['attach', process.env.WFC_TEST_INSTALLER, '-mountpoint', mount, '-nobrowse']);
    const dest = '/Applications/Workflow Canvas.app';
    assert.equal(await exists(dest), false, 'test must not replace an existing Mac installation');
    try {
      await exec('ditto', [path.join(mount, 'Workflow Canvas.app'), dest]);
      assert.equal((await readlink(path.join(dest, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'))).includes(mount), false, 'installed framework links survive DMG eject');
    }
    finally { await exec('hdiutil', ['detach', mount]); }
    return { executable: path.join(dest, 'Contents', 'MacOS', 'workflow-canvas'), installRoot: dest };
  }
  await exec('powershell.exe', ['-NoProfile', '-Command', "$p = Start-Process -FilePath " + ps(process.env.WFC_TEST_INSTALLER) + " -ArgumentList '--silent' -Wait -PassThru; exit $p.ExitCode"]);
  const installRoot = path.join(process.env.LOCALAPPDATA, 'WorkflowCanvas');
  const version = (await readdir(installRoot)).filter(name => name.startsWith('app-')).sort().at(-1);
  assert.ok(version, 'Squirrel installed version exists');
  return { executable: path.join(installRoot, version, 'workflow-canvas.exe'), installRoot };
}
for (const keep of [true, false]) {
  console.log(JSON.stringify({ phase: 'install', keep }));
  const installed = await install();
  console.log(JSON.stringify({ phase: 'launch', keep, executable: installed.executable }));
  const electron = await _electron.launch({ executablePath: installed.executable, env: { ...process.env, WFC_USER_DATA: path.join(testRoot, keep ? 'keep-data' : 'delete-data'), WFC_PORT: '8796' } });
  electron.process().stderr?.on('data', chunk => { const text = String(chunk); if (text.includes('login item')) process.stderr.write(text); });
  const page = await electron.firstWindow(); page.setDefaultTimeout(15000);
  await page.waitForSelector('[data-testid="doc-title"]');
  const paths = await electron.evaluate(({ app }) => ({ userData: app.getPath('userData'), home: app.getPath('home') }));
  const originalDocId = await page.evaluate(() => window.__wfc.state().docId);
  const external = path.join(testRoot, keep ? 'keep-created.excalidraw' : 'delete-created.excalidraw');
  await electron.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, external);
  await page.evaluate(id => window.workflowDesktop.saveDocument(id), originalDocId);
  const preexisting = path.join(testRoot, keep ? 'keep-existing.excalidraw' : 'delete-existing.excalidraw');
  await cp(external, preexisting);
  await electron.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, preexisting);
  await page.evaluate(id => window.workflowDesktop.saveDocument(id, true), originalDocId);
  const ownedSkill = path.join(paths.home, '.cursor', 'skills', 'workflow-canvas');
  assert.equal(await exists(ownedSkill), false, 'test must not overwrite existing skills');
  await page.evaluate(() => window.workflowDesktop.installSkill('cursor'));
  const exportParent = path.join(testRoot, keep ? 'keep-plugin' : 'delete-plugin'); await mkdir(exportParent);
  await electron.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, exportParent);
  await page.evaluate(() => window.workflowDesktop.exportPlugin());
  const exported = path.join(exportParent, 'workflow-canvas');
  // A pre-existing skill must never become owned, even if it matches the bundle.
  const preexistingSkill = path.join(paths.home, '.claude', 'skills', 'workflow-canvas');
  if (!await exists(preexistingSkill)) { await mkdir(preexistingSkill, { recursive: true }); await writeFile(path.join(preexistingSkill, 'SKILL.md'), 'User-owned skill'); }
  const skillBefore = await readFile(path.join(preexistingSkill, 'SKILL.md'), 'utf8');
  await page.evaluate(() => window.workflowDesktop.installSkill('claude').catch(() => null));
  const loginProof = path.join(testRoot, 'login-' + keep + '.json');
  await electron.evaluate(async ({ app }, proof) => {
    const { writeFileSync } = process.getBuiltinModule('node:fs');
    const original = app.setLoginItemSettings.bind(app);
    app.setLoginItemSettings = value => { original(value); writeFileSync(proof, JSON.stringify(app.getLoginItemSettings({ path: process.execPath }))); };
  }, loginProof);
  await page.evaluate(async () => { const data = await window.workflowDesktop.info(); await window.workflowDesktop.savePreferences({ ...data.preferences, openAtLogin: true }); });
  const loginBefore = JSON.parse(await readFile(loginProof, 'utf8'));
  console.log(JSON.stringify({ phase: 'native login item registered', keep, loginBefore }));
  assert.ok(loginBefore.openAtLogin || loginBefore.status === 'requires-approval', 'native login item registered before uninstall: ' + JSON.stringify(loginBefore));
  for (const root of extraRoots) { if (!await exists(root)) { if (root.endsWith('.plist')) await writeFile(root, 'owned preferences'); else { await mkdir(root, { recursive: true }); await writeFile(path.join(root, 'owned-cache'), 'cache'); } } }
  const unrelated = path.join(paths.home, 'Library', 'Caches', 'unrelated-wfc-test');
  await mkdir(unrelated, { recursive: true }); await writeFile(path.join(unrelated, 'sentinel'), 'preserve');
  console.log(JSON.stringify({ phase: 'cancel and backup recovery', keep }));
  const beforeCancel = await helperFolders();
  await electron.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }); });
  assert.equal((await page.evaluate(() => window.workflowDesktop.uninstall())).canceled, true);
  assert.deepEqual(await helperFolders(), beforeCancel);
  assert.equal(await exists(exported), true);
  // Failed backup must resume the live app without deleting integrations.
  const occupied = path.join(testRoot, 'occupied'); await mkdir(occupied, { recursive: true });
  await electron.evaluate(({ dialog }, target) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, occupied);
  const error = await page.evaluate(() => window.workflowDesktop.uninstall().then(() => '', error => error.message));
  assert.match(error, /already exists/); assert.equal(await exists(exported), true);
  assert.deepEqual(await helperFolders(), beforeCancel);
  const title = 'Latest edit kept before uninstall ' + keep;
  await page.getByTestId('doc-title').fill(title); await page.getByTestId('doc-title').press('Enter');
  await page.waitForFunction(value => window.__wfc.state().doc.title === value, title);
  if (!await page.getByTestId('open-settings').isVisible()) await page.getByTestId('menu-more').click();
  await page.getByTestId('open-settings').click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('button', { name: 'Uninstall Workflow Canvas…' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'uninstall-settings-' + keep + '.png') });
  const backup = path.join(testRoot, 'kept-canvases');
  await electron.evaluate(({ dialog }, { keep, backup }) => {
    let called = 0;
    dialog.showMessageBox = async options => ({ response: called++ === 0 ? (keep ? 0 : 1) : 0, checkboxChecked: false });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
  }, { keep, backup });
  const mcpClient = new Client({ name: 'uninstall-active-mcp', version: '1' });
  const mcpScript = path.resolve(path.dirname(installed.executable), process.platform === 'darwin' ? '../Resources' : 'resources', 'app.asar/dist/desktop/mcp.mjs');
  const mcpTransport = new StdioClientTransport({ command: installed.executable, args: [mcpScript], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WFC_USER_DATA: paths.userData, WFC_PORT: '8796' } });
  await mcpClient.connect(mcpTransport);
  let mcpClosed = false;
  const previousClose = mcpTransport.onclose;
  mcpTransport.onclose = () => { mcpClosed = true; previousClose?.(); };
  console.log(JSON.stringify({ phase: 'uninstall', keep }));
  if (process.platform === 'win32' && !keep) {
    const { stdout } = await exec('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WorkflowCanvas', '/v', 'UninstallString']);
    assert.ok(stdout.includes(installed.executable) && stdout.includes('--uninstall'));
    // Exercise the command registered in Windows Installed apps while the app is running.
    await exec(installed.executable, ['--uninstall'], { env: { ...process.env, WFC_USER_DATA: paths.userData } });
  } else await page.getByRole('button', { name: 'Uninstall Workflow Canvas…' }).click();
  console.log(JSON.stringify({ phase: 'verify no leftovers', keep }));
  // Project E2E timeout is 180 seconds; the OS uninstaller is part of this journey.
  try {
    await expect.poll(async () => await exists(installed.installRoot), { timeout: 180000 }).toBe(false);
  } catch (error) {
    const diagnostics = [];
    for (const folder of await helperFolders()) {
      const base = path.join(os.tmpdir(), folder);
      for (const name of await readdir(base)) {
        const file = path.join(base, name);
        diagnostics.push({ file, content: await readFile(file, 'utf8').catch(() => '') });
      }
    }
    if (!page.isClosed()) {
      diagnostics.push({ uiError: await page.getByRole('alert').allTextContents().catch(() => []) });
      await page.screenshot({ path: path.join(evidence, 'uninstall-failure.png') }).catch(() => {});
    }
    if (process.platform === 'win32') {
      diagnostics.push({ processes: await exec('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'workflow-canvas|powershell|Update' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json"]).then(r => r.stdout, e => e.message) });
    }
    await writeFile(path.join(evidence, 'uninstall-failure.json'), JSON.stringify(diagnostics, null, 2));
    console.error(JSON.stringify(diagnostics));
    throw error;
  }
  await expect.poll(async () => await exists(paths.userData), { timeout: 180000 }).toBe(false);
  for (const root of extraRoots) assert.equal(await exists(root), false, 'no app cache/preferences left: ' + root);
  assert.equal(await exists(ownedSkill), false);
  assert.equal(await exists(exported), false);
  assert.equal(await readFile(path.join(preexistingSkill, 'SKILL.md'), 'utf8'), skillBefore);
  assert.equal(await readFile(path.join(unrelated, 'sentinel'), 'utf8'), 'preserve');
  assert.equal(await exists(preexisting), true, 'existing external canvas stays user-owned');
  assert.equal(await exists(external), keep, 'created external canvas follows keep/delete choice');
  if (keep) {
    assert.equal(JSON.parse(await readFile(path.join(backup, 'documents', originalDocId + '.json'), 'utf8')).title, title);
    const drawing = JSON.parse(await readFile(path.join(backup, 'drawings', originalDocId + '.excalidraw'), 'utf8'));
    assert.equal(drawing.type, 'excalidraw'); assert.equal(drawing.workflowCanvas.title, title);
  }
  else assert.equal(await exists(backup), true, 'the previous explicit keep backup survives later uninstall');
  await expect.poll(() => mcpClosed, { timeout: 180000 }).toBe(true);
  await mcpClient.close();
  await expect.poll(helperFolders, { timeout: 180000 }).toEqual(originalHelpers);
  if (process.platform === 'win32') {
    const result = await exec('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WorkflowCanvas']).then(() => true, () => false);
    assert.equal(result, false, 'Windows uninstall registration removed');
    const run = await exec('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run']).then(r => r.stdout, () => '');
    assert.equal(run.includes(installed.executable), false, 'login entry removed');
    const desktop = path.join(paths.home, 'Desktop', 'Workflow Canvas.lnk');
    assert.equal(await exists(desktop), false, 'desktop shortcut removed');
  }
  const loginAfter = JSON.parse(await readFile(loginProof, 'utf8'));
  assert.equal(loginAfter.openAtLogin, false, 'native login item disabled by uninstall');
  assert.notEqual(loginAfter.status, 'requires-approval', 'pending login registration removed');
  await electron.close().catch(() => {});
  summaries.push({ keep, installRoot: installed.installRoot, userData: paths.userData, backup: keep ? backup : null, appRemoved: true, noOwnedLeftovers: true });
}
await writeFile(path.join(evidence, 'uninstall-results.json'), JSON.stringify({ platform: process.platform, ok: true, summaries, evidenceRoot: testRoot }, null, 2));
console.log(JSON.stringify({ ok: true, platform: process.platform, checks: ['cancel', 'failed backup recovery', 'keep latest canvases', 'delete app-created canvases', 'pre-existing canvases and skills preserved', 'remove app/caches/integrations/login/shortcuts/registration/helper'], summaries }));
