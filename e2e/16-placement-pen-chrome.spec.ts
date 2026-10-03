import { test, expect, type App, type Pt } from './support/journey';
import { defaultSize } from '../src/shared/sizes';

type Box = { x: number; y: number; width: number; height: number };
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const overlaps = (a: Box | null, b: Box | null) => !!a && !!b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Screen points along an SVG path, sampled at equal arc-length steps (same method as work/fixcheck/pen-fidelity.mjs). */
const samplePath = (app: App, selector: string) => app.page.locator(selector).first().evaluate((el) => {
  const path = el as unknown as SVGPathElement;
  const L = path.getTotalLength();
  const m = path.getScreenCTM()!;
  const out: [number, number][] = [];
  for (let k = 0; k <= 400; k++) { const pt = path.getPointAtLength((L * k) / 400); const sp = new DOMPoint(pt.x, pt.y).matrixTransform(m); out.push([sp.x, sp.y]); }
  return out;
});

/** Draw the track with the pen and measure how far the saved drawing sits from the live stroke the person saw. */
async function penStroke(app: App, track: Pt[]) {
  const page = app.page;
  if ((await app.state()).session.mode !== 'draw') await page.keyboard.press('p');
  await expect(page.getByTestId('pen-layer')).toBeVisible();
  const before = new Set((await app.doc()).nodes.map((n) => n.id));
  await page.mouse.move(track[0].x, track[0].y);
  await page.mouse.down();
  for (const p of track.slice(1)) await page.mouse.move(p.x, p.y, { steps: 1 });
  const live = await samplePath(app, '.pen-layer path');
  await page.mouse.up();
  await expect.poll(async () => (await app.doc()).nodes.filter((n) => n.kind === 'drawing' && !before.has(n.id)).length).toBe(1);
  const id = (await app.doc()).nodes.find((n) => n.kind === 'drawing' && !before.has(n.id))!.id;
  await expect(app.node(id).locator('path').first()).toBeVisible();
  await app.page.waitForTimeout(300);
  const final = await samplePath(app, '[data-testid="node-' + id + '"] path');
  const shift = Math.max(...live.map((q, i) => Math.hypot(q[0] - final[i][0], q[1] - final[i][1])));
  const seg = (q: number[], a: Pt, b: Pt) => { const dx = b.x - a.x, dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((q[0] - a.x) * dx + (q[1] - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(q[0] - a.x - t * dx, q[1] - a.y - t * dy); };
  const pointer = Math.max(...final.map((q) => Math.min(...track.slice(1).map((p, i) => seg(q, track[i], p)))));
  return { id, shift: +shift.toFixed(2), pointer: +pointer.toFixed(2) };
}

/** Click a column toggle and sample the column width on every animation frame until it has fully opened or been removed. */
async function toggleColumn(app: App, toggle: string, side: 'left' | 'right', width: number, opening: boolean) {
  const sampling = app.page.evaluate(({ side, width, opening }) => new Promise<{ t: number; w: number | null }[]>((resolve) => {
    const out: { t: number; w: number | null }[] = [];
    const t0 = performance.now();
    const tick = () => {
      const slot = document.querySelector('.column-slot.' + side);
      const w = slot ? slot.getBoundingClientRect().width : null;
      out.push({ t: Math.round(performance.now() - t0), w });
      const done = opening ? w === width && out.some((s) => s.w === null || s.w < width) : w === null && out.some((s) => s.w !== null);
      if (done) resolve(out); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { side, width, opening });
  await app.page.getByTestId(toggle).click();
  return sampling;
}

test('place elements where I click, draw precisely, and keep the chrome tidy', async ({ page, app, ev }) => {
  ev.proves('With nothing selected, the Topic/Sticky buttons arm a placement cursor whose ghost follows the pointer; a click drops the element centred on the click point and Esc disarms without creating anything; with a topic selected a new topic spawns 48px beside it, and Frame wraps the selection. A pen stroke is saved exactly where the live stroke was drawn (within 1px, at 100% and 200% zoom). Hiding and showing the side columns slides them (a mid-animation width between open and closed), a hidden column ends at zero width and leaves the page, and at 1280×800 with both columns open the toolbar does not overlap the zoom bar or the minimap.');
  const docId = await app.newDoc('Placement and pen');
  await app.open(docId);
  const pane = await app.paneBox();
  const pill = page.getByTestId('place-pill');
  const at = { x: pane.x + pane.width * 0.35, y: pane.y + pane.height * 0.4 };
  let placedId = '';

  await test.step('the Topic button arms a placement cursor whose ghost follows the pointer', async () => {
    await page.getByTestId('add-topic').click();
    await expect(page.getByTestId('add-topic')).toHaveClass(/active/);
    await expect(pill).toContainText('Click the canvas to place');
    await page.mouse.move(at.x - 60, at.y - 40);
    await page.mouse.move(at.x, at.y, { steps: 8 });
    const ghost = page.locator('.place-ghost');
    await expect(ghost).toBeVisible();
    const g = await app.box(ghost);
    const { zoom } = await app.viewport();
    const size = defaultSize('topic', 'card');
    expect(Math.abs(g.x + g.width / 2 - at.x), 'ghost centred on the pointer (x)').toBeLessThanOrEqual(1);
    expect(Math.abs(g.y + g.height / 2 - at.y), 'ghost centred on the pointer (y)').toBeLessThanOrEqual(1);
    expect(Math.abs(g.width - size.width * zoom), 'ghost has the new topic size').toBeLessThanOrEqual(1);
    expect(Math.abs(g.height - size.height * zoom)).toBeLessThanOrEqual(1);
    await ev.snap('armed-ghost-under-pointer');
  });

  await test.step('a click drops the topic centred on the click point', async () => {
    await page.mouse.click(at.x, at.y);
    await expect(pill).toHaveCount(0);
    await expect(app.editor()).toBeFocused();
    placedId = (await app.selection()).nodes[0];
    const b = await app.box(app.rfNode(placedId));
    ev.note('click at ' + at.x.toFixed(1) + ',' + at.y.toFixed(1) + '; topic centre ' + (b.x + b.width / 2).toFixed(1) + ',' + (b.y + b.height / 2).toFixed(1));
    expect(Math.abs(b.x + b.width / 2 - at.x), 'centred on the click (x)').toBeLessThanOrEqual(2);
    expect(Math.abs(b.y + b.height / 2 - at.y), 'centred on the click (y)').toBeLessThanOrEqual(2);
    await app.type('Placed here');
    await ev.snap('placed-at-click');
  });

  await test.step('Esc disarms placement and nothing is created', async () => {
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await app.selection()).nodes).toEqual([]);
    const count = (await app.doc()).nodes.length;
    const spot = await app.emptyPoint({ x: 0.7, y: 0.3 });
    await page.getByTestId('add-sticky').click();
    await expect(pill).toContainText('Click the canvas to place');
    await page.mouse.move(spot.x, spot.y, { steps: 6 });
    await expect(page.locator('.place-ghost.kind-sticky')).toBeVisible();
    await ev.snap('sticky-armed');
    await page.keyboard.press('Escape');
    await expect(pill).toHaveCount(0);
    await expect(page.getByTestId('place-layer')).toHaveCount(0);
    await expect(page.getByTestId('add-sticky')).not.toHaveClass(/active/);
    await page.mouse.click(spot.x, spot.y);
    expect((await app.doc()).nodes.length, 'a click after Esc creates nothing').toBe(count);
    await ev.snap('disarmed-nothing-created');
  });

  await test.step('with a topic selected, a new topic spawns beside it', async () => {
    await app.topic('Placed here').click();
    await expect.poll(async () => (await app.selection()).nodes).toEqual([placedId]);
    await page.getByTestId('add-topic').click();
    await expect(pill, 'no placement cursor when there is an anchor').toHaveCount(0);
    await app.type('Beside it');
    const a = await app.nodeNamed('Placed here');
    const b = await app.nodeNamed('Beside it');
    expect(b.x, '48px to the right of the anchor').toBe(a.x + a.width + 48);
    expect(Math.abs(b.y + b.height / 2 - (a.y + a.height / 2)), 'vertically centred on the anchor').toBeLessThanOrEqual(0.5);
    expect(overlaps(await app.box(app.topic('Placed here')), await app.box(app.topic('Beside it'))), 'the two topics do not overlap on screen').toBe(false);
    await ev.snap('spawned-beside-anchor');
  });

  await test.step('Frame with a selection wraps it', async () => {
    await app.topic('Placed here').click();
    await app.topic('Beside it').click({ modifiers: ['Shift'] });
    await expect.poll(async () => (await app.selection()).nodes.length).toBe(2);
    await page.getByTestId('add-frame').click();
    await expect(pill).toHaveCount(0);
    await app.type('Wrapped');
    const d = await app.doc();
    const frame = d.nodes.find((n) => n.kind === 'frame' && n.title === 'Wrapped');
    expect(frame, 'a frame named Wrapped exists').toBeTruthy();
    for (const t of ['Placed here', 'Beside it']) expect(d.nodes.find((n) => n.title === t)!.frameId, t + ' is a member').toBe(frame!.id);
    const fb = await app.box(app.frame(frame!.id));
    for (const t of ['Placed here', 'Beside it']) expect(inside(await app.box(app.topic(t)), fb), t + ' sits inside the frame on screen').toBe(true);
    await ev.snap('frame-wraps-selection');
  });

  await test.step('a pen stroke is saved exactly where it was drawn', async () => {
    await page.keyboard.press('Escape');
    const cx = pane.x + pane.width * 0.5, cy = pane.y + pane.height * 0.78;
    const zigzag = Array.from({ length: 41 }, (_, i) => ({ x: cx - 200 + i * 10, y: cy + (i % 2 ? -60 : 60) }));
    const z1 = await penStroke(app, zigzag);
    ev.note('zigzag at 100%: live→saved shift ' + z1.shift + 'px; saved stroke vs pointer path max ' + z1.pointer + 'px');
    expect(z1.shift, 'saved drawing overlays the live stroke at 100% (px)').toBeLessThanOrEqual(1);
    await ev.snap('zigzag-at-100');

    await page.keyboard.press('Escape');
    await app.tool('control_view', { documentId: docId, action: 'set_zoom', zoom: 2 });
    await expect.poll(async () => (await app.viewport()).zoom).toBe(2);
    const ox = pane.x + pane.width * 0.5, oy = pane.y + pane.height * 0.5;
    const circle = Array.from({ length: 73 }, (_, i) => ({ x: ox + 150 * Math.cos((i / 72) * 2 * Math.PI), y: oy + 150 * Math.sin((i / 72) * 2 * Math.PI) }));
    const z2 = await penStroke(app, circle);
    ev.note('circle at 200%: live→saved shift ' + z2.shift + 'px; saved stroke vs pointer path max ' + z2.pointer + 'px');
    expect(z2.shift, 'saved drawing overlays the live stroke at 200% (px)').toBeLessThanOrEqual(1);
    await ev.snap('circle-at-200');
    await page.keyboard.press('Escape');
    await app.fit();
  });

  await test.step('hiding and showing the side columns slides them', async () => {
    for (const [toggle, side, width, panel] of [['toggle-outline', 'left', 268, 'outline'], ['toggle-inspector', 'right', 292, 'inspector']] as const) {
      await expect(page.locator('.column-slot.' + side + '.shown')).toHaveCount(1);
      const canvasOpen = (await app.box(page.locator('.canvas-wrap'))).width;
      const closing = await toggleColumn(app, toggle, side, width, false);
      const midClose = closing.filter((s) => s.w !== null && s.w > 0 && s.w < width);
      ev.note(side + ' column closing: ' + closing.length + ' frames, widths ' + closing.map((s) => (s.w === null ? 'gone' : s.w.toFixed(0)) + '@' + s.t).join(' '));
      expect(midClose.length, side + ' column passes through in-between widths while closing').toBeGreaterThan(0);
      await expect(page.locator('.column-slot.' + side), 'the hidden column leaves the page').toHaveCount(0);
      await expect(page.getByTestId(panel)).toHaveCount(0);
      await expect.poll(async () => Math.round((await app.box(page.locator('.canvas-wrap'))).width - canvasOpen), 'the hidden column takes no width').toBe(width);
      if (side === 'left') await ev.snap('outline-hidden');

      const opening = await toggleColumn(app, toggle, side, width, true);
      const midOpen = opening.filter((s) => s.w !== null && s.w > 0 && s.w < width);
      ev.note(side + ' column opening: ' + opening.length + ' frames, widths ' + opening.map((s) => (s.w === null ? 'gone' : s.w.toFixed(0)) + '@' + s.t).join(' '));
      expect(midOpen.length, side + ' column passes through in-between widths while opening').toBeGreaterThan(0);
      expect(opening.at(-1)!.w, side + ' column ends fully open').toBe(width);
      await expect(page.getByTestId(panel)).toBeVisible();
    }
  });

  await test.step('at 1280×800 the toolbar stays clear of the zoom bar and minimap', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.fit();
    await expect(page.locator('.column-slot.left.shown')).toBeVisible();
    await expect(page.locator('.column-slot.right.shown')).toBeVisible();
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    const clash = async () => {
      const [toolbar, zoombar, minimap] = await Promise.all([page.getByTestId('toolbar').boundingBox(), page.getByTestId('zoombar').boundingBox(), page.locator('.react-flow__minimap').boundingBox()]);
      return { zoombar: overlaps(toolbar, zoombar), minimap: overlaps(toolbar, minimap) };
    };
    await expect.poll(clash, 'toolbar overlaps neither the zoom bar nor the minimap').toEqual({ zoombar: false, minimap: false });
    ev.note('dock at 1280×800: ' + ((await page.locator('.canvas-wrap').getAttribute('data-dock')) ?? 'flat'));
    await ev.snap('chrome-at-1280x800');
  });
});
