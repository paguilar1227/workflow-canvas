// Positive/negative controls for the E1 one-call / flow-edge rules and the E4 code-node rule.
// Usage: node scripts/skill-evals/check-e1-e4-grader.mjs <round-dir> [extra E4 round-dirs...]
import fs from 'node:fs';
import path from 'node:path';
import { e1BuiltInOneCall, e1FlowEdges, e4IsCode, E4_PATH } from './cases.mjs';

const [ROUND, ...EXTRA] = process.argv.slice(2);
if (!ROUND) { console.error('usage: node scripts/skill-evals/check-e1-e4-grader.mjs <round evidence dir> [extra run dirs...]'); process.exit(2); }
const T = (title, kind) => ({ title, ...(kind ? { kind } : {}) });
const named = ['Web app', 'API gateway', 'Orders service', 'Stripe', 'Postgres', 'Email worker', 'Email queue'].map((t) => T(t));
const cd = (nodes) => ({ name: 'create_diagram', args: { nodes } }), add = (nodes) => ({ name: 'add_nodes', args: { nodes } }), read = (name) => ({ name });
const cases = [];
const e1 = (name, expect, wc) => cases.push({ name: 'E1 one call: ' + name, expect, got: () => e1BuiltInOneCall(wc).pass });
e1('one create_diagram with every component', true, [read('get_canvas_state'), cd([T('Client', 'frame'), ...named]), read('describe_logic')]);
e1('one create_diagram + a follow-up add after checking', true, [cd(named), read('describe_logic'), add([T('Checkout response')])]);
e1('frames via create_diagram, components via a series of add_nodes', false, [cd([T('Client', 'frame'), T('App', 'frame')]), add([named[0], named[1]]), add([named[2], named[3]]), add(named.slice(4))]);
e1('only add_nodes', false, [add(named.slice(0, 4)), add(named.slice(4))]);
e1('two create_diagram calls', false, [cd(named), cd(named)]);
e1('create_diagram missing the queue', false, [cd(named.slice(0, 6)), add([T('Email queue')])]);
e1('add_nodes before create_diagram', false, [add([named[0]]), cd(named)]);
const doc = { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'n', kind: 'sticky' }, { id: 't', kind: 'text' }], edges: [] };
const e1e = (name, expect, edges) => cases.push({ name: 'E1 edges: ' + name, expect, got: () => { const f = e1FlowEdges({ ...doc, edges }); return f.length > 0 && f.every((e) => (e.label ?? '').trim()); } });
e1e('unlabelled sticky pointer exempt', true, [{ source: 'a', target: 'b', label: 'REST' }, { source: 'n', target: 'a' }]);
e1e('unlabelled pointer to a text label exempt', true, [{ source: 'a', target: 'b', label: 'SQL' }, { source: 'b', target: 't' }]);
e1e('unlabelled component-to-component edge', false, [{ source: 'a', target: 'b' }, { source: 'n', target: 'a' }]);
const e4 = (name, expect, nodes) => cases.push({ name: 'E4 paths: ' + name, expect, got: () => { const c = nodes.filter(e4IsCode); return c.length > 0 && c.every((n) => E4_PATH.test(n.subtitle ?? '')); } });
const mod = { title: 'Command engine', subtitle: 'src/shared/commands.ts' };
e4('actor, external, file artifact without paths', true, [mod, { title: 'Person in the browser', subtitle: 'mouse' }, { title: 'stdio-only MCP client', subtitle: 'Claude Desktop' }, { title: 'Stripe', role: 'external', subtitle: 'payments' }, { title: 'Attached Excalidraw files', subtitle: 'browser file' }, { title: 'PostgreSQL', role: 'store', subtitle: 'optional' }]);
e4('code module without a path', false, [mod, { title: 'Layout engine', subtitle: 'auto layout' }]);
e4('config files named by file path', true, [mod, { title: 'Project configuration', subtitle: 'package.json · tsconfig.json' }]);
e4('brace-grouped module paths', true, [mod, { title: 'Graph, sizing & layout', subtitle: 'shared/{graph,layout,sizes}.ts' }]);
e4('braces without a path', false, [mod, { title: 'Layout options', subtitle: '{graph, tree, lanes}' }]);
e4('format list is not a path', false, [mod, { title: 'Export formats', subtitle: 'PNG · SVG · Markdown · JSON' }]);
e4('code node with an actor-like word', false, [mod, { title: 'User service', subtitle: 'accounts' }]);
e4('client code without a path', false, [mod, { title: 'Realtime sync client', subtitle: 'websocket' }]);
e4('file-handling code without a path', false, [mod, { title: 'File service', subtitle: 'saves files' }]);
e4('file autosaver code without a path', false, [mod, { title: 'File autosaver', subtitle: 'debounced save' }]);
const real = (dir, id, expect, fn) => { if (fs.existsSync(dir)) cases.push({ name: 'real ' + id + ' ' + path.relative(path.dirname(ROUND), dir), expect, got: () => fn(dir) }); else console.log('missing ' + dir); };
const load = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const callsOf = (d) => { const c = load(d, 'calls.json'); return (Array.isArray(c) ? c : c.calls).filter((x) => x.kind === 'mcp' && x.server === 'workflow-canvas'); };
const e4real = (d) => { const doc = load(d, 'doc.json'); const m = doc.nodes.filter((n) => n.frameId && !['frame', 'sticky', 'text', 'drawing'].includes(n.kind ?? 'topic')).filter(e4IsCode); return m.length > 0 && m.every((n) => E4_PATH.test(n.subtitle ?? '')); };
for (const c of ['copilot', 'codex']) {
  real(path.join(ROUND, c, 'E1'), 'E1 one call', true, (d) => e1BuiltInOneCall(callsOf(d)).pass);
  real(path.join(ROUND, c, 'E1'), 'E1 edges', true, (d) => { const f = e1FlowEdges(load(d, 'doc.json')); return f.every((e) => (e.label ?? '').trim()); });
}
for (const r of [ROUND, ...EXTRA]) for (const c of ['copilot', 'codex']) real(path.join(r, c, 'E4'), 'E4 paths', true, e4real);
let bad = 0;
for (const c of cases) { const got = c.got(); if (got !== c.expect) bad++; console.log((got === c.expect ? 'ok   ' : 'FAIL ') + 'expect ' + c.expect + ' got ' + got + '  ' + c.name); }
console.log(cases.length - bad + '/' + cases.length + ' as expected'); process.exit(bad ? 1 : 0);
