import type { CanvasDocument, CanvasEdge, CanvasNode } from './types';

export const nodeLayer = (node: CanvasNode) => node.zIndex ?? (node.kind === 'frame' ? -1 : 1);
export const edgeLabelLayer = (edge: CanvasEdge) => edge.zIndex ?? 3;

export function arrangeLayers(doc: CanvasDocument, nodeIds: string[], edgeIds: string[], direction: 'front' | 'back'): CanvasDocument {
  const nodes = new Set(nodeIds);
  const edges = new Set(edgeIds);
  const items = [
    ...doc.nodes.map((node) => ({ item: node, layer: nodeLayer(node), selected: nodes.has(node.id) })),
    ...doc.edges.map((edge) => ({ item: edge, layer: edgeLabelLayer(edge), selected: edges.has(edge.id) })),
  ];
  const selected = items.filter((entry) => entry.selected).sort((left, right) => left.layer - right.layer);
  if (!selected.length) return doc;
  const remaining = items.filter((entry) => !entry.selected);
  const boundary = direction === 'front'
    ? Math.max(0, ...remaining.map((entry) => entry.layer)) + 1
    : Math.min(0, ...remaining.map((entry) => entry.layer)) - selected.length;
  const layers = new Map(selected.map((entry, index) => [entry.item, boundary + index]));
  return {
    ...doc,
    nodes: doc.nodes.map((node) => layers.has(node) ? { ...node, zIndex: layers.get(node)! } : node),
    edges: doc.edges.map((edge) => layers.has(edge) ? { ...edge, zIndex: layers.get(edge)! } : edge),
  };
}
