import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server/app';
import { Store } from '../../src/server/store';
import { readSettings, writeSettings, settingsSchema } from '../../src/desktop/settings';
import { exportDesktopPlugin, installBundledSkill } from '../../src/desktop/plugin';
import { checkServeSlot } from '../../src/desktop/tailscale';
import { WebSocket } from 'ws';

test('settings persist and reject invalid or public sharing addresses', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wfc-settings-'));
  const defaults = await readSettings(dir);
  assert.equal(defaults.port, 8790);
  const changed = { ...defaults, closeToTray: false, port: 9000, shareUrl: 'https://my-pc.example.ts.net:8791' };
  await writeSettings(dir, changed);
  assert.deepEqual(await readSettings(dir), changed);
  for (const shareUrl of ['http://my-pc.example.ts.net', 'https://public.example.com', 'https://user:secret@my-pc.example.ts.net', 'https://my-pc.example.ts.net/path']) assert.equal(settingsSchema.safeParse({ ...changed, shareUrl }).success, false);
});
test('immediate shutdown flush preserves the newest document and session', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wfc-flush-'));
  const store = new Store(dir); await store.init();
  const doc = store.create('Before quit');
  store.apply(doc.id, { type: 'update_document', title: 'Last edit before quit' }, { origin: 'test' });
  store.setSession({ activeDocumentId: doc.id, theme: 'paper' });
  await store.flush();
  assert.equal(JSON.parse(await readFile(path.join(dir, 'documents', doc.id + '.json'), 'utf8')).title, 'Last edit before quit');
  const reopened = new Store(dir); await reopened.init();
  assert.equal(reopened.get(doc.id)?.title, 'Last edit before quit');
  assert.equal(reopened.session.activeDocumentId, doc.id);
  await reopened.flush();
});
test('Tailscale setup preserves other routes and refuses a public Funnel slot', () => {
  const host = 'my-pc.example.ts.net', target = 'http://127.0.0.1:8790';
  checkServeSlot({}, host, 8791, target);
  checkServeSlot({ Web: { [host + ':8791']: { Handlers: { '/': { Proxy: target } } } } }, host, 8791, target);
  assert.throws(() => checkServeSlot({ Web: { [host + ':8791']: { Handlers: { '/': { Proxy: 'http://localhost:3000' } } } } }, host, 8791, target));
  assert.throws(() => checkServeSlot({ AllowFunnel: { [host + ':8791']: true } }, host, 8791, target));
});
test('desktop and phone use one store; exact tailnet host works for HTTP and WebSocket; MCP remains available', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wfc-service-'));
  const publicUrl = 'https://my-pc.example.ts.net:8791';
  const runtime = await createApp({ dataDir: dir, publicUrl: () => publicUrl, allowedHosts: () => ['my-pc.example.ts.net'] });
  await new Promise<void>((r) => runtime.server.listen(0, '127.0.0.1', r));
  const address = runtime.server.address() as { port: number };
  const base = 'http://127.0.0.1:' + address.port;
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/sync', { headers: { Host: 'my-pc.example.ts.net:8791', Origin: publicUrl } });
  try {
    const hello: any = await new Promise((resolve, reject) => { ws.once('message', (m) => resolve(JSON.parse(String(m)))); ws.once('error', reject); });
    assert.equal(hello.type, 'hello');
    const made = await fetch(base + '/api/tools/create_document', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Desktop and phone', open: false }) }).then(r => r.json()) as any;
    const docId = made.result.json.documentId;
    const snapshot = new Promise<any>((resolve) => { const on = (m: any) => { const value = JSON.parse(String(m)); if (value.type === 'snapshot') { ws.off('message', on); resolve(value); } }; ws.on('message', on); });
    ws.send(JSON.stringify({ type: 'open', docId }));
    assert.equal((await snapshot).doc.title, 'Desktop and phone');
    const denied = await fetch(base + '/api/documents', { headers: { Origin: 'https://untrusted.example' } }); assert.equal(denied.status, 403);
    const allowed = await fetch(base + '/api/documents'); assert.equal(allowed.status, 200);
    const init = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'desktop-test', version: '1' } } }) });
    assert.equal(init.status, 200);
    assert.match(await init.text(), /workflow-canvas/);
    const integration: any = await fetch(base + '/api/integration').then(r => r.json());
    assert.equal(integration.publicUrl, publicUrl);
    assert.ok(integration.toolCount > 0);
  } finally { ws.terminate(); await runtime.close(); }
});

test('failed attached-file flush leaves service usable and retry succeeds after recovery', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wfc-recovery-'));
  const runtime = await createApp({ dataDir: path.join(dir, 'data') });
  await new Promise<void>(r => runtime.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + (runtime.server.address() as { port: number }).port;
  const folder = path.join(dir, 'external');
  await mkdir(folder);
  const doc = runtime.store.create('Attached file');
  assert.equal((await runtime.files.attach(doc.id, path.join(folder, 'test.excalidraw'))).ok, true);
  await rename(folder, folder + '-offline');
  await writeFile(folder, 'simulated missing mount');
  runtime.store.apply(doc.id, { type: 'update_document', title: 'Keep this edit' }, { origin: 'test' });
  await assert.rejects(runtime.close());
  assert.equal((await fetch(base + '/health')).status, 200);
  await rename(folder, folder + '-blocked');
  await rename(folder + '-offline', folder);
  await runtime.close();
  const saved = JSON.parse(await readFile(path.join(folder, 'test.excalidraw'), 'utf8'));
  assert.match(JSON.stringify(saved), /Keep this edit/);
});

test('desktop plugin exports both manifest formats without Bash and preserves existing exports', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wfc-export-'));
  const target = path.join(root, 'workflow-canvas');
  const executable = 'C:\\Program Files\\Workflow Canvas\\workflow-canvas.exe';
  const launcher = executable + '.mcp.mjs';
  await exportDesktopPlugin(path.resolve('plugins/workflow-canvas'), target, executable, launcher, root);
  for (const manifest of ['mcp.json', '.mcp.json']) {
    const config = JSON.parse(await readFile(path.join(target, manifest), 'utf8')).mcpServers['workflow-canvas'];
    assert.equal(config.command, executable);
    assert.deepEqual(config.args, [launcher]);
    assert.deepEqual(config.env, { ELECTRON_RUN_AS_NODE: '1', WFC_USER_DATA: root });
    assert.equal(config.type, manifest.startsWith('.') ? 'local' : 'stdio');
  }
  await assert.rejects(exportDesktopPlugin(path.resolve('plugins/workflow-canvas'), target, 'other', launcher, root));
  assert.match(await readFile(path.join(target, 'skills/workflow-canvas/SKILL.md'), 'utf8'), /Workflow Canvas/);
});

test('skill install is idempotent and preserves customized files', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'wfc-skills-'));
  const source = path.resolve('plugins/workflow-canvas/skills/workflow-canvas');
  const target = await installBundledSkill(source, home, 'codex');
  assert.equal(await installBundledSkill(source, home, 'codex'), target);
  await writeFile(path.join(target, 'SKILL.md'), 'My customized skill');
  await assert.rejects(installBundledSkill(source, home, 'codex'), /preserved/);
  assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), 'My customized skill');
  await assert.rejects(installBundledSkill(source, home, '../../elsewhere'));
});
