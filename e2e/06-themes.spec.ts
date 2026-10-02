import { test, expect } from './support/journey';

test('swap the theme of a diagram', async ({ page, app, ev }) => {
  ev.proves('A user opens the Theme menu and switches the same diagram through all 8 themes (including the hand-drawn Excalidraw Sketch), with a full-page screenshot per theme; each switch changes the canvas palette (--bg) to that theme’s colour, the sketch theme draws rough outlines in a hand-written font that does not leak into the next theme, and the chosen theme survives a page reload.');
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

  await page.getByTestId('menu-theme').click();
  const options = page.locator('.theme-option');
  await expect(options, 'the Theme menu offers 8 themes').toHaveCount(8);
  const themes = await options.evaluateAll((els) => els.map((el) => ({
    id: el.getAttribute('data-testid')!.replace(/^theme-/, ''),
    name: el.querySelector('.theme-name')!.textContent!.trim(),
    swatch: getComputedStyle(el.querySelector('.theme-swatch')!).backgroundColor,
  })));
  expect(themes.map((t) => t.id)).toContain('excalidraw-sketch');
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
      if (t.id === 'excalidraw-sketch') {
        await expect(page.locator('svg.wfc-rough').first(), 'sketch theme draws rough hand-drawn outlines').toBeVisible();
        expect(await titleFont(), 'sketch theme uses the hand-written font').toContain('Patrick Hand');
      } else {
        await expect(page.locator('svg.wfc-rough')).toHaveCount(0);
        expect(await titleFont(), t.name + ' does not use the sketch font').not.toContain('Patrick Hand');
      }
      await page.waitForTimeout(400);
      await ev.snap('theme-' + t.id, { exactName: true, fullPage: true });
    });
  }

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
