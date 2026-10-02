import { memo, useMemo } from 'react';
import rough from 'roughjs';
import { useApp } from '../store';
import { getTheme } from '../../shared/themes';

const gen = rough.generator();

export function useSketch() {
  return useApp((s) => !!getTheme(s.session.theme).sketch);
}

export function seedOf(id: string) {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 100000) + 1;
}

function roundedRect(w: number, h: number, r: number) {
  r = Math.min(r, h / 2, w / 2);
  return 'M' + r + ',1 H' + (w - r) + ' Q' + (w - 1) + ',1 ' + (w - 1) + ',' + r + ' V' + (h - r) + ' Q' + (w - 1) + ',' + (h - 1) + ' ' + (w - r) + ',' + (h - 1) +
    ' H' + r + ' Q1,' + (h - 1) + ' 1,' + (h - r) + ' V' + r + ' Q1,1 ' + r + ',1 Z';
}

/** Hand-drawn outline + hachure fill. Colours are applied through CSS variables. */
export const RoughShape = memo(function RoughShape({ shape, w, h, seed, filled, strong }: { shape: string; w: number; h: number; seed: number; filled: boolean; strong?: boolean }) {
  const paths = useMemo(() => {
    const o = { seed, roughness: 1.1, bowing: 1, stroke: 'S', strokeWidth: strong ? 2.4 : 1.6, fill: filled ? 'F' : undefined, fillStyle: 'hachure', hachureGap: 7, fillWeight: 1, hachureAngle: -41 };
    let d;
    switch (shape) {
      case 'circle': d = gen.ellipse(w / 2, h / 2, w - 3, h - 3, o); break;
      case 'diamond': d = gen.polygon([[w / 2, 1], [w - 1, h / 2], [w / 2, h - 1], [1, h / 2]], o); break;
      case 'hexagon': d = gen.polygon([[w * 0.14, 1], [w * 0.86, 1], [w - 1, h / 2], [w * 0.86, h - 1], [w * 0.14, h - 1], [1, h / 2]], o); break;
      case 'cylinder': {
        const ry = Math.min(14, h / 6);
        d = gen.path('M1,' + ry + ' A' + (w / 2 - 1) + ',' + ry + ' 0 0,1 ' + (w - 1) + ',' + ry + ' L' + (w - 1) + ',' + (h - ry) + ' A' + (w / 2 - 1) + ',' + ry + ' 0 0,1 1,' + (h - ry) + ' Z M1,' + ry + ' A' + (w / 2 - 1) + ',' + ry + ' 0 0,0 ' + (w - 1) + ',' + ry, o);
        break;
      }
      case 'rectangle': case 'sticky': d = gen.rectangle(1, 1, w - 2, h - 2, o); break;
      case 'pill': d = gen.path(roundedRect(w, h, h / 2), o); break;
      default: d = gen.path(roundedRect(w, h, 12), o);
    }
    return gen.toPaths(d);
  }, [shape, w, h, seed, filled, strong]);
  return (
    <svg className="wfc-rough" width={w} height={h} viewBox={'0 0 ' + w + ' ' + h} aria-hidden>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill="none" strokeWidth={p.strokeWidth} strokeLinecap="round" style={{ stroke: p.stroke === 'F' ? 'var(--sk-fill)' : 'var(--sk-stroke)' }} />
      ))}
    </svg>
  );
});

export function roughPath(d: string, seed: number, width = 1.5) {
  return gen.toPaths(gen.path(d, { seed, roughness: 0.8, bowing: 0.6, stroke: 'S', strokeWidth: width }));
}

/** Smooth freehand stroke through points (quadratic midpoints). */
export function strokePath(points: [number, number][]) {
  if (!points.length) return '';
  if (points.length < 3) return 'M' + points.map((p) => p[0] + ',' + p[1]).join(' L');
  let d = 'M' + points[0][0] + ',' + points[0][1];
  for (let i = 1; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    d += ' Q' + x1 + ',' + y1 + ' ' + ((x1 + x2) / 2).toFixed(1) + ',' + ((y1 + y2) / 2).toFixed(1);
  }
  const last = points[points.length - 1];
  return d + ' L' + last[0] + ',' + last[1];
}

