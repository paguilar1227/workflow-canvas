import { test, expect, type Box } from './support/journey';

test('quick-edit a node in a popover beside it', async ({ page, app, ev }) => {
  ev.proves('A person double-clicks a topic with the mouse and its inspector opens in a popover right beside it (to the right, or to the left when the topic is near the right edge of the canvas), with the title field focused and no inline editor. Edits made there (title, colour, shape and status) show on the canvas and in the inspector column at once, and a picker opened in the popover is the only one that opens. The popover follows the topic when it is dragged, when the canvas pans and when it zooms. Header menus open above it, an AI screenshot leaves it open with the person\'s unsaved typing, and in a narrow 1000px window its close button is not covered by the emoji button and the selection bar steps aside. Esc (which first closes just an open picker), the close button, a click on empty canvas, selecting another node and F2 inline editing each close it; Esc keeps the topic selected; a double-click on a node\'s collapse button does not open it. A sticky note opens the same way with its Markdown in the title box. An AI agent opens the same popover with set_ui quickEditNodeId and closes it with an empty id.');
  const docId = await app.newDoc('Quick edit');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'pay', title: 'Payments API', x: 0, y: 0 },
    { id: 'ledger', title: 'Ledger', x: 0, y: 260 },
    { id: 'kid', title: 'Entries', parentId: 'ledger' },
    { id: 'far', title: 'Far right', x: 1500, y: 120 },
    { id: 'note', kind: 'sticky', title: '## Launch notes\n- **Owner**: Pablo', x: 600, y: 300 },
  ] });
  await app.open(docId);
  await app.fit();
  const pop = page.getByTestId('node-popover');
  const title = pop.getByTestId('insp-title');
  const node = app.node('pay');
  /** Where the popover sits against the node: which side, the horizontal gap, and whether they overlap vertically. */
  const placement = async (id: string) => {
    const n: Box = await app.box(app.rfNode(id));
    const p: Box = await app.box(pop);
    const right = Math.round(p.x - (n.x + n.width));
    const left = Math.round(n.x - (p.x + p.width));
    const gap = right >= 0 ? right : left;
    const toolbar = await app.box(page.locator('.toolbar'));
    expect(p.y + p.height, 'the popover stays above the bottom toolbar').toBeLessThanOrEqual(toolbar.y);
    const lift = await page.getByTestId('canvas').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--dock-lift')));
    const canvas = await app.box(page.locator('.react-flow'));
    const level = Math.abs(p.y - n.y) <= 1;
    const liftedToFit = Math.abs(p.y + p.height - (canvas.y + canvas.height - lift - 8)) <= 1 && p.y < n.y + n.height && p.y + p.height > n.y;
    return { side: await pop.getAttribute('data-side'), gap12: Math.abs(gap - 12) <= 1 ? 12 : gap, levelWithNode: level || liftedToFit };
  };
  const opened = async (id: string) => {
    await app.node(id).dblclick();
    await expect(pop, 'double-click opens the quick-edit popover').toBeVisible();
    await expect(pop).toHaveAttribute('data-node-id', id);
  };

  await test.step('double-click opens the inspector beside the topic, title focused, no inline editor', async () => {
    await opened('pay');
    await expect(app.editor(), 'the inline editor does not open').toHaveCount(0);
    await expect(title, 'the title field is focused to type straight away').toBeFocused();
    await expect(title).toHaveValue('Payments API');
    await expect.poll(() => placement('pay'), 'popover sits 12px to the right of the topic, level with it').toEqual({ side: 'right', gap12: 12, levelWithNode: true });
    await expect(pop.getByTestId('shape-picker'), 'it has the inspector fields').toBeVisible();
    await ev.snap('popover-beside-topic');
  });

  await test.step('edits in the popover show on the canvas and in the inspector column', async () => {
    await title.press('End');
    await page.keyboard.type(' v2');
    await title.press('Enter');
    await app.settled();
    await expect(node).toHaveAttribute('data-title', 'Payments API v2');
    await pop.getByTestId('color-blue').click();
    await app.settled();
    await expect(node).toHaveClass(/has-color/);
    await pop.getByTestId('shape-picker').click();
    await expect(page.getByTestId('shape-picker-options'), 'only the popover\'s shape picker opens').toHaveCount(1);
    await ev.snap('popover-shape-picker');
    await page.getByTestId('shape-diamond').click();
    await app.settled();
    await expect(node).toHaveClass(/shape-diamond/);
    await pop.getByTestId('status-picker').click();
    await page.getByTestId('status-done').click();
    await app.settled();
    expect((await app.nodeNamed('Payments API v2')).status).toBe('done');
    await expect(app.inspector().getByTestId('insp-title'), 'the inspector column shows the same title').toHaveValue('Payments API v2');
    await expect(app.inspector().getByTestId('shape-picker')).toContainText('Diamond');
    await expect(pop, 'the popover stays open while editing').toBeVisible();
    await ev.snap('popover-edits-applied');
  });

  await test.step('Esc in an open picker closes only the picker', async () => {
    await pop.getByTestId('priority-picker').click();
    await expect(page.getByTestId('priority-picker-options')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('priority-picker-options')).toHaveCount(0);
    await expect(pop, 'the popover is still open').toBeVisible();
  });

  await test.step('the popover follows the topic through a drag, a pan and a zoom', async () => {
    const delta = async (act: () => Promise<void>) => {
      const n0 = await app.box(app.rfNode('pay')), p0 = await app.box(pop);
      await act();
      await page.waitForTimeout(450);
      const n1 = await app.box(app.rfNode('pay')), p1 = await app.box(pop);
      const node = { x: Math.round(n1.x - n0.x), y: Math.round(n1.y - n0.y) };
      const popover = { x: Math.round(p1.x - p0.x), y: Math.round(p1.y - p0.y) };
      const sameWithin1px = Math.abs(node.x - popover.x) <= 1 && Math.abs(node.y - popover.y) <= 1;
      return { node, popover: sameWithin1px ? node : popover };
    };
    const canvasTop = (await app.box(page.locator('.react-flow'))).y;
    const start = await app.center(node);
    const top0 = (await app.box(app.rfNode('pay'))).y;
    await app.drag(start, { x: start.x, y: start.y - (top0 - (canvasTop + 60)) });
    await expect.poll(() => placement('pay'), 'with room below, the popover sits level with the topic').toEqual({ side: 'right', gap12: 12, levelWithNode: true });
    const c = await app.center(node);
    const dragged = await delta(() => app.drag(c, { x: c.x + 140, y: c.y + 30 }));
    expect(dragged.node.x, 'the topic moved').toBeGreaterThan(100);
    expect(dragged.popover, 'the popover moved with the dragged topic').toEqual(dragged.node);
    const empty = await app.emptyPoint({ x: 0.7, y: 0.8 });
    await page.mouse.move(empty.x, empty.y);
    const panned = await delta(() => page.mouse.wheel(0, -100));
    expect(Math.abs(panned.node.y), 'the canvas panned').toBeGreaterThan(40);
    expect(panned.popover, 'the popover moved with the panned canvas').toEqual(panned.node);
    await page.getByTestId('zoom-in').click();
    await expect.poll(() => placement('pay'), 'after zooming in it is still 12px beside the topic, level with it').toEqual({ side: 'right', gap12: 12, levelWithNode: true });
    await expect(pop).toHaveAttribute('data-node-id', 'pay');
    await ev.snap('popover-follows-zoom');
  });

  await test.step('near the right edge it opens on the left', async () => {
    await app.fit();
    await opened('far');
    await expect.poll(() => placement('far'), 'popover sits 12px to the left of a topic at the right edge, level with it or lifted just enough to fit').toEqual({ side: 'left', gap12: 12, levelWithNode: true });
    await ev.snap('popover-flips-left');
  });

  await test.step('header menus open above the popover', async () => {
    await page.getByTestId('menu-theme').click();
    const hidden = await page.evaluate(() => {
      const pop = document.querySelector('[data-testid="node-popover"]')!.getBoundingClientRect();
      const items = [...document.querySelectorAll('.menu button')];
      const overlapping = items.filter((el) => { const r = el.getBoundingClientRect(); return r.left < pop.right && r.right > pop.left && r.top < pop.bottom && r.bottom > pop.top; });
      const covered = overlapping.filter((el) => { const r = el.getBoundingClientRect(); return !el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
      return { overlapping: overlapping.length, covered: covered.length };
    });
    expect(hidden.overlapping, 'the theme menu overlaps the popover in this layout').toBeGreaterThan(0);
    expect(hidden.covered, 'no menu item is hidden behind the popover').toBe(0);
    await ev.snap('header-menu-above-popover');
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toHaveCount(0);
  });

  await test.step('an AI screenshot leaves the popover open with the unsaved typing', async () => {
    if (!(await pop.count())) await opened('far');
    await title.click();
    await title.press('End');
    await page.keyboard.type(' draft');
    const shot = await (await page.request.post('/api/tools/capture_screenshot', { data: { documentId: docId } })).json();
    expect(shot.ok, 'the AI screenshot succeeded: ' + (shot.error ?? '')).toBe(true);
    await expect(pop, 'the popover is still open after the AI screenshot').toBeVisible();
    await expect(title, 'the unsaved typing is still there').toHaveValue('Far right draft');
    await expect(title, 'and the field still has focus').toBeFocused();
    expect((await app.selection()).nodes, 'the selection is back').toEqual(['far']);
    await title.press('Enter');
    await app.settled();
    await expect(app.node('far')).toHaveAttribute('data-title', 'Far right draft');
  });

  await test.step('Esc, the close button, empty canvas, another node and F2 each close it', async () => {
    await title.focus();
    await page.keyboard.press('Escape');
    await expect(pop, 'Esc closes it').toHaveCount(0);
    expect((await app.selection()).nodes, 'Esc keeps the topic selected').toEqual(['far']);
    await opened('far');
    await pop.getByTestId('node-popover-close').click();
    await expect(pop, 'the close button closes it').toHaveCount(0);
    await opened('pay');
    const empty = await app.emptyPoint({ x: 0.5, y: 0.9 });
    await page.mouse.click(empty.x, empty.y);
    await expect(pop, 'a click on empty canvas closes it').toHaveCount(0);
    await opened('pay');
    await app.node('ledger').click();
    await expect(pop, 'selecting another node closes it').toHaveCount(0);
    expect((await app.selection()).nodes).toEqual(['ledger']);
    await opened('ledger');
    await app.node('ledger').click();
    await expect(pop, 'a click on the same node keeps it open').toBeVisible();
    await page.keyboard.press('F2');
    await expect(app.editor(), 'F2 still edits the text on the canvas').toBeVisible();
    await expect(pop, 'inline editing closes the popover').toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(app.editor()).toHaveCount(0);
    await app.rfNode('ledger').getByRole('button', { name: /Collapse branch|Expand branch/ }).dblclick();
    await expect(pop, 'a double-click on the collapse button does not open the popover').toHaveCount(0);
  });

  await test.step('in a narrow 1000px window the close button is not under the emoji button', async () => {
    await page.setViewportSize({ width: 1000, height: 760 });
    await app.fit();
    await opened('pay');
    await expect(title).toBeFocused();
    await expect(page.getByTestId('selection-bar'), 'the narrow layout\'s selection bar steps aside while the popover is open').toHaveCount(0);
    const dock = page.getByTestId('emoji-button');
    await expect(dock).toBeVisible();
    const close = pop.getByTestId('node-popover-close');
    const d = await app.box(dock), c = await app.box(close);
    expect(d.x < c.x + c.width && d.x + d.width > c.x && d.y < c.y + c.height && d.y + d.height > c.y, 'the emoji button does not overlap the close button').toBe(false);
    await ev.snap('narrow-window-close-button');
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
    await expect(pop, 'a real click on the close button closes it').toHaveCount(0);
    await expect(page.getByTestId('emoji-picker'), 'and does not open the emoji picker').toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.fit();
  });

  await test.step('a sticky note opens the same way, Markdown in the title box', async () => {
    await opened('note');
    await expect(app.editor()).toHaveCount(0);
    await expect(pop.getByTestId('inspector-node')).toContainText('Sticky note');
    await expect(title).toHaveValue('## Launch notes\n- **Owner**: Pablo');
    expect(await title.evaluate((el) => el.tagName), 'sticky text is a multi-line box').toBe('TEXTAREA');
    await ev.snap('popover-sticky');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  });

  await test.step('an AI agent opens the same popover with set_ui quickEditNodeId', async () => {
    await app.tool('set_ui', { documentId: docId, quickEditNodeId: 'ledger' });
    await expect(pop).toBeVisible();
    await expect(pop).toHaveAttribute('data-node-id', 'ledger');
    expect((await app.selection()).nodes).toEqual(['ledger']);
    await ev.snap('popover-opened-by-ai');
    await app.tool('set_ui', { documentId: docId, quickEditNodeId: '' });
    await expect(pop, 'an empty quickEditNodeId closes it').toHaveCount(0);
  });
});
