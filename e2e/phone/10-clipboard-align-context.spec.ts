import { test, expect, type Pt } from '../support/journey';

test('copy, paste, align and use the context menu', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person Area-selects four scattered topics (the canvas does not pan), lines them up with Align top and evens the gaps with Distribute horizontally in the inspector drawer; Area-selects two topics and taps Connect; long-presses the connector for its context sheet (dashed, reversed); long-presses empty canvas to add a topic right there; a quick canvas tap right after a sheet item adds nothing (P7); copies two topics from the selection bar’s More sheet (P8) and pastes them where they long-press; duplicates them from the More sheet; long-presses a topic to add a child (which must not cover another topic), recolour it and delete a topic; and uses Select all from the canvas sheet. Everything is saved. Ergonomics are checked on every sheet; the inspector behaves as a drawer.');
  const docId = await app.newDoc('Release train');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'rt-plan', title: 'Plan', x: 0, y: 60 },
    { id: 'rt-build', title: 'Build', x: 250, y: -40 },
    { id: 'rt-test', title: 'Test', x: 470, y: 110 },
    { id: 'rt-ship', title: 'Ship', x: 980, y: 10 },
  ] });
  await app.open(docId);
  await phone.fit();
  const ids = ['rt-plan', 'rt-build', 'rt-test', 'rt-ship'];
  const nodes = async () => (await app.doc()).nodes;
  const sheetItem = (menu: ReturnType<typeof page.getByTestId>, name: string | RegExp) => menu.getByRole('button', { name, exact: typeof name === 'string' });
  /** Area-select the given topics, starting and ending on empty canvas clear of the chrome. */
  const areaAround = async (which: string[]) => {
    const boxes = await Promise.all(which.map((id) => app.box(app.node(id))));
    const from: Pt = { x: Math.min(...boxes.map((b) => b.x)) - 14, y: Math.min(...boxes.map((b) => b.y)) - 14 };
    const to: Pt = { x: Math.max(...boxes.map((b) => b.x + b.width)) + 14, y: Math.max(...boxes.map((b) => b.y + b.height)) + 14 };
    await phone.areaSelect(from, to);
    await expect.poll(async () => (await app.selection()).nodes.slice().sort(), 'Area selected ' + which.join(', ')).toEqual(which.slice().sort());
  };
  await phone.ergonomics('scattered topics');
  await ev.snap('scattered-topics');

  await test.step('Area-select the four topics', async () => {
    await areaAround(ids);
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await phone.ergonomics('four selected');
    await ev.snap('four-selected');
  });

  await test.step('Align top in the inspector drawer lines the topics up', async () => {
    await phone.sel('sel-style');
    await expect(page.getByTestId('inspector-multi')).toContainText('4 selected');
    await phone.tap(page.getByTestId('align-top'));
    await expect.poll(async () => new Set((await nodes()).filter((n) => ids.includes(n.id)).map((n) => n.y)).size, 'every topic has the same top').toBe(1);
    await phone.ergonomics('align in the inspector drawer');
    await ev.snap('align-in-drawer');
  });

  await test.step('Distribute horizontally evens out the gaps', async () => {
    const gaps = async () => {
      const row = (await nodes()).filter((n) => ids.includes(n.id)).sort((a, b) => a.x - b.x);
      return row.slice(1).map((n, i) => n.x - (row[i].x + row[i].width));
    };
    const before = await gaps();
    expect(Math.max(...before) - Math.min(...before), 'the gaps start uneven').toBeGreaterThan(100);
    await phone.tap(page.getByTestId('distribute-h'));
    await expect.poll(async () => { const g = await gaps(); return Math.max(...g) - Math.min(...g); }, 'the gaps between neighbours are equal').toBeLessThanOrEqual(1);
    await phone.closeDrawer('inspector');
    expect((await app.selection()).nodes, 'closing the drawer keeps the selection').toHaveLength(4);
    await phone.fit();
    const screen = await Promise.all(ids.map((id) => app.box(app.node(id))));
    const tops = screen.map((b) => b.y);
    expect(Math.max(...tops) - Math.min(...tops), 'their tops line up on screen').toBeLessThan(1.5);
    screen.sort((a, b) => a.x - b.x);
    const sg = screen.slice(1).map((b, i) => b.x - (screen[i].x + screen[i].width));
    expect(Math.max(...sg) - Math.min(...sg), 'and the gaps look equal on screen').toBeLessThan(2);
    await ev.snap('aligned-and-distributed');
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.8 }));
  });

  let edgeId = '';
  await test.step('connector context sheet: dashed and reversed', async () => {
    await areaAround(['rt-plan', 'rt-build']);
    await phone.sel('sel-connect');
    await expect.poll(async () => (await app.doc()).edges.filter((e) => e.source === 'rt-plan' && e.target === 'rt-build').length, 'Connect joins the selected topics').toBe(1);
    edgeId = (await app.doc()).edges.find((e) => e.source === 'rt-plan')!.id;
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.8 }));
    let menu = await phone.contextSheet(await app.edgeMidpoint(edgeId));
    for (const label of ['Edit label', 'Reverse direction', 'Toggle dashed', 'Toggle animated flow', 'Delete connector']) await expect(menu).toContainText(label);
    await phone.ergonomics('connector sheet');
    await ev.snap('connector-context-sheet');
    await phone.tap(sheetItem(menu, 'Toggle dashed'));
    await expect(app.edgePath(edgeId), 'the line is drawn dashed').toHaveClass(/dashed/);
    menu = await phone.contextSheet(await app.edgeMidpoint(edgeId));
    await phone.tap(sheetItem(menu, 'Reverse direction'));
    await expect.poll(async () => { const e = (await app.doc()).edges.find((x) => x.id === edgeId)!; return e.source + '->' + e.target; }, 'the arrow now points from Build to Plan').toBe('rt-build->rt-plan');
    expect((await app.doc()).edges.find((x) => x.id === edgeId)!.style).toBe('dashed');
    await ev.snap('connector-dashed-and-reversed');
  });

  await test.step('canvas context sheet: add a topic right where you long-pressed', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.8 }));
    const spot = await app.emptyPoint({ x: 0.3, y: 0.7 });
    const menu = await phone.contextSheet(spot);
    for (const label of ['Add topic here', 'Add sticky note here', 'Paste', 'Select all', 'Fit to screen']) await expect(menu).toContainText(label);
    await phone.ergonomics('canvas sheet');
    await ev.snap('canvas-context-sheet');
    await phone.tap(menu.getByTestId('ctx-add-topic'));
    await app.type('Retro');
    const b = await app.box(app.topic('Retro'));
    expect(Math.abs(b.x + b.width / 2 - spot.x) < b.width && Math.abs(b.y + b.height / 2 - spot.y) < b.height * 1.5, 'the topic appears at the long-pressed spot').toBe(true);
    await ev.snap('topic-added-at-finger');
  });

  await test.step('a quick tap on empty canvas right after a sheet item adds nothing (P7)', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.8 }));
    await phone.fit();
    const menu = await phone.contextSheet(await app.emptyPoint({ x: 0.3, y: 0.3 }));
    const at = await app.center(sheetItem(menu, /^Paste/));
    const count = (await nodes()).length;
    await page.touchscreen.tap(at.x, at.y);
    const t0 = Date.now();
    await page.waitForTimeout(150);
    const gap = Date.now() - t0;
    await page.touchscreen.tap(at.x, at.y);
    expect(gap, 'the second tap follows the sheet item within 350 ms').toBeLessThan(350);
    await page.waitForTimeout(700);
    await expect(page.getByTestId('context-menu'), 'the sheet closed after its item').toHaveCount(0);
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.react-flow__pane'), at), 'the second tap landed on empty canvas').toBe(true);
    expect((await nodes()).length, 'no topic was added by the sheet-item tap plus the canvas tap').toBe(count);
    await expect(page.locator('.react-flow__node'), 'and none appeared on screen').toHaveCount(count);
    await ev.snap('quick-tap-after-sheet-adds-nothing');
  });

  let pasted: string[] = [];
  await test.step('copy two topics from the More sheet and paste them where you long-press', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.85 }));
    await phone.fit();
    await areaAround(['rt-plan', 'rt-build']);
    await phone.sel('sel-more');
    const more = page.getByTestId('context-menu');
    await expect(more, 'More in the selection bar opens the context sheet for a two-topic selection (P8)').toBeVisible();
    await expect(more, 'the context sheet for the selection is a bottom sheet').toHaveClass(/sheet/);
    await phone.ergonomics('selection More sheet');
    await ev.snap('selection-more-sheet');
    await phone.tap(sheetItem(more, /^Copy/));
    await expect(page.getByTestId('toast')).toContainText('Copied 2 nodes');
    const before = new Set((await nodes()).map((n) => n.id));
    const spot = await app.emptyPoint({ x: 0.6, y: 0.62 });
    const menu = await phone.contextSheet(spot);
    await phone.tap(sheetItem(menu, /^Paste/));
    await expect.poll(async () => (await nodes()).length).toBe(before.size + 2);
    pasted = (await nodes()).filter((n) => !before.has(n.id)).map((n) => n.id);
    expect((await nodes()).filter((n) => pasted.includes(n.id)).map((n) => n.title).sort()).toEqual(['Build', 'Plan']);
    expect((await app.doc()).edges.filter((e) => pasted.includes(e.source) && pasted.includes(e.target)), 'the connector between them is pasted too').toHaveLength(1);
    expect((await app.selection()).nodes.slice().sort(), 'the pasted copies are selected').toEqual(pasted.slice().sort());
    const boxes = await Promise.all(pasted.map((id) => app.box(app.node(id))));
    const cx = (Math.min(...boxes.map((b) => b.x)) + Math.max(...boxes.map((b) => b.x + b.width))) / 2;
    const cy = (Math.min(...boxes.map((b) => b.y)) + Math.max(...boxes.map((b) => b.y + b.height))) / 2;
    expect(Math.hypot(cx - spot.x, cy - spot.y), 'the copies are centred on the long-pressed spot').toBeLessThan(40);
    await ev.snap('pasted-at-finger');
  });

  await test.step('Duplicate in the More sheet copies the selection next to it', async () => {
    const before = new Set((await nodes()).map((n) => n.id));
    await phone.sel('sel-more');
    const more = page.getByTestId('context-menu');
    await expect(more, 'More in the selection bar opens the context sheet for the pasted pair (P8)').toBeVisible();
    await phone.tap(sheetItem(more, /^Duplicate/));
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
  await test.step('topic context sheet: add a child, recolour it, delete a topic', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.85 }));
    await phone.fit();
    let menu = await phone.contextSheet(await phone.grab(app.node('rt-plan')));
    for (const label of ['Edit text', 'Add child topic', 'Add sibling topic', 'Duplicate', 'Copy', 'Frame selection', 'Delete']) await expect(menu).toContainText(label);
    await phone.ergonomics('topic sheet');
    await ev.snap('topic-context-sheet');
    await phone.tap(menu.getByTestId('ctx-child'));
    await app.type('Write brief');
    child = (await app.nodeNamed('Write brief')).id;
    expect((await app.nodeNamed('Write brief')).parentId, 'the new topic is a child of Plan').toBe('rt-plan');
    const all = await nodes();
    const c = all.find((n) => n.id === child)!;
    const covered = all.filter((n) => n.id !== child && n.kind !== 'frame' && !n.parentId && n.id !== 'rt-plan'
      && c.x < n.x + n.width && n.x < c.x + c.width && c.y < n.y + n.height && n.y < c.y + c.height).map((n) => n.title);
    expect(covered, 'a new child topic must not be placed on top of an existing topic (it hides it)').toEqual([]);
    await phone.fit();
    menu = await phone.contextSheet(await phone.grab(app.topic('Write brief')));
    await phone.tap(sheetItem(menu, 'Color amber'));
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await expect(app.topic('Write brief')).toHaveClass(/has-color/);
    expect((await app.nodeNamed('Write brief')).color).toBe('amber');
    menu = await phone.contextSheet(await phone.grab(app.node('rt-test')));
    await phone.tap(menu.getByTestId('ctx-delete'));
    await expect(app.node('rt-test'), 'Test is gone from the canvas').toHaveCount(0);
    expect((await nodes()).some((n) => n.id === 'rt-test')).toBe(false);
    await ev.snap('child-added-recoloured-and-test-deleted');
  });

  await test.step('Select all from the canvas sheet, and everything was saved', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.85 }));
    const menu = await phone.contextSheet(await app.emptyPoint({ x: 0.15, y: 0.2 }));
    await phone.tap(sheetItem(menu, /^Select all/));
    const count = (await nodes()).length;
    await expect.poll(async () => (await app.selection()).nodes.length, 'everything is selected').toBe(count);
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await app.settled();
    const saved = await app.tool<{ nodes: { id: string; title: string }[]; edges: unknown[] }>('get_document', { documentId: docId, format: 'json' });
    expect(saved.nodes.map((n) => n.id).sort()).toEqual((await nodes()).map((n) => n.id).sort());
    expect(saved.nodes.filter((n) => n.title === 'Build')).toHaveLength(3);
    expect(saved.nodes.some((n) => n.title === 'Test')).toBe(false);
    expect(saved.nodes.find((n) => n.id === child)).toBeTruthy();
    await phone.ergonomics('all selected');
    await ev.snap('select-all');
  });

  await test.step('the inspector behaves like a drawer', async () => {
    await phone.checkDrawer('inspector', () => phone.sel('sel-style'));
  });
});
