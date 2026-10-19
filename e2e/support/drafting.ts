import { type App, type Evidence, expect } from './journey';
import type { Phone } from './phone';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function draftingJourney(app: App, ev: Evidence, phone?: Phone) {
  const { page } = app;
  ev.proves('Mono Drafting renders light/dark engineering paper, routes around nodes, supports keyboard and pointer bend editing, displaced label leaders, undo, reload and read-only mode.');
  const id = await app.newDoc('Drafting canvas');
  await app.tool('add_nodes', { documentId: id, nodes: [
    { id: 'start', title: 'Receive request', subtitle: 'Input', x: 0, y: 0, width: 200, height: 80 },
    { id: 'obstacle', title: 'Keep clear', x: 300, y: -10, width: 200, height: 100 },
    { id: 'end', title: 'Deliver result', x: 620, y: 0, width: 200, height: 80 },
  ] });
  await app.tool('add_edges', { documentId: id, edges: [
    { id: 'route', source: 'start', target: 'end', sourceSide: 'right', targetSide: 'left', label: 'Ready for delivery' },
  ] });
  await app.open(id);
  await app.fit();
  const label = page.getByTestId('edge-label-route');
  await expect(page.locator('html')).toHaveAttribute('data-drafting', '');
  await expect(page.locator('.react-flow__background')).toHaveCount(2);
  await expect(page.locator('.wfc-neon-halo')).toHaveCount(0);
  expect(await page.locator('.react-flow').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(246, 247, 240)');
  const crossings = await app.edgePath('route').evaluate((el) => {
    const path = el as SVGPathElement;
    const length = path.getTotalLength();
    for (let at = 0; at <= length; at++) {
      const p = path.getPointAtLength(at);
      if (p.x > 300 && p.x < 500 && p.y > -10 && p.y < 90) return true;
    }
    return false;
  });
  expect(crossings, 'the connector goes around the middle card').toBe(false);
  expect(await app.edgePath('route').evaluate((el) => getComputedStyle(el).filter)).toBe('none');
  await ev.snap('mono-drafting-light');
  if (phone) {
    await phone.tap(app.node('start'));
    await phone.sel('sel-style');
    await expect(page.getByTestId('insp-subtitle')).toHaveValue('Input');
    await phone.closeDrawer('inspector');
  }

  if (phone) await phone.tap(label); else await label.click();
  const bend = page.getByTestId('edge-bend-route');
  await expect(bend).toBeVisible();
  const labelHit = await label.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
  expect(labelHit, 'the bend handle cannot intercept the center of a label').toBe(true);
  const beforeNodes = (await app.doc()).nodes;
  const from = await app.center(bend);
  const to = { x: from.x, y: from.y + 70 };
  if (phone) await phone.drag(from, to); else await app.drag(from, to);
  await expect.poll(async () => (await app.doc()).edges[0].routePoint).toBeTruthy();
  const saved = (await app.doc()).edges[0].routePoint;
  expect((await app.doc()).nodes).toEqual(beforeNodes);
  await bend.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await app.doc()).edges[0].routePoint?.y).toBe(saved!.y - 20);
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await app.doc()).edges[0].routePoint).toEqual(saved);
  await ev.snap('connector-bend');

  const labelFrom = await app.center(label);
  const bendBeforeLabelDrag = (await app.doc()).edges[0].routePoint;
  const labelTo = { x: labelFrom.x, y: labelFrom.y + 100 };
  if (phone) await phone.drag(labelFrom, labelTo); else await app.drag(labelFrom, labelTo);
  const leader = page.getByTestId('label-leader-route');
  await expect(leader).toHaveCount(1);
  expect(await leader.evaluate((el) => ({ length: (el as unknown as SVGGeometryElement).getTotalLength() > 0, stroke: getComputedStyle(el).stroke !== 'none' }))).toEqual({ length: true, stroke: true });
  expect((await app.doc()).edges[0].routePoint, 'dragging a label does not drag its bend').toEqual(bendBeforeLabelDrag);
  const savedEdge = (await app.doc()).edges[0];
  await page.reload();
  await app.waitForDoc(id);
  expect((await app.doc()).edges[0]).toEqual(savedEdge);
  await app.tool('set_theme', { themeId: 'mono-drafting-dark' });
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  expect(await page.locator('.react-flow').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(27, 30, 26)');
  await app.fit();
  await ev.snap('mono-drafting-dark');

  if (phone) await phone.tap(label); else await label.click();
  await bend.focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await app.doc()).edges[0].routePoint).toBeUndefined();
  expect((await app.doc()).edges).toHaveLength(1);
  const client = new Client({ name: 'drafting-ui-parity', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', page.url())));
  try {
    const result = await client.callTool({ name: 'update_edges', arguments: { documentId: id, updates: [{ id: 'route', routePoint: { x: 250, y: -140 } }] } });
    expect(result.isError, 'the same bend can be set through MCP').not.toBe(true);
    await expect.poll(async () => (await app.doc()).edges[0].routePoint).toEqual({ x: 250, y: -140 });
    const reset = await client.callTool({ name: 'update_edges', arguments: { documentId: id, updates: [{ id: 'route', routePoint: null }] } });
    expect(reset.isError).not.toBe(true);
    await expect.poll(async () => (await app.doc()).edges[0].routePoint).toBeUndefined();
  } finally { await client.close(); }
  await app.tool('set_ui', { viewMode: true });
  await expect(bend).toHaveCount(0);
  await app.tool('set_theme', { themeId: 'neon-flow' });
  await expect(page.locator('html')).not.toHaveAttribute('data-drafting');
  expect(await app.cssVar('--canvas-bg'), 'drafting-only tokens are cleared on theme change').toBe('');
  await expect(page.locator('.react-flow__background')).toHaveCount(1);
}
