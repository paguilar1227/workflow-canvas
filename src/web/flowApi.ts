import type { ReactFlowInstance } from '@xyflow/react';

let instance: ReactFlowInstance | null = null;
export function setFlow(i: ReactFlowInstance | null) { instance = i; }
export function flow() { return instance; }

/** Include routed wires and displaced labels when fitting the drawing. */
export function fitDrawing(duration = 300) {
  if (!instance) return;
  const elements = document.querySelectorAll('.react-flow__node, .wfc-edge-path, .wfc-edge-label');
  const boxes = [...elements].map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
  if (!boxes.length) return instance.fitView({ padding: 0.15, duration, maxZoom: 1.5 });
  const first = instance.screenToFlowPosition({ x: Math.min(...boxes.map((r) => r.left)), y: Math.min(...boxes.map((r) => r.top)) });
  const last = instance.screenToFlowPosition({ x: Math.max(...boxes.map((r) => r.right)), y: Math.max(...boxes.map((r) => r.bottom)) });
  return instance.fitBounds({ ...first, width: last.x - first.x, height: last.y - first.y }, { padding: 0.15, duration });
}

export function viewportCenter(): { x: number; y: number } {
  const el = document.querySelector('.react-flow') as HTMLElement | null;
  if (!instance || !el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return instance.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

