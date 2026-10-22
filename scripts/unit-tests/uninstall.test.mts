import { test } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportDesktopPlugin, installBundledSkill } from '../../src/desktop/plugin';
import { readOwnership, cleanupIntegrations, emptyOwnership, recordCanvas } from '../../src/desktop/ownership';
import { backupCanvases, validateRemoval } from '../../src/desktop/uninstall';
import { exportExcalidraw, documentFromExcalidraw } from '../../src/shared/excalidraw';
import { Store } from '../../src/server/store';
import { ownsServeRoute } from '../../src/desktop/tailscale';
import { uninstallMarker, watchUninstall } from '../../src/desktop/uninstall-marker';
import { createApp } from '../../src/server/app';
const exists = (file: string) => lstat(file).then(() => true, () => false);

test('cleanup removes owned integrations and created parents, preserving pre-existing identical skills', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-uninstall-'));
  const userData = path.join(root, 'data'), home = path.join(root, 'home');
  await mkdir(home); const source = path.resolve('plugins/workflow-canvas/skills/workflow-canvas');
  const existing = await installBundledSkill(source, home, 'claude');
  await installBundledSkill(source, home, 'claude', userData);
  const owned = await installBundledSkill(source, home, 'codex', userData);
  const plugin = await exportDesktopPlugin(path.resolve('plugins/workflow-canvas'), path.join(root, 'workflow-canvas'), 'app', 'mcp', userData);
  const record = await readOwnership(userData);
  assert.equal(record.trees.length, 2);
  assert.deepEqual(await cleanupIntegrations(record, true, userData), []);
  assert.equal(await exists(owned), false); assert.equal(await exists(path.join(home, '.codex')), false);
  assert.equal(await exists(plugin), false); assert.equal(await exists(existing), true);
});

test('cleanup preserves edited and added files but removes unchanged owned files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-preserve-'));
  const userData = path.join(root, 'data');
  const target = await exportDesktopPlugin(path.resolve('plugins/workflow-canvas'), path.join(root, 'workflow-canvas'), 'app', 'mcp', userData);
  const edited = path.join(target, 'mcp.json'), added = path.join(target, 'personal.txt');
  await writeFile(edited, 'my changes'); await writeFile(added, 'my file');
  const preserved = await cleanupIntegrations(await readOwnership(userData), false, userData);
  assert.ok(preserved.includes(edited)); assert.equal(await readFile(added, 'utf8'), 'my file');
  assert.equal(await exists(path.join(target, '.mcp.json')), false);
});

test('backup verifies canvas data and refuses overwrites, unsafe destinations and symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-backup-'));
  const data = path.join(root, 'data'), target = path.join(root, 'backup');
  await mkdir(data); await writeFile(path.join(data, 'canvas.json'), 'keep exactly');
  await backupCanvases(data, target, [data]);
  assert.equal(await readFile(path.join(target, 'canvas.json'), 'utf8'), 'keep exactly');
  await assert.rejects(backupCanvases(data, target, [data]), /already exists/);
  await assert.rejects(backupCanvases(data, path.join(data, 'bad'), [data]), /outside/);
  if (process.platform !== 'win32') {
    await symlink(root, path.join(data, 'escape'));
    await assert.rejects(backupCanvases(data, path.join(root, 'bad-backup'), [data]), /symbolic link/);
  }
  await assert.rejects(validateRemoval([os.homedir()], data, os.homedir()), /shared/);
});

test('delete canvases removes app-created saves after autosave but preserves replaced user content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-canvas-cleanup-'));
  const userData = path.join(root, 'user'), data = path.join(root, 'canvas');
  const store = new Store(data); await store.init();
  const doc = store.create('Before', 'blank'); await store.flush();
  const file = path.join(root, 'created.excalidraw');
  await writeFile(file, JSON.stringify(exportExcalidraw(doc), null, 2));
  await recordCanvas(userData, file, doc.id);
  doc.title = 'After autosave'; await store.flush();
  await writeFile(file, JSON.stringify(exportExcalidraw(doc), null, 2));
  const record = await readOwnership(userData);
  await cleanupIntegrations(record, true, data); assert.equal(await exists(file), true);
  await cleanupIntegrations(record, false, data); assert.equal(await exists(file), false);
  await writeFile(file, 'a new personal file at the same path');
  assert.ok((await cleanupIntegrations(record, false, data)).includes(file));
  assert.equal(await readFile(file, 'utf8'), 'a new personal file at the same path');
});

test('invalid ownership paths fail before any owned files are removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-invalid-owner-'));
  const data = path.join(root, 'data');
  const target = await exportDesktopPlugin(path.resolve('plugins/workflow-canvas'), path.join(root, 'workflow-canvas'), 'app', 'mcp', data);
  const record = await readOwnership(data);
  record.trees[0].files.push({ relative: '../personal', hash: '', dev: 0, ino: 0 });
  await assert.rejects(cleanupIntegrations(record, false, data), /Invalid path/);
  assert.equal(await exists(path.join(target, 'mcp.json')), true);
});

test('uninstall checkpoint blocks edits and resume restores them after a canceled or failed backup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-checkpoint-'));
  const runtime = await createApp({ dataDir: root });
  await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const address = runtime.server.address() as { port: number };
  const call = () => fetch('http://127.0.0.1:' + address.port + '/api/tools/create_document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Allowed after resume' }) });
  await runtime.checkpoint(); assert.equal((await call()).status, 503);
  runtime.resume(); assert.equal((await call()).status, 200);
  await runtime.close();
});

test('kept canvases include directly reopenable drawings with original content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-reopen-'));
  const data = path.join(root, 'data'), backup = path.join(root, 'kept');
  const store = new Store(data); await store.init(); const doc = store.create('Preserved drawing', 'blank'); await store.flush();
  await backupCanvases(data, backup, [data]);
  const reopened = documentFromExcalidraw(await readFile(path.join(backup, 'drawings', doc.id + '.excalidraw'), 'utf8'));
  assert.equal(reopened.title, doc.title); assert.deepEqual(reopened.nodes, doc.nodes);
});

test('uninstall removes only its recorded private Tailscale root route', () => {
  const host = 'canvas.example.ts.net', port = 8791, target = 'http://127.0.0.1:8790';
  const config = { Web: { [host + ':' + port]: { Handlers: { '/': { Proxy: target } } } } };
  assert.equal(ownsServeRoute(config, host, port, target), true);
  assert.equal(ownsServeRoute({}, host, port, target), false);
  assert.equal(ownsServeRoute(config, host, port, 'http://127.0.0.1:8888'), false);
  assert.equal(ownsServeRoute({ ...config, AllowFunnel: { [host + ':' + port]: true } }, host, port, target), false);
  config.Web[host + ':' + port].Handlers['/other'] = { Proxy: 'http://127.0.0.1:8888' };
  assert.equal(ownsServeRoute(config, host, port, target), false);
});

test('active MCP bridge receives the uninstall marker instead of restarting the app', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-marker-'));
  // The real MCP transport keeps Node alive. Model that handle while the
  // deliberately unreferenced watcher waits for macOS filesystem events.
  const { port1, port2 } = new MessageChannel(); port1.on('message', () => {});
  try {
    const stopped = new Promise<void>(resolve => watchUninstall(root, resolve));
    await writeFile(uninstallMarker(root), '{}'); await stopped;
    let alreadyStopped = false; watchUninstall(root, () => { alreadyStopped = true; });
    assert.equal(alreadyStopped, true);
  } finally { port1.close(); port2.close(); }
});
