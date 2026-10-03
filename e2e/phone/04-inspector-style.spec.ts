import { test, expect } from '../support/journey';

test('style a topic in the inspector', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person adds a topic with the toolbar and a tap, taps Style in the selection bar to open the inspector drawer, and with taps and the on-screen keyboard gives the topic a subtitle, badge, emoji icon, colour, diamond and cylinder shapes, a status, a priority, tags, notes and a link. Each change is rendered on the canvas node and saved; it survives a reload. Ergonomics are checked throughout; the inspector behaves as a drawer.');
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
  const fill = async (testId: string, value: string) => {
    const f = page.getByTestId(testId);
    await f.tap();
    await f.fill(value);
    await f.press(testId === 'insp-notes' ? 'Tab' : 'Enter');
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
    await phone.tap(page.getByTestId('shape-diamond'));
    await expect(node).toHaveClass(/shape-diamond/);
    await expect(node.locator('svg.wfc-shape-svg polygon')).toHaveAttribute('points', '50,1 99,50 50,99 1,50');
    await expect(node.locator('.wfc-inline-icon'), 'non-card shapes show the icon inline').toHaveText('💳');
    await phone.tap(page.getByTestId('shape-cylinder'));
    await expect(node).toHaveClass(/shape-cylinder/);
    await expect(node.locator('svg.wfc-shape-svg path')).toHaveCount(2);
    await phone.tap(page.getByTestId('shape-card'));
    await expect(node).toHaveClass(/shape-card/);
  });

  await test.step('status, priority, tags, notes and link', async () => {
    await phone.tap(page.getByTestId('status-doing'));
    await expect(node.locator('.wfc-marker.st-doing')).toHaveText('◐');
    await phone.tap(insp.getByRole('button', { name: 'P2', exact: true }));
    await expect(node.locator('.wfc-marker.prio')).toHaveText('2');
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

