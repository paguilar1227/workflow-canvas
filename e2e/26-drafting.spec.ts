import { test, expect } from './support/journey';
import { draftingJourney } from './support/drafting';

test('drafting theme and connector controls', async ({ app, ev }) => {
  await draftingJourney(app, ev);
});

test('resize panels and open full node details', async ({ page, app, ev }) => {
  const id = await app.newDoc('Resizable drafting panels');
  await app.tool('add_nodes', { documentId: id, nodes: [{ id: 'details', title: 'Draft step', subtitle: 'Long details are available without widening the card', x: 0, y: 0 }] });
  await app.open(id);
  const panel = page.getByTestId('left-panel');
  const before = (await app.box(panel)).width;
  const resize = page.getByTestId('resize-left-panel');
  await resize.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await app.box(panel)).width).toBeGreaterThan(before);
  const wider = (await app.box(panel)).width;
  await page.reload();
  await app.waitForDoc(id);
  await expect.poll(async () => (await app.box(panel)).width).toBe(wider);
  await app.fit();
  await app.node('details').getByRole('button', { name: 'View node details' }).click();
  await expect(page.getByTestId('node-popover')).toBeVisible();
  await expect(page.getByTestId('node-popover').getByTestId('insp-subtitle')).toHaveValue('Long details are available without widening the card');
  const lock = page.getByTestId('node-popover').getByRole('checkbox', { name: 'Toggle lock' });
  await page.getByTestId('node-popover').getByText('Locked', { exact: true }).click();
  await expect(lock).toBeChecked();
  await lock.focus();
  await page.keyboard.press('Space');
  await expect(lock).not.toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByTestId('resize-left-panel').dblclick();
  await expect.poll(async () => (await app.box(panel)).width).toBe(before);
  await ev.snap('resizable-panels-and-node-details');
});

test('automatic labels avoid cards and each other after reload', async ({ page, app, ev }) => {
  const id = await app.newDoc('Crowded drafting labels');
  await app.tool('add_nodes', { documentId: id, nodes: [
    { id: 'left', title: 'Producer', x: 0, y: 0, width: 190, height: 80 },
    { id: 'right', title: 'Consumer', x: 440, y: 0, width: 190, height: 80 },
    { id: 'block', title: 'Protected card', x: 260, y: -10, width: 150, height: 100 },
  ] });
  await app.tool('add_edges', { documentId: id, edges: [
    { id: 'a', source: 'left', target: 'right', label: 'A long automatic annotation' },
    { id: 'b', source: 'left', target: 'right', label: 'Another automatic annotation' },
    { id: 'c', source: 'right', target: 'left', label: 'Return annotation' },
  ] });
  await app.open(id);
  const overlapCount = () => page.evaluate(() => {
    const labels = [...document.querySelectorAll('.wfc-edge-label')].map((el) => el.getBoundingClientRect());
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((el) => el.getBoundingClientRect());
    const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    return labels.reduce((count, label, i) => count + nodes.filter((node) => overlap(label, node)).length + labels.slice(i + 1).filter((other) => overlap(label, other)).length, 0);
  });
  await expect(page.locator('.wfc-edge-label')).toHaveCount(3);
  await expect.poll(overlapCount).toBe(0);
  await page.reload();
  await app.waitForDoc(id);
  await expect.poll(overlapCount).toBe(0);
  await app.fit();
  await ev.snap('crowded-labels-after-reload');
});
