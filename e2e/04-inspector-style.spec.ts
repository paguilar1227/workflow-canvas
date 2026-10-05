import { test, expect } from './support/journey';
import { NODE_SHAPES } from '../src/shared/types';

test('style a topic in the inspector', async ({ page, app, ev }) => {
  ev.proves('A user selects a topic and, from the inspector, gives it a subtitle, badge, emoji icon, colour, diamond and cylinder shapes, a status, a priority, tags, notes and a link; shape, status and priority are compact pickers that open their choices, close on a pick (or on a click outside, changing nothing) and show the same icon as the canvas marker. Each change is rendered on the canvas node (text, markers, tag chips, indicators, shape outline) and saved to the document.');
  const docId = await app.newDoc('Styled topic');
  await app.open(docId);
  await page.keyboard.press('n');
  await expect(page.getByTestId('place-pill'), 'N arms the placement cursor').toBeVisible();
  await page.keyboard.press('Enter');
  await app.type('Payments API');
  const id = (await app.selection()).nodes[0];
  const node = app.node(id);
  const insp = page.getByTestId('inspector-node');
  await expect(insp).toBeVisible();
  await expect(page.getByTestId('insp-title')).toHaveValue('Payments API');
  const fill = async (testId: string, value: string) => {
    const f = page.getByTestId(testId);
    await f.click();
    await f.fill(value);
    await f.press(testId === 'insp-notes' ? 'Tab' : 'Enter');
    await app.settled();
  };
  /** Open a compact picker, choose one option, and check the choices close again. */
  const pick = async (picker: string, option: string, snapLabel?: string) => {
    await page.getByTestId(picker).click();
    const options = page.getByTestId(picker + '-options');
    await expect(options, picker + ' opens its choices').toBeVisible();
    if (snapLabel) await ev.snap(snapLabel);
    await page.getByTestId(option).click();
    await expect(options, 'picking closes the ' + picker).toHaveCount(0);
    await app.settled();
  };

  await test.step('subtitle, badge and emoji icon', async () => {
    await fill('insp-subtitle', 'POST /v1/charges');
    await fill('insp-badge', 'Proposed');
    await fill('insp-icon', '💳');
    await expect(node.locator('.wfc-sub')).toHaveText('POST /v1/charges');
    await expect(node.locator('.wfc-badge')).toHaveText('Proposed');
    await expect(node.locator('.wfc-icon')).toHaveText('💳');
    await ev.snap('subtitle-badge-icon', { target: page.locator('.react-flow') });
  });

  await test.step('colour', async () => {
    await page.getByTestId('color-blue').click();
    await expect(node).toHaveClass(/has-color/);
    await expect(page.getByTestId('color-blue')).toHaveClass(/on/);
    const accent = await node.evaluate((el) => getComputedStyle(el).getPropertyValue('--nc').trim());
    expect(accent.toLowerCase(), 'node accent is the theme blue').toBe((await app.cssVar('--c-blue')).toLowerCase());
  });

  await test.step('diamond and cylinder shapes', async () => {
    await expect(page.getByTestId('shape-diamond'), 'shapes are behind the picker, not a row of buttons').toHaveCount(0);
    await expect(page.getByTestId('shape-picker')).toContainText('Card');
    await page.getByTestId('shape-picker').click();
    const tiles = page.getByTestId('shape-picker-options').getByRole('option');
    await expect(tiles, 'the shape picker is a grid of ' + NODE_SHAPES.length + ' shape tiles').toHaveCount(NODE_SHAPES.length);
    expect(await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))), 'one tile per shape, in order (Data\'s parallelogram last)').toEqual(NODE_SHAPES.map((s) => 'shape-' + s));
    await expect(page.getByTestId('shape-card'), 'the current shape is marked').toHaveAttribute('aria-selected', 'true');
    const cols = await tiles.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().x))).size);
    const rows = await tiles.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
    expect({ cols, rows }, 'shape tiles are laid out four to a row').toEqual({ cols: 4, rows: Math.ceil(NODE_SHAPES.length / 4) });
    await ev.snap('shape-picker-open');
    await page.getByTestId('shape-diamond').click();
    await expect(page.getByTestId('shape-picker-options'), 'picking a shape closes the picker').toHaveCount(0);
    await expect(node).toHaveClass(/shape-diamond/);
    await expect(page.getByTestId('shape-picker')).toContainText('Diamond');
    await expect(node.locator('svg.wfc-shape-svg polygon')).toHaveAttribute('points', '50,1 99,50 50,99 1,50');
    await expect(node.locator('.wfc-inline-icon'), 'non-card shapes show the icon inline').toHaveText('💳');
    await ev.snap('diamond');
    await pick('shape-picker', 'shape-cylinder');
    await expect(node).toHaveClass(/shape-cylinder/);
    await expect(node.locator('svg.wfc-shape-svg path')).toHaveCount(2);
    await ev.snap('cylinder');
    await pick('shape-picker', 'shape-card');
    await expect(node).toHaveClass(/shape-card/);
  });

  await test.step('status, priority, tags, notes and link', async () => {
    await pick('status-picker', 'status-doing', 'status-picker-open');
    await expect(node.locator('.wfc-marker.st-doing')).toHaveText('◐');
    await expect(page.getByTestId('status-picker').locator('.wfc-marker.st-doing'), 'the status picker shows the canvas marker').toHaveText('◐');
    await pick('priority-picker', 'priority-2');
    await expect(node.locator('.wfc-marker.prio')).toHaveText('2');
    await expect(page.getByTestId('priority-picker').locator('.wfc-marker.prio'), 'the priority picker shows the canvas marker').toHaveText('2');
    await expect(page.getByTestId('priority-picker')).toContainText('P2');
    await page.getByTestId('priority-picker').click();
    await expect(page.getByTestId('priority-picker-options')).toBeVisible();
    await page.getByTestId('picker-backdrop').click({ position: { x: 500, y: 450 } });
    await expect(page.getByTestId('priority-picker-options'), 'a click outside closes the picker').toHaveCount(0);
    await expect(page.getByTestId('priority-picker'), 'closing without a pick changes nothing').toContainText('P2');
    await fill('insp-tags', 'billing, core');
    await expect(node.locator('.wfc-tag')).toHaveText(['#billing', '#core']);
    await fill('insp-notes', 'Idempotency keys are required on every charge.');
    await expect(node.locator('.wfc-indicators [title="Has notes"]')).toBeVisible();
    await fill('insp-link', 'https://example.com/payments');
    await expect(node.locator('.wfc-indicators a')).toHaveAttribute('href', 'https://example.com/payments');
    await expect(insp.getByRole('link', { name: 'Open link' })).toHaveAttribute('href', 'https://example.com/payments');
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
    await ev.snap('after-reload');
  });
});
