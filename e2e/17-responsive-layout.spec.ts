import { devices, type Page } from '@playwright/test';
import { test, expect, App } from './support/journey';
import { Phone } from './support/phone';

/**
 * Sizes that sit on either side of the drawer ("compact") threshold (App.tsx COMPACT_QUERY): docked outline 268 +
 * inspector 292 + toolbar (543 mouse / 469 touch) + margins do not fit below 1046px (1120px with a mouse), so those
 * windows use drawers; touch tablets wide enough keep the docked columns. Ported from work/fixcheck/layout-sweep.mjs.
 */
const { defaultBrowserType: _webkit, ...iPad } = devices['iPad Pro 11'];
type Size = { name: string; width: number; height: number; touch: boolean; compact: boolean; shot?: string };
const touchSizes: Size[] = [
  { name: 'iPad Pro 11 portrait', width: 834, height: 1194, touch: true, compact: true, shot: 'ipad-pro-11-portrait' },
  { name: 'iPad Pro 12.9 portrait', width: 1024, height: 1366, touch: true, compact: true, shot: 'ipad-pro-12-9-portrait' },
  { name: 'iPad 7 landscape', width: 1080, height: 810, touch: true, compact: false, shot: 'ipad-7-landscape' },
  { name: 'iPad Air landscape', width: 1180, height: 820, touch: true, compact: false },
  { name: 'iPad Pro 11 landscape', width: 1194, height: 834, touch: true, compact: false },
  { name: 'iPad Pro 12.9 landscape', width: 1366, height: 1024, touch: true, compact: false },
];
const mouseSizes: Size[] = [821, 960, 1100, 1119, 1120, 1280, 1440].map((width) => ({ name: 'mouse window ' + width, width, height: 800, touch: false, compact: width <= 1119 }));

/** Boxes of the floating chrome and docked columns, plus overflow, read from the live page. */
const measure = (page: Page) => page.evaluate(() => {
  const box = (s: string) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const parts = { toolbar: box('.toolbar'), 'zoom bar': box('.zoombar'), minimap: box('.react-flow__minimap'), 'selection bar': box('[data-testid=selection-bar]'), outline: box('.column-slot.left'), inspector: box('.column-slot.right') };
  const named = Object.entries(parts).filter(([, b]) => b) as [string, { l: number; t: number; r: number; b: number }][];
  const clashes: string[] = [];
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
    const [n1, a] = named[i], [n2, c] = named[j];
    const w = Math.min(a.r, c.r) - Math.max(a.l, c.l), h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
    if (w > 0.5 && h > 0.5) clashes.push(n1 + ' × ' + n2 + ' ' + Math.round(w) + 'x' + Math.round(h));
  }
  const canvas = box('.canvas-wrap')!, tb = parts.toolbar!;
  const top = document.querySelector('.topbar')!;
  return {
    compact: document.querySelector('.app')!.classList.contains('compact'),
    canvasWidth: Math.round(canvas.r - canvas.l),
    toolbarInsideCanvas: tb.l >= canvas.l - 0.5 && tb.r <= canvas.r + 0.5 && tb.t >= canvas.t - 0.5 && tb.b <= canvas.b + 0.5,
    pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    topbarOverflow: top.scrollWidth - top.clientWidth,
    present: named.map(([n]) => n),
    clashes,
  };
});

test('keep the layout tidy on tablets and narrow desktop windows', async ({ page, app, ev, browser, request }, info) => {
  ev.proves('With a topic selected, every tablet and narrow-window size gets the right layout: iPad portraits (834, 1024) and mouse windows up to 1119px use drawers; iPad landscapes (1080–1366) and mouse windows from 1120px keep the docked outline and inspector. At every size the page and the top bar do not overflow sideways, the toolbar sits inside the canvas, and the toolbar, zoom bar, minimap, selection bar and docked columns never overlap; on touch sizes every chrome control is at least 44×44. Screenshots show the iPad Pro portraits and the iPad 7 landscape; the video shows the mouse window being resized.');
  const docId = await app.newDoc('Responsive layout');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'rl-research', title: 'Research', x: 0, y: 0 },
    { id: 'rl-design', title: 'Design', x: 300, y: 0 },
    { id: 'rl-build', title: 'Build', x: 600, y: 0 },
    { id: 'rl-launch', title: 'Launch', x: 900, y: 0 },
    { id: 'rl-feedback', title: 'Feedback', x: 450, y: 200 },
  ] });
  const selected = 'rl-research';

  const check = async (size: Size, at: Page, phone?: Phone) => {
    await expect.poll(async () => (await new App(at, request).selection()).nodes, size.name + ': a topic is selected').toEqual([selected]);
    await at.waitForTimeout(350);
    const m = await measure(at);
    ev.note(size.name + ' ' + size.width + '×' + size.height + (size.touch ? ' touch' : ' mouse') + ': ' + JSON.stringify(m));
    expect.soft(m.compact, size.name + ': ' + (size.compact ? 'drawer layout' : 'docked columns')).toBe(size.compact);
    expect.soft(m.pageOverflow, size.name + ': no sideways page overflow').toBeLessThanOrEqual(0);
    expect.soft(m.topbarOverflow, size.name + ': the top bar does not overflow').toBeLessThanOrEqual(0);
    expect.soft(m.toolbarInsideCanvas, size.name + ': the toolbar sits inside the canvas').toBe(true);
    const expected = ['toolbar', 'zoom bar', ...(size.compact ? [] : ['minimap', 'outline', 'inspector']), ...(size.touch || size.compact ? ['selection bar'] : [])];
    expect.soft(m.present, size.name + ': the chrome under test is on screen').toEqual(expect.arrayContaining(expected));
    expect.soft(m.clashes, size.name + ': toolbar, zoom bar, minimap, selection bar and docked columns do not overlap').toEqual([]);
    if (phone) {
      const small = (await phone.audit()).small;
      expect.soft(small, size.name + ': chrome controls under 44×44 on touch').toEqual([]);
    }
    if (size.shot) await ev.snap(size.shot, { page: at });
  };

  for (const size of touchSizes) {
    await test.step(size.name + ' ' + size.width + '×' + size.height + ' (touch): ' + (size.compact ? 'drawers' : 'docked columns'), async () => {
      const ctx = await browser.newContext({ ...iPad, viewport: { width: size.width, height: size.height }, baseURL: info.project.use.baseURL });
      try {
        const tab = await ctx.newPage();
        const tabApp = new App(tab, request);
        await tabApp.open(docId);
        await tabApp.rfNode(selected).tap();
        await check(size, tab, new Phone(tab, tabApp, ev));
      } finally {
        await ctx.close();
      }
    });
  }

  await app.open(docId);
  await app.rfNode(selected).click();
  for (const size of mouseSizes) {
    await test.step(size.name + ' ×' + size.height + ' (mouse): ' + (size.compact ? 'drawers' : 'docked columns'), async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await check(size, page);
    });
  }
});

