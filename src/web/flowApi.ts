import type { ReactFlowInstance } from '@xyflow/react';

let instance: ReactFlowInstance | null = null;
export function setFlow(i: ReactFlowInstance | null) { instance = i; }
export function flow() { return instance; }

export function viewportCenter(): { x: number; y: number } {
  const el = document.querySelector('.react-flow') as HTMLElement | null;
  if (!instance || !el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return instance.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

