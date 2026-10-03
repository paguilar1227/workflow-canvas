import { expect, type App, type Pt } from './journey';

/** Screen points along an SVG path, sampled at equal arc-length steps (same method as work/fixcheck/pen-fidelity.mjs). */
export const samplePath = (app: App, selector: string) => app.page.locator(selector).first().evaluate((el) => {
  const path = el as unknown as SVGPathElement;
  const L = path.getTotalLength();
  const m = path.getScreenCTM()!;
  const out: [number, number][] = [];
  for (let k = 0; k <= 400; k++) { const pt = path.getPointAtLength((L * k) / 400); const sp = new DOMPoint(pt.x, pt.y).matrixTransform(m); out.push([sp.x, sp.y]); }
  return out;
});

/** How a stroke reaches the pen layer: the mouse on desktop, one finger on a phone. */
export type StrokeInput = { down(p: Pt): Promise<void>; move(p: Pt): Promise<void>; up(): Promise<void> };

/** Draw the track on the active pen layer and measure how far the saved drawing sits from the live stroke the person saw. */
export async function penStroke(app: App, track: Pt[], input: StrokeInput) {
  const page = app.page;
  await expect(page.getByTestId('pen-layer')).toBeVisible();
  const before = new Set((await app.doc()).nodes.map((n) => n.id));
  await input.down(track[0]);
  for (const p of track.slice(1)) await input.move(p);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const live = await samplePath(app, '.pen-layer path');
  await input.up();
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
