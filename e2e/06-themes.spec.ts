import { test, expect } from './support/journey';
import { neonEdges } from './support/neon';

test('swap the theme of a diagram', async ({ page, app, ev }) => {
  ev.proves('A user opens the Theme menu and switches the same diagram through all 10 themes (including the hand-drawn Excalidraw Sketch in light and dark, and Neon Flow), with a full-page screenshot per theme; each switch changes the canvas palette (--bg) to that theme’s colour, both sketch themes draw rough outlines in a hand-written font that does not leak into the next theme, only Neon Flow draws 3px neon wires without arrowheads, a dot on both ends of every connector and neon mind-map branches (leaving it brings the arrowheads back and removes the dots), and the chosen theme survives a page reload.');
  const docId = await app.newDoc('Theme gallery', 'architecture');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'tg-root', title: 'Launch v2', shape: 'pill', color: 'blue', x: 40, y: 470 },
    { title: 'Docs', parentId: 'tg-root', status: 'done' },
    { title: 'Pricing', parentId: 'tg-root', status: 'doing', priority: 1, color: 'amber' },
    { title: 'Risk review', shape: 'diamond', color: 'red', x: 640, y: 450 },
    { kind: 'sticky', title: 'Ship by Friday', color: 'amber', x: 880, y: 430 },
  ] });
  await app.open(docId);
  await app.fit();

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

  await page.getByTestId('menu-theme').click();
  const options = page.locator('.theme-option');
  await expect(options, 'the Theme menu offers 10 themes').toHaveCount(10);
  const themes = await options.evaluateAll((els) => els.map((el) => ({
    id: el.getAttribute('data-testid')!.replace(/^theme-/, ''),
    name: el.querySelector('.theme-name')!.textContent!.trim(),
    swatch: getComputedStyle(el.querySelector('.theme-swatch')!).backgroundColor,
  })));
  expect(themes.map((t) => t.id)).toEqual(expect.arrayContaining(['excalidraw-sketch', 'excalidraw-sketch-dark', 'neon-flow']));
  const sketchThemes = new Set(['excalidraw-sketch', 'excalidraw-sketch-dark']);
  await ev.snap('theme-menu-open');
  await page.keyboard.press('Escape');

  const seen: Record<string, string> = {};
  for (const t of themes) {
    await test.step('switch to ' + t.name, async () => {
      await page.getByTestId('menu-theme').click();
      await page.getByTestId('theme-' + t.id).click();
      await expect(page.getByTestId('theme-' + t.id), 'the picked theme is marked active').toHaveClass(/active/);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('menu-theme')).toContainText(t.name);
      await expect.poll(async () => (await app.state()).session.theme).toBe(t.id);
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
      await ev.snap('theme-' + t.id, { exactName: true, fullPage: true });
    });
  }

  await test.step('leaving Neon Flow brings back arrowheads and removes the port dots', async () => {
    if ((await app.state()).session.theme !== 'neon-flow') {
      await page.getByTestId('menu-theme').click();
      await page.getByTestId('theme-neon-flow').click();
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await app.state()).session.theme).toBe('neon-flow');
    }
    await neonLook(true, 'Neon Flow');
    await page.getByTestId('menu-theme').click();
    await page.getByTestId('theme-lens-dark').click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await app.state()).session.theme).toBe('lens-dark');
    await neonLook(false, 'back in Lens Dark');
    for (const e of await neonEdges(page)) expect(e.markerEnd, e.id + ' has its arrowhead back').toMatch(/^url\(#wfc-arrow-/);
    await ev.snap('left-neon-flow');
  });

  await test.step('long theme names never widen the page past a 1280px window', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const id of ['excalidraw-sketch-dark', 'excalidraw-sketch']) {
      await page.getByTestId('menu-theme').click();
      await page.getByTestId('theme-' + id).click();
      await page.keyboard.press('Escape');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), id + ' fits the window').toBeLessThanOrEqual(0);
      await expect(page.getByTestId('inspector')).toBeInViewport({ ratio: 0.95 });
    }
    await ev.snap('sketch-dark-fits-1280');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('the dark sketch variant is a dark canvas with light hand-drawn strokes', async () => {
    const luminance = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    expect(luminance(seen['excalidraw-sketch-dark']), 'dark canvas').toBeLessThan(40);
    expect(luminance(seen['excalidraw-sketch']), 'light canvas').toBeGreaterThan(200);
  });

  await test.step('leaving the sketch theme drops its hand-drawn font and outlines', async () => {
    if ((await app.state()).session.theme !== 'excalidraw-sketch') {
      await page.getByTestId('menu-theme').click();
      await page.getByTestId('theme-excalidraw-sketch').click();
      await page.keyboard.press('Escape');
    }
    await expect.poll(titleFont).toContain('Patrick Hand');
    await page.getByTestId('menu-theme').click();
    await page.getByTestId('theme-paper-blueprint').click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await app.state()).session.theme).toBe('paper-blueprint');
    await expect.poll(titleFont, 'node titles leave the hand-written font').not.toContain('Patrick Hand');
    await expect(page.locator('svg.wfc-rough')).toHaveCount(0);
  });

  await test.step('the chosen theme persists after a reload', async () => {
    await page.reload();
    await app.waitForDoc(docId);
    expect((await app.state()).session.theme).toBe('paper-blueprint');
    expect(await bgRgb()).toBe(seen['paper-blueprint']);
    await expect(page.getByTestId('menu-theme')).toContainText('Paper Blueprint');
    expect((await app.tool<{ active: string }>('list_themes')).active, 'the server remembers the theme').toBe('paper-blueprint');
    await ev.snap('paper-blueprint-after-reload');
  });

  await test.step('switch back to Lens Dark', async () => {
    await page.getByTestId('menu-theme').click();
    await page.getByTestId('theme-lens-dark').click();
    await page.keyboard.press('Escape');
    await expect.poll(bgRgb).toBe(seen['lens-dark']);
  });
});
