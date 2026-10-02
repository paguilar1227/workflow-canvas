import type { CanvasDocument } from './types';
import type { EdgeInput, NodeInput } from './commands';
import { childrenMap, descendants } from './graph';

/** Deep-copies nodes (with their subtrees and internal edges) as fresh inputs. */
export function cloneNodes(doc: CanvasDocument, ids: string[], offset: { x: number; y: number }, genId: () => string): { nodes: NodeInput[]; edges: EdgeInput[]; idMap: Record<string, string> } {
  const kids = childrenMap(doc);
  const pick = new Set<string>();
  for (const id of ids) {
    if (!doc.nodes.some((n) => n.id === id)) continue;
    pick.add(id);
    for (const d of descendants(doc, id, kids)) pick.add(d);
    const n = doc.nodes.find((x) => x.id === id);
    if (n?.kind === 'frame') for (const m of doc.nodes.filter((x) => x.frameId === id)) pick.add(m.id);
  }
  const idMap: Record<string, string> = {};
  for (const id of pick) idMap[id] = genId();
  const ordered = doc.nodes.filter((n) => pick.has(n.id)).sort((a, b) => (a.kind === 'frame' ? -1 : 0) - (b.kind === 'frame' ? -1 : 0));
  const byDepth = (id: string): number => { const n = doc.nodes.find((x) => x.id === id); return n?.parentId && pick.has(n.parentId) ? 1 + byDepth(n.parentId) : 0; };
  ordered.sort((a, b) => (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1) || byDepth(a.id) - byDepth(b.id));
  const nodes: NodeInput[] = ordered.map((n) => {
    const { id, order: _order, ...rest } = n;
    const copy: NodeInput = { ...rest, id: idMap[id], x: n.x + offset.x, y: n.y + offset.y };
    copy.parentId = n.parentId && pick.has(n.parentId) ? idMap[n.parentId] : n.parentId && !ids.includes(n.id) ? n.parentId : null;
    if (n.parentId && !pick.has(n.parentId)) copy.parentId = null;
    copy.frameId = n.frameId && pick.has(n.frameId) ? idMap[n.frameId] : n.frameId ?? null;
    return copy;
  });
  const edges: EdgeInput[] = doc.edges.filter((e) => pick.has(e.source) && pick.has(e.target)).map((e) => {
    const { id: _id, ...rest } = e;
    return { ...rest, source: idMap[e.source], target: idMap[e.target], sourceSide: e.sourceSide ?? undefined, targetSide: e.targetSide ?? undefined };
  });
  return { nodes, edges, idMap };
}

