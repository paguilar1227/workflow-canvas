import type { CanvasDocument, CanvasNode } from './types';

export function nodeMap(doc: CanvasDocument): Map<string, CanvasNode> {
  return new Map(doc.nodes.map((n) => [n.id, n]));
}

export function childrenMap(doc: CanvasDocument): Map<string, CanvasNode[]> {
  const m = new Map<string, CanvasNode[]>();
  for (const n of doc.nodes) {
    if (!n.parentId) continue;
    const list = m.get(n.parentId) ?? [];
    list.push(n);
    m.set(n.parentId, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.order - b.order);
  return m;
}

export function descendants(doc: CanvasDocument, id: string, kids = childrenMap(doc)): string[] {
  const out: string[] = [];
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n.id);
    stack.push(...(kids.get(n.id) ?? []));
  }
  return out;
}

export function rootOf(doc: CanvasDocument, id: string, nodes = nodeMap(doc)): string {
  let cur = nodes.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && nodes.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = nodes.get(cur.parentId);
  }
  return cur?.id ?? id;
}

export function isAncestor(doc: CanvasDocument, ancestorId: string, id: string, nodes = nodeMap(doc)): boolean {
  let cur = nodes.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    if (cur.parentId === ancestorId) return true;
    seen.add(cur.id);
    cur = nodes.get(cur.parentId);
  }
  return false;
}

/** Ids hidden because an ancestor is collapsed. */
export function hiddenIds(doc: CanvasDocument): Set<string> {
  const kids = childrenMap(doc);
  const hidden = new Set<string>();
  for (const n of doc.nodes) {
    if (n.collapsed) for (const d of descendants(doc, n.id, kids)) hidden.add(d);
  }
  return hidden;
}

export function depthOf(doc: CanvasDocument, id: string, nodes = nodeMap(doc)): number {
  let d = 0;
  let cur = nodes.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && nodes.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    d++;
    cur = nodes.get(cur.parentId);
  }
  return d;
}

/** The first-level ancestor (child of the root) used for branch colouring. */
export function branchAncestor(doc: CanvasDocument, id: string, nodes = nodeMap(doc)): CanvasNode | undefined {
  let cur = nodes.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    const parent = nodes.get(cur.parentId);
    if (!parent) return cur;
    if (!parent.parentId) return cur;
    seen.add(cur.id);
    cur = parent;
  }
  return undefined;
}

