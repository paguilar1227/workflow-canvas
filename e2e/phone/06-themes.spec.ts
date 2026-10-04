import { test, expect } from '../support/journey';
import { neonEdges } from '../support/neon';

test('swap the theme of a diagram', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person opens the More sheet and switches the same diagram through all 10 themes listed there (including the hand-drawn Excalidraw Sketch in light and dark, and Neon Flow), with a screenshot per theme; each switch changes the canvas palette (--bg) to that theme’s swatch colour, the sketch themes draw rough outlines in a hand-written font that does not leak into the next theme, only Neon Flow draws 3px neon wires without arrowheads, a dot on both ends of every connector and neon mind-map branches (leaving it brings the arrowheads back and removes the dots), the phone chrome stays ergonomic in every theme, and the chosen theme survives a reload.');
  const docId = await app.newDoc('Theme gallery', 'architecture');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'tg-root', title: 'Launch v2', shape: 'pill', color: 'blue', x: 40, y: 470 },
    { title: 'Docs', parentId: 'tg-root', status: 'done' },
    { title: 'Pricing', parentId: 'tg-root', status: 'doing', priority: 1, color: 'amber' },
    { title: 'Risk review', shape: 'diamond', color: 'red', x: 640, y: 450 },
    { kind: 'sticky', title: 'Ship by Friday', color: 'amber', x: 880, y: 430 },
  ] });
  await app.open(docId);
  await phone.fit();

  const bgRgb = () => page.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const el = document.createElement('div'); el.style.color = v; document.body.appendChild(el);
    const c = getComputedStyle(el).color; el.remove(); return c;
  });
  const titleFont = () => page.locator('.wfc-title').first().evaluate((el) => getComputedStyle(el).fontFamily);
  const neonLook = async (on: boolean, where: string) => {
    if (!on) {
      await expect(page.locator('html'), where + ': not in Neon Flow mode').not.toHaveAttribute('data-neon');
      await expect(page.locator('.wfc-port-dot, .wfc-edge-path.neon, .wfc-branch.neon'), where + ': no neon wires or port dots').toHaveCount(0);
      return;
    }
    await expect(page.locator('html'), where + ': the page is in Neon Flow mode').toHaveAttribute('data-neon', '');
    const edges = await neonEdges(page);
    expect(edges.map((e) => e.id).sort(), where + ': every connector is drawn').toEqual((await app.doc()).edges.map((e) => e.id).sort());
    for (const e of edges) expect([e.cls.includes('neon'), e.width, e.markerEnd], where + ': ' + e.id + ' is a 3px neon wire without an arrowhead').toEqual([true, '3px', null]);
    await expect(page.locator('.wfc-port-dot'), where + ': a dot on both ends of every connector').toHaveCount(2 * edges.length);
    await expect(page.locator('.wfc-branch.neon'), where + ': both mind-map branches (Docs, Pricing) are neon too').toHaveCount(2);
    const branches = await page.locator('.wfc-branch.neon').evaluateAll((els) => els.map((el) => ({ len: (el as SVGPathElement).getTotalLength(), stroke: getComputedStyle(el).stroke })));
    for (const b of branches) expect(b.len > 0 && b.stroke !== 'none', where + ': a neon branch is drawn: ' + JSON.stringify(b)).toBe(true);
  };
  const options = page.locator('.theme-option');
  const pick = async (id: string) => {
    await phone.more('theme-' + id);
    if (await options.first().isVisible()) await phone.tap(page.getByTestId('menu-more'));
    await expect(options.first(), 'the More sheet closes after picking a theme').toBeHidden();
    await expect.poll(async () => (await app.state()).session.theme).toBe(id);
  };

  await phone.tap(page.getByTestId('menu-more'));
  await expect(options, 'the More sheet offers 10 themes').toHaveCount(10);
  const themes = await options.evaluateAll((els) => els.map((el) => ({
    id: el.getAttribute('data-testid')!.replace(/^theme-/, ''),
    name: el.querySelector('.theme-name')!.textContent!.trim(),
    swatch: getComputedStyle(el.querySelector('.theme-swatch')!).backgroundColor,
  })));
  expect(themes.map((t) => t.id)).toEqual(expect.arrayContaining(['excalidraw-sketch', 'excalidraw-sketch-dark', 'neon-flow']));
  const sketchThemes = new Set(['excalidraw-sketch', 'excalidraw-sketch-dark']);
  await options.first().scrollIntoViewIfNeeded();
  await phone.ergonomics('More sheet');
  await ev.snap('more-sheet-themes');
  await phone.tap(page.getByTestId('menu-more'));
  await expect(options.first()).toBeHidden();

  const seen: Record<string, string> = {};
  for (const t of themes) {
    await test.step('switch to ' + t.name, async () => {
      await pick(t.id);
      await expect.poll(bgRgb, 'canvas background is the ' + t.name + ' colour').toBe(t.swatch);
      seen[t.id] = await bgRgb();
      if (sketchThemes.has(t.id)) {
        await expect(page.locator('svg.wfc-rough').first(), 'sketch theme draws rough hand-drawn outlines').toBeVisible();
        expect(await titleFont(), 'sketch theme uses the hand-written font').toContain('Patrick Hand');
      } else {
        await expect(page.locator('svg.wfc-rough')).toHaveCount(0);
        expect(await titleFont(), t.name + ' does not use the sketch font').not.toContain('Patrick Hand');
      }
      await neonLook(t.id === 'neon-flow', t.name);
      await page.waitForTimeout(400);
      await phone.ergonomics(t.name);
      await ev.snap('theme-' + t.id, { exactName: true });
      await phone.tap(page.getByTestId('menu-more'));
      await expect(page.getByTestId('theme-' + t.id), 'the More sheet marks the picked theme active').toHaveClass(/active/);
      await phone.tap(page.getByTestId('menu-more'));
      await expect(options.first()).toBeHidden();
    });
  }

  await test.step('leaving Neon Flow brings back arrowheads and removes the port dots', async () => {
    if ((await app.state()).session.theme !== 'neon-flow') await pick('neon-flow');
    await neonLook(true, 'Neon Flow');
    await pick('lens-dark');
    await neonLook(false, 'back in Lens Dark');
    for (const e of await neonEdges(page)) expect(e.markerEnd, e.id + ' has its arrowhead back').toMatch(/^url\(#wfc-arrow-/);
    await ev.snap('left-neon-flow');
  });

  await test.step('the dark sketch variant is a dark canvas with light hand-drawn strokes', async () => {
    const luminance = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    expect(luminance(seen['excalidraw-sketch-dark']), 'dark canvas').toBeLessThan(40);
    expect(luminance(seen['excalidraw-sketch']), 'light canvas').toBeGreaterThan(200);
  });

  await test.step('leaving the sketch theme drops its hand-drawn font and outlines', async () => {
    if ((await app.state()).session.theme !== 'excalidraw-sketch') await pick('excalidraw-sketch');
    await expect.poll(titleFont).toContain('Patrick Hand');
    await pick('paper-blueprint');
    await expect.poll(titleFont, 'node titles leave the hand-written font').not.toContain('Patrick Hand');
    await expect(page.locator('svg.wfc-rough')).toHaveCount(0);
  });

  await test.step('the chosen theme persists after a reload', async () => {
    await page.reload();
    await app.waitForDoc(docId);
    expect((await app.state()).session.theme).toBe('paper-blueprint');
    expect(await bgRgb()).toBe(seen['paper-blueprint']);
    expect((await app.tool<{ active: string }>('list_themes')).active, 'the server remembers the theme').toBe('paper-blueprint');
    await phone.ergonomics('after reload');
    await ev.snap('paper-blueprint-after-reload');
  });

  await test.step('the outline drawer behaves like a drawer in the chosen theme', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });

  await test.step('switch back to Lens Dark', async () => {
    await pick('lens-dark');
    await expect.poll(bgRgb).toBe(seen['lens-dark']);
  });
});
