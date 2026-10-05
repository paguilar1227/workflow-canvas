// Regression tests for describeLogic and role import: npm run test:logic
import { describeLogic } from '../../src/shared/logic';
import { documentFromExcalidraw, exportExcalidraw, importExcalidraw } from '../../src/shared/excalidraw';
import type { CanvasDocument, CanvasEdge, CanvasNode } from '../../src/shared/types';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(detail))); if (!ok) failed++; };
let order = 0;
const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, kind: 'topic', title: id, x: order * 300, y: 0, width: 200, height: 60, order: ++order, ...extra });
const edge = (source: string, target: string, extra: Partial<CanvasEdge> = {}): CanvasEdge => ({ id: source + '-' + target, source, target, style: 'solid', arrow: 'end', routing: 'smooth', ...extra });
const doc = (nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasDocument => ({ id: 'd', title: 'T', nodes, edges, settings: { autoArrange: true, treeLayout: 'mindmap' }, createdAt: '', updatedAt: '' });

{
  const d = doc([node('s', { role: 'start' }), node('x', { role: 'step' as never }), node('e', { role: 'end' })], [edge('s', 'x'), edge('x', 'e')]);
  let ok = true, issues: string[] = [];
  try { issues = describeLogic(d).report.issues.map((i) => i.message); } catch (err) { ok = false; issues = [String(err)]; }
  check('D2: an unknown role does not break describe_logic and reads as a step', ok && issues.length === 0, issues);
  const scene = exportExcalidraw(d);
  check('D2: opening an .excalidraw file drops unknown roles', documentFromExcalidraw(JSON.stringify(scene)).nodes.find((n) => n.id === 'x')?.role === undefined);
  check('D2: importing an .excalidraw scene drops unknown roles', importExcalidraw(JSON.stringify(scene), 'i').nodes.find((n) => n.id === 'ix')?.role === undefined);
}
{
  const d = doc([node('s', { role: 'start' }), node('x', { role: 'constructor' as never }), node('e', { role: 'end' })], [edge('s', 'x'), edge('x', 'e')]);
  let ok = true;
  try { describeLogic(d); } catch { ok = false; }
  check('built-in object names (constructor) are not treated as roles', ok);
}
{
  const d = doc([node('root'), node('a', { parentId: 'root' }), node('db', { parentId: 'root', shape: 'cylinder' }), node('q', { parentId: 'a', shape: 'diamond' })]);
  const r = describeLogic(d).report;
  check('N1: a mind map with diamond/cylinder children reports no issues', r.issues.length === 0, r.issues);
}
{
  const d = doc([node('a'), node('b')], [edge('a', 'b', { arrow: 'both' })]);
  const r = describeLogic(d);
  check('N2: a two-way connector in a document without roles reports no issues', r.report.issues.length === 0, r.report.issues);
  check('N2: no "Not reached from a start" heading without starts', !r.markdown.includes('Not reached from a start'), r.markdown);
}
{
  const d = doc([node('s', { role: 'start' }), node('a'), node('b')], [edge('s', 'a'), edge('a', 'b'), edge('b', 'a')]);
  const r = describeLogic(d).report;
  check('a loop with no way out is flagged in a flow with roles', r.issues.some((i) => /no way out/.test(i.message)), r.issues);
}
{
  const d = doc([node('s', { role: 'start' }), node('d', { role: 'decision' }), node('y', { role: 'end' }), node('n', { role: 'end' })], [edge('s', 'd'), edge('d', 'y', { label: 'Yes' }), edge('d', 'n')]);
  const r = describeLogic(d).report;
  check('an unlabelled decision branch is flagged', r.issues.length === 1 && /no condition label/.test(r.issues[0].message), r.issues);
}
{
  const d = doc([node('a'), node('q', { shape: 'diamond' }), node('b'), node('c')], [edge('a', 'q'), edge('q', 'b', { label: 'Yes' }), edge('q', 'c')]);
  const r = describeLogic(d).report;
  check('a connected diamond without a role still gets decision checks', r.issues.some((i) => /no condition label/.test(i.message)), r.issues);
}
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
