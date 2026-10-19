import assert from 'node:assert/strict';
import { routeConnection, routePath } from '../../src/web/canvas/routing';
import { labelLeaderEnd, placeLabels } from '../../src/web/canvas/labels';
import { applyCommand, normalizeCommand, diffDocs } from '../../src/shared/commands';
import { cloneNodes } from '../../src/shared/clipboard';
import { documentFromExcalidraw, exportExcalidraw, importExcalidraw } from '../../src/shared/excalidraw';
import type { CanvasDocument } from '../../src/shared/types';

const obstacles = [{ x: 0, y: 0, width: 100, height: 80 }, { x: 200, y: 0, width: 100, height: 80 }, { x: 400, y: 0, width: 100, height: 80 }];
const args = { source: { x: 100, y: 40 }, target: { x: 400, y: 40 }, sourceSide: 'right' as const, targetSide: 'left' as const, obstacles };
for (const points of [routeConnection(args), routeConnection({ ...args, via: { x: 250, y: -120 } })]) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    assert.ok(a.x === b.x || a.y === b.y, 'route uses orthogonal segments');
    for (const r of obstacles) {
      const crosses = a.y === b.y
        ? a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width
        : a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height;
      assert.equal(crosses, false, 'route never crosses node interiors');
    }
  }
  assert.ok(routePath(points, 8, obstacles).includes('C'), 'drafting routes have rounded corners');
}
const geometry = { middle: { x: 50, y: 40 }, candidates: [{ x: 50, y: 40 }], width: 80, height: 24 };
const labels = placeLabels([{ id: 'one', label: 'one' }, { id: 'two', label: 'two' }], { one: geometry, two: geometry }, obstacles);
assert.notDeepEqual(labels.one, labels.two, 'crowded labels get separate positions');
assert.ok(labelLeaderEnd(geometry.middle, labels.one, geometry), 'a displaced label has a leader');
assert.equal(labelLeaderEnd(geometry.middle, geometry.middle, geometry), null);

let seq = 0;
const options = { genId: () => 'draft-' + ++seq };
const empty: CanvasDocument = { id: 'draft', title: 'Draft', nodes: [], edges: [], settings: { autoArrange: false, treeLayout: 'mindmap' }, createdAt: '', updatedAt: '' };
const original = applyCommand(empty, normalizeCommand(empty, { type: 'batch', commands: [
  { type: 'add_nodes', nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }] },
  { type: 'add_edges', edges: [{ id: 'wire', source: 'a', target: 'b', routePoint: { x: 300, y: -100 }, label: 'yes' }] },
] }, options));
const reset = applyCommand(original, normalizeCommand(original, { type: 'update_edges', updates: [{ id: 'wire', routePoint: null }] }, options));
assert.equal(reset.edges[0].routePoint, undefined, 'null restores automatic routing');
assert.deepEqual(applyCommand(reset, diffDocs(reset, original)!), original, 'undo restores bend');
assert.deepEqual(documentFromExcalidraw(exportExcalidraw(original)).edges, original.edges, 'saved files preserve bend');
assert.deepEqual(importExcalidraw(exportExcalidraw(original), 'copy-').edges[0].routePoint, original.edges[0].routePoint, 'import preserves bend');
assert.deepEqual(cloneNodes(original, ['a', 'b'], { x: 40, y: 40 }, options.genId).edges[0].routePoint, { x: 340, y: -60 }, 'copied bends travel with copied nodes');
console.log('Drafting routing, labels, undo, interchange and clipboard passed');
