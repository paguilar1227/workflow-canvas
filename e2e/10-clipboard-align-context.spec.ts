import { test, expect, type App, type Pt } from './support/journey';

async function rightClick(app: App, at: Pt) {
  await app.page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(app.page.getByTestId('context-menu')).toBeVisible();
  return app.page.getByTestId('context-menu');
}

test('copy, paste, align and use the context menu', async ({ page, app, ev }) => {
  ev.proves('A user marquee-selects four scattered topics, lines them up with Align top and evens the gaps with Distribute horizontally in the inspector; uses right-click menus on a topic (add a child, recolour, delete), on a connector (toggle dashed, reverse direction) and on empty canvas (add a topic at the pointer, paste, select all); copies with Cmd+C, pastes at the right-clicked spot, and duplicates with Cmd+D — each result is visible on the canvas and saved.');
  const docId = await app.newDoc('Release train');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'rt-plan', title: 'Plan', x: 0, y: 60 },
    { id: 'rt-build', title: 'Build', x: 250, y: -40 },
    { id: 'rt-test', title: 'Test', x: 470, y: 110 },
    { id: 'rt-ship', title: 'Ship', x: 980, y: 10 },
  ] });
  await app.open(docId);
  await app.fit();
  const ids = ['rt-plan', 'rt-build', 'rt-test', 'rt-ship'];
  const nodes = async () => (await app.doc()).nodes;
  await ev.snap('scattered-topics');

  await test.step('marquee-select the four topics', async () => {
    const boxes = await Promise.all(ids.map((id) => app.box(app.node(id))));
    // React Flow auto-scrolls while a selection drag is within 40px of the canvas edge; stay clear of that zone.
    const pane = await app.paneBox();
    const inset = 48;
    const from = { x: Math.max(pane.x + inset, Math.min(...boxes.map((b) => b.x)) - 30), y: Math.max(pane.y + inset, Math.min(...boxes.map((b) => b.y)) - 30) };
    const to = { x: Math.min(pane.x + pane.width - inset, Math.max(...boxes.map((b) => b.x + b.width)) + 30), y: Math.min(pane.y + pane.height - inset, Math.max(...boxes.map((b) => b.y + b.height)) + 30) };
    const startsOnCanvas = await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.classList.contains('react-flow__pane'), from);
    expect(startsOnCanvas, 'the marquee starts on empty canvas').toBe(true);
    const view = await app.viewport();
    await app.drag(from, to, { beforeRelease: async () => {
      await expect(page.locator('.react-flow__selection'), 'a selection rectangle follows the pointer').toBeVisible();
      await ev.snap('marquee-dragging');
    } });
    expect(await app.viewport(), 'the canvas stays put while selecting').toEqual(view);
    await expect.poll(async () => (await app.selection()).nodes.slice().sort()).toEqual(ids.slice().sort());
    await expect(page.getByTestId('inspector-multi')).toContainText('4 selected');
  });

  await test.step('Align top lines the topics up', async () => {
    await page.getByTestId('align-top').click();
    await expect.poll(async () => new Set((await nodes()).filter((n) => ids.includes(n.id)).map((n) => n.y)).size, 'every topic has the same top').toBe(1);
    const tops = await Promise.all(ids.map(async (id) => (await app.box(app.node(id))).y));
    expect(Math.max(...tops) - Math.min(...tops), 'their tops line up on screen').toBeLessThan(1.5);
    await ev.snap('aligned-top');
  });

  await test.step('Distribute horizontally evens out the gaps', async () => {
    const gaps = async () => {
      const row = (await nodes()).filter((n) => ids.includes(n.id)).sort((a, b) => a.x - b.x);
      return row.slice(1).map((n, i) => n.x - (row[i].x + row[i].width));
    };
    const before = await gaps();
    expect(Math.max(...before) - Math.min(...before), 'the gaps start uneven').toBeGreaterThan(100);
    await page.getByTestId('distribute-h').click();
    await expect.poll(async () => { const g = await gaps(); return Math.max(...g) - Math.min(...g); }, 'the gaps between neighbours are equal').toBeLessThanOrEqual(1);
    const screen = await Promise.all(ids.map((id) => app.box(app.node(id))));
    screen.sort((a, b) => a.x - b.x);
    const sg = screen.slice(1).map((b, i) => b.x - (screen[i].x + screen[i].width));
    expect(Math.max(...sg) - Math.min(...sg), 'and look equal on screen').toBeLessThan(2);
    await ev.snap('distributed-horizontally');
    await page.keyboard.press('Escape');
  });

  let edgeId = '';
  await test.step('connector context menu: dashed and reversed', async () => {
    await app.node('rt-plan').click();
    await app.node('rt-build').click({ modifiers: ['Shift'] });
    await page.keyboard.press('c');
    await expect.poll(async () => (await app.doc()).edges.filter((e) => e.source === 'rt-plan' && e.target === 'rt-build').length, 'C connects the selected topics').toBe(1);
    edgeId = (await app.doc()).edges.find((e) => e.source === 'rt-plan')!.id;
    await page.keyboard.press('Escape');
    let menu = await rightClick(app, await app.edgeMidpoint(edgeId));
    for (const label of ['Edit label', 'Reverse direction', 'Toggle dashed', 'Toggle animated flow', 'Delete connector']) await expect(menu).toContainText(label);
    await ev.snap('connector-context-menu');
    await menu.getByRole('button', { name: 'Toggle dashed' }).click();
    await expect(app.edgePath(edgeId), 'the line is drawn dashed').toHaveClass(/dashed/);
    menu = await rightClick(app, await app.edgeMidpoint(edgeId));
    await menu.getByRole('button', { name: 'Reverse direction' }).click();
    await expect.poll(async () => { const e = (await app.doc()).edges.find((x) => x.id === edgeId)!; return e.source + '->' + e.target; }, 'the arrow now points from Build to Plan').toBe('rt-build->rt-plan');
    expect((await app.doc()).edges.find((x) => x.id === edgeId)!.style).toBe('dashed');
    await ev.snap('connector-dashed-and-reversed');
  });

  await test.step('canvas context menu: add a topic right where you clicked', async () => {
    await page.keyboard.press('Escape');
    const spot = await app.emptyPoint({ x: 0.3, y: 0.78 });
    const menu = await rightClick(app, spot);
    for (const label of ['Add topic here', 'Add sticky note here', 'Paste', 'Select all', 'Fit to screen']) await expect(menu).toContainText(label);
    await ev.snap('canvas-context-menu');
    await menu.getByTestId('ctx-add-topic').click();
    await app.type('Retro');
    const b = await app.box(app.topic('Retro'));
    expect(Math.abs(b.x + b.width / 2 - spot.x) < b.width && Math.abs(b.y + b.height / 2 - spot.y) < b.height * 1.5, 'the topic appears at the clicked spot').toBe(true);
    await ev.snap('topic-added-at-pointer');
  });

  let pasted: string[] = [];
  await test.step('copy two topics and paste them where you right-click', async () => {
    await page.keyboard.press('Escape');
    await app.node('rt-plan').click();
    await app.node('rt-build').click({ modifiers: ['Shift'] });
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.getByTestId('toast')).toContainText('Copied 2 nodes');
    const before = new Set((await nodes()).map((n) => n.id));
    const spot = await app.emptyPoint({ x: 0.6, y: 0.62 });
    const menu = await rightClick(app, spot);
    await menu.getByRole('button', { name: /^Paste/ }).click();
    await expect.poll(async () => (await nodes()).length).toBe(before.size + 2);
    pasted = (await nodes()).filter((n) => !before.has(n.id)).map((n) => n.id);
    expect((await nodes()).filter((n) => pasted.includes(n.id)).map((n) => n.title).sort()).toEqual(['Build', 'Plan']);
    expect((await app.doc()).edges.filter((e) => pasted.includes(e.source) && pasted.includes(e.target)), 'the connector between them is pasted too').toHaveLength(1);
    expect((await app.selection()).nodes.slice().sort(), 'the pasted copies are selected').toEqual(pasted.slice().sort());
    const boxes = await Promise.all(pasted.map((id) => app.box(app.node(id))));
    const cx = (Math.min(...boxes.map((b) => b.x)) + Math.max(...boxes.map((b) => b.x + b.width))) / 2;
    const cy = (Math.min(...boxes.map((b) => b.y)) + Math.max(...boxes.map((b) => b.y + b.height))) / 2;
    expect(Math.hypot(cx - spot.x, cy - spot.y), 'the copies are centred on the right-clicked spot').toBeLessThan(40);
    await ev.snap('pasted-at-pointer');
  });

  await test.step('Cmd+D duplicates the selection next to it', async () => {
    const before = new Set((await nodes()).map((n) => n.id));
    await page.keyboard.press('ControlOrMeta+d');
    await expect.poll(async () => (await nodes()).length).toBe(before.size + 2);
    const all = await nodes();
    const dups = all.filter((n) => !before.has(n.id));
    for (const d of dups) {
      const src = all.find((n) => pasted.includes(n.id) && n.title === d.title)!;
      expect({ dx: d.x - src.x, dy: d.y - src.y }, d.title + ' copy is offset down-right').toEqual({ dx: 40, dy: 40 });
      await expect(app.node(d.id)).toBeVisible();
    }
    await ev.snap('duplicated');
  });

  let child = '';
  await test.step('topic context menu: add a child, recolour it, delete a topic', async () => {
    let menu = await rightClick(app, await app.center(app.node('rt-plan')));
    for (const label of ['Edit text', 'Add child topic', 'Add sibling topic', 'Duplicate', 'Copy', 'Frame selection', 'Delete']) await expect(menu).toContainText(label);
    await ev.snap('topic-context-menu');
    await menu.getByTestId('ctx-child').click();
    await app.type('Write brief');
    child = (await app.nodeNamed('Write brief')).id;
    expect((await app.nodeNamed('Write brief')).parentId, 'the new topic is a child of Plan').toBe('rt-plan');
    const all = await nodes();
    const c = all.find((n) => n.id === child)!;
    const covered = all.filter((n) => n.id !== child && n.kind !== 'frame' && !n.parentId && n.id !== 'rt-plan'
      && c.x < n.x + n.width && n.x < c.x + c.width && c.y < n.y + n.height && n.y < c.y + c.height).map((n) => n.title);
    expect(covered, 'a new child topic must not be placed on top of an existing topic (it hides it)').toEqual([]);
    await app.fit();
    menu = await rightClick(app, await app.center(app.topic('Write brief')));
    await menu.getByRole('button', { name: 'Color amber' }).click();
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await expect(app.topic('Write brief')).toHaveClass(/has-color/);
    expect((await app.nodeNamed('Write brief')).color).toBe('amber');
    menu = await rightClick(app, await app.center(app.node('rt-test')));
    await menu.getByTestId('ctx-delete').click();
    await expect(app.node('rt-test'), 'Test is gone from the canvas').toHaveCount(0);
    expect((await nodes()).some((n) => n.id === 'rt-test')).toBe(false);
    await ev.snap('child-added-recoloured-and-test-deleted');
  });

  await test.step('Select all from the canvas menu, and everything was saved', async () => {
    await page.keyboard.press('Escape');
    const menu = await rightClick(app, await app.emptyPoint({ x: 0.15, y: 0.2 }));
    await menu.getByRole('button', { name: /^Select all/ }).click();
    const count = (await nodes()).length;
    await expect(page.getByTestId('inspector-multi')).toContainText(count + ' selected');
    await app.settled();
    const saved = await app.tool<{ nodes: { id: string; title: string }[]; edges: unknown[] }>('get_document', { documentId: docId, format: 'json' });
    expect(saved.nodes.map((n) => n.id).sort()).toEqual((await nodes()).map((n) => n.id).sort());
    expect(saved.nodes.filter((n) => n.title === 'Build')).toHaveLength(3);
    expect(saved.nodes.some((n) => n.title === 'Test')).toBe(false);
    expect(saved.nodes.find((n) => n.id === child)).toBeTruthy();
    await ev.snap('select-all');
  });
});
