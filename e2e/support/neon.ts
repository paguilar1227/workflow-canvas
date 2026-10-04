import { expect, type Page } from '@playwright/test';
import type { Pt } from './journey';

/** Product contract (src/web/canvas/neon.tsx NEON_WIRES): the colours an uncoloured connector can take in Neon Flow. */
export const NEON_PALETTE = ['amber', 'pink', 'purple', 'red', 'teal'];
/** Product contract (neon.tsx NEON_SNAP_RADIUS): how close, in flow units, a dragged wire snaps to a port. */
export const SNAP_RADIUS = 55;
/** Product contract (neon.tsx NEON_BURST_MS): how long the connect burst stays on the target card. */
export const BURST_MS = 1600;

export type NeonEdge = {
  id: string; cls: string; ec: string; stroke: string; width: string; filter: string;
  markerStart: string | null; markerEnd: string | null; d: string; haloBeforePath: boolean; haloSelected: boolean; haloStroke: string | null;
  start: Pt; end: Pt; anim: string;
};

/** Every drawn connector (not mind-map branches) as a person sees it: colour, width, glow, arrowheads, path shape and screen end points. */
export async function neonEdges(page: Page): Promise<NeonEdge[]> {
  return page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].flatMap((g) => {
    const p = g.querySelector('path.wfc-edge-path') as SVGPathElement | null;
    if (!p) return [];
    const halo = g.querySelector('path.wfc-neon-halo') as SVGPathElement | null;
    const kids = [...g.querySelectorAll('path')];
    const cs = getComputedStyle(p);
    const at = (l: number) => { const q = p.getPointAtLength(l); const s = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM()!); return { x: s.x, y: s.y }; };
    return [{
      id: g.getAttribute('data-id') ?? (g.getAttribute('data-testid') ?? '').replace('rf__edge-', ''),
      cls: p.getAttribute('class') ?? '', ec: p.style.getPropertyValue('--ec').trim(), stroke: cs.stroke, width: cs.strokeWidth, filter: cs.filter,
      markerStart: p.getAttribute('marker-start'), markerEnd: p.getAttribute('marker-end'), d: p.getAttribute('d') ?? '',
      haloBeforePath: !!halo && kids.indexOf(halo) < kids.indexOf(p), haloSelected: !!halo && halo.classList.contains('selected'), haloStroke: halo ? getComputedStyle(halo).stroke : null,
      start: at(0), end: at(p.getTotalLength()), anim: cs.animationName,
    }];
  }));
}

/** The coloured dots Neon Flow puts on both ends of every connector: screen centre, size and fill. */
export async function portDots(page: Page) {
  return page.locator('.wfc-port-dot').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width, fill: getComputedStyle(el).backgroundColor };
  }));
}

/** A CSS colour (a theme token such as var(--c-pink), or a literal) resolved to rgb() against the active theme. */
export async function rgbOf(page: Page, css: string) {
  return page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.color = v;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, css);
}

/** The palette colour named by a var(--c-<name>) value, or null when it is not one of the Neon Flow wire colours. */
export const paletteName = (v: string) => { const m = /^var\(--c-([a-z]+)\)$/.exec(v.trim()); return m && NEON_PALETTE.includes(m[1]) ? m[1] : null; };

/** The live wire while a person drags a connector in Neon Flow, or null when none is drawn. */
export async function connecting(page: Page) {
  return page.evaluate(() => {
    const g = document.querySelector('[data-testid=neon-connection]') as SVGGElement | null;
    if (!g) return null;
    const wire = g.querySelector('path.wire')!;
    const spark = g.querySelector('[data-testid=neon-spark]');
    const ring = g.querySelector('circle.ring');
    return {
      snapped: g.classList.contains('snapped'), zc: g.style.getPropertyValue('--zc').trim(), wire: getComputedStyle(wire).stroke,
      spark: !!spark, sparkKinks: (spark?.getAttribute('d')?.match(/L/g) ?? []).length, sparkStroke: spark ? getComputedStyle(spark).stroke : null,
      ring: !!ring, ringStroke: ring ? getComputedStyle(ring).stroke : null, ringAnim: ring ? getComputedStyle(ring).animationName : null,
    };
  });
}

