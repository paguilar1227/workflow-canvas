import type { CanvasNode, NodeKind, NodeShape } from './types';

export function defaultSize(kind: NodeKind, shape: NodeShape | undefined, isRoot = false): { width: number; height: number } {
  if (kind === 'frame') return { width: 560, height: 420 };
  if (kind === 'sticky') return { width: 200, height: 160 };
  if (kind === 'text') return { width: 260, height: 48 };
  if (kind === 'drawing') return { width: 120, height: 80 };
  switch (shape) {
    case 'diamond': return { width: 160, height: 120 };
    case 'circle': return { width: 128, height: 128 };
    case 'hexagon': return { width: 200, height: 88 };
    case 'cylinder': return { width: 180, height: 104 };
    case 'parallelogram': return { width: 200, height: 72 };
    case 'pill': return isRoot ? { width: 260, height: 72 } : { width: 200, height: 52 };
    case 'rounded':
    case 'rectangle': return { width: 220, height: 64 };
    default: return isRoot ? { width: 280, height: 84 } : { width: 240, height: 72 };
  }
}

export interface Rect { x: number; y: number; width: number; height: number }

export function rectOf(n: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>): Rect {
  return { x: n.x, y: n.y, width: n.width, height: n.height };
}

export function center(n: Rect) {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function containsPoint(r: Rect, p: { x: number; y: number }) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

