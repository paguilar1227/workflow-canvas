import { test, expect } from '../support/journey';
import { MIN_TARGET } from '../support/phone';

test('build a mind map from the keyboard', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: with the on-screen keyboard instead of shortcuts, a person taps Topic and then the canvas to drop the root, names topics as they are created, adds children and siblings from the selection bar (instead of Tab/Enter), renames with Edit (instead of F2), collapses and expands a branch from the long-press sheet on the still-selected, zoomed-out topic (instead of "/"; P1), clears the selection by tapping empty canvas (P2), deletes with the selection bar, and switches to a logic chart and an org chart from the More sheet. Ergonomics are measured on every screen; the outline drawer opens, expands, and closes from × and the backdrop.');
  const docId = await app.newDoc('Keyboard mind map');
  await app.open(docId);
  await phone.ergonomics('empty canvas');
  await ev.snap('empty-canvas');
  let rootId = '';

  await test.step('tap Topic, tap the canvas, and type the name', async () => {
    const pane = await app.paneBox();
    await phone.place('add-topic', { x: pane.x + pane.width / 2, y: pane.y + pane.height * 0.35 });
    await app.type('Trip to Japan');
    rootId = (await app.selection()).nodes[0];
    await expect(app.node(rootId)).toBeVisible();
    await expect.soft(app.node(rootId).locator('.wfc-title')).toHaveText('Trip to Japan');
    await phone.ergonomics('topic selected');
  });

  await test.step('Child and Sibling in the selection bar add topics', async () => {
    await phone.sel('sel-child');
    await app.type('Flights');
    await phone.sel('sel-sibling');
    await app.type('Hotels');
    await phone.sel('sel-sibling');
    await app.type('Food');
    await phone.sel('sel-child');
    await app.type('Ramen');
    await phone.sel('sel-sibling');
    await app.type('Sushi');
    const d = await app.doc();
    const by = (t: string) => d.nodes.find((n) => n.title === t)!;
    for (const t of ['Flights', 'Hotels', 'Food']) expect(by(t)?.parentId, t + ' is a child of the root').toBe(rootId);
    for (const t of ['Ramen', 'Sushi']) expect(by(t)?.parentId, t + ' is a child of Food').toBe(by('Food').id);
    await expect(page.locator('.wfc-branch'), 'one branch line per child topic').toHaveCount(5);
    await phone.fit();
    for (const t of ['Flights', 'Hotels', 'Food', 'Ramen', 'Sushi']) await expect(app.topic(t)).toBeVisible();
    await phone.ergonomics('mind map');
    await ev.snap('mind-map-typed-on-the-phone');
  });

  await test.step('Edit in the selection bar renames the selected topic', async () => {
    const food = await app.nodeNamed('Food');
    await phone.selectTopic('Food');
    await expect.poll(async () => (await app.selection()).nodes).toEqual([food.id]);
    await phone.sel('sel-edit');
    await page.keyboard.press('ControlOrMeta+a');
    await app.type('Food & drink');
    await expect(app.topic('Food & drink')).toBeVisible();
    await expect(app.topic('Food')).toHaveCount(0);
    await ev.snap('renamed-with-edit');
  });

  await test.step('long-press on the selected topic opens its sheet even zoomed out (P1); the sheet collapses and expands the branch', async () => {
    const food = await app.nodeNamed('Food & drink');
    expect((await app.selection()).nodes, 'Food & drink is still selected after the rename').toEqual([food.id]);
    await phone.fit();
    const h = (await app.box(app.topic('Food & drink'))).height;
    expect(h, 'at fit zoom the selected topic is shorter than a touch target, where its connection handles used to swallow the long-press').toBeLessThan(MIN_TARGET);
    let sheet = await phone.contextSheet(await app.center(app.topic('Food & drink')));
    await expect(sheet, 'the sheet is for the selected topic').toContainText('Collapse branch');
    await phone.ergonomics('context sheet');
    await ev.snap('long-press-sheet');
    await phone.tap(sheet.getByRole('button', { name: 'Collapse branch' }));
    await expect(app.topic('Ramen')).toHaveCount(0);
    await expect(app.topic('Sushi')).toHaveCount(0);
    await expect(app.topic('Food & drink').locator('.wfc-collapse')).toHaveText('+2');
    await ev.snap('branch-collapsed');
    sheet = await phone.contextSheet(await app.center(app.topic('Food & drink')));
    await phone.tap(sheet.getByRole('button', { name: 'Expand branch' }));
    await expect(app.topic('Ramen')).toBeVisible();
    await expect(app.topic('Sushi')).toBeVisible();
  });

  await test.step('a tap on empty canvas clears the selection (P2)', async () => {
    await phone.selectTopic('Hotels');
    expect((await app.selection()).nodes).toHaveLength(1);
    await phone.tap(await app.emptyPoint());
    await expect.poll(async () => (await app.selection()).nodes, 'a touch tap on empty canvas deselects, like a mouse click').toEqual([]);
    await expect(page.getByTestId('selection-bar'), 'and the selection bar goes away').toBeHidden();
    await ev.snap('tap-canvas-deselects');
  });

  await test.step('Delete in the selection bar removes a topic and selects its parent', async () => {
    const parent = await app.nodeNamed('Food & drink');
    await phone.selectTopic('Sushi');
    await phone.sel('sel-delete');
    await expect(app.topic('Sushi')).toHaveCount(0);
    await expect.poll(async () => (await app.selection()).nodes).toEqual([parent.id]);
    await ev.snap('topic-deleted');
  });

  await test.step('the More sheet switches to a logic chart and an org chart', async () => {
    const kids = ['Flights', 'Hotels', 'Food & drink', 'Ramen'];
    await phone.more('layout-right');
    await page.waitForTimeout(800);
    expect((await app.doc()).settings.treeLayout).toBe('right');
    await phone.fit();
    let root = await app.box(app.node(rootId));
    for (const t of kids) expect((await app.box(app.topic(t))).x, t + ' sits right of the root').toBeGreaterThan(root.x + root.width - 1);
    await ev.snap('logic-chart');
    await phone.more('layout-down');
    await page.waitForTimeout(800);
    expect((await app.doc()).settings.treeLayout).toBe('down');
    await phone.fit();
    root = await app.box(app.node(rootId));
    for (const t of kids) expect((await app.box(app.topic(t))).y, t + ' sits below the root').toBeGreaterThan(root.y + root.height - 1);
    await phone.ergonomics('org chart');
    await ev.snap('org-chart');
  });

  await test.step('the outline drawer lists the map and behaves like a drawer', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });
});