/** Screen distance from a point to the nearest connection port (handle) of each node, and the current zoom. */
export async function portDistances(page: Page, pt: Pt) {
  return page.evaluate((pt) => {
    const t = (document.querySelector('.react-flow__viewport') as HTMLElement).style.transform;
    const zoom = Number(/scale\(([-\d.e]+)\)/.exec(t)?.[1] ?? 1);
    const near: Record<string, number> = {};
    for (const h of document.querySelectorAll('.react-flow__node .react-flow__handle')) {
      const id = h.closest('.react-flow__node')!.getAttribute('data-id')!;
      const r = h.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - pt.x, r.top + r.height / 2 - pt.y);
      near[id] = Math.min(near[id] ?? Infinity, d);
    }
    return { zoom, near };
  }, pt);
}

/** A point on empty canvas farther than the snap radius from every port, so a wire dragged there cannot snap. */
export async function farFromPorts(page: Page, prefer: Pt): Promise<Pt> {
  const p = await page.evaluate(({ prefer, radius }) => {
    const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect();
    const t = (document.querySelector('.react-flow__viewport') as HTMLElement).style.transform;
    const zoom = Number(/scale\(([-\d.e]+)\)/.exec(t)?.[1] ?? 1);
    const ports = [...document.querySelectorAll('.react-flow__node .react-flow__handle')].map((h) => { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const cands: { x: number; y: number; d: number }[] = [];
    for (let fx = 0.06; fx <= 0.94; fx += 0.02) for (let fy = 0.06; fy <= 0.8; fy += 0.02) {
      const x = pane.left + pane.width * fx, y = pane.top + pane.height * fy;
      cands.push({ x, y, d: Math.hypot(x - prefer.x, y - prefer.y) });
    }
    cands.sort((a, b) => a.d - b.d);
    const hit = cands.find((c) => {
      const el = document.elementFromPoint(c.x, c.y);
      return el?.classList.contains('react-flow__pane') && ports.every((q) => Math.hypot(q.x - c.x, q.y - c.y) > radius * zoom * 1.5);
    });
    return hit ? { x: hit.x, y: hit.y } : null;
  }, { prefer, radius: SNAP_RADIUS });
  expect(p, 'an empty spot well outside the snap radius of every port').toBeTruthy();
  return p!;
}

/** The colour actually painted at a screen point (centre pixel of a tiny screenshot), as [r, g, b]. */
export async function pixel(page: Page, pt: Pt): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.round(pt.x) - 1, y: Math.round(pt.y) - 1, width: 3, height: 3 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, png.toString('base64'));
}

export const rgbParts = (rgb: string) => (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
/** Largest per-channel difference between two colours. */
export const colourGap = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
/** Path data drawn as one cubic bezier (M … C …) with no straight or rounded-corner segments. */
export const isBezier = (d: string) => /^M[^A-Za-z]+C[^A-Za-z]+$/.test(d.trim());

/**
 * Times the connect burst on a card: waits for it to appear after \`releasedAt\`, then for it to be removed.
 * Returns when it was first seen and when it was gone, in ms after the release.
 */
export async function timeBurst(page: Page, targetId: string, releasedAt: number) {
  const burst = page.getByTestId('neon-burst-' + targetId);
  await expect(burst, 'the connect burst appears on the target card').toHaveCount(1, { timeout: 3000 });
  const seen = Date.now() - releasedAt;
  const color = await burst.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--bc').trim());
  const visible = await burst.isVisible();
  const display = await burst.evaluate((el) => getComputedStyle(el).display);
  return {
    seen, color, visible, display,
    gone: async () => {
      await expect(burst, 'the burst is removed after its animation').toHaveCount(0, { timeout: BURST_MS + 3000 });
      return Date.now() - releasedAt;
    },
  };
}

