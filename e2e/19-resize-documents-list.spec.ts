import { test, expect } from './support/journey';
import { DEFAULT_DOCS_HEIGHT, docsLayout, expectOutlineBound, expectSplitterValues, moreDocsThanFit, near, outlineDoc } from './support/docs-list';

test('resize the documents list', async ({ page, app, ev }) => {
  ev.proves('A user drags the line between Documents and Outline to make the documents list taller, and the height is remembered after a reload. The list cannot grow past its own content or past the point where the outline keeps its title and one row, and cannot shrink below one document row. Arrow keys resize it by a row, Home/End jump to the bounds, Enter or a double-click reset it, and the splitter tells a screen reader its current height and bounds after every change. The inspector Shape, Status and Priority pickers work from the keyboard alone: Enter or an arrow opens, arrows and Enter pick, Escape closes without a change, Tab or Shift+Tab closes and moves on like a native select, and Enter or Tab on a picker never adds a topic.');
  const docId = await outlineDoc(app, 'Docs list journey');
  await app.open(docId);
  const sp = page.getByTestId('docs-splitter');
  const vh = page.viewportSize()!.height;
  /** Press on the splitter's grip, move the mouse to the given height on screen and release there, wherever that leaves the pointer. */
  const dragTo = async (y: number) => {
    const c = await app.center(sp);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const height = async () => (await docsLayout(page)).h;
  let largest = 0;
  let row = 0;

  await test.step('a splitter sits between Documents and Outline; the list starts at its default size', async () => {
    const added = await moreDocsThanFit(app, page);
    ev.note('Documents in the list: ' + (await docsLayout(page)).docs + ' (' + added + ' added so the list has more than the panel can show).');
    await expect(sp).toHaveAttribute('role', 'separator');
    await expect(sp).toHaveAttribute('aria-orientation', 'horizontal');
    const box = await app.box(sp);
    expect(Math.round(box.height), 'the mouse splitter is 10px tall').toBe(10);
    expect(await sp.evaluate((e) => getComputedStyle(e).cursor)).toBe('row-resize');
    await expect(sp.locator('.grip'), 'the splitter shows a grip').toBeVisible();
    const list = await app.box(page.getByTestId('doc-list'));
    const outline = await app.box(page.getByTestId('outline'));
    expect(box.y + box.height / 2, 'the splitter is on the line under the documents list').toBeGreaterThan(list.y + list.height - 6);
    expect(box.y + box.height / 2, 'the splitter is on the line above the outline').toBeLessThan(outline.y + 6);
    const l = await docsLayout(page);
    row = l.row;
    expect(near(l.h, DEFAULT_DOCS_HEIGHT), 'default list height ' + l.h).toBe(true);
    expect(l.stored, 'nothing is remembered before a resize').toBeNull();
    expect(l.scrollable, 'more documents than fit: the list scrolls').toBe(true);
    await expectSplitterValues(page, 'default size', { now: l.h, min: row });
    await ev.snap('default-size');
  });

  await test.step('hovering a document row shows its actions without changing any row height', async () => {
    const items = page.locator('[data-testid=doc-list] .doc-item');
    const rowHeights = () => items.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight));
    const atRest = await rowHeights();
    expect(new Set(atRest).size, 'every document row is the same height at rest (' + atRest[0] + 'px)').toBe(1);
    const content = (await docsLayout(page)).content;
    for (const [name, target] of [['another document', items.and(page.locator(':not(.active)')).first()], ['the open document', items.and(page.locator('.active'))]] as const) {
      await target.hover();
      await expect(target.locator('.doc-actions'), 'hovering ' + name + ' shows its actions').toBeVisible();
      expect(await rowHeights(), 'hovering ' + name + ' leaves every row height unchanged').toEqual(atRest);
      expect(near((await docsLayout(page)).content, content), 'hovering ' + name + ' leaves the list content height unchanged').toBe(true);
    }
    await ev.snap('hovered-row-same-height');
  });

  await test.step('drag the splitter down; the taller list is remembered after a reload', async () => {
    const c = await app.center(sp);
    await dragTo(c.y + 150);
    const l = await docsLayout(page);
    expect(near(l.h, DEFAULT_DOCS_HEIGHT + 150, 2), 'dragging 150px down makes the list 150px taller (' + l.h + ')').toBe(true);
    expect(near(Number(l.stored), l.h), 'the height is saved on this device').toBe(true);
    await ev.snap('dragged-taller');
    await page.reload();
    await app.waitForDoc(docId);
    expect(near(await height(), l.h), 'the height survives a reload').toBe(true);
    await ev.snap('after-reload');
  });

  await test.step('largest: the outline keeps its title and one row; the list never grows past its content', async () => {
    await dragTo(vh - 2);
    const l = await expectOutlineBound(page, 'dragged to the bottom');
    largest = l.h;
    expect(l.secondRowShown, 'the list takes all the room except the outline title and one row').toBe(false);
    expect(l.scrollable, 'the outline, not the content, stops the list here').toBe(true);
    await ev.snap('largest-outline-keeps-title-and-a-row');
    await dragTo(vh - 2);
    expect(near(await height(), largest), 'dragging further does not grow it').toBe(true);
    await sp.focus();
    await page.keyboard.press('ArrowDown');
    expect(near(await height(), largest), 'ArrowDown at the largest size does not grow it').toBe(true);
    await expectSplitterValues(page, 'largest size', { now: largest, max: largest });

    await page.setViewportSize({ width: page.viewportSize()!.width, height: vh + Math.ceil(l.content - l.h) + 200 });
    await page.waitForTimeout(300);
    await sp.focus();
    await page.keyboard.press('End');
    const tall = await expectOutlineBound(page, 'tall window');
    expect(near(tall.h, tall.content), 'with room to spare the list stops at its own content (' + tall.h + ' vs ' + tall.content + ')').toBe(true);
    expect(tall.scrollable, 'every document is shown').toBe(false);
    await page.keyboard.press('ArrowDown');
    expect(near(await height(), tall.h), 'ArrowDown past the content does not grow it').toBe(true);
    await expectSplitterValues(page, 'tall window', { now: tall.h, max: tall.content });
    await ev.snap('largest-shows-all-documents');
    await page.setViewportSize({ width: page.viewportSize()!.width, height: vh });
    await page.waitForTimeout(300);
    const back = await docsLayout(page);
    expect(back.titleShown && back.firstRowShown, 'window back to normal: the outline title and first row stay visible without a reload (BUG-P15)').toBe(true);
    expect(near(back.h, largest), 'a smaller window shrinks the list back to the outline bound (' + back.h + ' vs ' + largest + ') (BUG-P15)').toBe(true);
    await expectSplitterValues(page, 'window back to normal', { now: back.h, max: largest });
    await ev.snap('window-back-to-normal');
  });

  await test.step('smallest: one document row', async () => {
    await dragTo(2);
    const l = await docsLayout(page);
    expect(near(l.h, row), 'dragging to the top leaves one document row (' + l.h + ' vs row ' + row + ')').toBe(true);
    expect(l.firstDocShown, 'that row is fully visible').toBe(true);
    await sp.focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    expect(near(await height(), row), 'ArrowUp and Home do not shrink it further').toBe(true);
    await expectSplitterValues(page, 'smallest size', { now: row, min: row });
    await ev.snap('smallest-one-row');
  });

  await test.step('keyboard: arrows move a row, Home/End jump to the bounds, Enter and double-click reset', async () => {
    await sp.focus();
    await expect(sp, 'the splitter takes keyboard focus').toBeFocused();
    await page.keyboard.press('ArrowDown');
    expect(near(await height(), row * 2), 'ArrowDown adds one row').toBe(true);
    await page.keyboard.press('ArrowDown');
    expect(near(await height(), row * 3), 'ArrowDown adds another row').toBe(true);
    await page.keyboard.press('ArrowUp');
    expect(near(await height(), row * 2), 'ArrowUp removes one row').toBe(true);
    await expectSplitterValues(page, 'after arrow keys', { now: row * 2, min: row, max: largest });
    expect(near(Number((await docsLayout(page)).stored), row * 2), 'keyboard sizes are remembered too').toBe(true);
    await page.keyboard.press('End');
    expect(near(await height(), largest), 'End jumps to the largest size').toBe(true);
    await page.keyboard.press('Home');
    expect(near(await height(), row), 'Home jumps to the smallest size').toBe(true);
    await page.keyboard.press('Enter');
    let l = await docsLayout(page);
    expect(near(l.h, DEFAULT_DOCS_HEIGHT), 'Enter resets to the default (' + l.h + ')').toBe(true);
    expect(l.stored, 'a reset forgets the saved height').toBeNull();
    await expectSplitterValues(page, 'after Enter reset', { now: DEFAULT_DOCS_HEIGHT });
    await page.keyboard.press('ArrowDown');
    expect(near(await height(), DEFAULT_DOCS_HEIGHT + row), 'ArrowDown from the default adds a row').toBe(true);
    await sp.dblclick();
    l = await docsLayout(page);
    expect(near(l.h, DEFAULT_DOCS_HEIGHT), 'double-click resets to the default (' + l.h + ')').toBe(true);
    expect(l.stored).toBeNull();
    await ev.snap('reset-to-default');
  });

  await test.step('keyboard-only pickers: Enter opens, arrows and Enter pick, Escape closes, Tab moves on, no topic is added', async () => {
    await app.node('dl-a').click();
    await expect(page.getByTestId('inspector-node')).toBeVisible();
    const before = (await app.doc()).nodes.map((n) => n.id).sort();
    const nodeA = async () => (await app.doc()).nodes.find((n) => n.id === 'dl-a')!;
    const shape = page.getByTestId('shape-picker');
    await shape.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shape-picker-options'), 'Enter opens the shape picker').toBeVisible();
    await expect(page.getByTestId('shape-card'), 'the current shape has focus').toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('shape-rounded')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('shape-circle'), 'ArrowDown moves down the 4-column grid').toBeFocused();
    await ev.snap('keyboard-shape-picker');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shape-picker-options'), 'Enter picks and closes').toHaveCount(0);
    await expect(shape, 'focus returns to the picker').toBeFocused();
    await expect(app.node('dl-a')).toHaveClass(/shape-circle/);

    const status = page.getByTestId('status-picker');
    await status.focus();
    await page.keyboard.press(' ');
    await expect(page.getByTestId('status-none'), 'Space opens the status picker on the current status').toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('status-doing')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-picker-options')).toHaveCount(0);
    await expect(status).toBeFocused();
    await expect(app.node('dl-a').locator('.wfc-marker.st-doing')).toHaveText('◐');

    const prio = page.getByTestId('priority-picker');
    await prio.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('priority-0'), 'an arrow key opens the priority picker on the current value').toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('priority-2')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('priority-picker-options'), 'Escape closes the picker').toHaveCount(0);
    await expect(prio, 'focus returns to the picker').toBeFocused();
    await app.settled();
    expect((await nodeA()).priority ?? 0, 'Escape changes nothing').toBe(0);
    expect((await app.selection()).nodes, 'Escape in the picker keeps the topic selected').toEqual(['dl-a']);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('priority-0')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('priority-5')).toBeFocused();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('priority-2')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(prio).toBeFocused();
    await app.settled();

    await shape.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shape-picker-options')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('shape-picker-options'), 'Tab closes the open shape picker').toHaveCount(0);
    await expect(status, 'Tab moves on to the next control, like a native select').toBeFocused();
    await prio.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('priority-picker-options')).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('priority-picker-options'), 'Shift+Tab closes the open priority picker').toHaveCount(0);
    await expect(status, 'Shift+Tab moves back to the previous control').toBeFocused();
    await page.keyboard.press('Tab');
    await expect(prio, 'Tab on a closed picker moves focus like any button').toBeFocused();
    await page.keyboard.press('Tab');
    await expect(prio, 'focus leaves the priority picker').not.toBeFocused();
    await app.settled();

    const a = await nodeA();
    expect({ shape: a.shape, status: a.status, priority: a.priority }, 'Tab out of an open picker changes nothing').toEqual({ shape: 'circle', status: 'doing', priority: 2 });
    expect((await app.doc()).nodes.map((n) => n.id).sort(), 'Enter or Tab on a picker never adds a sibling or child topic').toEqual(before);
    await expect(app.editor(), 'no topic editor opened').toHaveCount(0);
    await ev.snap('keyboard-pickers-done');
  });
});
