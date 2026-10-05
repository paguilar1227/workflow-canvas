import fs from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { App, Box } from './journey';

/** Logic roles in the order the Logic menu and the role picker list them (src/shared/types.ts NODE_ROLES). */
export const ROLES = ['start', 'end', 'decision', 'parallel', 'wait', 'data', 'store', 'subprocess', 'external'];

/**
 * A node's role marker and, for each of its ports, what a pointer pressing the port's centre and four points near the rim of its drawn
 * dot actually hits, and how much of the dot the marker's box covers (in screen px²).
 */
export async function markerAndPorts(page: Page, nodeId: string) {
  return page.locator('.react-flow__node[data-id="' + nodeId + '"]').evaluate((node) => {
    const mk = node.querySelector('[data-testid=role-marker]');
    const m = mk?.getBoundingClientRect();
    const name = (e: Element | null) => {
      if (!e) return 'nothing';
      if (e.closest('[data-testid=role-marker]')) return 'role marker';
      const c = e.getAttribute('class') ?? '';
      return e.getAttribute('data-testid') || c || e.tagName.toLowerCase();
    };
    return {
      marker: m && mk ? { x: m.left, y: m.top, width: m.width, height: m.height, role: mk.getAttribute('data-role') } : null,
      ports: [...node.querySelectorAll('.react-flow__handle')].map((h) => {
        const r = h.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, k = r.width * 0.35;
        const hits = [[0, 0], [-k, 0], [k, 0], [0, -k], [0, k]].map(([dx, dy]) => {
          const e = document.elementFromPoint(cx + dx, cy + dy);
          return e?.closest('.react-flow__handle') === h ? 'port' : name(e);
        });
        const overlap = m ? Math.max(0, Math.min(r.right, m.right) - Math.max(r.left, m.left)) * Math.max(0, Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top)) : 0;
        return { side: h.getAttribute('data-handlepos') ?? '?', centre: { x: cx, y: cy }, hits, overlap };
      }),
    };
  });
}

/** The role marker is drawn, and nothing of it sits on any of the node's four ports: every press on a port's dot reaches the port. */
export async function expectPortsClearOfMarker(page: Page, nodeId: string, role: string, where: string) {
  const m = await markerAndPorts(page, nodeId);
  expect(m.marker?.role, where + ': the ' + role + ' marker is drawn').toBe(role);
  expect(m.ports.map((p) => p.side).sort(), where + ': a port on every side').toEqual(['bottom', 'left', 'right', 'top']);
  for (const p of m.ports) {
    expect(p.overlap, where + ': the role marker does not overlap the ' + p.side + ' port').toBe(0);
    expect(p.hits, where + ': a press anywhere on the ' + p.side + ' port reaches the port').toEqual(['port', 'port', 'port', 'port', 'port']);
  }
  return m;
}

/** Where the role marker sits on its node, as fractions of the node's box. */
export function markerSpot(marker: Box, node: Box) {
  return { fx: (marker.x + marker.width / 2 - node.x) / node.width, fy: (marker.y + marker.height / 2 - node.y) / node.height };
}

/** Where a role marker belongs on its outline: the diamond's upper-left edge (1/4, 1/4) and the circle's upper-left rim ((1 − cos 45°) / 2). */
const MARKER_ON_SHAPE: Record<string, number> = { decision: 0.25, wait: (1 - Math.SQRT1_2) / 2 };

/** The decision or wait marker sits on the drawn outline of its shape, not at the corner of the node's box (the sketch themes once put it there). */
export async function expectMarkerOnShape(app: App, nodeId: string, role: 'decision' | 'wait', where: string) {
  const spot = markerSpot(await app.box(app.rfNode(nodeId).getByTestId('role-marker')), await app.box(app.rfNode(nodeId).locator('.wfc-node')));
  const at = MARKER_ON_SHAPE[role];
  expect(Math.hypot(spot.fx - at, spot.fy - at), where + ': the marker centre (' + spot.fx.toFixed(3) + ', ' + spot.fy.toFixed(3) + ') is on the ' + role + '\'s upper-left outline (' + at.toFixed(3) + ')').toBeLessThan(0.02);
  return spot;
}

