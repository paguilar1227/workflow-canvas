import type { CanvasDocument, CanvasEdge, CanvasNode, LayerDirection } from './types';

export const nodeLayer = (node: CanvasNode) => node.zIndex ?? (node.kind === 'frame' ? -1 : 1);
export const edgeLabelLayer = (edge: CanvasEdge) => edge.zIndex ?? 3;

export function arrangeLayers(doc: CanvasDocument, nodeIds: string[], edgeIds: string[], direction: LayerDirection): CanvasDocument {
  const nodes = new Set(nodeIds);
  const edges = new Set(edgeIds);
  const items = [
    ...doc.nodes.map((node) => ({ item: node, layer: nodeLayer(node), selected: nodes.has(node.id) })),
    ...doc.edges.map((edge) => ({ item: edge, layer: edgeLabelLayer(edge), selected: edges.has(edge.id) })),
  ];
  const selected = items.filter((entry) => entry.selected).sort((left, right) => left.layer - right.layer);
  if (!selected.length) return doc;
  if (direction === 'forward' || direction === 'backward') {
    const ordered = [...items].sort((left, right) => left.layer - right.layer);
    let moved = false;
    const step = direction === 'forward' ? -1 : 1;
    for (let index = step < 0 ? ordered.length - 2 : 1; index >= 0 && index < ordered.length; index += step) {
      const other = index - step;
      if (ordered[index].selected && !ordered[other].selected) {
        [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
        moved = true;
      }
    }
    if (!moved) return doc;
    const first = Math.min(0, ...items.map((entry) => entry.layer));
    const layers = new Map(ordered.map((entry, index) => [entry.item, first + index]));
    return {
      ...doc,
      nodes: doc.nodes.map((node) => ({ ...node, zIndex: layers.get(node)! })),
      edges: doc.edges.map((edge) => ({ ...edge, zIndex: layers.get(edge)! })),
    };
  }
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
