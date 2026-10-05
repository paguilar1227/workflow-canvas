import { test, expect, App, type Pt } from './support/journey';
import {
  BURST_MS, SNAP_RADIUS, colourGap, connecting, expectEvenPorts, farFromPorts, isBezier, neonEdges, paletteName, pixel, portDistances, portDots, rgbOf, rgbParts, sidePorts, timeBurst,
} from './support/neon';

const PROMPT = 'nf-prompt', NOISE = 'nf-noise', SAMPLER = 'nf-sampler', PROC = 'nf-proc', PREVIEW = 'nf-preview';

test('connect a pipeline in the Neon Flow theme', async ({ page, app, ev, browser, request }, info) => {
  ev.proves('A mouse user builds a small node-graph pipeline in Neon Flow, the first theme in the Theme menu: connectors are 3px neon wires with a glow, a palette colour when they have none (wires converging on one card all differ, and an automatic colour steps aside for an explicitly coloured wire into that card), bezier curves without arrowheads and a coloured dot on both ends drawn above the cards; cards show a grip and white ports. Wires that share a side of a card each get their own port, evenly spaced at 1/(n+1) … n/(n+1) and ordered by where the other end sits, so three wires into Processing meet it at 1/4, 1/2 and 3/4 and never cross, and a single wire meets the middle. Dragging from a port draws a white wire that sparks with a ring once it is near another card\'s port, the spark colour (--zc) is the colour the new wire ends up with, the connect ripple appears at the new wire\'s own port and the burst is gone after about 1.6 s; a connector added by the AI also bursts at its port, and its ripple stays centred on its own port dot when another wire into that side is hidden inside a collapsed branch (bug K2); dragging a source card re-orders the target\'s ports live, and dragging the target card carries its evenly spaced ports along live; clicking a wire shows the selection halo; with reduced motion the ring is still and no burst is shown (side-by-side.mp4: reduced motion left, normal right); switching to Lens Dark restores arrowheads, plain lines meeting the middle of the side, and no port dots.');
  const docId = await app.newDoc('Neon pipeline');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: PROMPT, title: 'Prompt', subtitle: 'text', x: 0, y: 0 },
    { id: NOISE, title: 'Random noise', subtitle: 'latent', x: 0, y: 140 },
    { id: SAMPLER, title: 'Sampler', subtitle: 'steps 30', x: 0, y: 280 },
    { id: PROC, title: 'Processing', subtitle: 'diffusion', x: 420, y: 140 },
    { id: PREVIEW, title: 'Preview', subtitle: 'image', x: 820, y: 330 },
  ] });
  await app.tool('add_edges', { documentId: docId, edges: [{ id: 'nf-e1', source: PROMPT, target: PROC }] });
  await app.pinTheme('neon-flow');
  ev.note('Pinned to Neon Flow: this journey asserts Neon Flow visuals (neon wires, port dots, per-wire ports, spark and burst), so it must not depend on which theme is the default.');
  await app.open(docId);
  await app.tool('set_ui', { inspector: false, minimap: false });
  await app.fit();

  const edgeById = async (id: string) => {
    const e = (await neonEdges(page)).find((x) => x.id === id);
    expect(e, 'connector ' + id + ' is drawn').toBeTruthy();
    return e!;
  };
  const handle = (id: string, side: string) => app.rfNode(id).locator('.react-flow__handle[data-handlepos="' + side + '"]');
  const glide = async (p: typeof page, from: Pt, to: Pt, steps = 14) => {
    for (let i = 1; i <= steps; i++) {
      await p.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await p.waitForTimeout(20);
    }
    await p.waitForTimeout(200);
  };
  /** A point beside a card's port, well inside the snap radius and closer to that port than to any other card's. */
  const nearPort = async (a: App, id: string, side: 'left' | 'top') => {
    const h = await a.center(a.rfNode(id).locator('.react-flow__handle[data-handlepos="' + side + '"]'));
    const zoom = (await a.viewport()).zoom;
    const off = 0.45 * SNAP_RADIUS * Math.min(1, zoom);
    const pt = side === 'left' ? { x: h.x - off, y: h.y + off * 0.3 } : { x: h.x + off * 0.3, y: h.y - off };
    const { near } = await portDistances(a.page, pt);
    expect(near[id], 'the pointer is inside the snap radius of ' + id).toBeLessThan(SNAP_RADIUS * zoom);
    for (const [other, d] of Object.entries(near)) if (other !== id) expect(d, id + ' is the closest card').toBeGreaterThan(near[id]);
    return pt;
  };

  await test.step('pick Neon Flow, the first theme in the Theme menu', async () => {
    await page.getByTestId('menu-theme').click();
    await expect(page.locator('.theme-option'), 'the Theme menu offers 10 themes').toHaveCount(10);
    await expect(page.locator('.theme-option').first(), 'Neon Flow is listed first').toHaveAttribute('data-testid', 'theme-neon-flow');
    await expect(page.getByTestId('theme-neon-flow')).toContainText('Neon Flow');
    await ev.snap('theme-menu-neon-flow');
    await page.getByTestId('theme-neon-flow').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-theme')).toContainText('Neon Flow');
    await expect.poll(async () => (await app.state()).session.theme).toBe('neon-flow');
    await expect(page.locator('html'), 'the page is in Neon Flow mode').toHaveAttribute('data-neon', '');
    await expect(page.locator('.wfc-edge-path.neon')).toHaveCount(1);
    await page.waitForTimeout(300);
    await ev.snap('neon-flow-picked');
  });

  let autoColour = '';
  await test.step('an uncoloured wire takes a palette colour that steps aside for an explicit colour into the same card', async () => {
    const e1 = await edgeById('nf-e1');
    autoColour = paletteName(e1.ec) ?? '';
    expect(autoColour, 'the uncoloured wire gets a Neon Flow palette colour: ' + e1.ec).not.toBe('');
    const releasedAt = Date.now();
    await app.tool('add_edges', { documentId: docId, edges: [{ id: 'nf-e2', source: NOISE, target: PROC, color: autoColour }] });
    await expect.poll(async () => (await neonEdges(page)).map((e) => e.id), 'the AI wire is drawn').toContain('nf-e2');
    const burst = await timeBurst(page, PROC, releasedAt);
    expect((await edgeById('nf-e2')).ec, 'the explicitly coloured wire keeps its own colour').toBe('var(--c-' + autoColour + ')');
    await expectEvenPorts(page, PROC, 'left', ['nf-e1', 'nf-e2'], 'two wires into Processing');
    const e2end = (await edgeById('nf-e2')).end;
    expect(Math.hypot(burst.ripple.x - e2end.x, burst.ripple.y - e2end.y), 'the ripple appears at the AI wire\'s own port').toBeLessThanOrEqual(1.5);
    const moved = paletteName((await edgeById('nf-e1')).ec);
    expect(moved, 'the uncoloured wire still has a palette colour').not.toBeNull();
    expect(moved, 'the uncoloured wire no longer shares the explicit wire\'s colour').not.toBe(autoColour);
    ev.note('uncoloured Prompt wire was ' + autoColour + '; after an explicit ' + autoColour + ' wire into Processing it is ' + moved);
    await ev.snap('explicit-colour-into-processing');
    await burst.gone();
  });

  await test.step('wires are 3px neon bezier curves with a glow, no arrowheads and a dot on both ends above the cards', async () => {
    const edges = await neonEdges(page);
    expect(edges.map((e) => e.id).sort()).toEqual(['nf-e1', 'nf-e2']);
    for (const e of edges) {
      expect(e.cls, e.id + ' is a neon wire').toContain('neon');
      expect(e.width, e.id + ' is 3px wide').toBe('3px');
      expect(e.filter, e.id + ' glows').toContain('drop-shadow');
      expect(isBezier(e.d), e.id + ' is one bezier curve: ' + e.d).toBe(true);
      expect([e.markerStart, e.markerEnd], e.id + ' has no arrowheads').toEqual([null, null]);
      expect(e.haloBeforePath, e.id + ' has a soft halo under the wire').toBe(true);
      expect(e.stroke, e.id + ' is drawn in its colour').toBe(await rgbOf(page, e.ec));
    }
    await expect(page.locator('.react-flow__edge path[marker-end], .react-flow__edge path[marker-start]'), 'no arrowheads anywhere').toHaveCount(0);
    const dots = await portDots(page);
    expect(dots, 'two port dots per visible connector').toHaveLength(2 * edges.length);
    for (const e of edges) {
      for (const end of [e.start, e.end]) {
        const here = dots.filter((d) => Math.hypot(d.x - end.x, d.y - end.y) < 1.5).map((d) => d.fill);
        expect(here, e.id + ' has a dot in its colour at ' + JSON.stringify(end)).toContain(e.stroke);
      }
      const dot = dots.find((d) => Math.hypot(d.x - e.start.x, d.y - e.start.y) < 1.5)!;
      const card = await app.center(app.rfNode((await app.doc()).edges.find((x) => x.id === e.id)!.source));
      const len = Math.hypot(card.x - e.start.x, card.y - e.start.y);
      const inside = { x: e.start.x + ((card.x - e.start.x) / len) * (dot.size / 4), y: e.start.y + ((card.y - e.start.y) / len) * (dot.size / 4) };
      const painted = await pixel(page, inside);
      const [toDot, toCard] = [colourGap(painted, rgbParts(dot.fill)), colourGap(painted, rgbParts(await rgbOf(page, 'var(--node-bg)')))];
      ev.note(e.id + ' source dot, inner half over the card: painted ' + JSON.stringify(painted) + ', dot ' + dot.fill + ' (gap ' + toDot + '), card (gap ' + toCard + ')');
      expect(toDot, e.id + ' end dot is drawn above the card, not covered by it').toBeLessThan(toCard);
    }
    const grip = await app.node(PROC).evaluate((el) => { const s = getComputedStyle(el, '::after'); return { content: s.content, bg: s.backgroundImage, w: s.width, h: s.height }; });
    expect(grip.bg, 'cards show the six-dot grip').toContain('radial-gradient');
    expect([grip.w, grip.h]).toEqual(['8px', '12px']);
    await app.node(SAMPLER).hover();
    const port = handle(SAMPLER, 'right');
    await expect(port).toBeVisible();
    await expect.poll(() => port.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await port.evaluate((el) => getComputedStyle(el).backgroundColor), 'ports are white').toBe('rgb(244, 244, 245)');
    await ev.snap('neon-wires-dots-grip-ports');
  });

  let sparkColour = '';
  await test.step('drag a wire from a port: white to the pointer, then a spark and ring near the target port', async () => {
    await app.node(SAMPLER).hover();
    const from = await app.center(handle(SAMPLER, 'right'));
    await page.mouse.move(from.x, from.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    const far = await farFromPorts(page, { x: from.x + 200, y: from.y + 140 });
    await glide(page, from, far);
    const loose = await connecting(page);
    expect(loose, 'a live wire follows the pointer').not.toBeNull();
    expect(loose!.snapped, 'far from every port the wire does not snap').toBe(false);
    expect(loose!.wire, 'the live wire is white').toBe('rgb(255, 255, 255)');
    expect([loose!.spark, loose!.ring], 'no spark or ring away from ports').toEqual([false, false]);
    await ev.snap('dragging-white-wire');
    const near = await nearPort(app, PROC, 'left');
    await glide(page, far, near);
    const hot = await connecting(page);
    expect(hot!.snapped, 'near Processing\'s port the wire snaps').toBe(true);
    expect(hot!.spark, 'a spark jumps to the port').toBe(true);
    expect(hot!.sparkKinks, 'the spark is a zig-zag').toBeGreaterThanOrEqual(2);
    expect(hot!.ring, 'a ring circles the port').toBe(true);
    expect(hot!.ringAnim, 'the ring pulses').toBe('neon-ring');
    sparkColour = hot!.zc;
    expect(paletteName(sparkColour), 'the spark shows a palette colour: ' + sparkColour).not.toBeNull();
    const zcRgb = await rgbOf(page, sparkColour);
    expect(hot!.sparkStroke, 'the spark is drawn in --zc').toBe(zcRgb);
    expect(hot!.ringStroke, 'the ring is drawn in --zc').toBe(zcRgb);
    await ev.snap('spark-and-ring-at-port');
    const releasedAt = Date.now();
    await page.mouse.up();
    await expect.poll(async () => (await app.doc()).edges.filter((e) => e.source === SAMPLER && e.target === PROC).length, 'releasing connects Sampler to Processing').toBe(1);
    const burst = await timeBurst(page, PROC, releasedAt);
    const id = (await app.doc()).edges.find((e) => e.source === SAMPLER && e.target === PROC)!.id;
    const wire = await edgeById(id);
    expect(wire.ec, 'the new wire ends up in the spark colour (--zc)').toBe(sparkColour);
    expect(wire.cls, 'the new wire plays the connect animation').toContain('born');
    expect(burst.color, 'the burst on Processing is the wire colour').toBe(sparkColour);
    expect(burst.visible, 'the burst is visible on the card').toBe(true);
    await ev.snap('connect-burst-on-processing');
    const into = (await neonEdges(page)).filter((e) => ['nf-e1', 'nf-e2', id].includes(e.id)).map((e) => e.ec);
    expect(new Set(into).size, 'the three wires converging on Processing all have different colours: ' + into.join(', ')).toBe(3);
    const ports = await expectEvenPorts(page, PROC, 'left', ['nf-e1', 'nf-e2', id], 'three wires into Processing');
    ev.note('three wires into Processing meet its left side at ' + ports.map((p) => p.f.toFixed(3)).join(', ') + ' (Prompt, Random noise, Sampler)');
    expect(Math.hypot(burst.ripple.x - wire.end.x, burst.ripple.y - wire.end.y), 'the ripple appears at the new wire\'s own port (3/4 down the side), not the middle').toBeLessThanOrEqual(1.5);
    const gone = await burst.gone();
    ev.note('burst first seen ' + burst.seen + ' ms after release, removed ' + gone + ' ms after release (product timer ' + BURST_MS + ' ms)');
    expect(gone, 'the burst lasts its full animation').toBeGreaterThanOrEqual(BURST_MS);
    await expect(page.getByTestId('neon-connection')).toHaveCount(0);
    await expect.poll(async () => (await edgeById(id)).cls, 'the born state is cleared with the burst').not.toContain('born');
    await ev.snap('connected-burst-gone');
  });

  await test.step('a connector added by the AI also bursts on its target', async () => {
    const releasedAt = Date.now();
    await app.tool('add_edges', { documentId: docId, edges: [{ id: 'nf-e4', source: PROC, target: PREVIEW }] });
    const burst = await timeBurst(page, PREVIEW, releasedAt);
    const wire = await edgeById('nf-e4');
    expect(paletteName(wire.ec), 'the AI connector gets a palette colour').not.toBeNull();
    expect(burst.color, 'the burst is the new wire\'s colour').toBe(wire.ec);
    await expectEvenPorts(page, PREVIEW, 'left', ['nf-e4'], 'a single wire into Preview');
    expect(Math.hypot(burst.ripple.x - wire.end.x, burst.ripple.y - wire.end.y), 'the ripple appears at the wire\'s port in the middle of the side').toBeLessThanOrEqual(1.5);
    expect(wire.cls).toContain('born');
    await ev.snap('ai-connector-burst');
    await burst.gone();
  });

  await test.step('a wire hidden in a collapsed branch does not push the ripple off the new wire\'s port dot', async () => {
    const TARGET = 'k2-target', LEAF_WIRE = 'k2-leaf-wire';
    const hiddenDoc = await app.newDoc('Neon hidden branch');
    await app.tool('add_nodes', { documentId: hiddenDoc, nodes: [
      { id: TARGET, title: 'Target', x: 520, y: 200 },
      { id: 'k2-one', title: 'One', x: 0, y: 100 },
      { id: 'k2-four', title: 'Four', x: 0, y: 200 },
      { id: 'k2-two', title: 'Two', x: 0, y: 300 },
      { id: 'k2-branch', title: 'Branch', x: 0, y: 520 },
    ] });
    await app.tool('add_nodes', { documentId: hiddenDoc, nodes: [{ id: 'k2-leaf', title: 'Leaf', parentId: 'k2-branch' }] });
    await app.tool('add_edges', { documentId: hiddenDoc, edges: [
      { id: 'k2-e1', source: 'k2-one', target: TARGET },
      { id: 'k2-e2', source: 'k2-two', target: TARGET },
      { id: LEAF_WIRE, source: 'k2-leaf', target: TARGET },
    ] });
    await app.open(hiddenDoc);
    await app.fit();
    await expectEvenPorts(page, TARGET, 'left', ['k2-e1', 'k2-e2', LEAF_WIRE], 'with Branch expanded, Leaf\'s wire shares Target\'s left side');
    await ev.snap('hidden-branch-expanded');
    const collapse = app.rfNode('k2-branch').locator('.wfc-collapse');
    await expect(collapse).toHaveAttribute('aria-label', 'Collapse branch');
    await collapse.click();
    await expect(collapse, 'Branch is collapsed with its one child hidden').toHaveText('+1');
    await expect.poll(async () => (await neonEdges(page)).map((e) => e.id).sort(), 'Leaf\'s wire is hidden with Leaf').toEqual(['k2-e1', 'k2-e2']);
    await expectEvenPorts(page, TARGET, 'left', ['k2-e1', 'k2-e2'], 'with Leaf hidden in the collapsed branch');
    await ev.snap('hidden-branch-collapsed');
    const releasedAt = Date.now();
    await app.tool('add_edges', { documentId: hiddenDoc, edges: [{ id: 'k2-e4', source: 'k2-four', target: TARGET }] });
    const burst = await timeBurst(page, TARGET, releasedAt);
    await expectEvenPorts(page, TARGET, 'left', ['k2-e1', 'k2-e4', 'k2-e2'], 'after the AI adds Four → Target');
    const wire = await edgeById('k2-e4');
    expect(burst.color, 'the burst is the new wire\'s colour').toBe(wire.ec);
    const dot = (await portDots(page)).map((d) => ({ ...d, gap: Math.hypot(d.x - wire.end.x, d.y - wire.end.y) })).sort((a, b) => a.gap - b.gap)[0];
    expect(dot.gap, 'Four → Target has its own port dot on Target').toBeLessThanOrEqual(1);
    const box = await app.box(app.rfNode(TARGET));
    const along = (y: number) => ((y - box.y) / box.height).toFixed(3);
    const off = Math.hypot(burst.ripple.x - dot.x, burst.ripple.y - dot.y);
    ev.note('Leaf → Target hidden in the collapsed branch: the ripple of the AI wire Four → Target is ' + off.toFixed(2) + 'px from its port dot (ripple at ' + along(burst.ripple.y) + ', dot at ' + along(dot.y) + ' of Target\'s left side)');
    expect(off, 'the ripple is centred on the new wire\'s port dot (ripple at ' + along(burst.ripple.y) + ', dot at ' + along(dot.y) + ' of the side)').toBeLessThanOrEqual(1);
    await ev.snap('hidden-branch-ripple-at-port');
    await burst.gone();
    await app.open(docId);
    await app.fit();
  });

  await test.step('dragging a card re-orders the ports live, so the wires into Processing never cross', async () => {
    const e3 = (await app.doc()).edges.find((e) => e.source === SAMPLER && e.target === PROC)!.id;
    const pane = await app.paneBox();
    const promptAt = await app.center(app.node(PROMPT));
    const sampler = await app.box(app.node(SAMPLER));
    const below = { x: promptAt.x, y: sampler.y + sampler.height * 2 };
    expect(below.y, 'there is room below Sampler on screen').toBeLessThan(pane.y + pane.height - 60);
    await app.drag(promptAt, below, {
      steps: 20,
      beforeRelease: async () => {
        const ports = await expectEvenPorts(page, PROC, 'left', ['nf-e2', e3, 'nf-e1'], 'while Prompt is dragged below Sampler');
        ev.note('mid-drag, with Prompt below Sampler, Processing\'s left ports are ' + ports.map((q) => q.id + ' at ' + q.f.toFixed(3)).join(', '));
        await ev.snap('ports-reorder-while-dragging-prompt');
      },
    });
    await expectEvenPorts(page, PROC, 'left', ['nf-e2', e3, 'nf-e1'], 'after Prompt is dropped below Sampler');
    const procAt = await app.center(app.node(PROC));
    const before = (await sidePorts(page, PROC, 'left')).map((q) => q.at);
    const boxBefore = await app.box(app.rfNode(PROC));
    const shift = { x: 60, y: 80 };
    await app.drag(procAt, { x: procAt.x + shift.x, y: procAt.y + shift.y }, {
      steps: 16,
      beforeRelease: async () => {
        const box = await app.box(app.rfNode(PROC));
        const moved = { x: box.x - boxBefore.x, y: box.y - boxBefore.y };
        expect(Math.hypot(moved.x, moved.y), 'Processing follows the pointer mid-drag').toBeGreaterThan(0.8 * Math.hypot(shift.x, shift.y));
        const ports = await expectEvenPorts(page, PROC, 'left', ['nf-e2', e3, 'nf-e1'], 'while Processing itself is dragged');
        ports.forEach((q, i) => expect(Math.hypot(q.at.x - before[i].x - moved.x, q.at.y - before[i].y - moved.y), q.id + "'s port moves with Processing").toBeLessThanOrEqual(1.5));
        await ev.snap('ports-follow-while-dragging-processing');
      },
    });
    await app.drag(await app.center(app.node(PROC)), procAt, { steps: 16 });
    await app.drag(await app.center(app.node(PROMPT)), promptAt, { steps: 20 });
    await expectEvenPorts(page, PROC, 'left', ['nf-e1', 'nf-e2', e3], 'with Prompt and Processing back in place');
    await ev.snap('ports-back-in-order');
  });

  await test.step('clicking a wire shows the selection halo', async () => {
    await page.mouse.click(...(Object.values(await app.edgeMidpoint('nf-e1')) as [number, number]));
    await expect.poll(async () => app.selection()).toEqual({ nodes: [], edges: ['nf-e1'] });
    const e = await edgeById('nf-e1');
    expect(e.haloSelected, 'the halo is shown as selected').toBe(true);
    expect(e.haloStroke, 'the halo uses the selection colour').toBe(await rgbOf(page, 'var(--selection)'));
    expect(e.stroke, 'the wire keeps its own colour while selected').toBe(await rgbOf(page, e.ec));
    expect(e.width).toBe('4px');
    await ev.snap('wire-selected-halo');
    await page.keyboard.press('Escape');
  });

  await test.step('with reduced motion the ring is still and no burst is shown', async () => {
    const viewport = { width: 1440, height: 900 };
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, baseURL: info.project.use.baseURL, reducedMotion: 'reduce', recordVideo: { dir: info.outputPath('reduced-video'), size: viewport } });
    const calmPage = await ctx.newPage();
    const calm = new App(calmPage, request);
    try {
      await calm.open(docId);
      await calmPage.getByTestId('fit-view').click();
      await calmPage.waitForTimeout(500);
      await calm.node(PROMPT).hover();
      const from = await calm.center(calm.rfNode(PROMPT).locator('.react-flow__handle[data-handlepos="right"]'));
      await calmPage.mouse.move(from.x, from.y);
      await calmPage.waitForTimeout(120);
      await calmPage.mouse.down();
      const far = await farFromPorts(calmPage, { x: from.x + 120, y: from.y + 420 });
      await glide(calmPage, from, far);
      const near = await nearPort(calm, PREVIEW, 'left');
      await glide(calmPage, far, near);
      const hot = await connecting(calmPage);
      expect(hot!.snapped && hot!.ring, 'the ring still marks the port').toBe(true);
      expect(hot!.ringAnim, 'the ring does not pulse with reduced motion').toBe('none');
      await ev.snap('reduced-motion-still-ring', { page: calmPage });
      const releasedAt = Date.now();
      await calmPage.mouse.up();
      await expect.poll(async () => (await calm.doc()).edges.filter((e) => e.source === PROMPT && e.target === PREVIEW).length).toBe(1);
      const quiet = await timeBurst(calmPage, PREVIEW, releasedAt);
      expect([quiet.display, quiet.visible], 'no burst is shown with reduced motion').toEqual(['none', false]);
      const loud = await timeBurst(page, PREVIEW, releasedAt);
      expect(loud.visible, 'the same connector bursts for the teammate without reduced motion').toBe(true);
      const id = (await calm.doc()).edges.find((e) => e.source === PROMPT && e.target === PREVIEW)!.id;
      const calmWire = (await neonEdges(calmPage)).find((e) => e.id === id)!;
      expect(calmWire.anim, 'the new wire does not flash with reduced motion').toBe('none');
      expect(calmWire.ec, 'the new wire still ends up in the spark colour').toBe(hot!.zc);
      await ev.snap('reduced-motion-no-burst', { page: calmPage });
      await ev.snap('normal-motion-burst', { page });
      await loud.gone();
    } finally {
      await ctx.close();
      const video = calmPage.video();
      if (video) await info.attach('reduced-motion', { path: await video.path(), contentType: 'video/webm' });
    }
  });

  await test.step('back to Lens Dark: arrowheads and plain lines return, port dots go', async () => {
    await page.getByTestId('menu-theme').click();
    await page.getByTestId('theme-lens-dark').click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await app.state()).session.theme).toBe('lens-dark');
    await expect(page.locator('html')).not.toHaveAttribute('data-neon');
    await expect(page.locator('.wfc-port-dot'), 'no port dots outside Neon Flow').toHaveCount(0);
    await expect(page.locator('.wfc-neon-halo')).toHaveCount(0);
    const edges = await neonEdges(page);
    expect(edges.length).toBe(5);
    for (const e of edges) {
      expect(e.cls).not.toContain('neon');
      expect(e.markerEnd, e.id + ' has its arrowhead back').toMatch(/^url\(#wfc-arrow-/);
      expect(isBezier(e.d), e.id + ' is a smooth-step line again').toBe(false);
    }
    const middle = await sidePorts(page, PROC, 'left');
    expect(middle.length, 'three wires still meet Processing\'s left side').toBe(3);
    const procBox = await app.box(app.rfNode(PROC));
    for (const q of middle) expect(Math.abs(q.f - 0.5) * procBox.height, q.id + ' meets the middle of the side in Lens Dark (got ' + q.f.toFixed(3) + ')').toBeLessThanOrEqual(1.5);
    const grip = await app.node(PROC).evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
    expect(grip, 'no grip outside Neon Flow').not.toContain('radial-gradient');
    await ev.snap('back-to-lens-dark');
    await page.mouse.click(...(Object.values(await app.edgeMidpoint('nf-e1')) as [number, number]));
    await expect.poll(async () => app.selection()).toEqual({ nodes: [], edges: ['nf-e1'] });
    const picked = (await neonEdges(page)).find((x) => x.id === 'nf-e1')!;
    expect(picked.stroke, 'a clicked connector in Lens Dark uses the selection colour').toBe(await rgbOf(page, 'var(--selection)'));
    await ev.snap('lens-dark-connector-selected');
    await page.keyboard.press('Escape');
  });
});
