/** Rectilinear connector routing. Coordinates are in canvas space. */
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
type Side = 'left' | 'right' | 'top' | 'bottom';
interface Connection {
  source: Point;
  target: Point;
  sourceSide: Side;
  targetSide: Side;
  obstacles: Rect[];
  /** A user-controlled bend is retained even when it deliberately overlaps a node. */
  via?: Point;
  /** Parallel edges can use separate eight-pixel tracks. */
  track?: number;
}

const CLEARANCE = 16;
const TRACK_SPACING = 8;
const EPSILON = 1e-7;
const vector: Record<Side, Point> = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
};
const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inside = (p: Point, r: Rect) => p.x > r.x + EPSILON && p.x < r.x + r.width - EPSILON && p.y > r.y + EPSILON && p.y < r.y + r.height - EPSILON;

/** Boundary contact is allowed; a segment may never pass through an interior. */
function clear(a: Point, b: Point, obstacles: Rect[]): boolean {
  if (a.x !== b.x && a.y !== b.y) return false;
  return !obstacles.some(r => a.y === b.y
    ? a.y > r.y + EPSILON && a.y < r.y + r.height - EPSILON && Math.max(a.x, b.x) > r.x + EPSILON && Math.min(a.x, b.x) < r.x + r.width - EPSILON
    : a.x > r.x + EPSILON && a.x < r.x + r.width - EPSILON && Math.max(a.y, b.y) > r.y + EPSILON && Math.min(a.y, b.y) < r.y + r.height - EPSILON);
}

function stub(p: Point, side: Side, obstacles: Rect[], other: Point, preferred: number): Point {
  const d = vector[side];
  let length = preferred;
  // Tight gaps still need a correctly directed exit, without entering the next node.
  for (const r of obstacles) {
    const across = d.x ? p.y > r.y && p.y < r.y + r.height : p.x > r.x && p.x < r.x + r.width;
    if (!across) continue;
    const gap = d.x > 0 ? r.x - p.x : d.x < 0 ? p.x - r.x - r.width : d.y > 0 ? r.y - p.y : p.y - r.y - r.height;
    if (gap > EPSILON) length = Math.min(length, gap / 2);
  }
  const otherAlong = d.x ? (other.x - p.x) * d.x : (other.y - p.y) * d.y;
  if ((d.x ? p.y === other.y : p.x === other.x) && otherAlong > 0) length = Math.min(length, otherAlong / 2);
  return { x: p.x + d.x * length, y: p.y + d.y * length };
}

interface Graph {
  points: Point[];
  links: { to: number; axis: number; length: number }[][];
  index: Map<string, number>;
}
const key = (p: Point) => `${p.x},${p.y}`;

function graph(obstacles: Rect[], anchors: Point[]): Graph {
  const xs = new Set(anchors.map(p => p.x));
  const ys = new Set(anchors.map(p => p.y));
  for (const r of obstacles) {
    xs.add(r.x); xs.add(r.x + r.width);
    ys.add(r.y); ys.add(r.y + r.height);
  }
  const xValues = [...xs].sort((a, b) => a - b), yValues = [...ys].sort((a, b) => a - b);
  const points: Point[] = [], index = new Map<string, number>();
  const rows: number[][] = yValues.map(() => []), columns: number[][] = xValues.map(() => []);
  yValues.forEach((y, row) => xValues.forEach((x, column) => {
    const p = { x, y };
    if (obstacles.some(r => inside(p, r))) return;
    const i = points.length;
    points.push(p); index.set(key(p), i); rows[row].push(i); columns[column].push(i);
  }));
  const links: Graph['links'] = points.map(() => []);
  for (const [axis, lines] of [[1, rows], [2, columns]] as const) {
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        if (!clear(points[a], points[b], obstacles)) continue;
        const length = distance(points[a], points[b]);
        links[a].push({ to: b, axis, length }); links[b].push({ to: a, axis, length });
      }
    }
  }
  return { points, links, index };
}

interface QueueItem { state: number; cost: number; priority: number }
/** Small binary heap keeps large diagrams free of an arbitrary search-size cap. */
class Queue {
  items: QueueItem[] = [];
  push(item: QueueItem) {
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(item, this.items[parent])) break;
      this.items[i] = this.items[parent]; i = parent;
    }
    this.items[i] = item;
  }
  pop(): QueueItem | undefined {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length && last) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.before(this.items[child + 1], this.items[child])) child++;
        if (!this.before(this.items[child], last)) break;
        this.items[i] = this.items[child]; i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
  private before(a: QueueItem, b: QueueItem) { return a.priority < b.priority || (a.priority === b.priority && a.state < b.state); }
}

function find(g: Graph, a: Point, b: Point): Point[] | null {
  const start = g.index.get(key(a)), end = g.index.get(key(b));
  if (start === undefined || end === undefined) return null;
  if (start === end) return [a];
  const costs = new Map<number, number>(), previous = new Map<number, number>(), queue = new Queue();
  const initial = start * 3;
  costs.set(initial, 0); queue.push({ state: initial, cost: 0, priority: distance(a, b) });
  let current: QueueItem | undefined;
  while ((current = queue.pop())) {
    if (current.cost !== costs.get(current.state)) continue;
    const node = Math.floor(current.state / 3), axis = current.state % 3;
    if (node === end) {
      const path = [g.points[node]];
      let state = current.state;
      while (previous.has(state)) { state = previous.get(state)!; path.push(g.points[Math.floor(state / 3)]); }
      return path.reverse();
    }
    for (const link of g.links[node]) {
      const state = link.to * 3 + link.axis;
      const cost = current.cost + link.length + (axis && axis !== link.axis ? TRACK_SPACING : 0);
      if (cost >= (costs.get(state) ?? Infinity)) continue;
      costs.set(state, cost); previous.set(state, current.state);
      queue.push({ state, cost, priority: cost + distance(g.points[link.to], b) });
    }
  }
  return null;
}

