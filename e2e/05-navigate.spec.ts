import { test, expect } from './support/journey';

test('navigate a big canvas', async ({ page, app, ev }) => {
  ev.proves('On a 49-topic canvas a user zooms with the buttons and Cmd+scroll, pans by scrolling and with the hand tool, fits everything back into view, sees and toggles the minimap, finds a topic with Cmd+F (match count shown, view jumps to it, Enter steps through matches) and jumps to a topic by clicking it in the outline.');
  const docId = await app.newDoc('Service map');
  const nodes = [] as { title: string; x: number; y: number; color?: string }[];
  for (let i = 0; i < 48; i++) nodes.push({ title: 'Service ' + (i + 1), x: (i % 8) * 420, y: Math.floor(i / 8) * 260 });
  nodes.push({ title: 'Billing ledger', x: 8 * 420 + 300, y: 6 * 260 + 200, color: 'amber' });
  await app.tool('add_nodes', { documentId: docId, nodes });
  await app.open(docId);
  await app.fit();
  const first = await app.nodeNamed('Service 1');
  const ledger = await app.nodeNamed('Billing ledger');
  await ev.snap('whole-canvas');

  await test.step('zoom with the buttons', async () => {
    const z0 = await app.zoomPct();
    await page.getByTestId('zoom-in').click();
    await expect.poll(() => app.zoomPct(), 'zoom in raises the zoom level').toBeGreaterThan(z0);
    const z1 = await app.zoomPct();
    await page.getByTestId('zoom-out').click();
    await page.getByTestId('zoom-out').click();
    await expect.poll(() => app.zoomPct(), 'zoom out lowers the zoom level').toBeLessThan(z1);
  });

  await test.step('Cmd+scroll zooms around the pointer', async () => {
    const z0 = (await app.viewport()).zoom;
    const at = await app.emptyPoint();
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('ControlOrMeta');
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
    await page.keyboard.up('ControlOrMeta');
    await expect.poll(async () => (await app.viewport()).zoom, 'Cmd+scroll up zooms in').toBeGreaterThan(z0 * 1.1);
    await ev.snap('zoomed-in-with-cmd-scroll');
  });

  await test.step('scrolling pans, and the hand tool drags the canvas', async () => {
    const v0 = await app.viewport();
    const at = await app.emptyPoint();
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(60); }
    await expect.poll(async () => (await app.viewport()).y, 'scrolling down moves the canvas up').toBeLessThan(v0.y - 100);
    expect((await app.viewport()).zoom, 'plain scrolling does not zoom').toBeCloseTo(v0.zoom, 5);

    await page.getByTestId('tool-pan').click();
    await expect(page.getByTestId('tool-pan')).toHaveClass(/active/);
    const v1 = await app.viewport();
    const from = await app.emptyPoint({ x: 0.3, y: 0.5 });
    await app.drag(from, { x: from.x + 260, y: from.y + 120 });
    const v2 = await app.viewport();
    expect(v2.x - v1.x, 'hand-drag pans horizontally with the pointer').toBeGreaterThan(200);
    expect(v2.y - v1.y, 'hand-drag pans vertically with the pointer').toBeGreaterThan(80);
    expect((await app.selection()).nodes, 'panning does not select').toEqual([]);
    await ev.snap('panned-with-hand-tool');
    await page.keyboard.press('v');
    await expect(page.getByTestId('tool-pan')).not.toHaveClass(/active/);
  });

  await test.step('fit view brings everything back and the minimap shows the whole map', async () => {
    await app.fit();
    expect(await app.inView(app.node(first.id)), 'top-left topic is in view').toBe(true);
    expect(await app.inView(app.node(ledger.id)), 'bottom-right topic is in view').toBe(true);
    const minimap = page.locator('.react-flow__minimap');
    await expect(minimap).toBeVisible();
    await expect(minimap.locator('.react-flow__minimap-node')).toHaveCount(49);
    await page.getByTestId('toggle-minimap').click();
    await expect(minimap).toHaveCount(0);
    await page.getByTestId('toggle-minimap').click();
    await expect(minimap).toBeVisible();
    await ev.snap('fit-view-with-minimap');
  });

  await test.step('Cmd+F finds a topic and focuses it', async () => {
    await page.getByTestId('zoom-in').click();
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(400);
    await page.keyboard.press('ControlOrMeta+f');
    const input = page.getByTestId('search-input');
    await expect(input).toBeFocused();
    await input.pressSequentially('ledger', { delay: 40 });
    await expect(page.getByTestId('search-count')).toHaveText('1 / 1');
    await expect(app.node(ledger.id)).toHaveClass(/is-current-match/);
    await expect.poll(() => app.inView(app.node(ledger.id)), 'the view jumps to the match').toBe(true);
    await ev.snap('search-found-ledger');

    await input.fill('Service 1');
    await expect(page.getByTestId('search-count')).toHaveText('1 / 11');
    await input.press('Enter');
    await expect(page.getByTestId('search-count')).toHaveText('2 / 11');
    await expect(page.locator('.wfc-node.is-match')).toHaveCount(10);
    await expect(page.locator('.wfc-node.is-current-match')).toHaveCount(1);
    await ev.snap('search-stepping-through-matches');
    await input.press('Escape');
    await expect(page.getByTestId('searchbar')).toHaveCount(0);
    await expect(page.locator('.wfc-node.is-match, .wfc-node.is-current-match')).toHaveCount(0);
  });

  await test.step('clicking a topic in the outline selects and focuses it', async () => {
    await app.fit();
    const target = await app.nodeNamed('Service 40');
    const z0 = (await app.viewport()).zoom;
    await page.getByTestId('outline-' + target.id).click();
    await expect.poll(async () => (await app.selection()).nodes).toEqual([target.id]);
    await expect.poll(async () => (await app.viewport()).zoom, 'the view zooms in on the topic').toBeGreaterThan(z0 * 1.5);
    await expect.poll(() => app.inView(app.node(target.id))).toBe(true);
    await expect(page.getByTestId('outline-' + target.id)).toHaveClass(/selected/);
    await expect(page.getByTestId('insp-title')).toHaveValue('Service 40');
    await ev.snap('outline-focus');
  });
});
