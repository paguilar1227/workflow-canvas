import { test, expect } from '../support/journey';

test('focus in zen mode and present in view mode', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person turns on Zen mode from the More sheet (a Zen pill offers Exit, the minimap stays hidden, the drawing toolbar stays, editing still works) and turns it off with Exit and from the More sheet; then switches to View mode (read-only) from the More sheet to present: the toolbar disappears, and a double-tap on a topic, the selection bar, the long-press sheet, the inspector, one-finger drags of topics, a double-tap on empty canvas and Undo change nothing, while tapping to select, the zoom buttons, pinch, one-finger pan and Fit still work; Edit in the pill restores editing, and the More sheet turns view mode on and off. Ergonomics are checked in zen and view mode; the outline behaves as a drawer.');
  const docId = await app.newDoc('Quarterly review');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'qr-root', title: 'Q3 review', shape: 'pill', x: 0, y: 0 },
    { id: 'qr-wins', title: 'Wins', parentId: 'qr-root' },
    { id: 'qr-misses', title: 'Misses', parentId: 'qr-root' },
    { id: 'qr-next', title: 'Next quarter', parentId: 'qr-root' },
    { id: 'qr-nps', title: 'Customer NPS', x: 700, y: -260 },
  ] });
  await app.tool('add_edges', { documentId: docId, edges: [{ id: 'qr-e1', source: 'qr-nps', target: 'qr-wins', label: 'drives' }] });
  await app.open(docId);
  await phone.fit();
  const toolbar = page.getByTestId('toolbar');
  const minimap = page.locator('.react-flow__minimap');
  /** Open the More sheet and show one of its items (scrolled into view) without tapping it. */
  const moreItem = async (testId: string) => {
    await phone.tap(page.getByTestId('menu-more'));
    const item = page.getByTestId(testId);
    await expect(item).toBeVisible();
    await item.scrollIntoViewIfNeeded();
    return item;
  };
  /** Two taps on one spot, closer together than the browser's double-tap interval. */
  const doubleTap = async (at: { x: number; y: number }) => {
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(400);
  };
  /** What the finger would hit at the centre of a control: the control itself, or whatever covers it. */
  const coveredBy = (control: ReturnType<typeof page.getByTestId>) => control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
    return top && el.contains(top) ? 'not covered' : 'covered by ' + (top?.closest('[data-testid]')?.getAttribute('data-testid') || top?.className);
  });

  await test.step('the phone editor starts with the toolbar and no panels in the way', async () => {
    await expect(toolbar).toBeVisible();
    await expect(phone.slot('outline')).toHaveCount(0);
    await expect(phone.slot('inspector')).toHaveCount(0);
    await expect(minimap, 'no minimap shown on a phone').toBeHidden();
    await phone.ergonomics('editing');
    await ev.snap('editing-layout');
  });

  await test.step('More › Zen mode', async () => {
    const zen = await moreItem('view-zen');
    await expect(zen).toContainText('Zen mode');
    await phone.ergonomics('More sheet view items');
    await ev.snap('view-items-in-more');
    await phone.tap(zen);
    await expect(page.getByTestId('zen-pill')).toContainText('Zen mode');
    await expect(page.getByTestId('exit-zen'), 'the pill button reads Exit, without a keyboard hint on touch').toHaveText('Exit');
    expect((await app.state()).session.zenMode).toBe(true);
    await expect(minimap, 'the minimap stays hidden in zen').toBeHidden();
    await expect(toolbar, 'drawing tools stay available in zen').toBeVisible();
    await phone.ergonomics('zen mode');
    await ev.snap('zen-mode');
    const inspectorItem = await moreItem('toggle-inspector');
    expect(await coveredBy(inspectorItem), 'the zen pill does not cover More › Inspector').toBe('not covered');
    await phone.tap(page.getByTestId('menu-more'));
    await expect(inspectorItem, 'the More sheet closes again').toBeHidden();
  });

  await test.step('editing still works in zen', async () => {
    await phone.fit();
    await phone.selectTopic('Wins');
    await phone.sel('sel-child');
    await app.type('Shipped v2');
    expect((await app.nodeNamed('Shipped v2')).parentId).toBe('qr-wins');
    await expect(app.topic('Shipped v2')).toBeVisible();
    await ev.snap('edited-in-zen');
  });

  await test.step('Exit and the More sheet toggle zen', async () => {
    await phone.tap(page.getByTestId('exit-zen'));
    await expect(page.getByTestId('zen-pill')).toHaveCount(0);
    expect((await app.state()).session.zenMode).toBe(false);
    await phone.more('view-zen');
    await expect(page.getByTestId('zen-pill'), 'More › Zen mode turns zen on').toBeVisible();
    await phone.more('view-zen');
    await expect(page.getByTestId('zen-pill'), 'and off again').toHaveCount(0);
    expect((await app.state()).session.zenMode).toBe(false);
  });

  await test.step('More › View mode makes the canvas read-only', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.85 }));
    await phone.fit();
    await expect(page.locator('[data-testid="undo"]:visible'), 'there is an edit to undo before presenting').toBeEnabled();
    await phone.more('view-readonly');
    await expect(page.getByTestId('view-pill')).toContainText('read-only');
    await expect(page.getByTestId('exit-view'), 'the pill button reads Edit, without a keyboard hint on touch').toHaveText('Edit');
    await expect(page.getByTestId('toast')).toContainText('View mode');
    await expect(toolbar, 'no editing tools while presenting').toHaveCount(0);
    await phone.ergonomics('view mode');
    await ev.snap('view-mode');
    await phone.tap(page.getByTestId('menu-more'));
    const firstItem = page.locator('.menu [role=menuitem]').first();
    await expect(firstItem).toBeVisible();
    expect(await coveredBy(firstItem), 'the view pill does not cover the first More item').toBe('not covered');
    await expect(page.getByTestId('toggle-inspector'), 'More offers no Inspector while presenting').toHaveCount(0);
    await ev.snap('view-mode-more-sheet');
    await phone.tap(page.getByTestId('menu-more'));
    await expect(firstItem, 'the More sheet closes again').toBeHidden();
  });

  await test.step('nothing can be changed in view mode', async () => {
    const before = await app.doc();
    await doubleTap(await phone.grab(app.topic('Misses')));
    await expect(app.editor(), 'a double-tap on a topic does not open the editor').toHaveCount(0);
    await phone.tap(await phone.grab(app.topic('Wins')));
    await expect.poll(async () => (await app.selection()).nodes, 'topics can still be selected').toEqual(['qr-wins']);
    await phone.ergonomics('view mode with a selection');
    await ev.snap('view-mode-selection');

    const bar = page.getByTestId('selection-bar');
    for (const id of ['sel-edit', 'sel-child', 'sel-sibling', 'sel-delete', 'sel-style', 'sel-frame', 'sel-connect']) {
      await expect(bar.getByTestId(id), 'the selection bar offers no ' + id + ' in view mode').toHaveCount(0);
    }

    await phone.longPress(await phone.grab(app.topic('Wins')));
    const sheet = page.getByTestId('context-menu');
    await expect(sheet, 'a long-press on a topic still opens the sheet').toBeVisible();
    const offered = (await sheet.getByRole('button').allInnerTexts()).map((t) => t.split('\n')[0].trim());
    expect(offered, 'the view-mode sheet offers only actions that change nothing').toEqual(['Copy', 'Select all', 'Fit to screen']);
    await phone.ergonomics('view-mode long-press sheet');
    await ev.snap('view-mode-long-press-sheet');
    await phone.tap(sheet.getByTestId('ctx-copy'));
    await expect(sheet).toHaveCount(0);
    await expect(app.editor(), 'Copy opens no editor').toHaveCount(0);

    if (!(await app.selection()).nodes.includes('qr-wins')) await phone.tap(await phone.grab(app.topic('Wins')));
    await expect(page.locator('.column-slot.right'), 'the inspector cannot open while presenting').toHaveCount(0);

    const misses = await app.box(app.topic('Misses'));
    const wins = await app.box(app.topic('Wins'));
    const from = await phone.grab(app.topic('Misses'));
    await phone.drag(from, { x: from.x + 90, y: from.y + 70 });
    const [m2, w2] = [await app.box(app.topic('Misses')), await app.box(app.topic('Wins'))];
    expect({ dx: Math.round(m2.x - w2.x), dy: Math.round(m2.y - w2.y) }, 'a one-finger drag does not move the topic').toEqual({ dx: Math.round(misses.x - wins.x), dy: Math.round(misses.y - wins.y) });
    await doubleTap(await app.emptyPoint({ x: 0.5, y: 0.85 }));
    for (const id of ['undo', 'redo']) {
      const button = page.locator('[data-testid="' + id + '"]:visible');
      await expect(button, id + ' is disabled while presenting (BUG-P13)').toBeDisabled();
      const box = (await button.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(400);
    }
    await app.settled();
    expect((await app.doc()).nodes.map((n) => n.title).sort(), 'Undo and Redo in the top bar change nothing in view mode (BUG-P13)').toEqual(before.nodes.map((n) => n.title).sort());
    const now = await app.doc();
    expect(now.nodes, 'no topic was added, removed, renamed, recoloured or moved').toEqual(before.nodes);
    expect(now.edges).toEqual(before.edges);
    for (const t of ['Q3 review', 'Wins', 'Misses', 'Next quarter', 'Shipped v2', 'Customer NPS']) await expect(app.topic(t)).toHaveCount(1);
    await ev.snap('view-mode-after-edit-attempts');
  });

  await test.step('navigating still works in view mode', async () => {
    await phone.tap(await phone.grab(app.topic('Wins')));
    await expect.poll(async () => (await app.selection()).nodes).toEqual(['qr-wins']);
    const z0 = await app.zoomPct();
    await phone.tap(page.getByTestId('zoom-in'));
    await expect.poll(() => app.zoomPct(), 'zoom in still works').toBeGreaterThan(z0);
    const z1 = await app.zoomPct();
    await phone.pinch(await app.emptyPoint(), 260, 80);
    await expect.poll(() => app.zoomPct(), 'a pinch still zooms').toBeLessThan(z1);
    const vp = await app.viewport();
    const start = await app.emptyPoint({ x: 0.5, y: 0.5 });
    await phone.drag(start, { x: start.x - 60, y: start.y + 80 });
    const vp2 = await app.viewport();
    expect(Math.hypot(vp2.x - vp.x, vp2.y - vp.y), 'one finger on empty canvas still pans').toBeGreaterThan(40);
    await phone.fit();
    for (const t of ['Q3 review', 'Customer NPS']) expect(await app.inView(app.topic(t)), t + ' is in view after Fit').toBe(true);
    await ev.snap('view-mode-navigated');
  });

  await test.step('Edit in the pill and the More sheet leave and re-enter view mode', async () => {
    await phone.tap(page.getByTestId('exit-view'));
    await expect(page.getByTestId('view-pill')).toHaveCount(0);
    await expect(toolbar).toBeVisible();
    await phone.selectTopic('Misses');
    await phone.sel('sel-edit');
    await page.keyboard.press('ControlOrMeta+a');
    await app.type('Misses & lessons');
    await expect(app.topic('Misses & lessons'), 'editing works again').toBeVisible();
    await phone.more('view-readonly');
    await expect(page.getByTestId('view-pill'), 'More › View mode turns it on').toBeVisible();
    await expect(toolbar).toHaveCount(0);
    await phone.more('view-readonly');
    await expect(page.getByTestId('view-pill'), 'and off').toHaveCount(0);
    await expect(toolbar).toBeVisible();
    await ev.snap('editing-again');
  });

  await test.step('the outline behaves like a drawer', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });
});
