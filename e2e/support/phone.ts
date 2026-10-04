import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { App, Box, Evidence, Pt } from './journey';

type TouchType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
type Panel = 'outline' | 'inspector';

/** Product contract (README "Phones and tablets", styles.css): touch targets are at least 44×44 (WCAG 2.5.5 / Apple HIG). */
export const MIN_TARGET = 44;
/** Product contract (Canvas long-press): the context sheet opens after a 500 ms hold; holding longer is what a person does. */
const LONG_PRESS_MS = 700;
/** Product contract (App.tsx SLIDE_MS): drawers slide for 220 ms; sampling a little longer sees the whole transition. */
const SLIDE_SAMPLE_MS = 450;
/** Two taps closer together than the browser's multi-click interval (500 ms in Chromium) become a double-tap; a person pauses longer between separate taps. */
const TAP_GAP_MS = 600;

/** A person using the app on a phone: taps, long-presses, one- and two-finger drags, sheets and drawers. */
export class Phone {
  private cdp?: CDPSession;
  private lastTap = 0;
  constructor(readonly page: Page, readonly app: App, readonly ev: Evidence) {}

  private async session() { return (this.cdp ??= await this.page.context().newCDPSession(this.page)); }

  /** Raw multi-touch through the DevTools protocol (Playwright's touchscreen only taps). */
  async touch(type: TouchType, pts: Pt[]) {
    await (await this.session()).send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  }

  async tap(target: Locator | Pt) {
    const wait = TAP_GAP_MS - (Date.now() - this.lastTap);
    if (wait > 0) await this.page.waitForTimeout(wait);
    if (typeof (target as Pt).x === 'number') await this.page.touchscreen.tap((target as Pt).x, (target as Pt).y);
    else await (target as Locator).tap();
    this.lastTap = Date.now();
    await this.page.waitForTimeout(150);
  }

  /** Two taps on one spot, well inside the browser's 500 ms multi-click interval: a double-tap. */
  async doubleTap(at: Pt) {
    const wait = TAP_GAP_MS - (Date.now() - this.lastTap);
    if (wait > 0) await this.page.waitForTimeout(wait);
    await this.page.touchscreen.tap(at.x, at.y);
    await this.page.waitForTimeout(120);
    await this.page.touchscreen.tap(at.x, at.y);
    this.lastTap = Date.now();
    await this.page.waitForTimeout(400);
  }

  async longPress(at: Pt) {
    await this.touch('touchStart', [at]);
    await this.page.waitForTimeout(LONG_PRESS_MS);
    await this.touch('touchEnd', []);
    await this.page.waitForTimeout(250);
  }

  /** One finger: press, slide in small steps, lift. */
  async drag(from: Pt, to: Pt, steps = 16) {
    await this.touch('touchStart', [from]);
    await this.page.waitForTimeout(60);
    for (let i = 1; i <= steps; i++) {
      await this.touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
      await this.page.waitForTimeout(16);
    }
    await this.touch('touchEnd', []);
    await this.page.waitForTimeout(300);
    await this.app.settled();
  }

  /** Two fingers on a horizontal line around centre, moving from gap0 apart to gap1 apart (gap1 > gap0 zooms in). */
  async pinch(centre: Pt, gap0: number, gap1: number, steps = 12) {
    const at = (g: number) => [{ x: centre.x - g / 2, y: centre.y }, { x: centre.x + g / 2, y: centre.y }];
    await this.touch('touchStart', at(gap0));
    for (let i = 1; i <= steps; i++) { await this.touch('touchMove', at(gap0 + ((gap1 - gap0) * i) / steps)); await this.page.waitForTimeout(16); }
    await this.touch('touchEnd', []);
    await this.page.waitForTimeout(350);
  }

  async center(l: Locator) { return this.app.center(l); }

