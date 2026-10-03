import { test, expect } from '../support/journey';

test('navigate a big canvas', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: on a 49-topic canvas a person zooms with the zoom-bar buttons and with two-finger pinches (also when the pinch starts on topics, which must not move them), pans with one finger on empty canvas, fits everything back into view, finds a topic with More › Search (match count shown, view jumps to it, the next-match button steps through matches) and jumps to a topic by tapping it in the outline drawer, which closes to reveal it. Ergonomics are checked throughout; the outline behaves as a drawer.');
  const docId = await app.newDoc('Service map');
  const nodes = [] as { title: string; x: number; y: number; color?: string }[];
  for (let i = 0; i < 48; i++) nodes.push({ title: 'Service ' + (i + 1), x: (i % 8) * 420, y: Math.floor(i / 8) * 260 });
  nodes.push({ title: 'Billing ledger', x: 8 * 420 + 300, y: 6 * 260 + 200, color: 'amber' });
  await app.tool('add_nodes', { documentId: docId, nodes });
  await app.open(docId);
  await phone.fit();
  const first = await app.nodeNamed('Service 1');
  const ledger = await app.nodeNamed('Billing ledger');
  await phone.ergonomics('whole canvas');
  await ev.snap('whole-canvas');

  await test.step('zoom with the zoom-bar buttons', async () => {
    const z0 = await app.zoomPct();
    await phone.tap(page.getByTestId('zoom-in'));
    await expect.poll(() => app.zoomPct(), 'zoom in').toBeGreaterThan(z0);
    const z1 = await app.zoomPct();
    await phone.tap(page.getByTestId('zoom-out'));
    await phone.tap(page.getByTestId('zoom-out'));
    await expect.poll(() => app.zoomPct(), 'zoom out').toBeLessThan(z1);
    await ev.snap('zoomed-with-buttons');
  });

  await test.step('pinch zooms, also when the fingers start on topics', async () => {
    await phone.fit();
    const v0 = await app.viewport();
    await phone.pinch(await app.emptyPoint(), 80, 280);
    const v1 = await app.viewport();
    expect(v1.zoom, 'spreading two fingers zooms in').toBeGreaterThan(v0.zoom * 1.5);
    await ev.snap('pinched-in');
    await phone.pinch(await app.emptyPoint(), 280, 80);
    expect((await app.viewport()).zoom, 'pinching two fingers zooms out').toBeLessThan(v1.zoom / 1.5);

    await phone.fit();
    const t = await app.nodeNamed('Service 20');
    const z0 = (await app.viewport()).zoom;
    await phone.pinch(await phone.grab(app.node(t.id)), 40, 240);
    expect((await app.viewport()).zoom, 'a pinch that starts on topics still zooms').toBeGreaterThan(z0 * 1.5);
    const t1 = await app.nodeNamed('Service 20');
    expect({ x: t1.x, y: t1.y }, 'the pinch does not move the topic under the fingers').toEqual({ x: t.x, y: t.y });
    await ev.snap('pinched-on-topics');
  });

  await test.step('one finger on empty canvas pans', async () => {
    await phone.tap(await app.emptyPoint());
    const from = await app.emptyPoint();
    const v1 = await app.viewport();
    await phone.drag(from, { x: from.x - 150, y: from.y - 120 }, 20);
    const v2 = await app.viewport();
    expect(v2.x - v1.x, 'pans horizontally with the finger').toBeLessThan(-100);
    expect(v2.y - v1.y, 'pans vertically with the finger').toBeLessThan(-80);
    expect(v2.zoom, 'panning does not zoom').toBeCloseTo(v1.zoom, 5);
    expect((await app.selection()).nodes, 'panning does not select').toEqual([]);
    await phone.ergonomics('panned');
    await ev.snap('panned-with-one-finger');
  });

  await test.step('fit view brings everything back', async () => {
    await phone.fit();
    expect(await app.inView(app.node(first.id)), 'top-left topic is in view').toBe(true);
    expect(await app.inView(app.node(ledger.id)), 'bottom-right topic is in view').toBe(true);
    await ev.snap('fit-view');
  });

  await test.step('More › Search finds a topic and focuses it', async () => {
    await phone.tap(page.getByTestId('zoom-in'));
    await phone.tap(page.getByTestId('zoom-in'));
    await phone.more('open-search');
    const input = page.getByTestId('search-input');
    await expect(input).toBeVisible();
    const field = await app.box(input);
    expect(Math.min(field.width, field.height), 'the search field is a full touch target (P6 regression)').toBeGreaterThanOrEqual(44);
    await input.tap();
    await input.pressSequentially('ledger', { delay: 40 });
    await expect(page.getByTestId('search-count')).toHaveText('1 / 1');
    await expect(app.node(ledger.id)).toHaveClass(/is-current-match/);
    await expect.poll(() => app.inView(app.node(ledger.id)), 'the view jumps to the match').toBe(true);
    await phone.ergonomics('search bar');
    await ev.snap('search-found-ledger');

    await input.fill('Service 1');
    await expect(page.getByTestId('search-count')).toHaveText('1 / 11');
    await phone.tap(page.getByRole('button', { name: 'Next match' }));
    await expect(page.getByTestId('search-count')).toHaveText('2 / 11');
    await expect(page.locator('.wfc-node.is-match')).toHaveCount(10);
    await expect(page.locator('.wfc-node.is-current-match')).toHaveCount(1);
    await ev.snap('search-stepping-through-matches');
    await phone.tap(page.getByRole('button', { name: 'Close search' }));
    await expect(page.getByTestId('searchbar')).toHaveCount(0);
    await expect(page.locator('.wfc-node.is-match, .wfc-node.is-current-match')).toHaveCount(0);
  });

  await test.step('tapping a topic in the outline drawer selects it, closes the drawer and focuses it', async () => {
    await phone.fit();
    const target = await app.nodeNamed('Service 40');
    const z0 = (await app.viewport()).zoom;
    await phone.openDrawer('outline');
    await phone.ergonomics('outline drawer');
    await ev.snap('outline-drawer');
    await phone.tap(page.getByTestId('outline-' + target.id));
    await expect(phone.slot('outline'), 'the drawer closes to reveal the canvas').toHaveCount(0);
    await expect.poll(async () => (await app.selection()).nodes).toEqual([target.id]);
    await expect.poll(async () => (await app.viewport()).zoom, 'the view zooms in on the topic').toBeGreaterThan(z0 * 1.5);
    await expect.poll(() => app.inView(app.node(target.id))).toBe(true);
    await expect(page.getByTestId('selection-bar'), 'the selection bar shows for the focused topic').toBeVisible();
    await ev.snap('outline-focus');
  });

  await test.step('the outline behaves like a drawer', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });
});
