import { test, expect } from '../support/journey';

test('style a topic in the inspector', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person adds a topic with the toolbar and a tap, taps Style in the selection bar to open the inspector drawer, and with taps and the on-screen keyboard gives the topic a subtitle, badge, emoji icon, colour, diamond and cylinder shapes, a status, a priority, tags, notes and a link. Shape, status and priority open as bottom sheets over a dim backdrop, with 44px option rows and 64px shape tiles; a tap on the backdrop closes a sheet without changing anything. Each change is rendered on the canvas node and saved; it survives a reload. Ergonomics are checked throughout; the inspector behaves as a drawer.');
  const docId = await app.newDoc('Styled topic');
  await app.open(docId);
  await phone.place('add-topic', await app.emptyPoint());
  await app.type('Payments API');
  const id = (await app.selection()).nodes[0];
  const node = app.node(id);
  await phone.ergonomics('new topic selected');
  await phone.sel('sel-style');
  await expect(phone.slot('inspector'), 'Style opens the inspector drawer').toHaveClass(/shown/);
  const insp = page.getByTestId('inspector-node');
  await expect(insp).toBeVisible();
  await expect(page.getByTestId('insp-title')).toHaveValue('Payments API');
  await phone.ergonomics('inspector drawer');
  const pickersFit = async (where: string) => {
    const fit = await page.evaluate(() => {
      const drawer = document.querySelector('.column-slot.right')!.getBoundingClientRect();
      const out = ['shape-picker', 'status-picker', 'priority-picker'].flatMap((id) => {
        const r = document.querySelector('[data-testid=' + id + ']')!.getBoundingClientRect();
        return r.left < drawer.left - 0.5 || r.right > drawer.right + 0.5 ? [id + ' ' + Math.round(r.left) + '-' + Math.round(r.right)] : [];
      });
      const sideways = [...document.querySelectorAll('[data-testid=inspector] *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)).map((e) => e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
      return { drawer: Math.round(drawer.left) + '-' + Math.round(drawer.right), out, sideways };
    });
    expect(fit.out, where + ': shape, status and priority pickers fit inside the drawer ' + fit.drawer + ' (BUG-P14)').toEqual([]);
    expect(fit.sideways, where + ': the inspector does not scroll sideways (BUG-P14)').toEqual([]);
  };
  await pickersFit('new topic');
  const fill = async (testId: string, value: string) => {
    const f = page.getByTestId(testId);
    await f.tap();
    await f.fill(value);
    await f.press(testId === 'insp-notes' ? 'Tab' : 'Enter');
    await app.settled();
  };
  const sheet = page.locator('.picker-pop.sheet');
  /** Tap a picker, check its choices come up as a bottom sheet with finger-sized options, tap one, and check the sheet goes away. */
  const pick = async (picker: string, option: string, minOptionHeight: number, label?: string) => {
    await phone.tap(page.getByTestId(picker));
    await expect(sheet, picker + ' opens as a bottom sheet').toBeVisible();
    await expect(page.getByTestId('picker-backdrop'), 'the sheet dims the page behind it').toHaveClass(/dim/);
    const vp = page.viewportSize()!;
    const box = await app.box(sheet);
    expect(box.y + box.height, 'the sheet sits at the bottom of the screen').toBeGreaterThan(vp.height - 16);
    expect(box.width, 'the sheet spans the screen').toBeGreaterThan(vp.width - 24);
    const heights = await sheet.getByRole('option').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(heights.every((h) => h >= minOptionHeight), picker + ' options are at least ' + minOptionHeight + 'px high (' + heights.join(',') + ')').toBe(true);
    if (label) {
      await phone.ergonomics(label);
      await ev.snap(label);
    }
    await phone.tap(page.getByTestId(option));
    await expect(sheet, 'picking closes the sheet').toHaveCount(0);
    await app.settled();
  };

  await test.step('subtitle, badge and emoji icon', async () => {
    await fill('insp-subtitle', 'POST /v1/charges');
    await fill('insp-badge', 'Proposed');
    await fill('insp-icon', '💳');
    await expect(node.locator('.wfc-sub')).toHaveText('POST /v1/charges');
    await expect(node.locator('.wfc-badge')).toHaveText('Proposed');
    await expect(node.locator('.wfc-icon')).toHaveText('💳');
    await ev.snap('subtitle-badge-icon');
  });

  await test.step('colour', async () => {
    await phone.tap(page.getByTestId('color-blue'));
    await expect(node).toHaveClass(/has-color/);
    await expect(page.getByTestId('color-blue')).toHaveClass(/on/);
    const accent = await node.evaluate((el) => getComputedStyle(el).getPropertyValue('--nc').trim());
    expect(accent.toLowerCase(), 'node accent is the theme blue').toBe((await app.cssVar('--c-blue')).toLowerCase());
  });

  await test.step('diamond and cylinder shapes', async () => {
    await expect(page.getByTestId('shape-diamond'), 'shapes are behind the picker, not a row of buttons').toHaveCount(0);
    await pick('shape-picker', 'shape-diamond', 64, 'shape sheet');
    await expect(page.getByTestId('shape-picker')).toContainText('Diamond');
    await expect(node).toHaveClass(/shape-diamond/);
    await expect(node.locator('svg.wfc-shape-svg polygon')).toHaveAttribute('points', '50,1 99,50 50,99 1,50');
    await expect(node.locator('.wfc-inline-icon'), 'non-card shapes show the icon inline').toHaveText('💳');
    await pick('shape-picker', 'shape-cylinder', 64);
    await expect(node).toHaveClass(/shape-cylinder/);
    await expect(node.locator('svg.wfc-shape-svg path')).toHaveCount(2);
    await pick('shape-picker', 'shape-card', 64);
    await expect(node).toHaveClass(/shape-card/);
  });

  await test.step('status, priority, tags, notes and link', async () => {
    await pick('status-picker', 'status-doing', 44, 'status sheet');
    await expect(node.locator('.wfc-marker.st-doing')).toHaveText('◐');
    await expect(page.getByTestId('status-picker').locator('.wfc-marker.st-doing'), 'the status picker shows the canvas marker').toHaveText('◐');
    await pick('priority-picker', 'priority-2', 44, 'priority sheet');
    await expect(node.locator('.wfc-marker.prio')).toHaveText('2');
    await expect(page.getByTestId('priority-picker')).toContainText('P2');
    await phone.tap(page.getByTestId('priority-picker'));
    await expect(sheet).toBeVisible();
    await phone.tap({ x: page.viewportSize()!.width / 2, y: 60 });
    await expect(sheet, 'a tap on the dim backdrop closes the sheet').toHaveCount(0);
    await expect(page.getByTestId('priority-picker'), 'closing without a pick changes nothing').toContainText('P2');
    await fill('insp-tags', 'billing, core');
    await expect(node.locator('.wfc-tag')).toHaveText(['#billing', '#core']);
    await fill('insp-notes', 'Idempotency keys are required on every charge.');
    await expect(node.locator('.wfc-indicators [title="Has notes"]')).toBeVisible();
    await fill('insp-link', 'https://example.com/payments');
    await expect(node.locator('.wfc-indicators a')).toHaveAttribute('href', 'https://example.com/payments');
    await expect(insp.getByRole('link', { name: 'Open link' })).toHaveAttribute('href', 'https://example.com/payments');
    await phone.ergonomics('inspector drawer filled in');
    await ev.snap('inspector-filled-in');
    await phone.closeDrawer('inspector');
    await phone.fit();
    await ev.snap('fully-styled-topic');
    await ev.snap('fully-styled-topic-closeup', { target: node });
  });

  await test.step('everything is saved and survives a reload', async () => {
    const expected = { title: 'Payments API', subtitle: 'POST /v1/charges', badge: 'Proposed', icon: '💳', color: 'blue', shape: 'card', status: 'doing', priority: 2, tags: ['billing', 'core'], notes: 'Idempotency keys are required on every charge.', link: 'https://example.com/payments' };
    expect((await app.doc()).nodes.find((n) => n.id === id)).toMatchObject(expected);
    await page.reload();
    await app.waitForDoc(docId);
    await expect(node.locator('.wfc-badge')).toHaveText('Proposed');
    await expect(node.locator('.wfc-marker.st-doing')).toBeVisible();
    await expect(node.locator('.wfc-tag')).toHaveText(['#billing', '#core']);
    expect((await app.doc()).nodes.find((n) => n.id === id)).toMatchObject(expected);
    await phone.ergonomics('after reload');
    await ev.snap('after-reload');
  });

  await test.step('the inspector behaves like a drawer', async () => {
    await phone.selectTopic('Payments API');
    await phone.checkDrawer('inspector', () => phone.sel('sel-style'));
  });
});
