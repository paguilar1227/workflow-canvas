import { useEffect, useState, type CSSProperties } from 'react';
import { getBezierPath, useStore, type ConnectionLineComponentProps } from '@xyflow/react';
import { useApp } from '../store';
import { getTheme } from '../../shared/themes';
import type { CanvasEdge, ColorName } from '../../shared/types';

/** Wire colours for connectors without their own colour, after the reference: yellow, pink, purple, orange, cyan. */
export const NEON_WIRES: ColorName[] = ['amber', 'pink', 'purple', 'red', 'teal'];

/** The longest connect animation in styles.css (the card light sweep); burst state is dropped after it. */
export const NEON_BURST_MS = 1600;

/**
 * Snap distance in flow units while connecting. The reference spark spans about four title heights (≈51px against a 13px
 * title); with our 14px titles that is about 55.
 */
export const NEON_SNAP_RADIUS = 55;

/** Spark re-roll interval while a wire hovers a port (about 14 frames a second, a flicker rather than smooth motion). */
const SPARK_TICK_MS = 70;

export function useNeon() {
  return useApp((s) => !!getTheme(s.session.theme).neon);
}

/** FNV-1a with a final avalanche, so ids that differ by a few characters still land on different colours. */
function mix(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

const uncoloured = (e: CanvasEdge) => !e.color || e.color === 'default';

/**
 * Uncoloured wires into the same card take consecutive palette colours from a per-card start, skipping colours that
 * explicitly coloured wires into that card already use, so converging inputs read apart.
 */
export function neonWireColors(edges: CanvasEdge[]): Map<string, ColorName> {
  const out = new Map<string, ColorName>();
  const taken = new Map<string, Set<string>>();
  for (const e of edges) if (!uncoloured(e)) taken.set(e.target, (taken.get(e.target) ?? new Set()).add(e.color!));
  const rank = new Map<string, number>();
  for (const e of edges) {
    if (!uncoloured(e)) { out.set(e.id, e.color as ColorName); continue; }
    const r = rank.get(e.target) ?? 0;
    rank.set(e.target, r + 1);
    const start = mix(e.target);
    const order = NEON_WIRES.map((_, i) => NEON_WIRES[(start + i) % NEON_WIRES.length]);
    const free = order.filter((c) => !taken.get(e.target)?.has(c));
    const pool = free.length ? free : order;
    out.set(e.id, pool[r % pool.length]);
  }
  return out;
}

/** The colour the next uncoloured wire into a card will get, so the snap spark already shows it. */
export function nextNeonWire(edges: CanvasEdge[], target: string): ColorName {
  const next = { id: '\u0000next', source: '', target } as CanvasEdge;
  return neonWireColors([...edges, next]).get(next.id)!;
}

/** Mind-map branches: each first-level branch gets one palette colour unless it has its own. */
export function neonBranch(branchId: string, color?: string): ColorName {
  return color && color !== 'default' ? (color as ColorName) : NEON_WIRES[mix(branchId) % NEON_WIRES.length];
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function jitter(i: number, phase: number) {
  const v = Math.sin(i * 12.9898 + phase * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** A zig-zag spark from the pointer to the port it snapped to; a new phase re-rolls the kinks so it crackles. */
export function sparkPath(ax: number, ay: number, bx: number, by: number, phase: number) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (len < 3) return '';
  const steps = Math.max(3, Math.round(len / 7));
  const nx = -dy / len, ny = dx / len;
  let d = 'M' + ax.toFixed(1) + ',' + ay.toFixed(1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const amp = (i % 2 ? 1 : -1) * (2 + jitter(i, phase) * 3.5);
    d += ' L' + (ax + dx * t + nx * amp).toFixed(1) + ',' + (ay + dy * t + ny * amp).toFixed(1);
  }
  return d + ' L' + bx.toFixed(1) + ',' + by.toFixed(1);
}

/** While dragging a connector: a white wire to the pointer; near a port, a spark in the wire's future colour and a ring on the port. */
export function NeonConnectionLine({ fromX, fromY, fromPosition, toX, toY, toPosition, fromNode, toHandle, pointer }: ConnectionLineComponentProps) {
  const transform = useStore((s) => s.transform);
  const edges = useApp((s) => s.doc?.edges);
  const snapped = !!toHandle && toHandle.nodeId !== fromNode.id;
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!snapped || reducedMotion()) return;
    const timer = setInterval(() => setPhase((p) => p + 1), SPARK_TICK_MS);
    return () => clearInterval(timer);
  }, [snapped]);
  const end = snapped && pointer ? { x: (pointer.x - transform[0]) / transform[2], y: (pointer.y - transform[1]) / transform[2] } : { x: toX, y: toY };
  const [wire] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: end.x, targetY: end.y, targetPosition: toPosition });
  const color = snapped ? 'var(--c-' + nextNeonWire(edges ?? [], toHandle!.nodeId) + ')' : '#fff';
  return (
    <g className={'wfc-neon-drag' + (snapped ? ' snapped' : '')} style={{ ['--zc' as string]: color } as CSSProperties} data-testid="neon-connection">
      <path className="wire" d={wire} />
      <circle className="src" cx={fromX} cy={fromY} r={5} />
      {snapped ? (
        <>
          <path className="spark" d={sparkPath(end.x, end.y, toX, toY, phase)} data-testid="neon-spark" />
          <circle className="ring" cx={toX} cy={toY} r={10} />
          <circle className="port" cx={toX} cy={toY} r={4.5} />
        </>
      ) : <circle className="tip" cx={end.x} cy={end.y} r={3.5} />}
    </g>
  );
}

/** Light that runs both ways around a card from the side a new wire landed on, with a ripple from that port. */
export function NeonBurst({ id }: { id: string }) {
  const neon = useNeon();
  const b = useApp((s) => s.bursts[id]);
  if (!neon || !b) return null;
  return (
    <span key={b.at} className={'wfc-neon-burst from-' + b.side} style={{ ['--bc' as string]: 'var(--c-' + b.color + ')' } as CSSProperties} data-testid={'neon-burst-' + id} aria-hidden>
      <i /><i /><b />
    </span>
  );
}