/** What a reader's eye (a hit test) finds at the centre and near the four corners of a connector's label: 'label' when nothing is drawn over it. */
export async function labelHits(page: Page, edgeId: string) {
  return page.getByTestId('edge-label-' + edgeId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [[0.5, 0.5], [0.15, 0.3], [0.85, 0.3], [0.15, 0.7], [0.85, 0.7]].map(([fx, fy]) => {
      const hit = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
      if (hit && el.contains(hit)) return 'label';
      return hit?.closest('.react-flow__node')?.getAttribute('data-id') ?? hit?.getAttribute('class') ?? 'nothing';
    });
  });
}

/** Bug L1's case: a decision's Yes connector leaving its right port and entering the TOP port of a card, whose label Neon Flow used to draw under that card. */
export async function seedLabelIntoTop(app: App) {
  const docId = await app.newDoc('Label into a top port');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'l1-dec', title: 'Paid?', role: 'decision', x: 0, y: 0 },
    { id: 'l1-ship', title: 'Ship order', x: 360, y: 24 },
  ] });
  await app.tool('add_edges', { documentId: docId, edges: [{ id: 'l1-yes', source: 'l1-dec', target: 'l1-ship', sourceSide: 'right', targetSide: 'top', label: 'Yes' }] });
  return { docId, source: 'l1-dec', target: 'l1-ship', edge: 'l1-yes' };
}

/** A connector's label is readable: a hit test finds the label at its centre and corners, and its box is clear of both cards it joins. */
export async function expectLabelReadable(app: App, edgeId: string, nodeIds: string[], where: string) {
  const hits = await labelHits(app.page, edgeId);
  expect(hits, where + ': nothing is drawn over the label (hit test at its centre and corners)').toEqual(['label', 'label', 'label', 'label', 'label']);
  const label = await app.box(app.page.getByTestId('edge-label-' + edgeId));
  const covered: string[] = [];
  for (const id of nodeIds) {
    const n = await app.box(app.rfNode(id));
    const w = Math.min(label.x + label.width, n.x + n.width) - Math.max(label.x, n.x);
    const h = Math.min(label.y + label.height, n.y + n.height) - Math.max(label.y, n.y);
    covered.push(id + ' ' + (w > 0 && h > 0 ? Math.round(w) + 'x' + Math.round(h) : 'clear'));
  }
  expect(covered, where + ': the label sits clear of the cards it joins').toEqual(nodeIds.map((id) => id + ' clear'));
  return { hits, covered };
}

/** The flow built by hand in the logic journey, as the Logic description export must read it (trimmed lines, in this order). */
export const FLOW_LINES = [
  '**Summary:** 6 steps, 1 start point, 1 decision, 1 end point, 1 loop, 0 issues.',
  '## Flow',
  '1. **Order received** · start',
  '2. **Check payment** · step',
  '3. **Paid?** · decision',
  'Depending on the answer:',
  '- **Yes** →',
  '4. **Ship order** · step',
  '5. **Done** · end',
  '- **No** →',
  '6. **Send reminder** · step',
  '→ loops back to step 2 (**Check payment**)',
  '## Issues',
  '- None found.',
];

/** The downloaded Logic description: the document heading, then every expected line in order. */
export function expectLogicMarkdown(file: string, title: string) {
  const md = fs.readFileSync(file, 'utf8');
  expect(md.split('\n')[0], 'the description is headed with the document title').toBe('# Logic of "' + title + '"');
  const lines = md.split('\n').map((l) => l.trim());
  let at = -1;
  const found: string[] = [];
  for (const want of FLOW_LINES) {
    const i = lines.indexOf(want, at + 1);
    if (i < 0) break;
    found.push(want);
    at = i;
  }
  expect(found, 'the Logic description lists the steps, both branches and the loop, in order:\n' + md).toEqual(FLOW_LINES);
  return md;
}

/** Nodes, by title, in the flow the journey builds. */
export async function idsByTitle(app: App, titles: string[]) {
  const d = await app.doc();
  return Object.fromEntries(titles.map((t) => [t, d.nodes.find((n) => n.title === t)?.id ?? ''])) as Record<string, string>;
}
