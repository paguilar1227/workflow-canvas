import { documentFromExcalidraw } from '../../src/shared/excalidraw';
import type { App } from './journey';

/** Shared by the desktop and phone save journeys: the file name Save suggests for the 'Release plan' document. */
export const FILE = 'Release plan.excalidraw';

/** Every feature the .excalidraw export has to carry (same coverage as .scratch/roundtrip.ts). */
export const CONTENT = {
  nodes: [
    { id: 'lane', kind: 'frame', title: 'Backend', subtitle: 'Services', color: 'blue', notes: 'lane notes', x: 0, y: 0, width: 600, height: 400, locked: true },
    { id: 'root', kind: 'topic', title: 'Launch', shape: 'pill', color: 'purple', icon: '🚀', badge: 'Q3', subtitle: 'v2', x: 40, y: 60, width: 240, height: 72, frameId: 'lane', collapsed: true, tags: ['a', 'b'], link: 'https://example.com', status: 'doing', priority: 2, notes: 'multi\nline' },
    { id: 'kid', kind: 'topic', title: 'Hidden child', shape: 'rounded', x: 320, y: 70, width: 200, height: 48, parentId: 'root', frameId: 'lane', status: 'done' },
    { id: 'db', kind: 'topic', title: 'Ledger', shape: 'cylinder', color: 'teal', x: 40, y: 220, width: 160, height: 96, frameId: 'lane' },
    { id: 'hex', kind: 'topic', title: 'Gate', shape: 'hexagon', x: 700, y: 40, width: 180, height: 80 },
    { id: 'dia', kind: 'topic', title: 'Decide?', shape: 'diamond', color: 'amber', x: 700, y: 200, width: 160, height: 110 },
    { id: 'circ', kind: 'topic', title: 'Done', shape: 'circle', x: 920, y: 200, width: 120, height: 120 },
    { id: 'st', kind: 'sticky', title: 'Remember the risk', color: 'green', x: 700, y: 360, width: 200, height: 140 },
    { id: 'tx', kind: 'text', title: 'Free label', color: 'red', notes: 'text notes', x: 960, y: 40, width: 120, height: 30, link: 'https://x.dev' },
    { id: 'pen', kind: 'drawing', title: '', color: 'pink', points: [[0, 0], [10.5, 4.2], [22, 18.3], [30, 2]], x: 1100, y: 300, width: 30, height: 18, locked: true },
  ],
  edges: [
    { id: 'e1', source: 'root', target: 'db', label: 'writes', style: 'dashed', arrow: 'both', routing: 'step', color: 'red', animated: true, sourceSide: 'bottom', targetSide: 'top' },
    { id: 'e2', source: 'hex', target: 'dia', style: 'dotted', arrow: 'none', routing: 'straight' },
    { id: 'e3', source: 'dia', target: 'circ', label: 'yes', style: 'solid', arrow: 'end', routing: 'smooth' },
  ],
};

const canon = (o: unknown) => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b))) : v));
const byId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));

/** Every node and edge field of the open document, compared with what parsing the saved file gives back. */
export async function roundTripDiffs(app: App, text: string) {
  const doc = await app.doc() as any;
  const back = documentFromExcalidraw(text) as any;
  const diffs: string[] = [];
  for (const [kind, ours, theirs] of [['node', doc.nodes, back.nodes], ['edge', doc.edges, back.edges]] as const) {
    for (const a of ours as any[]) {
      const b = (theirs as any[]).find((x) => x.id === a.id);
      if (!b) { diffs.push('missing ' + kind + ' ' + a.id); continue; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (canon(a[k]) !== canon(b[k])) diffs.push(kind + ' ' + a.id + '.' + k + ': ' + canon(a[k]) + ' -> ' + canon(b[k]));
    }
    if ((theirs as any[]).length !== (ours as any[]).length) diffs.push(kind + ' count ' + (ours as any[]).length + ' -> ' + (theirs as any[]).length);
  }
  for (const k of ['title', 'description', 'settings']) if (canon(doc[k]) !== canon(back[k])) diffs.push('doc.' + k + ': ' + canon(doc[k]) + ' -> ' + canon(back[k]));
  if (canon(byId(doc.nodes)) !== canon(byId(back.nodes)) || canon(byId(doc.edges)) !== canon(byId(back.edges))) diffs.push('canonical node/edge lists differ');
  return [...new Set(diffs)];
}

export const titleIn = (text: string | null, id: string) => (text ? documentFromExcalidraw(text).nodes.find((n) => n.id === id)?.title : undefined);
