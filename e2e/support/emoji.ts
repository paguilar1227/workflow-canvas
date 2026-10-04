import type { Locator } from '@playwright/test';

/**
 * Floating chrome and visible controls (outside the canvas content and the emoji UI itself) whose box intersects the
 * element's box where they are actually reachable (on top, not under a drawer or sheet): anything listed would be
 * hidden or have its taps and clicks intercepted by the element.
 */
export async function clashes(target: Locator): Promise<string[]> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const vis = (e: Element) => {
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const reachable = (e: Element, b: DOMRect) => {
      const [x0, x1, y0, y1] = [Math.max(r.left, b.left), Math.min(r.right, b.right), Math.max(r.top, b.top), Math.min(r.bottom, b.bottom)];
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const top = document.elementsFromPoint(x0 + 0.5 + ((x1 - x0 - 1) * i) / 4, y0 + 0.5 + ((y1 - y0 - 1) * j) / 4).find((h) => !h.closest('.emoji-ui'));
        if (top && e.contains(top)) return true;
      }
      return false;
    };
    const sel = 'button, [role=button], input, select, textarea, a[href], [role=menuitem], label.btn, .toolbar, .zoombar, .topbar, [data-testid=selection-bar], .mode-pill, .react-flow__minimap';
    return [...document.querySelectorAll(sel)]
      .filter((e) => e !== el && !el.contains(e) && !e.contains(el) && !e.closest('.emoji-ui, .react-flow__viewport') && vis(e))
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return Math.min(r.right, b.right) - Math.max(r.left, b.left) > 0.5 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 0.5 && reachable(e, b);
      })
      .map((e) => (e.getAttribute('data-testid') || e.getAttribute('aria-label') || (e.textContent ?? '').trim().slice(0, 24) || e.tagName.toLowerCase()) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  });
}

/** Controls inside a floating panel whose centre a finger or pointer cannot reach because something else is drawn on top. */
export async function covered(target: Locator): Promise<string[]> {
  return target.evaluate((el) => {
    return [...el.querySelectorAll('button, input')].filter((e) => {
      const b = e.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      const clip = (e.closest('.emoji-grid-wrap, .emoji-suggest, .emoji-tabs') ?? el).getBoundingClientRect();
      if (b.width === 0 || x < clip.left || x > clip.right || y < clip.top || y > clip.bottom || x > innerWidth || y > innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !hit || !el.contains(hit);
    }).map((e) => (e.getAttribute('data-emoji') || e.getAttribute('aria-label') || e.tagName.toLowerCase()) + ' under ' + (() => { const b = e.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return h ? (h.getAttribute('data-testid') || h.className || h.tagName).toString().slice(0, 30) : 'nothing'; })());
  });
}
