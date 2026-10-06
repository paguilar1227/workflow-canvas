// Regression test for lane order: npm run test:unit
import { applyCommand, normalizeCommand } from '../../src/shared/commands';
import { layoutLanes } from '../../src/shared/layout';
import type { CanvasDocument } from '../../src/shared/types';

let seq = 0;
let doc: CanvasDocument = { id: 'd', title: 'T', nodes: [], edges: [], settings: { autoArrange: true, treeLayout: 'mindmap' }, createdAt: '', updatedAt: '' };
const titles = ['Clients', 'Edge', 'Services', 'Data', 'Third parties'];
doc = applyCommand(doc, normalizeCommand(doc, { type: 'add_nodes', nodes: titles.map((t, i) => ({ id: 'f' + i, kind: 'frame', title: t })) }, { genId: () => 'g' + ++seq, anchor: { x: 0, y: 0 } }));
doc = applyCommand(doc, normalizeCommand(doc, { type: 'add_nodes', nodes: titles.map((_, i) => ({ id: 'n' + i, title: 'Node ' + i, frameId: 'f' + i })) }, { genId: () => 'g' + ++seq, anchor: { x: 0, y: 0 } }));
const pos = layoutLanes(doc);
const order = [...titles.keys()].sort((a, b) => pos.get('f' + a)!.x - pos.get('f' + b)!.x).map((i) => titles[i]);
const ok = JSON.stringify(order) === JSON.stringify(titles);
console.log((ok ? 'ok   ' : 'FAIL ') + 'frames added without positions become lanes in the order they were given' + (ok ? '' : ' ' + JSON.stringify(order)));
if (!ok) process.exit(1);
console.log('all passed');
