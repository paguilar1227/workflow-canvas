import { test, expect, type Pt } from '../support/journey';
import { MIN_TARGET } from '../support/phone';
import {
  BURST_MS, SNAP_RADIUS, colourGap, connecting, farFromPorts, isBezier, neonEdges, paletteName, pixel, portDistances, portDots, rgbOf, rgbParts, timeBurst,
} from '../support/neon';

const PROMPT = 'nf-prompt', NOISE = 'nf-noise', SAMPLER = 'nf-sampler', PROC = 'nf-proc', PREVIEW = 'nf-preview';

test('connect a pipeline in the Neon Flow theme', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person picks Neon Flow from the More sheet (10 themes) and the pipeline renders cleanly at phone size: 3px neon bezier wires without arrowheads, a dot in the wire colour on both ends drawn above the cards, no sideways overflow and an ergonomic phone chrome. Once a card is selected its white ports keep their enlarged 44px touch areas. A one-finger drag from a port draws a white wire to the finger, then a spark and ring near Processing\'s port in the colour (--zc) the new wire ends up with; lifting the finger connects the cards, the three wires into Processing all differ in colour, and the burst on Processing is gone after about 1.6 s.');
  const docId = await app.newDoc('Neon pipeline');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: PROMPT, title: 'Prompt', subtitle: 'text', x: 0, y: 0 },
    { id: NOISE, title: 'Random noise', subtitle: 'latent', x: 0, y: 130 },
    { id: SAMPLER, title: 'Sampler', subtitle: 'steps 30', x: 0, y: 260 },
    { id: PROC, title: 'Processing', subtitle: 'diffusion', x: 340, y: 130 },
    { id: PREVIEW, title: 'Preview', subtitle: 'image', x: 340, y: 300 },
  ] });
  await app.tool('add_edges', { documentId: docId, edges: [
    { id: 'nf-e1', source: PROMPT, target: PROC },
    { id: 'nf-e2', source: NOISE, target: PROC, color: 'blue' },
  ] });
  await app.open(docId);
  await phone.fit();

  const handle = (id: string, side: string) => app.rfNode(id).locator('.react-flow__handle[data-handlepos="' + side + '"]');
  const slide = async (from: Pt, to: Pt, steps = 14) => {
    for (let i = 1; i <= steps; i++) {
      await phone.touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);
  };
  const cleanRender = async (where: string, ids: string[]) => {
    const edges = await neonEdges(page);
    expect(edges.map((e) => e.id).sort(), where + ': every connector is drawn').toEqual([...ids].sort());
    for (const e of edges) {
      expect([e.cls.includes('neon'), e.width, isBezier(e.d), e.markerStart, e.markerEnd], where + ': ' + e.id + ' is a 3px neon bezier without arrowheads').toEqual([true, '3px', true, null, null]);
      expect(e.stroke, where + ': ' + e.id + ' is drawn in its colour').toBe(await rgbOf(page, e.ec));
    }
    const dots = await portDots(page);
    expect(dots, where + ': two port dots per connector').toHaveLength(2 * edges.length);
    for (const e of edges) {
      const dot = dots.find((d) => Math.hypot(d.x - e.start.x, d.y - e.start.y) < 1.5 && d.fill === e.stroke);
      expect(dot, where + ': ' + e.id + ' has a dot in its colour where it leaves its card').toBeTruthy();
      const card = await app.center(app.rfNode((await app.doc()).edges.find((x) => x.id === e.id)!.source));
      const len = Math.hypot(card.x - e.start.x, card.y - e.start.y);
      const inside = { x: e.start.x + ((card.x - e.start.x) / len) * (dot!.size / 4), y: e.start.y + ((card.y - e.start.y) / len) * (dot!.size / 4) };
      const painted = await pixel(page, inside);
      const [toDot, toCard] = [colourGap(painted, rgbParts(dot!.fill)), colourGap(painted, rgbParts(await rgbOf(page, 'var(--node-bg)')))];
      ev.note(where + ': ' + e.id + ' dot inner half ' + JSON.stringify(painted) + ' vs dot ' + dot!.fill + ' (gap ' + toDot + ', card gap ' + toCard + ')');
      expect(toDot, where + ': ' + e.id + ' end dot is drawn above the card').toBeLessThan(toCard);
    }
    await phone.ergonomics(where);
  };

  await test.step('pick Neon Flow from the More sheet', async () => {
    await phone.tap(page.getByTestId('menu-more'));
    await expect(page.locator('.theme-option'), 'the More sheet offers 10 themes').toHaveCount(10);
    const item = page.getByTestId('theme-neon-flow');
    await item.scrollIntoViewIfNeeded();
    await expect(item).toContainText('Neon Flow');
    await ev.snap('more-sheet-neon-flow');
    await phone.tap(item);
    if (await page.locator('.theme-option').first().isVisible()) await phone.tap(page.getByTestId('menu-more'));
    await expect(page.locator('.theme-option').first(), 'the More sheet closes').toBeHidden();
    await expect.poll(async () => (await app.state()).session.theme).toBe('neon-flow');
    await expect(page.locator('html'), 'the page is in Neon Flow mode').toHaveAttribute('data-neon', '');
    await page.waitForTimeout(300);
  });

  await test.step('the pipeline renders cleanly at phone size', async () => {
    await cleanRender('Neon Flow on a phone', ['nf-e1', 'nf-e2']);
    expect(paletteName((await neonEdges(page)).find((e) => e.id === 'nf-e1')!.ec), 'the uncoloured wire gets a palette colour').not.toBeNull();
    await ev.snap('neon-flow-phone');
  });

  await test.step('a selected card\'s white ports keep their enlarged touch areas', async () => {
    await phone.selectTopic('Sampler');
    const port = handle(SAMPLER, 'right');
    await expect.poll(() => port.evaluate((el) => getComputedStyle(el).opacity), 'ports show on the selected card').toBe('1');
    expect(await port.evaluate((el) => getComputedStyle(el).backgroundColor), 'ports are white').toBe('rgb(244, 244, 245)');
    const zoom = (await app.viewport()).zoom;
    const hit = await port.evaluate((h) => {
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const on = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('.react-flow__handle') === h;
      const reach = (dx: number, dy: number) => { let d = 0; while (d < 200 && on(cx + dx * (d + 0.25), cy + dy * (d + 0.25))) d += 0.25; return d; };
      return { w: reach(-1, 0) + reach(1, 0), h: reach(0, -1) + reach(0, 1), size: r.width };
    });
    const dpr = await page.evaluate(() => devicePixelRatio);
    const step = 2 * (0.25 + 1 / dpr);
    ev.note('Sampler right port at zoom ' + zoom.toFixed(3) + ': drawn ' + (hit.size / zoom).toFixed(1) + 'px, touch area ' + (hit.w / zoom).toFixed(1) + '×' + (hit.h / zoom).toFixed(1) + 'px in card units');
    expect(hit.size / zoom, 'the port is the 16px touch size').toBeCloseTo(16, 0);
    expect(hit.w, 'the touch area is at least ' + MIN_TARGET + ' wide (in card units)').toBeGreaterThanOrEqual(MIN_TARGET * zoom - step);
    expect(hit.h, 'the touch area is at least ' + MIN_TARGET + ' tall (in card units)').toBeGreaterThanOrEqual(MIN_TARGET * zoom - step);
    await ev.snap('selected-card-white-ports');
  });

  await test.step('drag a wire from a port with one finger: white, then a spark at Processing\'s port, then the burst', async () => {
    const from = await app.center(handle(SAMPLER, 'right'));
    await phone.touch('touchStart', [from]);
    await page.waitForTimeout(80);
    const far = await farFromPorts(page, { x: from.x + 60, y: from.y + 140 });
    await slide(from, far);
    const loose = await connecting(page);
    expect(loose, 'a live wire follows the finger').not.toBeNull();
    expect([loose!.snapped, loose!.wire, loose!.spark, loose!.ring], 'away from ports the wire is white with no spark').toEqual([false, 'rgb(255, 255, 255)', false, false]);
    await ev.snap('finger-drags-white-wire');
    const h = await app.center(handle(PROC, 'left'));
    const zoom = (await app.viewport()).zoom;
    const off = 0.45 * SNAP_RADIUS * Math.min(1, zoom);
    const near = { x: h.x - off, y: h.y + off * 0.3 };
    const { near: dist } = await portDistances(page, near);
    expect(dist[PROC], 'the finger is inside Processing\'s snap radius').toBeLessThan(SNAP_RADIUS * zoom);
    for (const [other, d] of Object.entries(dist)) if (other !== PROC) expect(d, 'Processing is the closest card').toBeGreaterThan(dist[PROC]);
    await slide(far, near);
    const hot = await connecting(page);
    expect([hot!.snapped, hot!.spark, hot!.ring], 'near the port the wire snaps with a spark and a ring').toEqual([true, true, true]);
    expect(hot!.sparkKinks, 'the spark is a zig-zag').toBeGreaterThanOrEqual(2);
    expect(paletteName(hot!.zc), 'the spark shows a palette colour: ' + hot!.zc).not.toBeNull();
    const zcRgb = await rgbOf(page, hot!.zc);
    expect([hot!.sparkStroke, hot!.ringStroke], 'spark and ring are drawn in --zc').toEqual([zcRgb, zcRgb]);
    await ev.snap('spark-at-processing-port');
    const releasedAt = Date.now();
    await phone.touch('touchEnd', []);
    await expect.poll(async () => (await app.doc()).edges.filter((e) => e.source === SAMPLER && e.target === PROC).length, 'lifting the finger connects Sampler to Processing').toBe(1);
    const burst = await timeBurst(page, PROC, releasedAt);
    const id = (await app.doc()).edges.find((e) => e.source === SAMPLER && e.target === PROC)!.id;
    const wire = (await neonEdges(page)).find((e) => e.id === id)!;
    expect(wire.ec, 'the new wire ends up in the spark colour (--zc)').toBe(hot!.zc);
    expect([burst.color, burst.visible], 'the burst on Processing shows in the wire colour').toEqual([hot!.zc, true]);
    const into = (await neonEdges(page)).filter((e) => ['nf-e1', 'nf-e2', id].includes(e.id)).map((e) => e.ec);
    expect(new Set(into).size, 'the three wires into Processing all differ: ' + into.join(', ')).toBe(3);
    await ev.snap('connect-burst-phone');
    const gone = await burst.gone();
    ev.note('burst first seen ' + burst.seen + ' ms after the finger lifted, removed after ' + gone + ' ms (product timer ' + BURST_MS + ' ms)');
    expect(gone, 'the burst lasts its full animation').toBeGreaterThanOrEqual(BURST_MS);
    await expect(page.getByTestId('neon-connection')).toHaveCount(0);
  });

  await test.step('the connected pipeline still renders cleanly', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.15 }));
    const ids = (await app.doc()).edges.map((e) => e.id);
    await cleanRender('after connecting', ids);
    await ev.snap('connected-pipeline-phone');
  });

  await test.step('back to Lens Dark from the More sheet', async () => {
    await phone.more('theme-lens-dark');
    if (await page.locator('.theme-option').first().isVisible()) await phone.tap(page.getByTestId('menu-more'));
    await expect.poll(async () => (await app.state()).session.theme).toBe('lens-dark');
    await expect(page.locator('html')).not.toHaveAttribute('data-neon');
    await expect(page.locator('.wfc-port-dot'), 'no port dots outside Neon Flow').toHaveCount(0);
    for (const e of await neonEdges(page)) expect(e.markerEnd, e.id + ' has its arrowhead back').toMatch(/^url\(#wfc-arrow-/);
    await phone.ergonomics('back in Lens Dark');
    await ev.snap('back-to-lens-dark');
  });
});