function simplify(points: Point[], protectedPoints: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && equal(result[result.length - 1], p)) continue;
    while (result.length > 1) {
      const a = result[result.length - 2], b = result[result.length - 1];
      if (protectedPoints.some(protectedPoint => equal(b, protectedPoint))) break;
      const straight = a.x === b.x && b.x === p.x || a.y === b.y && b.y === p.y;
      if (!straight) break;
      result.pop();
    }
    if (!result.length || !equal(result[result.length - 1], p)) result.push(p);
  }
  return result;
}

export function routeConnection({ source, target, sourceSide, targetSide, obstacles, via, track = 0 }: Connection): Point[] {
  const nodes = obstacles.filter(r => r.width > 0 && r.height > 0 && [r.x, r.y, r.width, r.height].every(Number.isFinite));
  // Explicit placement belongs to the user: a waypoint inside a node intentionally opts
  // this connector out of avoiding that node. All other nodes remain obstacles.
  const blockers = via ? nodes.filter(r => !inside(via, r)) : nodes;
  const offset = track * TRACK_SPACING;
  const clearanceForTrack = CLEARANCE + Math.abs(offset);
  const start = stub(source, sourceSide, blockers, target, clearanceForTrack), end = stub(target, targetSide, blockers, source, clearanceForTrack);
  const protectedPoints = via ? [start, end, via] : [start, end];
  const shifted = (p: Point, side: Side) => side === 'left' || side === 'right' ? { x: p.x, y: p.y + offset } : { x: p.x + offset, y: p.y };
  const trackedStart = shifted(start, sourceSide), trackedEnd = shifted(end, targetSide);

  // Prefer clear space around nodes. If a narrow passage cannot fit that clearance,
  // use its actual free space; the no-interior-crossing contract is unchanged.
  for (const clearance of [clearanceForTrack, 0]) {
    const inflated = blockers.map(r => ({ x: r.x - clearance, y: r.y - clearance, width: r.width + 2 * clearance, height: r.height + 2 * clearance }));
    for (const useTrack of offset ? [true, false] : [false]) {
      const first = useTrack ? trackedStart : start, last = useTrack ? trackedEnd : end;
      if (!clear(source, start, blockers) || !clear(end, target, blockers) || !clear(start, first, inflated) || !clear(last, end, inflated)) continue;
      const anchors = via ? [first, via, last] : [first, last];
      const g = graph(inflated, anchors);
      const middle: Point[] = [];
      let possible = true;
      for (let i = 1; i < anchors.length; i++) {
        const leg = find(g, anchors[i - 1], anchors[i]);
        if (!leg) { possible = false; break; }
        middle.push(...leg);
      }
      if (possible) return simplify([source, start, ...middle, end, target], protectedPoints);
    }
  }
  // Overlapping nodes can enclose a port completely. Keep its directed endpoint
  // segments and any explicit bend instead of silently dropping the connection.
  const bend = via ?? { x: start.x, y: end.y };
  return simplify([source, start, { x: bend.x, y: start.y }, bend, { x: end.x, y: bend.y }, end, target], protectedPoints);
}

export function routePath(points: Point[], radius = 0, obstacles: Rect[] = [], via?: Point): string {
  if (!radius || points.length < 3) return points.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], at = points[i], after = points[i + 1];
    const r = via && equal(at, via) ? 0 : Math.min(radius, distance(before, at) / 2, distance(at, after) / 2);
    const entry = { x: at.x + Math.sign(before.x - at.x) * r, y: at.y + Math.sign(before.y - at.y) * r };
    const exit = { x: at.x + Math.sign(after.x - at.x) * r, y: at.y + Math.sign(after.y - at.y) * r };
    const bounds = { x: Math.min(entry.x, exit.x), y: Math.min(entry.y, exit.y), width: Math.abs(entry.x - exit.x), height: Math.abs(entry.y - exit.y) };
    // The Bezier is contained in this box. Keep a sharp bend where rounding
    // would cut into a node in a passage with no spare clearance.
    const blocked = obstacles.some(node => bounds.x < node.x + node.width && bounds.x + bounds.width > node.x && bounds.y < node.y + node.height && bounds.y + bounds.height > node.y);
    if (!r || blocked || before.x === after.x || before.y === after.y) { path += ` L ${at.x} ${at.y}`; continue; }
    const c1 = { x: entry.x + (at.x - entry.x) * 2 / 3, y: entry.y + (at.y - entry.y) * 2 / 3 };
    const c2 = { x: exit.x + (at.x - exit.x) * 2 / 3, y: exit.y + (at.y - exit.y) * 2 / 3 };
    path += ` L ${entry.x} ${entry.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${exit.x} ${exit.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}

export function routeMiddle(points: Point[], radius = 0): Point {
  if (!points.length) return { x: 0, y: 0 };
  let remaining = points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0) / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    if (remaining <= length && length) {
      const inset = Math.min(radius, length / 2);
      const at = Math.max(inset, Math.min(length - inset, remaining));
      return { x: a.x + (b.x - a.x) * at / length, y: a.y + (b.y - a.y) * at / length };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}
