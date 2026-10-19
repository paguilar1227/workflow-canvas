import type { CanvasEdge } from '../../shared/types';

export interface Point { x: number; y: number }
export interface LabelGeometry { middle: Point; candidates: Point[]; width: number; height: number }
export interface LabelRect extends Point { width: number; height: number }

/** Stop a leader at the label border; a label covering its anchor needs no extra line. */
export function labelLeaderEnd(anchor: Point, center: Point, size: { width: number; height: number }): Point | null {
  const dx = anchor.x - center.x, dy = anchor.y - center.y;
  const halfWidth = size.width / 2, halfHeight = size.height / 2;
  if (Math.abs(dx) <= halfWidth && Math.abs(dy) <= halfHeight) return null;
  const scale = Math.min(dx ? halfWidth / Math.abs(dx) : Infinity, dy ? halfHeight / Math.abs(dy) : Infinity);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

const rectAt = (point: Point, size: LabelGeometry): LabelRect => ({ x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height });
const overlap = (a: LabelRect, b: LabelRect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Reserve manual placements first; place untouched labels nearest their midpoint on free parts of their own path. */
export function placeLabels(edges: Pick<CanvasEdge, 'id' | 'label' | 'labelOffset'>[], geometry: Record<string, LabelGeometry>, nodes: LabelRect[]): Record<string, Point> {
  const occupied = [...nodes];
  const result: Record<string, Point> = {};
  const labels = edges.filter((e) => e.label && geometry[e.id]).sort((a, b) => Number(!!b.labelOffset) - Number(!!a.labelOffset) || a.id.localeCompare(b.id));
  for (const edge of labels) {
    const g = geometry[edge.id];
    let point: Point;
    if (edge.labelOffset) {
      point = { x: g.middle.x + edge.labelOffset.x, y: g.middle.y + edge.labelOffset.y };
    } else {
      point = g.middle;
      let best = Infinity;
      for (const candidate of g.candidates) {
        const rect = rectAt(candidate, g);
        const score = occupied.reduce((sum, other) => sum + overlap(rect, other), 0);
        if (score < best) { best = score; point = candidate; }
        if (score === 0) break;
      }
      // A short/crowded path may have no room for a tag. Search outside it rather
      // than knowingly covering a node or another label; a leader shows ownership.
      for (let ring = 1; best > 0; ring++) {
        const dx = ring * (g.width + 8), dy = ring * (g.height + 8);
        const candidates = [
          { x: g.middle.x, y: g.middle.y - dy }, { x: g.middle.x, y: g.middle.y + dy },
          { x: g.middle.x - dx, y: g.middle.y }, { x: g.middle.x + dx, y: g.middle.y },
        ];
        const free = candidates.find((candidate) => occupied.every((other) => overlap(rectAt(candidate, g), other) === 0));
        if (free) { point = free; best = 0; }
      }
    }
    result[edge.id] = point;
    occupied.push(rectAt(point, g));
  }
  return result;
}
