import { test, expect } from './support/journey';

test('build a mind map from the keyboard', async ({ page, app, ev }) => {
  ev.proves('A keyboard-only user creates a root topic (N arms placement, Enter drops it at the view centre), children (Tab) and siblings (Enter) while typing titles, renames with F2, collapses and expands a branch with "/", deletes a topic, and switches the structure to a logic chart and an org chart from the Layout menu.');
  const docId = await app.newDoc('Keyboard mind map');
  await app.open(docId);
  await ev.snap('empty-canvas');
  let rootId = '';

  await test.step('N then Enter creates a topic and typing names it', async () => {
    await page.keyboard.press('n');
    await expect(page.getByTestId('place-pill'), 'N arms the placement cursor').toBeVisible();
    await page.keyboard.press('Enter');
    await app.type('Trip to Japan');
    rootId = (await app.selection()).nodes[0];
    await expect(app.node(rootId)).toBeVisible();
    await expect.soft(app.node(rootId).locator('.wfc-title'), 'the typed title replaces the placeholder exactly').toHaveText('Trip to Japan');
  });

  await test.step('Tab adds a child, Enter adds a sibling', async () => {
    await page.keyboard.press('Tab');
    await app.type('Flights');
    await page.keyboard.press('Enter');
    await app.type('Hotels');
    await page.keyboard.press('Enter');
    await app.type('Food');
    await page.keyboard.press('Tab');
    await app.type('Ramen');
    await page.keyboard.press('Enter');
    await app.type('Sushi');
    for (const t of ['Flights', 'Hotels', 'Food', 'Ramen', 'Sushi']) await expect(app.topic(t)).toBeVisible();
    const d = await app.doc();
    const by = (t: string) => d.nodes.find((n) => n.title === t)!;
    for (const t of ['Flights', 'Hotels', 'Food']) expect(by(t).parentId, t + ' is a child of the root').toBe(rootId);
    for (const t of ['Ramen', 'Sushi']) expect(by(t).parentId, t + ' is a child of Food').toBe(by('Food').id);
    await expect(page.locator('.wfc-branch'), 'one branch line per child topic').toHaveCount(5);
    await app.fit();
    await ev.snap('mind-map-typed-from-keyboard');
  });

  await test.step('F2 renames the selected topic', async () => {
    const food = await app.nodeNamed('Food');
    await app.topic('Food').click();
    await expect.poll(async () => (await app.selection()).nodes).toEqual([food.id]);
    await page.keyboard.press('F2');
    await app.type('Food & drink');
    await expect(app.topic('Food & drink')).toBeVisible();
    await expect(app.topic('Food')).toHaveCount(0);
    await ev.snap('renamed-with-f2');
  });

  await test.step('"/" collapses and expands the branch', async () => {
    await page.keyboard.press('/');
    await expect(app.topic('Ramen')).toHaveCount(0);
    await expect(app.topic('Sushi')).toHaveCount(0);
    await expect(app.topic('Food & drink').locator('.wfc-collapse'), 'collapsed badge shows hidden child count').toHaveText('+2');
    await ev.snap('branch-collapsed');
    await page.keyboard.press('/');
    await expect(app.topic('Ramen')).toBeVisible();
    await expect(app.topic('Sushi')).toBeVisible();
    await expect(app.topic('Food & drink').locator('.wfc-collapse')).toHaveText('−');
  });

  await test.step('Delete removes a topic and selects its parent', async () => {
    const parent = await app.nodeNamed('Food & drink');
    await app.topic('Sushi').click();
    await page.keyboard.press('Delete');
    await expect(app.topic('Sushi')).toHaveCount(0);
    await expect.poll(async () => (await app.selection()).nodes).toEqual([parent.id]);
    await ev.snap('topic-deleted');
  });

  await test.step('Layout menu switches to a logic chart and an org chart', async () => {
    await page.keyboard.press('Escape');
    const kids = ['Flights', 'Hotels', 'Food & drink', 'Ramen'];
    await app.menu('menu-layout', 'layout-right');
    await page.waitForTimeout(800);
    expect((await app.doc()).settings.treeLayout).toBe('right');
    let root = await app.box(app.node(rootId));
    for (const t of kids) expect((await app.box(app.topic(t))).x, t + ' sits right of the root').toBeGreaterThan(root.x + root.width - 1);
    await ev.snap('logic-chart');

    await app.menu('menu-layout', 'layout-down');
    await page.waitForTimeout(800);
    expect((await app.doc()).settings.treeLayout).toBe('down');
    root = await app.box(app.node(rootId));
    for (const t of kids) expect((await app.box(app.topic(t))).y, t + ' sits below the root').toBeGreaterThan(root.y + root.height - 1);
    await ev.snap('org-chart');
  });
});
