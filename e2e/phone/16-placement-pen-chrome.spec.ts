import { test, expect, type Pt } from '../support/journey';
import { penStroke, type StrokeInput } from '../support/pen';

type Box = { x: number; y: number; width: number; height: number };
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const overlaps = (a: Box | null, b: Box | null) => !!a && !!b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('place elements where I click, draw precisely, and keep the chrome tidy', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: with nothing selected, the Topic/Sticky buttons arm placement (a pill says "Tap to place"); a tap drops the element centred on the tap point and the pill\'s Cancel disarms without creating anything; with a topic selected a new topic spawns 48px beside it, and Frame wraps an Area selection. A one-finger pen stroke is saved exactly where the live stroke was drawn (within 1px, at 100% and 200% zoom). The outline and inspector drawers slide in and out; the toolbar fits a 390px phone and, at 320px, stays on screen and scrolls sideways to its last tool without overlapping the zoom bar. Ergonomics are checked throughout.');
  const docId = await app.newDoc('Placement and pen');
  await app.open(docId);
  const pane = await app.paneBox();
  const pill = page.getByTestId('place-pill');
  const at = { x: Math.round(pane.x + pane.width * 0.4), y: Math.round(pane.y + pane.height * 0.35) };
  let placedId = '';

  await test.step('the Topic button arms placement and a tap drops the topic centred on the tap point', async () => {
    await phone.tap(page.getByTestId('add-topic'));
    await expect(page.getByTestId('add-topic')).toHaveClass(/active/);
    await expect(pill).toContainText('Tap to place a topic');
    await expect(pill.getByRole('button'), 'the pill button reads Cancel, without a keyboard hint on touch').toHaveText('Cancel');
    await phone.ergonomics('placement armed');
    await ev.snap('topic-armed');
    await phone.tap(at);
    await expect(pill).toHaveCount(0);
    await expect(app.editor()).toBeFocused();
    placedId = (await app.selection()).nodes[0];
    const b = await app.box(app.rfNode(placedId));
    ev.note('tap at ' + at.x + ',' + at.y + '; topic centre ' + (b.x + b.width / 2).toFixed(1) + ',' + (b.y + b.height / 2).toFixed(1));
    expect(Math.abs(b.x + b.width / 2 - at.x), 'centred on the tap (x)').toBeLessThanOrEqual(2);
    expect(Math.abs(b.y + b.height / 2 - at.y), 'centred on the tap (y)').toBeLessThanOrEqual(2);
    await app.type('Placed here');
    await ev.snap('placed-at-tap');
  });

  await test.step('Cancel in the pill disarms placement and nothing is created', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.75 }));
    await expect.poll(async () => (await app.selection()).nodes).toEqual([]);
    const count = (await app.doc()).nodes.length;
    const spot = await app.emptyPoint({ x: 0.7, y: 0.6 });
    await phone.tap(page.getByTestId('add-sticky'));
    await expect(pill).toContainText('Tap to place a sticky');
    await ev.snap('sticky-armed');
    await phone.tap(pill.getByRole('button', { name: 'Cancel' }));
    await expect(pill).toHaveCount(0);
    await expect(page.getByTestId('place-layer')).toHaveCount(0);
    await expect(page.getByTestId('add-sticky')).not.toHaveClass(/active/);
    await phone.tap(spot);
    expect((await app.doc()).nodes.length, 'a tap after Cancel creates nothing').toBe(count);
    await ev.snap('cancelled-nothing-created');
  });

  await test.step('with a topic selected, a new topic spawns beside it', async () => {
    await phone.selectTopic('Placed here');
    await expect.poll(async () => (await app.selection()).nodes).toEqual([placedId]);
    await phone.tap(page.getByTestId('add-topic'));
    await expect(pill, 'no placement when there is an anchor').toHaveCount(0);
    await app.type('Beside it');
    const a = await app.nodeNamed('Placed here');
    const b = await app.nodeNamed('Beside it');
    expect(b.x, '48px to the right of the anchor').toBe(a.x + a.width + 48);
    expect(Math.abs(b.y + b.height / 2 - (a.y + a.height / 2)), 'vertically centred on the anchor').toBeLessThanOrEqual(0.5);
    await phone.fit();
    expect(overlaps(await app.box(app.topic('Placed here')), await app.box(app.topic('Beside it'))), 'the two topics do not overlap on screen').toBe(false);
    await ev.snap('spawned-beside-anchor');
  });

  await test.step('Frame with an Area selection wraps it', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.8 }));
    const boxes = [await app.box(app.topic('Placed here')), await app.box(app.topic('Beside it'))];
    await phone.areaSelect(
      { x: Math.min(...boxes.map((b) => b.x)) - 14, y: Math.min(...boxes.map((b) => b.y)) - 14 },
      { x: Math.max(...boxes.map((b) => b.x + b.width)) + 14, y: Math.max(...boxes.map((b) => b.y + b.height)) + 14 },
    );
    await expect.poll(async () => (await app.selection()).nodes.length).toBe(2);
    await phone.tap(page.getByTestId('add-frame'));
    await expect(pill).toHaveCount(0);
    await app.type('Wrapped');
    const d = await app.doc();
    const frame = d.nodes.find((n) => n.kind === 'frame' && n.title === 'Wrapped');
    expect(frame, 'a frame named Wrapped exists').toBeTruthy();
    for (const t of ['Placed here', 'Beside it']) expect(d.nodes.find((n) => n.title === t)!.frameId, t + ' is a member').toBe(frame!.id);
    const fb = await app.box(app.frame(frame!.id));
    for (const t of ['Placed here', 'Beside it']) expect(inside(await app.box(app.topic(t)), fb), t + ' sits inside the frame on screen').toBe(true);
    await phone.ergonomics('frame wraps the selection');
    await ev.snap('frame-wraps-selection');
  });

  await test.step('a one-finger pen stroke is saved exactly where it was drawn', async () => {
    const finger: StrokeInput = { down: (p) => phone.touch('touchStart', [p]), move: (p) => phone.touch('touchMove', [p]), up: () => phone.touch('touchEnd', []) };
    const draw = async (track: Pt[]) => {
      if ((await app.state()).session.mode !== 'draw') await phone.tap(page.getByTestId('tool-pen'));
      return penStroke(app, track, finger);
    };
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.8 }));
    const box = await app.paneBox();
    const cx = box.x + box.width * 0.5, cy = box.y + box.height * 0.62;
    const zigzag = Array.from({ length: 31 }, (_, i) => ({ x: cx - 135 + i * 9, y: cy + (i % 2 ? -45 : 45) }));
    const z1 = await draw(zigzag);
    ev.note('zigzag at ' + (await app.zoomPct()) + '%: live→saved shift ' + z1.shift + 'px; saved stroke vs finger path max ' + z1.pointer + 'px');
    await ev.snap('zigzag-drawn');
    await phone.tap(page.getByTestId('pen-pill').getByRole('button', { name: 'Done' }));

    await app.tool('control_view', { documentId: docId, action: 'set_zoom', zoom: 1 });
    await expect.poll(async () => (await app.viewport()).zoom).toBe(1);
    const z100 = await draw(zigzag.map((p) => ({ x: p.x, y: p.y - 120 })));
    ev.note('zigzag at 100%: live→saved shift ' + z100.shift + 'px; saved stroke vs finger path max ' + z100.pointer + 'px');
    expect(z100.shift, 'saved drawing overlays the live stroke at 100% (px)').toBeLessThanOrEqual(1);
    expect(z1.shift, 'saved drawing overlays the live stroke at the fitted zoom (px)').toBeLessThanOrEqual(1);
    await ev.snap('zigzag-at-100');
    await phone.tap(page.getByTestId('pen-pill').getByRole('button', { name: 'Done' }));

    await app.tool('control_view', { documentId: docId, action: 'set_zoom', zoom: 2 });
    await expect.poll(async () => (await app.viewport()).zoom).toBe(2);
    const ox = box.x + box.width * 0.5, oy = box.y + box.height * 0.5;
    const circle = Array.from({ length: 73 }, (_, i) => ({ x: ox + 100 * Math.cos((i / 72) * 2 * Math.PI), y: oy + 100 * Math.sin((i / 72) * 2 * Math.PI) }));
    const z2 = await draw(circle);
    ev.note('circle at 200%: live→saved shift ' + z2.shift + 'px; saved stroke vs finger path max ' + z2.pointer + 'px');
    expect(z2.shift, 'saved drawing overlays the live stroke at 200% (px)').toBeLessThanOrEqual(1);
    await phone.ergonomics('pen at 200%');
    await ev.snap('circle-at-200');
    await phone.tap(page.getByTestId('pen-pill').getByRole('button', { name: 'Done' }));
    await phone.fit();
  });

  await test.step('the outline and inspector drawers slide in and out', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
    await phone.checkDrawer('inspector', () => phone.more('toggle-inspector'));
  });

  await test.step('the toolbar fits a 390px phone and scrolls sideways at 320px', async () => {
    const toolbar = page.getByTestId('toolbar');
    const measure = () => toolbar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { overflow: el.scrollWidth - el.clientWidth, scrollLeft: el.scrollLeft, left: r.left, right: r.right, vw: innerWidth, page: document.documentElement.scrollWidth - innerWidth };
    });
    const clash = async () => overlaps(await toolbar.boundingBox(), await page.getByTestId('zoombar').boundingBox());
    const at390 = await measure();
    ev.note('toolbar at 390px: ' + JSON.stringify(at390));
    expect(at390.overflow, 'every tool fits at 390px').toBeLessThanOrEqual(0);
    expect(at390.left >= 0 && at390.right <= at390.vw, 'the toolbar is on screen at 390px').toBe(true);
    expect(await clash(), 'toolbar and zoom bar do not overlap at 390px').toBe(false);

    await page.setViewportSize({ width: 320, height: 568 });
    await phone.fit();
    const at320 = await measure();
    ev.note('toolbar at 320px: ' + JSON.stringify(at320));
    expect(at320.page, 'no sideways page scroll at 320px').toBeLessThanOrEqual(0);
    expect(at320.left >= 0 && at320.right <= at320.vw, 'the toolbar stays on screen at 320px').toBe(true);
    expect(at320.overflow, 'the tools that do not fit scroll inside the toolbar').toBeGreaterThan(0);
    expect(await clash(), 'toolbar and zoom bar do not overlap at 320px').toBe(false);
    await ev.snap('toolbar-at-320');

    const tb = await app.box(toolbar);
    await phone.drag({ x: tb.x + tb.width - 30, y: tb.y + tb.height / 2 }, { x: tb.x + 30, y: tb.y + tb.height / 2 });
    await expect.poll(async () => (await measure()).scrollLeft, 'a one-finger swipe scrolls the toolbar').toBeGreaterThan(0);
    const last = toolbar.locator('button').last();
    const lb = await app.box(last);
    expect(lb.x + lb.width <= at320.vw && lb.x >= 0, 'the last tool is reachable on screen').toBe(true);
    await expect(last, 'the last tool is Logic').toHaveAttribute('data-testid', 'add-logic');
    await phone.tap(last);
    await expect(page.getByTestId('add-logic-options'), 'tapping Logic opens its sheet').toBeVisible();
    await phone.tap(page.getByTestId('role-start'));
    await expect(pill, 'picking Start from the last tool arms placement').toContainText('Tap to place');
    await phone.ergonomics('320px phone');
    await ev.snap('toolbar-scrolled-at-320');
    await phone.tap(pill.getByRole('button', { name: 'Cancel' }));
    await expect(pill).toHaveCount(0);
  });
});
