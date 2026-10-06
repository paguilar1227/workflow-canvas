// Positive/negative controls for the E7 layout grader. Usage: node scripts/skill-evals/check-e7-grader.mjs [round-dir with <client>/E7/{grade-input,doc}.json]
import fs from 'node:fs';
import path from 'node:path';
import { e7Layout, E7_NODES } from './cases.mjs';

const ROUND = process.argv[2];
const size = { web: [240, 72], gateway: [240, 72], orders: [240, 72], payments: [240, 72], stripe: [220, 64], db: [180, 104] };
const seed = { nodes: E7_NODES.map((n) => ({ ...n, width: size[n.id][0], height: size[n.id][1] })) };
const fraud = { id: 'fraud', title: 'Fraud check', x: 960, y: 0, width: 240, height: 72 };
const edit = (moves, extra = [fraud]) => ({ nodes: [...seed.nodes.map((n) => ({ ...n, ...(moves[n.id] ?? {}) })), ...extra] });
const ok = (L) => L.strayMoves.length === 0 && L.sharedAxisOffset && L.resized.length === 0;
const cases = [
  ['rigid +320 shift of Payments and Stripe', true, edit({ payments: { x: 1280 }, stripe: { x: 1600 } })],
  ['no moves, fraud placed above the connector', true, edit({}, [{ ...fraud, x: 800, y: -160 }])],
  ['Payments +320, Stripe +200 (different offsets)', false, edit({ payments: { x: 1280 }, stripe: { x: 1480 } })],
  ['shift with a vertical component', false, edit({ payments: { x: 1280, y: 40 }, stripe: { x: 1600, y: 40 } })],
  ['shift backwards (toward Orders)', false, edit({ payments: { x: 900 }, stripe: { x: 1220 } })],
  ['Web app moved', false, edit({ payments: { x: 1280 }, stripe: { x: 1600 }, web: { x: -40 } })],
  ['Postgres moved with the shift', false, edit({ payments: { x: 1280 }, stripe: { x: 1600 }, db: { x: 960 } })],
  ['Payments resized', false, edit({ payments: { x: 1280, width: 280 }, stripe: { x: 1600 } })],
  ['whole chain re-laid out', false, edit({ web: { x: 0, y: 100 }, gateway: { x: 300, y: 100 }, orders: { x: 600, y: 100 }, payments: { x: 1200, y: 100 }, stripe: { x: 1500, y: 100 } })],
].map(([name, expect, doc]) => ({ name, expect, seed, doc }));
if (ROUND) for (const client of ['copilot', 'codex']) {
  const dir = path.join(ROUND, client, 'E7'); if (!fs.existsSync(path.join(dir, 'grade-input.json'))) { console.log('missing ' + dir); continue; }
  const gi = JSON.parse(fs.readFileSync(path.join(dir, 'grade-input.json'), 'utf8'));
  cases.push({ name: client + ' real round-1 edit', expect: true, seed: gi.seedDoc, doc: gi.doc });
}
let bad = 0;
for (const c of cases) { const L = e7Layout(c.seed, c.doc); const got = ok(L); if (got !== c.expect) bad++; console.log((got === c.expect ? 'ok   ' : 'FAIL ') + 'expect ' + c.expect + ' got ' + got + '  ' + c.name + '  [stray ' + L.strayMoves.join(',') + ' | offsets ' + L.offsets.join(' ') + ' | resized ' + L.resized.length + ']'); }
console.log(cases.length - bad + '/' + cases.length + ' as expected'); process.exit(bad ? 1 : 0);
