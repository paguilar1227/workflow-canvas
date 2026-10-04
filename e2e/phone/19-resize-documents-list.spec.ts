import { test, expect } from '../support/journey';
import { MIN_TARGET } from '../support/phone';
import { DEFAULT_DOCS_HEIGHT, docsLayout, expectOutlineBound, expectSplitterValues, moreDocsThanFit, near, outlineDoc } from '../support/docs-list';

test('resize the documents list', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: in the outline drawer a person drags the 44px handle between Documents and Outline with one finger to make the documents list taller. The page does not scroll, and the height is remembered after a reload. The list cannot grow past the point where the outline keeps its title and one row, and cannot shrink below one document row. Arrow keys from an attached keyboard resize it by a row, Home/End jump to the bounds, and Enter or a double-tap on the handle resets it. The handle tells a screen reader its height and bounds from the drawer\'s first open. Turned to landscape with no chosen size, the list shrinks so the handle and the outline title stay reachable, and the default returns in portrait. Ergonomics are checked on the drawer.');
  const docId = await outlineDoc(app, 'Docs list journey');
  await app.open(docId);
  const sp = page.getByTestId('docs-splitter');
  const vh = page.viewportSize()!.height;
  /** One finger on the handle, slid to the given height on screen. */
  const slideTo = async (y: number) => {
    const c = await app.center(sp);
    await phone.drag(c, { x: c.x, y }, 12);
  };
  const height = async () => (await docsLayout(page)).h;
  let largest = 0;
  let row = 0;

  await test.step('the outline drawer has a 44px handle between Documents and Outline', async () => {
    await phone.openDrawer('outline');
    const added = await moreDocsThanFit(app, page);
    ev.note('Documents in the list: ' + (await docsLayout(page)).docs + ' (' + added + ' added so the list has more than the drawer can show).');
    await expect(sp).toHaveAttribute('role', 'separator');
    const box = await app.box(sp);
    expect(box.height, 'the handle is a ' + MIN_TARGET + 'px touch target (' + box.height + ')').toBeGreaterThanOrEqual(MIN_TARGET);
    expect(await sp.evaluate((e) => getComputedStyle(e).touchAction), 'dragging the handle never scrolls').toBe('none');
    const l = await docsLayout(page);
    row = l.row;
    expect(near(l.h, DEFAULT_DOCS_HEIGHT), 'default list height ' + l.h).toBe(true);
    expect(l.stored).toBeNull();
    await expectSplitterValues(page, 'drawer first open', { now: l.h, min: row });
    await phone.ergonomics('outline drawer');
    await ev.snap('outline-drawer-default');
  });

  await test.step('a one-finger drag on the handle makes the list taller without scrolling the page; a reload remembers it', async () => {
    const before = await docsLayout(page);
    const c = await app.center(sp);
    await slideTo(c.y + 150);
    const l = await docsLayout(page);
    expect(near(l.h, DEFAULT_DOCS_HEIGHT + 150, 2), 'sliding 150px down makes the list 150px taller (' + l.h + ')').toBe(true);
    expect(l.scroll, 'the page, the drawer and the list did not scroll').toEqual(before.scroll);
    await expect(phone.slot('outline'), 'the drawer stays open').toHaveClass(/shown/);
    expect(near(Number(l.stored), l.h), 'the height is saved on this device').toBe(true);
    await phone.ergonomics('outline drawer, list resized');
    await ev.snap('dragged-taller');
    await page.reload();
    await app.waitForDoc(docId);
    await phone.openDrawer('outline');
    expect(near(await height(), l.h), 'the height survives a reload').toBe(true);
    await ev.snap('after-reload');
  });

  await test.step('largest: the outline keeps its title and one row; smallest: one document row', async () => {
    await slideTo(vh - 4);
    const l = await expectOutlineBound(page, 'slid to the bottom');
    largest = l.h;
    expect(l.secondRowShown, 'the list takes all the room except the outline title and one row').toBe(false);
    expect(l.scrollable, 'the outline, not the content, stops the list here').toBe(true);
    await ev.snap('largest-outline-keeps-title-and-a-row');
    await slideTo(vh - 4);
    expect(near(await height(), largest), 'sliding further does not grow it').toBe(true);
    await slideTo(4);
    const s = await docsLayout(page);
    expect(near(s.h, row), 'sliding to the top leaves one document row (' + s.h + ' vs row ' + row + ')').toBe(true);
    expect(s.firstDocShown, 'that row is fully visible').toBe(true);
    await phone.ergonomics('outline drawer, smallest list');
    await ev.snap('smallest-one-row');
  });

  await test.step('keyboard resize, Enter reset and double-tap reset', async () => {
    await sp.focus();
    await page.keyboard.press('ArrowDown');
    expect(near(await height(), row * 2), 'ArrowDown adds one row').toBe(true);
    await page.keyboard.press('ArrowUp');
    expect(near(await height(), row), 'ArrowUp removes one row').toBe(true);
    await page.keyboard.press('End');
    expect(near(await height(), largest), 'End jumps to the largest size').toBe(true);
    await page.keyboard.press('Home');
    expect(near(await height(), row), 'Home jumps to the smallest size').toBe(true);
    await page.keyboard.press('Enter');
    let l = await docsLayout(page);
    expect(near(l.h, DEFAULT_DOCS_HEIGHT), 'Enter resets to the default (' + l.h + ')').toBe(true);
    expect(l.stored, 'a reset forgets the saved height').toBeNull();
    const c = await app.center(sp);
    await slideTo(c.y + 100);
    expect(near(await height(), DEFAULT_DOCS_HEIGHT + 100, 2)).toBe(true);
    await phone.doubleTap(await app.center(sp));
    l = await docsLayout(page);
    expect(near(l.h, DEFAULT_DOCS_HEIGHT), 'a double-tap on the handle resets to the default (' + l.h + ')').toBe(true);
    expect(l.stored).toBeNull();
    await expect(phone.slot('outline'), 'the drawer stays open').toHaveClass(/shown/);
    await ev.snap('reset-to-default');
  });

  await test.step('landscape with no chosen size: the list shrinks so the handle and the outline title stay reachable; portrait brings the default back', async () => {
    const portrait = page.viewportSize()!;
    await page.setViewportSize({ width: portrait.height, height: portrait.width });
    await page.waitForTimeout(400);
    await expect(phone.slot('outline'), 'the drawer stays open in landscape').toHaveClass(/shown/);
    const l = await expectOutlineBound(page, 'landscape');
    expect(l.stored, 'nothing was chosen, so nothing is remembered').toBeNull();
    expect(l.h, 'the default ' + DEFAULT_DOCS_HEIGHT + 'px list does not fit, so it shrinks (' + l.h + ')').toBeLessThan(DEFAULT_DOCS_HEIGHT);
    expect(l.h, 'at least one document row stays').toBeGreaterThanOrEqual(row - 1);
    expect(l.scroll.slice(0, 3), 'neither the page nor the drawer had to scroll to keep it reachable').toEqual([0, 0, 0]);
    const box = await app.box(sp);
    expect(box.y >= 0 && box.y + box.height <= portrait.width + 0.5, 'the handle is on screen (' + Math.round(box.y) + '-' + Math.round(box.y + box.height) + ')').toBe(true);
    await expectSplitterValues(page, 'landscape', { now: l.h, max: l.h });
    await ev.snap('landscape-list-fits');
    await page.setViewportSize(portrait);
    await page.waitForTimeout(400);
    const p = await docsLayout(page);
    expect(near(p.h, DEFAULT_DOCS_HEIGHT), 'back in portrait the default size returns (' + p.h + ')').toBe(true);
    expect(p.stored).toBeNull();
    await expectSplitterValues(page, 'portrait again', { now: DEFAULT_DOCS_HEIGHT });
    await ev.snap('portrait-default-again');
  });
});
