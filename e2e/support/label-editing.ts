import type { Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type App, type Evidence, expect } from './journey';
import type { Phone } from './phone';

async function connect(page: Page, documentId: string) {
  const client = new Client({ name: 'label-position-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', page.url())));
  return {
    close: () => client.close(),
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: { documentId, ...args } });
      expect(result.isError, name + ' succeeds through MCP').not.toBe(true);
      return result;
    },
  };
}

export async function labelPositionJourney(page: Page, app: App, ev: Evidence, phone?: Phone) {
  ev.proves('A person drags a connector label with mouse or touch at two zoom levels without moving the nodes or panning. The saved offset survives reload, one undo reverses a drag, cancelled gestures do not save, MCP can position the same label, and Reset restores automatic placement.');
  const documentId = await app.newDoc('Move a connector label');
  await app.tool('add_nodes', { documentId, nodes: [
    { id: 'source', title: 'Request', x: 0, y: 0, width: 120, height: 80 },
    { id: 'target', title: 'Response', x: 480, y: 0, width: 120, height: 80 },
  ] });
  await app.tool('add_edges', { documentId, edges: [{ id: 'wire', source: 'source', target: 'target', label: 'Move me', style: 'dashed' }] });
  await app.open(documentId);
  await app.tool('set_ui', { inspector: false, outline: false, minimap: false });
  await app.fit();
  const original = await app.doc();
  const label = page.getByTestId('edge-label-wire');
  const offset = async () => (await app.doc()).edges[0].labelOffset;
  const local = () => label.evaluate((element) => ({ x: parseFloat((element as HTMLElement).style.left), y: parseFloat((element as HTMLElement).style.top) }));
  const origin = await local();
  const ai = await connect(page, documentId);
  try {
    for (const zoom of [0.65, 1.2]) {
      await ai.call('control_view', { action: 'focus', nodeIds: ['source', 'target'], zoom });
      const from = await app.center(label);
      const previous = await offset() ?? { x: 0, y: 0 };
      const viewport = await app.viewport();
      const to = { x: from.x + 45 * zoom, y: from.y + 50 * zoom };
      if (phone) await phone.drag(from, to);
      else await app.drag(from, to);
      await expect.poll(async () => Math.abs((await offset())!.x - previous.x - 45)).toBeLessThan(1);
      expect(Math.abs((await offset())!.y - previous.y - 50)).toBeLessThan(1);
      const end = await app.center(label);
      expect(Math.abs(end.x - to.x)).toBeLessThan(2);
      expect(Math.abs(end.y - to.y)).toBeLessThan(2);
      expect(await app.viewport(), 'dragging a label does not pan or zoom the canvas').toEqual(viewport);
      expect((await app.doc()).nodes, 'dragging a label never moves nodes').toEqual(original.nodes);
      await ev.snap('label-dragged-at-zoom-' + zoom);
      await ai.call('undo');
      await expect.poll(async () => (await offset())?.x ?? 0).toBeCloseTo(previous.x, 1);
      await ai.call('redo');
      await expect.poll(async () => (await offset())?.x ?? 0).toBeCloseTo(previous.x + 45, 1);
    }
    const saved = await offset();
    await page.reload();
    await app.waitForDoc(documentId);
    expect(await offset()).toEqual(saved);
    expect((await local()).x).toBeCloseTo(origin.x + saved!.x, 1);
    expect((await local()).y).toBeCloseTo(origin.y + saved!.y, 1);

    const from = await app.center(label);
    if (phone) {
      await phone.touch('touchStart', [from]);
      await phone.touch('touchMove', [{ x: from.x + 30, y: from.y + 30 }]);
      await phone.touch('touchCancel', []);
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 30, from.y + 30);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    expect(await offset(), 'cancelled drags do not change saved positions').toEqual(saved);

    await ai.call('update_edges', { updates: [{ id: 'wire', labelOffset: { x: -35, y: 70 } }] });
    await expect.poll(async () => (await offset())?.x).toBe(-35);
    await expect.poll(async () => (await local()).x).toBeCloseTo(origin.x - 35, 1);
    await expect.poll(async () => (await local()).y).toBeCloseTo(origin.y + 70, 1);
    await ev.snap('ai-positioned-label');

    if (phone) await phone.contextSheet(await app.center(label));
    else await label.click({ button: 'right' });
    if (phone) { await phone.ergonomics('label position menu'); await phone.tap(page.getByTestId('ctx-reset-label')); }
    else await page.getByTestId('ctx-reset-label').click();
    await expect.poll(offset, 'Reset restores automatic positioning').toBeUndefined();
    await expect.poll(local).toEqual(origin);

    await ai.call('set_ui', { viewMode: true });
    const lockedFrom = await app.center(label);
    const lockedTo = { x: lockedFrom.x + 30, y: lockedFrom.y + 30 };
    if (phone) await phone.drag(lockedFrom, lockedTo); else await app.drag(lockedFrom, lockedTo);
    expect(await offset(), 'read-only mode cannot reposition a label').toBeUndefined();
    await ai.call('set_ui', { viewMode: false });
  } finally { await ai.close(); }
}

