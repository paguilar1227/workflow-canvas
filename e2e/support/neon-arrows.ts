import type { Page } from '@playwright/test';
import { App, Evidence, expect } from './journey';
import { colourGap, neonEdges, pixel, portDots, rgbOf, rgbParts } from './neon';

export async function neonArrowJourney(page: Page, app: App, ev: Evidence) {
  ev.proves('Neon Flow honors none, start, end and both arrow settings on every connector routing. Arrow tips meet their connection points, replace dots at directed ends, retain wire colors when selected, and are visibly painted on desktop and phone.');
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
        expect(marker.tipGap, arrow + ': arrow tip meets the path endpoint').toBe(0);
        const alignment = await app.edgePath(arrow).evaluate((element, end) => {
          const path = element as SVGPathElement;
          const marker = document.querySelector(path.getAttribute('marker-' + end)!.slice(4, -1)) as SVGMarkerElement;
          const length = marker.markerWidth.baseVal.value;
          const total = path.getTotalLength();
          const tip = path.getPointAtLength(end === 'start' ? 0 : total);
          const base = path.getPointAtLength(end === 'start' ? length : total - length);
          const middle = path.getPointAtLength(end === 'start' ? length / 2 : total - length / 2);
          return { distance: Math.hypot(base.x - tip.x, base.y - tip.y), length, midpointError: Math.hypot(middle.x - (base.x + tip.x) / 2, middle.y - (base.y + tip.y) / 2) };
        }, end);
        expect(alignment.distance, arrow + ': line enters the center of the arrow base').toBeCloseTo(alignment.length, 1);
        expect(alignment.midpointError, arrow + ': the shaft stays straight through the arrow').toBeLessThan(0.1);
        const tip = end === 'start' ? edge.start : edge.end;
        expect((await portDots(page)).some((dot) => Math.hypot(dot.x - tip.x, dot.y - tip.y) < 1), arrow + ': no dot covers the arrow tip').toBe(false);
      }
      expect(edge.filter).toContain('drop-shadow');
      expect(edge.haloBeforePath).toBe(true);
    }
    await expect(page.locator('.wfc-port-dot')).toHaveCount(4);
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

  for (const style of ['dashed', 'dotted', 'animated']) for (const routing of ['smooth', 'bezier', 'straight', 'step']) {
    await app.tool('update_edges', { documentId, updates: modes.map((id) => ({ id, routing, style: style === 'animated' ? 'solid' : style, animated: style === 'animated' })) });
    await expect(app.edgePath('end')).toHaveClass(new RegExp(style));
    const edges = await check();
    await expect(page.locator('.wfc-neon-terminal'), 'every headed connector has a continuous terminal').toHaveCount(3);
    const terminal = app.edge('end').locator('.wfc-neon-terminal');
    const paint = await terminal.evaluate((element) => {
      const style = getComputedStyle(element);
      return { dash: style.strokeDasharray, animation: style.animationName, stroke: style.stroke };
    });
    expect(paint, 'the terminal remains solid in the wire color').toEqual({ dash: 'none', animation: 'none', stroke: edges.find((edge) => edge.id === 'end')!.stroke });
    if (style === 'dashed' && routing === 'straight') {
      const sample = await app.edgePath('end').evaluate((element) => {
        const path = element as SVGPathElement;
        const marker = document.querySelector(path.getAttribute('marker-end')!.slice(4, -1)) as SVGMarkerElement;
        const point = path.getPointAtLength(path.getTotalLength() - marker.markerWidth.baseVal.value - 1);
        return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!).toJSON();
      });
      const color = await pixel(page, sample);
      const wire = rgbParts(paint.stroke);
      const background = rgbParts(await rgbOf(page, 'var(--bg)'));
      expect(colourGap(color, wire), 'the dashed shaft paints right up to the arrow base').toBeLessThan(colourGap(color, background));
    }
    await ev.snap(style + '-arrow-contact-' + routing);
  }
  await app.tool('update_edges', { documentId, updates: modes.map((id) => ({ id, style: 'solid', animated: false })) });
  await expect(page.locator('.wfc-neon-terminal')).toHaveCount(0);

  const edge = (await neonEdges(page)).find((item) => item.id === 'end')!;
  const sample = await app.edgePath('end').evaluate((element) => {
    const path = element as SVGPathElement;
    const reference = path.getAttribute('marker-end')!;
    const marker = document.querySelector(reference.slice(4, -1)) as SVGMarkerElement;
    const scale = marker.markerWidth.baseVal.value / marker.viewBox.baseVal.width;
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

  const shapes = ['circle', 'diamond', 'cylinder'] as const;
  await app.tool('update_nodes', { documentId, updates: shapes.map((shape, index) => ({ id: modes[index] + '-target', shape })) });
  await app.tool('add_edges', { documentId, edges: shapes.flatMap((shape, index) => [0, 1, 2].map((port) => ({
    id: shape + '-' + port, source: modes[index] + '-source', target: modes[index] + '-target',
    arrow: 'end', sourceSide: 'right', targetSide: 'left',
  }))) });
  await expect(page.locator('.wfc-edge-path')).toHaveCount(13);
  for (const [index, shape] of shapes.entries()) for (const port of [0, 1, 2]) {
    const touches = await app.edgePath(shape + '-' + port).evaluate((element, target) => {
      const path = element as SVGPathElement;
      const outline = document.querySelector('.react-flow__node[data-id="' + target + '"] .wfc-shape-svg .fill') as SVGGeometryElement;
      const tip = path.getPointAtLength(path.getTotalLength());
      const screen = new DOMPoint(tip.x, tip.y).matrixTransform(path.getScreenCTM()!);
      return outline.isPointInStroke(screen.matrixTransform(outline.getScreenCTM()!.inverse()));
    }, modes[index] + '-target');
    expect(touches, shape + ': arrow tip touches the visible outline at port ' + port).toBe(true);
  }
  await ev.snap('arrows-touch-shaped-nodes');
}