  /** Where a finger can actually touch the element: its centre, or the nearest point not covered by floating chrome or by one of its buttons. */
  async grab(l: Locator): Promise<Pt> {
    const p = await l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cands: { x: number; y: number; d: number }[] = [];
      for (let fx = 0.1; fx <= 0.9; fx += 0.05) for (let fy = 0.2; fy <= 0.8; fy += 0.1) cands.push({ x: r.left + r.width * fx, y: r.top + r.height * fy, d: Math.hypot(fx - 0.5, fy - 0.5) });
      cands.sort((a, b) => a.d - b.d);
      const ok = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && el.contains(hit) && !hit.closest('button, input, textarea, [role=button]');
      };
      const c = cands.find((q) => q.x > 0 && q.y > 0 && q.x < innerWidth && q.y < innerHeight && ok(q.x, q.y));
      return c ? { x: c.x, y: c.y } : null;
    });
    expect(p, 'a finger can reach the element').toBeTruthy();
    return p!;
  }

  /** The More sheet holds everything the desktop top bar shows: open it and tap one item. */
  async more(itemTestId: string) {
    await this.tap(this.page.getByTestId('menu-more'));
    const item = this.page.getByTestId(itemTestId);
    await expect(item, 'More sheet offers ' + itemTestId).toBeVisible();
    await item.scrollIntoViewIfNeeded();
    await this.tap(item);
  }

  /** One of the selection bar's actions (the touch stand-in for Tab, Enter, F2, Delete and right-click). */
  async sel(testId: string) {
    const b = this.page.getByTestId('selection-bar').getByTestId(testId);
    await expect(b, 'selection bar offers ' + testId).toBeVisible();
    await this.tap(b);
  }

  async selectTopic(title: string) {
    await this.tap(this.app.topic(title));
    await expect(this.page.getByTestId('selection-bar'), 'tapping a topic shows the selection bar').toBeVisible();
  }

  async fit() {
    await this.tap(this.page.getByTestId('fit-view'));
    await this.page.waitForTimeout(450);
  }

  /** Long-press a point and wait for the context menu to open as a bottom sheet. */
  async contextSheet(at: Pt) {
    await this.longPress(at);
    const menu = this.page.getByTestId('context-menu');
    await expect(menu, 'long-press opens the context menu').toBeVisible();
    await expect(menu, 'on a phone the context menu is a bottom sheet').toHaveClass(/sheet/);
    return menu;
  }

  /** Arm Topic/Sticky/Text/Frame from the toolbar, then tap where it goes. */
  async place(addTestId: string, at: Pt) {
    await this.tap(this.page.getByTestId(addTestId));
    await expect(this.page.getByTestId('place-pill'), 'the toolbar button arms placement').toContainText('Tap to place');
    await this.tap(at);
    await expect(this.page.getByTestId('place-pill')).toHaveCount(0);
    await this.app.settled();
  }

  /** Area tool: arm it, drag one finger across the nodes, and it disarms after selecting. */
  async areaSelect(from: Pt, to: Pt) {
    await this.tap(this.page.getByTestId('tool-area'));
    await expect(this.page.getByTestId('area-pill'), 'Area arms one box-select drag').toBeVisible();
    const before = await this.app.viewport();
    await this.drag(from, to, 20);
    const after = await this.app.viewport();
    expect(Math.hypot(after.x - before.x, after.y - before.y), 'an Area drag selects without panning the canvas (P5 regression)').toBeLessThan(1);
    await expect(this.page.getByTestId('area-pill'), 'Area disarms after the selection').toHaveCount(0);
  }

  async openDrawer(panel: Panel) {
    if (panel === 'outline') await this.tap(this.page.getByTestId('toggle-outline'));
    else await this.more('toggle-inspector');
    await expect(this.slot(panel)).toHaveClass(/shown/);
    await this.page.waitForTimeout(300);
  }

  async closeDrawer(panel: Panel) {
    await this.tap(this.page.getByTestId('close-' + panel));
    await expect(this.slot(panel)).toHaveCount(0);
  }

  slot(panel: Panel) { return this.page.locator('.column-slot.' + (panel === 'outline' ? 'left' : 'right')); }

  /** Width of the drawer's column every animation frame from before `act` until the slide has had time to finish after it, so a slide is observable mid-transition. */
  async slideWidths(panel: Panel, act: () => Promise<void>) {
    const sel = '.column-slot.' + (panel === 'outline' ? 'left' : 'right');
    await this.page.evaluate((sel) => {
      const w = window as any;
      w.__slide = [];
      w.__slideOn = true;
      const tick = () => {
        const el = document.querySelector(sel);
        w.__slide.push(el ? el.getBoundingClientRect().width : 0);
        if (w.__slideOn) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, sel);
    await act();
    await this.page.waitForTimeout(SLIDE_SAMPLE_MS);
    return this.page.evaluate(() => { (window as any).__slideOn = false; return (window as any).__slide as number[]; });
  }

  /**
   * Drawer contract: opens with a slide, expands to the full width, closes from its × and from a tap on the
   * backdrop, and slides out again. Screens for each state go to the journey's evidence.
   */
  async checkDrawer(panel: Panel, open: () => Promise<void>) {
    const vw = this.page.viewportSize()!.width;
    const opening = await this.slideWidths(panel, open);
    const target = Math.max(...opening);
    expect(target, panel + ' drawer opens').toBeGreaterThan(200);
    expect(opening.some((w) => w > 1 && w < target - 1), panel + ' drawer slides in (mid-transition widths: ' + opening.map(Math.round).join(',') + ')').toBe(true);
    await expect(this.page.getByTestId('drawer-backdrop')).toHaveClass(/shown/);
    await this.ergonomics(panel + ' drawer open');
    await this.ev.snap(panel + '-drawer-open');

    await this.tap(this.page.getByTestId('expand-' + panel));
    await expect.poll(async () => Math.round((await this.app.box(this.slot(panel))).width), panel + ' expands to the full width').toBe(vw);
    await this.ergonomics(panel + ' drawer expanded');
    await this.ev.snap(panel + '-drawer-full-width');

    const closing = await this.slideWidths(panel, () => this.tap(this.page.getByTestId('close-' + panel)));
    expect(closing.some((w) => w > 1 && w < vw - 1), panel + ' drawer slides out (widths: ' + closing.map(Math.round).join(',') + ')').toBe(true);
    await expect(this.slot(panel), '× closes the ' + panel).toHaveCount(0);

    await open();
    await expect(this.slot(panel)).toHaveClass(/shown/);
    await this.page.waitForTimeout(300);
    const box = await this.app.box(this.slot(panel));
    expect(Math.round(box.width), 'closing resets the full-width state').toBeLessThan(vw);
    const outside = { x: panel === 'outline' ? (box.x + box.width + vw) / 2 : box.x / 2, y: box.y + box.height / 2 };
    await this.tap(outside);
    await expect(this.slot(panel), 'tapping the backdrop closes the ' + panel).toHaveCount(0);
    await expect(this.page.getByTestId('drawer-backdrop')).not.toHaveClass(/shown/);
  }

  /** Measurements behind the ergonomic contract, taken from the live page. */
  async audit() {
    return this.page.evaluate((min) => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      };
      const name = (e: Element) => (e.getAttribute('data-testid') || e.getAttribute('aria-label') || (e.textContent ?? '').trim().slice(0, 24) || e.tagName.toLowerCase());
      const sz = (e: Element) => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
      const small = [...document.querySelectorAll('button, [role=button], input, select, textarea, [role=menuitem], label.btn, a.btn')]
        .filter((e) => !e.closest('.react-flow__viewport') && vis(e))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width < min - 0.5 || r.height < min - 0.5; })
        .map((e) => name(e) + ' ' + sz(e));
      const chrome: [string, string][] = [['toolbar', '.toolbar'], ['zoombar', '.zoombar'], ['selection-bar', '[data-testid=selection-bar]'], ['pill', '.mode-pill'], ['topbar', '.topbar']];
      const boxes = chrome.flatMap(([n, s]) => [...document.querySelectorAll(s)].filter(vis).map((e) => ({ n, r: e.getBoundingClientRect() })));
      const overlaps: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0.5 && h > 0.5) overlaps.push(boxes[i].n + ' × ' + boxes[j].n + ' ' + Math.round(w) + 'x' + Math.round(h));
      }
      const top = document.querySelector('.topbar');
      const clipped = top ? [...top.querySelectorAll('*')].filter(vis).filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.left < -0.5 || r.right > innerWidth + 0.5) return true;
        const text = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim());
        if (e instanceof HTMLInputElement) {
          if (document.activeElement === e) return false;
          return e.scrollHeight > e.clientHeight + 1 || (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis');
        }
        return text && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1);
      }).map((e) => name(e) + ' ' + sz(e)) : ['no top bar'];
      return {
        overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
        compact: !!document.querySelector('.app.compact'),
        small, overlaps, clipped,
      };
    }, MIN_TARGET);
  }

  /** Ergonomic contract for every phone screen; failures are collected (soft) so one run lists them all. */
  async ergonomics(where: string) {
    const a = await this.audit();
    expect.soft(a.compact, where + ': compact phone layout').toBe(true);
    expect.soft(a.overflowX, where + ': no horizontal page overflow').toBeLessThanOrEqual(0);
    expect.soft(a.small, where + ': chrome controls under ' + MIN_TARGET + '×' + MIN_TARGET).toEqual([]);
    expect.soft(a.overlaps, where + ': overlapping chrome').toEqual([]);
    expect.soft(a.clipped, where + ': clipped top-bar text').toEqual([]);
    return a;
  }

  /** Box of the visible canvas between the top bar and the toolbar. */
  async canvasBox(): Promise<Box> { return this.app.paneBox(); }
}
