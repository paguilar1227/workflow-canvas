import type { Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type App, type Evidence, expect, test } from './journey';
import type { Phone } from './phone';

export async function layerJourney(page: Page, app: App, ev: Evidence, phone?: Phone) {
  ev.proves('Connector labels are readable above overlapping nodes. People can send a connector behind nodes and bring it forward from the inspector, and arrange nodes from mouse or touch context menus. Layering survives reload, shared AI undo/redo, and Excalidraw export/import. The actual MCP arrange_layers tool changes the same rendered layers.');
  const documentId = await app.newDoc('Overlapping connector labels');
  await app.tool('add_nodes', { documentId, nodes: [
    { id: 'source', title: 'Request', x: 0, y: 100, width: 160, height: 80 },
    { id: 'target', title: 'Response', x: 640, y: 100, width: 160, height: 80 },
    { id: 'blocker', title: 'Overlapping node', x: 280, y: 70, width: 240, height: 160 },
  ] });
  // A deliberate overlap tests stacking; untouched drafting labels avoid nodes.
  await app.tool('add_edges', { documentId, edges: [{ id: 'wire', source: 'source', target: 'target', label: 'No — return job_id', labelOffset: { x: 0, y: 0 }, routing: 'straight', style: 'dashed' }] });
  await app.open(documentId);
  await app.tool('set_ui', { inspector: false, outline: false, minimap: false });
  await app.fit();
  const label = page.getByTestId('edge-label-wire');
  const hit = () => label.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const front = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return front?.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? front?.closest('.react-flow__node')?.getAttribute('data-id');
  });
  const context = async (locator: ReturnType<Page['locator']>) => {
    if (phone) return phone.contextSheet(await app.center(locator));
    await locator.click({ button: 'right' });
    return page.getByTestId('context-menu');
  };
  const press = async (locator: ReturnType<Page['locator']>) => phone ? phone.tap(locator) : locator.click();

  await expect.poll(hit, 'the label is painted in front of the overlapping node').toBe('wire');
  await ev.snap('label-above-node-by-default');

  await test.step('send the connector to the back from its label menu', async () => {
    const menu = await context(label);
    if (phone) await phone.ergonomics('connector arrangement sheet');
    await ev.snap('connector-arrangement-menu');
    await press(menu.getByTestId('ctx-send-to-back'));
    await expect.poll(hit).toBe('blocker');
  });
  await test.step('bring the connector back using the inspector', async () => {
    if (phone) await phone.sel('sel-style');
    else await page.getByTestId('toggle-inspector').click();
    await press(page.getByTestId('bring-to-front'));
    if (phone) {
      await phone.ergonomics('layer controls in the inspector');
      await ev.snap('touch-inspector-arrangement');
      await phone.closeDrawer('inspector');
    } else await page.getByTestId('toggle-inspector').click();
    await expect.poll(hit).toBe('wire');
  });
  await test.step('node context menus can cover and uncover the label', async () => {
    const blocker = app.node('blocker');
    const box = await app.box(blocker);
    const point = { x: box.x + box.width / 2, y: box.y + box.height * 0.85 };
    if (phone) await phone.contextSheet(point);
    else await page.mouse.click(point.x, point.y, { button: 'right' });
    await press(page.getByTestId('ctx-bring-to-front'));
    await expect.poll(hit).toBe('blocker');
    const menu = await context(blocker);
    await press(menu.getByTestId('ctx-send-to-back'));
    await expect.poll(hit).toBe('wire');
  });
  await app.settled();
  const saved = await app.doc();
  await page.reload();
  await app.waitForDoc(documentId);
  await expect.poll(hit, 'saved arrangement survives a reload').toBe('wire');
  expect((await app.doc()).nodes).toEqual(saved.nodes);
  expect((await app.doc()).edges).toEqual(saved.edges);

  const client = new Client({ name: 'layer-regression', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', page.url())));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { documentId, ...args } });
    expect(result.isError, name + ' succeeds through MCP').not.toBe(true);
    return result;
  };
  try {
    await call('arrange_layers', { edgeIds: ['wire'], direction: 'back' });
    await expect.poll(hit, 'MCP changes the same visible layers').toBe('blocker');
    await call('undo', {});
    await expect.poll(hit, 'undo restores the front label').toBe('wire');
    await call('redo', {});
    await expect.poll(hit, 'redo restores the back label').toBe('blocker');
    await call('arrange_layers', { edgeIds: ['wire'], direction: 'front' });
    await expect.poll(hit).toBe('wire');
    const exported = await call('export_document', { format: 'excalidraw' });
    const content = (exported.content as { type: string; text?: string }[]).filter((block) => block.type === 'text').map((block) => block.text).join('');
    const beforeImport = await app.doc();
    await call('import_content', { format: 'excalidraw', content, mode: 'replace' });
    await expect.poll(hit, 'Excalidraw import retains the layers').toBe('wire');
    const afterImport = await app.doc();
    for (const node of beforeImport.nodes) expect(afterImport.nodes.find((item) => item.id === node.id)?.zIndex).toBe(node.zIndex);
    expect(afterImport.edges.find((edge) => edge.id === 'wire')?.zIndex).toBe(beforeImport.edges[0].zIndex);
  } finally { await client.close(); }
  await ev.snap('saved-and-ai-arranged-labels');
}
