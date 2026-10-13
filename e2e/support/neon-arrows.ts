import type { Page } from '@playwright/test';
import { App, Evidence, expect } from './journey';
import { colourGap, neonEdges, pixel, rgbParts } from './neon';

export async function neonArrowJourney(page: Page, app: App, ev: Evidence) {
  ev.proves('Neon Flow honors none, start, end and both arrow settings on every connector routing. Arrowheads retain automatic or explicit wire colors when selected, clear the endpoint dots, and are visibly painted on desktop and phone.');
  const modes = ['none', 'start', 'end', 'both'] as const;
  const documentId = await app.newDoc('Neon connector arrows');
  await app.tool('add_nodes', { documentId, nodes: modes.flatMap((arrow, index) => [
    { id: arrow + '-source', title: arrow, x: 0, y: index * 140, width: 120, height: 60 },
    { id: arrow + '-target', title: 'Target', x: 340, y: index * 140, width: 120, height: 60 },
  ]) });
  await app.tool('add_edges', { documentId, edges: modes.map((arrow) => ({
    id: arrow, source: arrow + '-source', target: arrow + '-target', arrow,
    sourceSide: 'right', targetSide: 'left', color: arrow === 'both' ? 'blue' : 'default',
  })) });
  await app.pinTheme('neon-flow');
  await app.open(documentId);
  await app.tool('set_ui', { inspector: false, outline: false, minimap: false });
  await app.fit();

  const check = async () => {
    const edges = await neonEdges(page);
    expect(edges).toHaveLength(modes.length);
    for (const arrow of modes) {
      const edge = edges.find((item) => item.id === arrow)!;
      for (const end of ['start', 'end'] as const) {
        const visible = arrow === 'both' || arrow === end;
        const reference = end === 'start' ? edge.markerStart : edge.markerEnd;
        if (!visible) { expect(reference, arrow + ': no ' + end + ' arrow').toBeNull(); continue; }
        expect(reference, arrow + ': ' + end + ' arrow').toMatch(/^url\(#wfc-arrow-/);
        const marker = await page.locator(reference!.slice(4, -1)).evaluate((element) => {
          const marker = element as SVGMarkerElement;
          return {
            fill: getComputedStyle(marker.querySelector('path')!).fill,
            tipGap: (marker.refX.baseVal.value - marker.viewBox.baseVal.width) * marker.markerWidth.baseVal.value / marker.viewBox.baseVal.width,
          };
        });
        expect(marker.fill, arrow + ': arrow uses the wire color').toBe(edge.stroke);
        expect(marker.tipGap * parseFloat(edge.width), arrow + ': arrow clears the 5px dot and 2px outline').toBeGreaterThan(7);
      }
      expect(edge.filter).toContain('drop-shadow');
      expect(edge.haloBeforePath).toBe(true);
    }
    await expect(page.locator('.wfc-port-dot')).toHaveCount(2 * modes.length);
    return edges;
  };

  for (const routing of ['smooth', 'bezier', 'straight', 'step']) {
    await app.tool('update_edges', { documentId, updates: modes.map((id) => ({ id, routing })) });
    await expect.poll(async () => (await app.doc()).edges.every((edge) => edge.routing === routing)).toBe(true);
    const unselected = await check();
    await app.tool('select', { documentId, edgeIds: ['both'] });
    await expect(app.edgePath('both')).toHaveClass(/selected/);
    const selected = await check();
    expect(selected.map((edge) => edge.d), 'selection preserves the connector routes').toEqual(unselected.map((edge) => edge.d));
    await app.tool('select', { documentId, mode: 'clear' });
    await ev.snap('neon-arrows-' + routing);
  }

  const edge = (await neonEdges(page)).find((item) => item.id === 'end')!;
  const sample = await app.edgePath('end').evaluate((element) => {
    const path = element as SVGPathElement;
    const reference = path.getAttribute('marker-end')!;
    const marker = document.querySelector(reference.slice(4, -1)) as SVGMarkerElement;
    const scale = marker.markerWidth.baseVal.value / marker.viewBox.baseVal.width * parseFloat(getComputedStyle(path).strokeWidth);
    const tip = path.getPointAtLength(path.getTotalLength());
    return new DOMPoint(tip.x + (3 - marker.refX.baseVal.value) * scale, tip.y - 2 * scale).matrixTransform(path.getScreenCTM()!).toJSON();
  });
  const painted = await pixel(page, sample);
  await app.tool('update_edges', { documentId, updates: [{ id: 'end', arrow: 'none' }] });
  await expect(app.edgePath('end')).not.toHaveAttribute('marker-end');
  const absent = await pixel(page, sample);
  expect(colourGap(painted, rgbParts(edge.stroke)), 'the visible arrow wing is closer to the wire color than the same pixel with no arrow').toBeLessThan(colourGap(absent, rgbParts(edge.stroke)));
  await app.tool('update_edges', { documentId, updates: [{ id: 'end', arrow: 'end' }] });
  await check();
  await page.reload();
  await app.waitForDoc(documentId);
  await check();
}
