import net from 'node:net';
import { test, expect } from './support/journey';

const raw = (base: string, request: string, waitMs = 0, second?: string) => new Promise<string[]>((resolve, reject) => {
  const url = new URL(base);
  const replies: string[] = [];
  let buf = '';
  const socket = net.connect(Number(url.port || 80), url.hostname, () => socket.write(request));
  socket.on('data', (d) => {
    buf += d;
    if (!/\r\n\r\n/.test(buf)) return;
    replies.push(buf.split('\r\n')[0]);
    buf = '';
    if (second && replies.length === 1) setTimeout(() => socket.write(second), waitMs);
    else socket.destroy();
  });
  socket.on('close', () => resolve(replies));
  socket.on('error', reject);
});

test('an AI client works over the API safely and predictably', async ({ page, app, ev, request, baseURL }) => {
  ev.proves('An AI client gets clear errors (and no silent changes) for impossible requests, reads exactly what the human selected even after the AI re-opens the document or the human switches away and back (the UI and the AI always agree), can reuse an idle connection after the server would previously have dropped it, and requests from other websites are refused.');
  const docId = await app.newDoc('AI API check');
  const otherId = await app.newDoc('AI API check (other)');
  await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'root', title: 'Root', x: 0, y: 0 }, { id: 'kid', title: 'Kid', parentId: 'root' }] });

  await test.step('impossible requests fail clearly and change nothing', async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['reparent_node', { documentId: docId, id: 'root', parentId: 'kid' }, /descendant/],
      ['update_nodes', { documentId: docId, updates: [{ id: 'root', parentId: 'kid' }] }, /descendant/],
      ['delete_nodes', { documentId: docId, ids: ['nope'] }, /Unknown node ids/],
      ['delete_edges', { documentId: docId, ids: ['nope'] }, /Unknown edge ids/],
      ['set_ui', { documentId: docId, editNodeId: 'nope' }, /Unknown node ids/],
    ];
    for (const [name, args, message] of cases) {
      const body = await (await request.post('/api/tools/' + name, { data: args })).json();
      expect(body.ok, name + ' should fail').toBe(false);
      expect(body.error, name).toMatch(message);
    }
    const doc = await app.tool<{ nodes: { id: string; parentId?: string }[] }>('get_document', { documentId: docId, format: 'json' });
    expect(doc.nodes.map((n) => n.id).sort()).toEqual(['kid', 'root']);
    expect(doc.nodes.find((n) => n.id === 'root')?.parentId).toBeUndefined();
  });

  await test.step('the AI reads the human selection, also after re-opening the document', async () => {
    await app.open(docId);
    await app.topic('Root').click();
    await app.topic('Kid').click({ modifiers: ['Shift'] });
    const selected = async () => [...((await app.tool('get_canvas_state')).session.selections?.[docId]?.nodes ?? [])].sort();
    await expect.poll(selected).toEqual(['kid', 'root']);
    await app.tool('open_document', { documentId: docId });
    await page.waitForTimeout(600);
    expect(await selected()).toEqual(['kid', 'root']);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await ev.snap('human-selection-read-by-ai');

    await page.getByTestId('doc-' + otherId).click();
    await app.waitForDoc(otherId);
    await page.getByTestId('doc-' + docId).click();
    await app.waitForDoc(docId);
    await page.waitForTimeout(600);
    const shown = await page.locator('.react-flow__node.selected .wfc-node').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')).sort());
    expect(shown, 'the UI shows the stored selection after switching back').toEqual(['Kid', 'Root']);
    expect(await selected(), 'the AI reads the same selection the UI shows').toEqual(['kid', 'root']);
    await ev.snap('selection-after-switching-away-and-back');
  });

  await test.step('the deployment marker is JSON, not the app page', async () => {
    const res = await request.get('/deployment');
    expect(res.headers()['content-type']).toContain('application/json');
    expect(Object.keys(await res.json()).sort()).toEqual(['deploymentId', 'sourceSha']);
  });

  await test.step('an idle keep-alive connection can be reused', async () => {
    const host = new URL(baseURL!).host;
    const get = 'GET /health HTTP/1.1\r\nHost: ' + host + '\r\nConnection: keep-alive\r\n\r\n';
    expect(await raw(baseURL!, get, 7000, get)).toEqual(['HTTP/1.1 200 OK', 'HTTP/1.1 200 OK']);
  });

  await test.step('other websites are refused', async () => {
    const foreign = { origin: 'http://evil.example' };
    expect((await request.post('/api/tools/list_documents', { data: {}, headers: foreign })).status()).toBe(403);
    expect((await request.post('/mcp', { data: {}, headers: { ...foreign, accept: 'application/json, text/event-stream' } })).status()).toBe(403);
    const host = new URL(baseURL!).host;
    const upgrade = 'GET /sync HTTP/1.1\r\nHost: ' + host + '\r\nOrigin: http://evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n';
    expect(await raw(baseURL!, upgrade)).toEqual(['HTTP/1.1 403 Forbidden']);
    const rebinding = 'GET /api/documents HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n';
    expect((await raw(baseURL!, rebinding))[0]).toMatch(/^HTTP\/1\.1 403/);
  });

  await app.tool('delete_document', { documentId: docId });
  await app.tool('delete_document', { documentId: otherId });
});
