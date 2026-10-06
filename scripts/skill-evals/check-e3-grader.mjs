// Positive/negative controls for the E3 ambiguity grader. Usage: node scripts/skill-evals/check-e3-grader.mjs [round-dir with <client>/E3/final.md]
import fs from 'node:fs';
import path from 'node:path';
import { e3FlaggedLines } from './cases.mjs';

const ROUND = process.argv[2];
const rows = [
  [true, 'Is the unlabelled path from Within 30 days? meant to be the decline path?'],
  [true, '| Q1 | The branch to Refund declined has no label | Confirm it means "No" |'],
  [true, 'Open question: what happens to requests older than 30 days?'],
  [true, 'The 30-day decision has an ambiguous second branch.'],
  [true, 'TBD: the condition on the path into **Refund declined**'],
  [true, 'The diagram does not say which answer to "Within 30 days?" leads to Refund declined; this remains open.'],
  [false, 'Support checks whether the request is within 30 days.'],
  [false, 'If the request is older than 30 days, the refund is declined.'],
  [false, 'The “Within 30 days?” decision routes Yes to the amount check.'],
  [false, '- **Within 30 days?**'],
  [false, 'The customer receives a confirmation when the refund is declined.'],
  [false, 'Customers can open a refund request within 30 days of purchase.'],
  [false, 'Open question: who approves refunds over $500?'],
  [false, 'Assumption: refunds after 30 days are declined.'],
  [false, '**In scope:** Refund submission, receipt verification, 30-day eligibility validation, and refund payment.'],
];
const cases = rows.map(([expect, text]) => ({ name: text.slice(0, 70), expect, text }));
if (ROUND) for (const client of ['copilot', 'codex']) {
  const f = path.join(ROUND, client, 'E3', 'final.md'); if (!fs.existsSync(f)) { console.log('missing ' + f); continue; }
  const msg = fs.readFileSync(f, 'utf8'); const hit = e3FlaggedLines(msg);
  cases.push({ name: client + ' real BRD', expect: true, text: msg });
  cases.push({ name: client + ' real BRD minus flagged lines', expect: false, text: msg.split('\n').filter((l) => !hit.includes(l.trim())).join('\n') });
}
let bad = 0;
for (const c of cases) { const got = e3FlaggedLines(c.text).length > 0; if (got !== c.expect) bad++; console.log((got === c.expect ? 'ok   ' : 'FAIL ') + 'expect ' + c.expect + ' got ' + got + '  ' + c.name); }
console.log(cases.length - bad + '/' + cases.length + ' as expected'); process.exit(bad ? 1 : 0);