export async function intermediateLayerJourney(page: Page, app: App, ev: Evidence, phone?: Phone) {
  ev.proves('With a label above three overlapping cards, Send backward places it behind only the top card, while it remains in front of the next card. Another backward step puts it behind that card too; Bring forward reverses just one step. MCP uses the same ordered stack, and reload preserves the between-layers result.');
  const documentId = await app.newDoc('Put a label between two cards');
  await app.tool('add_nodes', { documentId, nodes: [
    { id: 'source', title: 'Source', x: -250, y: 40, width: 80, height: 80 },
    { id: 'target', title: 'Target', x: 580, y: 40, width: 80, height: 80 },
    { id: 'a', title: 'Back', x: 0, y: 0, width: 260, height: 180, color: 'blue' },
    { id: 'b', title: 'Middle', x: 70, y: 0, width: 260, height: 180, color: 'purple' },
    { id: 'c', title: 'Front', x: 200, y: 0, width: 260, height: 180, color: 'green' },
  ] });
  await app.tool('add_edges', { documentId, edges: [{ id: 'wire', source: 'source', target: 'target', label: 'Between cards', labelOffset: { x: 0, y: 0 }, routing: 'straight' }] });
  await app.open(documentId);
  await app.tool('set_ui', { inspector: false, outline: false, minimap: false });
  await app.fit();
  const label = page.getByTestId('edge-label-wire');
  const layersAtLabel = () => page.evaluate(() => {
    const rect = document.querySelector('.wfc-edge-label[data-edge-id="wire"]')!.getBoundingClientRect();
    const front = document.querySelector('.react-flow__node[data-id="c"]')!.getBoundingClientRect();
    const hit = (x: number) => {
      const element = document.elementFromPoint(x, rect.y + rect.height / 2);
      return element?.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? element?.closest('.react-flow__node')?.getAttribute('data-id');
    };
    return [hit((rect.left + front.left) / 2), hit((front.left + rect.right) / 2)];
  });
  await expect.poll(layersAtLabel).toEqual(['wire', 'wire']);
  if (phone) { await phone.tap(label); await phone.sel('sel-style'); }
  else { await label.click(); await page.getByTestId('toggle-inspector').click(); }
  const press = async (id: string) => phone ? phone.tap(page.getByTestId(id)) : page.getByTestId(id).click();
  await press('send-backward');
  if (phone) { await phone.ergonomics('one-step layer controls'); await phone.closeDrawer('inspector'); }
  else await page.getByTestId('toggle-inspector').click();
  await expect.poll(layersAtLabel, 'the label is above Middle but behind Front').toEqual(['wire', 'c']);
  await ev.snap('label-between-two-cards');
  if (phone) await phone.sel('sel-style'); else await page.getByTestId('toggle-inspector').click();
  await press('send-backward');
  if (phone) await phone.closeDrawer('inspector'); else await page.getByTestId('toggle-inspector').click();
  await expect.poll(layersAtLabel).toEqual(['b', 'c']);
  const ai = await connect(page, documentId);
  try {
    await ai.call('arrange_layers', { edgeIds: ['wire'], direction: 'forward' });
    await expect.poll(layersAtLabel).toEqual(['wire', 'c']);
    await ai.call('undo');
    await expect.poll(layersAtLabel).toEqual(['b', 'c']);
    await ai.call('redo');
    await expect.poll(layersAtLabel).toEqual(['wire', 'c']);
    const saved = await app.doc();
    await page.reload();
    await app.waitForDoc(documentId);
    await expect.poll(layersAtLabel, 'between-layers order survives reload').toEqual(['wire', 'c']);
    expect((await app.doc()).nodes).toEqual(saved.nodes);
    expect((await app.doc()).edges).toEqual(saved.edges);
  } finally { await ai.close(); }
}
