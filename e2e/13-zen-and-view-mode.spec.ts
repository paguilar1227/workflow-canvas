import { test, expect } from './support/journey';

test('focus in zen mode and present in view mode', async ({ page, app, ev }) => {
  ev.proves('A user hides the side panels and minimap with View › Zen mode (the canvas grows, a Zen pill offers Exit, editing still works) and toggles it with Alt+Z; then switches to View › View mode (read-only) to present: the toolbar and inspector disappear, and double-click editing, Tab/Enter/Delete/N/P shortcuts, dragging, double-click-to-add and Cmd+Z change nothing, while selecting, arrow-key navigation, zoom and fit still work; Edit (and Alt+R) restores editing.');
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
  await app.fit();
  const chrome = {
    outline: page.getByTestId('outline'), inspector: page.getByTestId('inspector'), toolbar: page.getByTestId('toolbar'),
    minimap: page.locator('.react-flow__minimap'),
  };
  const normalWidth = (await app.paneBox()).width;
  await test.step('the editor starts with panels, toolbar and minimap', async () => {
    for (const [name, l] of Object.entries(chrome)) await expect(l, name + ' is shown while editing').toBeVisible();
    await ev.snap('editing-layout');
  });

  await test.step('View › Zen mode hides the panels', async () => {
    await page.getByTestId('menu-view').click();
    await expect(page.getByTestId('view-zen')).toContainText('Alt+Z');
    await ev.snap('view-menu');
    await page.getByTestId('view-zen').click();
    await expect(page.getByTestId('zen-pill')).toContainText('Zen mode');
    for (const name of ['outline', 'inspector', 'minimap'] as const) await expect(chrome[name], name + ' is hidden in zen').toHaveCount(0);
    await expect(chrome.toolbar, 'drawing tools stay available in zen').toBeVisible();
    await expect.poll(async () => (await app.paneBox()).width, 'the canvas takes the freed space').toBeGreaterThan(normalWidth + 400);
    await ev.snap('zen-mode');
  });

  await test.step('editing still works in zen', async () => {
    await app.fit();
    await app.topic('Wins').click();
    await page.keyboard.press('Tab');
    await app.type('Shipped v2');
    expect((await app.nodeNamed('Shipped v2')).parentId).toBe('qr-wins');
    await expect(app.topic('Shipped v2')).toBeVisible();
    await ev.snap('edited-in-zen');
  });

  await test.step('Exit and Alt+Z toggle zen', async () => {
    await page.getByTestId('exit-zen').click();
    await expect(page.getByTestId('zen-pill')).toHaveCount(0);
    for (const [name, l] of Object.entries(chrome)) await expect(l, name + ' is back after Exit').toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+z');
    await expect(page.getByTestId('zen-pill'), 'Alt+Z turns zen on').toBeVisible();
    await expect(chrome.outline).toHaveCount(0);
    await page.keyboard.press('Alt+z');
    await expect(page.getByTestId('zen-pill'), 'Alt+Z turns zen off').toHaveCount(0);
    await expect(chrome.outline).toBeVisible();
    expect((await app.state()).session.zenMode).toBe(false);
  });

  await test.step('View › View mode makes the canvas read-only', async () => {
    await app.fit();
    await app.menu('menu-view', 'view-readonly');
    await expect(page.getByTestId('view-pill')).toContainText('read-only');
    await expect(page.getByTestId('toast')).toContainText('View mode');
    await expect(chrome.toolbar, 'no editing tools while presenting').toHaveCount(0);
    await expect(chrome.inspector, 'no inspector while presenting').toHaveCount(0);
    await ev.snap('view-mode');
  });

  await test.step('nothing can be changed in view mode', async () => {
    const before = await app.doc();
    await app.topic('Misses').dblclick();
    await expect(app.editor(), 'double-click does not open the editor').toHaveCount(0);
    await app.topic('Wins').click();
    await expect.poll(async () => (await app.selection()).nodes, 'topics can still be selected').toEqual(['qr-wins']);
    for (const key of ['Tab', 'Enter', 'Delete', 'Backspace', 'n', 'p', 'F2', 'Meta+d', 'Meta+z']) await page.keyboard.press(key);
    await expect(app.editor()).toHaveCount(0);
    expect((await app.state()).session.mode, 'P does not switch to the pen').toBe('select');
    const misses = await app.box(app.topic('Misses'));
    await app.drag({ x: misses.x + misses.width / 2, y: misses.y + misses.height / 2 }, { x: misses.x + misses.width / 2 + 160, y: misses.y + misses.height / 2 + 90 });
    const after = await app.box(app.topic('Misses'));
    expect({ x: after.x, y: after.y }, 'dragging does not move the topic').toEqual({ x: misses.x, y: misses.y });
    const spot = await app.emptyPoint({ x: 0.5, y: 0.85 });
    await page.mouse.dblclick(spot.x, spot.y);
    await page.waitForTimeout(400);
    await app.settled();
    const now = await app.doc();
    expect(now.nodes, 'no topic was added, removed, renamed or moved').toEqual(before.nodes);
    expect(now.edges).toEqual(before.edges);
    for (const t of ['Q3 review', 'Wins', 'Misses', 'Next quarter', 'Shipped v2', 'Customer NPS']) await expect(app.topic(t)).toHaveCount(1);
    await ev.snap('view-mode-after-edit-attempts');
  });

  await test.step('navigating still works in view mode', async () => {
    await app.topic('Wins').click();
    await expect.poll(async () => (await app.selection()).nodes).toEqual(['qr-wins']);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await app.selection()).nodes, 'arrow keys move the selection to the next topic').toEqual([(await app.nodeNamed('Shipped v2')).id]);
    const z0 = await app.zoomPct();
    await page.getByTestId('zoom-in').click();
    await expect.poll(() => app.zoomPct(), 'zoom in still works').toBeGreaterThan(z0);
    await app.fit();
    for (const t of ['Q3 review', 'Customer NPS']) expect(await app.inView(app.topic(t)), t + ' is in view after Fit').toBe(true);
    await ev.snap('view-mode-navigated');
  });

  await test.step('Edit and Alt+R leave and re-enter view mode', async () => {
    await page.getByTestId('exit-view').click();
    await expect(page.getByTestId('view-pill')).toHaveCount(0);
    await expect(chrome.toolbar).toBeVisible();
    await expect(chrome.inspector).toBeVisible();
    await app.topic('Misses').click();
    await page.keyboard.press('F2');
    await page.keyboard.press('ControlOrMeta+a');
    await app.type('Misses & lessons');
    await expect(app.topic('Misses & lessons'), 'editing works again').toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+r');
    await expect(page.getByTestId('view-pill'), 'Alt+R turns view mode on').toBeVisible();
    await expect(chrome.toolbar).toHaveCount(0);
    await page.keyboard.press('Alt+r');
    await expect(page.getByTestId('view-pill'), 'Alt+R turns it off').toHaveCount(0);
    await expect(chrome.toolbar).toBeVisible();
    await ev.snap('editing-again');
  });
});
