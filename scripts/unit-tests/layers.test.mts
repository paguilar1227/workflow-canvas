import assert from 'node:assert/strict';
import { applyCommand, normalizeCommand, diffDocs } from '../../src/shared/commands';
import { nodeLayer, edgeLabelLayer } from '../../src/shared/layers';
import { documentFromExcalidraw, exportExcalidraw, importExcalidraw } from '../../src/shared/excalidraw';
import type { CanvasDocument } from '../../src/shared/types';

let sequence = 0;
const options = { genId: () => 'layer-' + ++sequence };
const empty: CanvasDocument = { id: 'layers', title: 'Layers', nodes: [], edges: [], settings: { autoArrange: false, treeLayout: 'mindmap' }, createdAt: '', updatedAt: '' };
const original = applyCommand(empty, normalizeCommand(empty, { type: 'batch', commands: [
  { type: 'add_nodes', nodes: [
    { id: 'frame', kind: 'frame' }, { id: 'first', zIndex: 0 }, { id: 'second', zIndex: 4 }, { id: 'third' },
  ] },
  { type: 'add_edges', edges: [{ id: 'wire', source: 'first', target: 'second', label: 'Label', labelOffset: { x: 35, y: -20 } }] },
] }, options));
assert.equal(nodeLayer(original.nodes[0]), -1);
assert.equal(nodeLayer(original.nodes[1]), 0);
assert.equal(edgeLabelLayer(original.edges[0]), 3);

for (const direction of ['front', 'back'] as const) {
  const arranged = applyCommand(original, { type: 'arrange_layers', nodeIds: ['first', 'second'], edgeIds: ['wire'], direction });
  const layers = [nodeLayer(arranged.nodes[1]), edgeLabelLayer(arranged.edges[0]), nodeLayer(arranged.nodes[2])];
  assert.ok(layers[0] < layers[1] && layers[1] < layers[2], 'mixed selections preserve relative order');
  for (const node of [arranged.nodes[0], arranged.nodes[3]]) assert.ok(direction === 'front' ? layers[0] > nodeLayer(node) : layers[2] < nodeLayer(node));
  assert.deepEqual(applyCommand(arranged, diffDocs(arranged, original)!), original, 'undo restores exact data');
  assert.deepEqual(arranged.nodes.map(({ zIndex: _layer, ...node }) => node), original.nodes.map(({ zIndex: _layer, ...node }) => node), 'arranging does not move or edit nodes');
  const scene = exportExcalidraw(arranged);
  const opened = documentFromExcalidraw(scene);
  assert.deepEqual([...opened.nodes].sort((left, right) => left.id.localeCompare(right.id)), [...arranged.nodes].sort((left, right) => left.id.localeCompare(right.id)), 'saved file retains node layers');
  assert.deepEqual(opened.edges, arranged.edges, 'saved file retains connector layers');
  const imported = importExcalidraw(scene, 'copy-');
  for (const node of arranged.nodes) assert.equal(imported.nodes.find((item) => item.id === 'copy-' + node.id)?.zIndex, node.zIndex, 'import retains node layers');
  assert.equal(imported.edges[0].zIndex, arranged.edges[0].zIndex);
  assert.deepEqual(imported.edges[0].labelOffset, { x: 35, y: -20 });
}
const stack = (doc: CanvasDocument) => [...doc.nodes.map((node) => ({ id: node.id, layer: nodeLayer(node) })), ...doc.edges.map((edge) => ({ id: edge.id, layer: edgeLabelLayer(edge) }))].sort((left, right) => left.layer - right.layer).map((item) => item.id);
const forward = applyCommand(original, { type: 'arrange_layers', nodeIds: ['first'], edgeIds: [], direction: 'forward' });
assert.deepEqual(stack(forward), ['frame', 'third', 'first', 'wire', 'second']);
const backward = applyCommand(forward, { type: 'arrange_layers', nodeIds: ['first'], edgeIds: [], direction: 'backward' });
assert.deepEqual(stack(backward), ['frame', 'first', 'third', 'wire', 'second']);
assert.equal(applyCommand(forward, { type: 'arrange_layers', nodeIds: ['second'], edgeIds: [], direction: 'forward' }), forward, 'forward at the front is a no-op');
console.log('Layer ordering, mixed selections, undo and Excalidraw round trips passed');
