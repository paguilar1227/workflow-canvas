// Skill-eval cases: user-style prompts, seeds and an automated rubric per case.
// Each grade() returns checks [{id, pass, detail}] plus info [{id, value}] (informational, not counted).
export const BASELINE_DOCS = ['launch-plan', 'how-it-works'];
export const READ_TOOLS = new Set(['get_canvas_state', 'list_documents', 'get_document', 'describe_logic', 'find_nodes', 'capture_screenshot', 'export_document', 'list_themes']);
export const VIEW_TOOLS = new Set(['open_document', 'select', 'control_view']);
export const isWrite = (c) => !READ_TOOLS.has(c.name) && !VIEW_TOOLS.has(c.name);
export const LAYOUT_TOOLS = new Set(['auto_layout', 'move_nodes', 'align_nodes', 'distribute_nodes', 'fit_frame_to_contents']);
const isLogicWrite = (c) => isWrite(c) && !LAYOUT_TOOLS.has(c.name);

const t = (id, title, frameId, role) => ({ id, title, frameId, ...(role ? { role } : {}) });
export const E3_SPEC = {
  nodes: [
    { id: 'customer', kind: 'frame', title: 'Customer' }, { id: 'support', kind: 'frame', title: 'Support' }, { id: 'finance', kind: 'frame', title: 'Finance' },
    t('requested', 'Refund requested', 'customer', 'start'), t('ask', 'Ask for the receipt', 'customer'), t('declined', 'Refund declined', 'customer', 'end'), t('paid', 'Refund paid', 'customer', 'end'),
    t('review', 'Review the request', 'support'), t('receipt', 'Receipt attached?', 'support', 'decision'), t('days', 'Within 30 days?', 'support', 'decision'),
    t('amount', 'Check the amount', 'finance'), t('manager', 'Manager approval', 'finance'), t('pay', 'Pay the refund', 'finance'),
    { id: 'db', title: 'Orders database', role: 'store' }, { id: 'psp', title: 'Payment provider', role: 'external' },
  ],
  edges: [
    { source: 'requested', target: 'review' }, { source: 'review', target: 'receipt' },
    { source: 'receipt', target: 'days', label: 'Yes' }, { source: 'receipt', target: 'ask', label: 'No' }, { source: 'ask', target: 'review' },
    { source: 'days', target: 'amount', label: 'Yes' }, { source: 'days', target: 'declined' },
    { source: 'amount', target: 'pay', label: 'Up to $500' }, { source: 'amount', target: 'manager', label: 'Over $500' }, { source: 'manager', target: 'pay' },
    { source: 'pay', target: 'paid' }, { source: 'db', target: 'review' }, { source: 'pay', target: 'db' }, { source: 'pay', target: 'psp' },
  ],
};
export const E7_NODES = [
  { id: 'web', title: 'Web app', icon: '🌐', x: 0, y: 0 }, { id: 'gateway', title: 'API gateway', x: 320, y: 0 },
  { id: 'orders', title: 'Orders service', icon: '⚙️', x: 640, y: 0 }, { id: 'payments', title: 'Payments', icon: '⚙️', x: 960, y: 0 },
  { id: 'stripe', title: 'Stripe', role: 'external', x: 1280, y: 0 }, { id: 'db', title: 'Postgres', role: 'store', x: 640, y: 260 },
];
export const E7_EDGES = [
  { source: 'web', target: 'gateway', label: 'HTTPS' }, { source: 'gateway', target: 'orders', label: 'REST' },
  { source: 'orders', target: 'payments', label: 'charge' }, { source: 'payments', target: 'stripe', label: 'API' }, { source: 'orders', target: 'db', label: 'SQL' },
];

const topics = (doc) => doc.nodes.filter((n) => !['frame', 'sticky', 'text', 'drawing'].includes(n.kind ?? 'topic'));
const find = (doc, re) => topics(doc).filter((n) => re.test(n.title ?? ''));
const one = (doc, re) => find(doc, re)[0];
const count = (calls, name) => calls.filter((c) => c.name === name).length;
const chk = (id, pass, detail) => ({ id, pass: Boolean(pass), detail });
const portOf = (u) => { try { const x = new URL(u); return x.port || (x.protocol === 'https:' ? '443' : '80'); } catch { return null; } };
const linkCheck = (ctx) => {
  const links = ctx.finalMsg.match(/https?:\/\/[^\s)>\]]*\?doc=[\w-]+/g) ?? []; const want = ctx.canvasBase ? portOf(ctx.canvasBase) : null;
  const ok = links.filter((u) => u.endsWith('?doc=' + ctx.docId) && (!want || portOf(u) === want));
  return chk('doc_link', ctx.docId && ok.length > 0, (links.join(' ') || 'no link') + (want ? ' (expect eval port ' + want + ')' : ''));
};
const skillCheck = (ctx) => chk('skill_loaded', ctx.skillLoaded, ctx.skillEvidence);
const framesWithMembers = (doc) => doc.nodes.filter((f) => f.kind === 'frame' && doc.nodes.some((n) => n.frameId === f.id));
const box = (ctx, n) => n && ctx.boxes[n.id];
const notAfter = (a, b, ax) => a && b && (ax === 'x' ? a.x <= b.x + b.w : a.y <= b.y + b.h);
const center = (b, ax) => (ax === 'x' ? b.x + b.w / 2 : b.y + b.h / 2);
const textOf = (doc) => [...doc.nodes.map((n) => [n.title, n.subtitle, n.notes].join(' ')), ...doc.edges.map((e) => e.label ?? '')].join(' ');
export const E3_BRANCH = /\b30[ -]?days?\b|within 30|declin/i;
export const E3_CUE = /no (condition |branch )?label|unlabell?ed|not labell?ed|missing (a |its )?(condition |branch )?label|without (a )?(condition|label)|\bconfirm(?!ation)|unclear|ambigu|open questions?|open issue|\bopen:|\bquestion\b|remains? open|left open|still open|\bTBD\b|to be (confirmed|decided|defined)|not (specified|stated|defined)|unspecified|\?[\s*_]*$/i;
export const e3FlaggedLines = (msg) => msg.split('\n').map((l) => l.trim()).filter((l) => E3_BRANCH.test(l) && E3_CUE.test(l.replace(/within 30 days\?/gi, 'within 30 days')));
const axisOf = (a, b) => (Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)) >= Math.abs(b.y + b.height / 2 - (a.y + a.height / 2)) ? 'x' : 'y');
// E1: the components named in the prompt must come from one create_diagram call; later add_nodes (a fix after checking) are allowed.
export const E1_COMPONENTS = { web: /web|front|storefront|browser|spa/i, gateway: /gateway/i, orders: /order/i, payments: /payment|stripe/i, postgres: /postgres/i, email_worker: /worker|mailer|e-?mail (sender|service)/i, queue: /queue|kafka|sqs|rabbit|pub.?sub|\bbus\b/i };
export function e1BuiltInOneCall(wc) {
  const i = wc.findIndex((c) => c.name === 'create_diagram'); const cds = wc.filter((c) => c.name === 'create_diagram');
  const nodes = (cds[0]?.args?.nodes ?? []).filter((n) => !['frame', 'sticky', 'text', 'drawing'].includes(n.kind ?? 'topic'));
  const missing = Object.entries(E1_COMPONENTS).filter(([, re]) => !nodes.some((n) => re.test(n.title ?? ''))).map(([k]) => k);
  const addsBefore = wc.slice(0, i < 0 ? wc.length : i).filter((c) => c.name === 'add_nodes').length, addsAfter = i < 0 ? 0 : wc.slice(i + 1).filter((c) => c.name === 'add_nodes').length;
  return { pass: cds.length === 1 && missing.length === 0 && addsBefore === 0, detail: 'create_diagram ' + cds.length + (missing.length ? '; named components missing from it: ' + missing.join(',') : '; all 7 named components in it') + '; add_nodes before ' + addsBefore + ', after ' + addsAfter };
}
// E1: connectors from or to stickies/text are annotation pointers and need no label; flow edges between components do.
export function e1FlowEdges(doc) { const annot = new Set(doc.nodes.filter((n) => ['sticky', 'text'].includes(n.kind)).map((n) => n.id)); return doc.edges.filter((e) => !annot.has(e.source) && !annot.has(e.target)); }
// E4: module paths apply to nodes that represent code; actors/people, external systems and data/file artifacts are exempt.
const E4_NONCODE_ROLES = new Set(['external', 'store', 'data', 'actor', 'person']);
const E4_ACTOR = /\b(person|people|users?|human|editor|actor|customer|developer|operator)\b|\bAI agent\b|\bMCP client\b|\bLLM\b|\bexternal\b/i;
const E4_ARTIFACT = /\bfiles?\b|\.excalidraw\b|\bdatabase\b|postgres|\bbucket\b|\bvolume\b/i;
const E4_CODE_WORD = /\b(services?|api|modules?|packages?|engines?|layers?|handlers?|controllers?|routers?|server|librar(y|ies)|lib|sdk|hooks?|components?|(auto)?savers?|writers?|loaders?|readers?|watchers?|parsers?|workers?|managers?)\b/i;
export const e4IsCode = (n) => !(E4_NONCODE_ROLES.has(n.role) || (!E4_CODE_WORD.test(n.title ?? '') && (E4_ACTOR.test(n.title ?? '') || E4_ARTIFACT.test(n.title ?? ''))));
export const E4_PATH = /[\w.-]+\/[\w.*-]+|\w\.(tsx?|jsx?|mjs|cjs|json|css|html|ya?ml|sh)\b|\bDockerfile\b/;
// Editing someone else's diagram: nodes in the way are existing nodes at or beyond the downstream end (Payments) along the insertion axis, inside the Orders-Payments band.
export function e7Layout(seedDoc, doc) {
  const S = (re) => seedDoc.nodes.find((n) => re.test(n.title ?? ''));
  const O = S(/^Orders/), P = S(/^Payments/); const ax = axisOf(O, P), pp = ax === 'x' ? 'y' : 'x', ps = ax === 'x' ? 'height' : 'width';
  const dir = Math.sign(P[ax] - O[ax]) || 1; const lo = Math.min(O[pp], P[pp]), hi = Math.max(O[pp] + O[ps], P[pp] + P[ps]);
  const rows = seedDoc.nodes.filter((s) => s.kind !== 'frame').map((s) => { const n = doc?.nodes.find((m) => m.id === s.id);
    return { title: s.title, n, s, dx: n ? n.x - s.x : NaN, dy: n ? n.y - s.y : NaN, moved: !n || n.x !== s.x || n.y !== s.y, inWay: dir * (s[ax] - P[ax]) >= 0 && s[pp] < hi && s[pp] + s[ps] > lo }; });
  const moved = rows.filter((r) => r.moved); const offsets = [...new Set(moved.map((r) => r.dx + ',' + r.dy))];
  const along = (r) => (ax === 'x' ? r.dx : r.dy), across = (r) => (ax === 'x' ? r.dy : r.dx);
  return { ax, inWay: rows.filter((r) => r.inWay).map((r) => r.title), moved: moved.map((r) => r.title + ' ' + r.dx + ',' + r.dy), strayMoves: moved.filter((r) => !r.inWay).map((r) => r.title), offsets,
    sharedAxisOffset: moved.length === 0 || (offsets.length === 1 && across(moved[0]) === 0 && dir * along(moved[0]) > 0),
    resized: rows.filter((r) => r.n && (r.n.width !== r.s.width || r.n.height !== r.s.height)).map((r) => r.title + ' ' + r.s.width + 'x' + r.s.height + '->' + r.n.width + 'x' + r.n.height) };
}

export const CASES = {
  E1: {
    title: 'Architecture sketch',
    prompt: () => 'Sketch the architecture of a typical SaaS checkout: web app, API gateway, orders service, payments through Stripe, Postgres, and an email worker that reads from a queue.',
    tab: 'live',
    grade(ctx) {
      const { doc, wc } = ctx; const firstWc = wc[0]?.name;
      const edges = doc ? e1FlowEdges(doc) : []; const labelled = edges.filter((e) => (e.label ?? '').trim()).length; const pointers = (doc?.edges.length ?? 0) - edges.length; const one1 = e1BuiltInOneCall(wc);
      const N = doc ? { web: one(doc, /web|front|storefront|browser|spa/i), gw: one(doc, /gateway/i), orders: one(doc, /order/i), pg: one(doc, /postgres/i), stripe: one(doc, /stripe/i) } : {};
      const B = Object.fromEntries(Object.entries(N).map(([k, n]) => [k, box(ctx, n)]));
      const pts = Object.values(B).filter(Boolean); const spread = (ax) => Math.max(...pts.map((b) => center(b, ax))) - Math.min(...pts.map((b) => center(b, ax)));
      const ax = pts.length ? (spread('x') >= spread('y') ? 'x' : 'y') : 'x';
      const order = pts.length === 5 && notAfter(B.web, B.gw, ax) && notAfter(B.gw, B.orders, ax) && notAfter(B.orders, B.pg, ax) && notAfter(B.orders, B.stripe, ax) && center(B.web, ax) < center(B.pg, ax);
      const frames = doc ? framesWithMembers(doc) : [];
      const frameOrder = frames.map((f) => ({ t: f.title, b: ctx.boxes[f.id] ?? { x: f.x, y: f.y, w: f.width ?? 0, h: f.height ?? 0 } })).sort((a, b) => center(a.b, ax) - center(b.b, ax)).map((f) => f.t);
      const fitCall = wc.some((c) => c.name === 'control_view' && c.args?.action === 'fit') ? 'control_view fit' : wc.some((c) => c.name === 'create_diagram' && c.args?.fitView) ? 'create_diagram fitView' : '';
      return [
        skillCheck(ctx),
        chk('orient_first', firstWc === 'get_canvas_state', 'first canvas call: ' + firstWc),
        chk('one_create_diagram', one1.pass, one1.detail),
        chk('frames_as_boundaries', frames.length >= 2, frames.length + ' frames with members: ' + frames.map((f) => f.title).join(', ')),
        chk('stripe_external', N.stripe?.role === 'external', N.stripe ? N.stripe.title + ' role=' + N.stripe.role : 'no Stripe node'),
        chk('postgres_store', N.pg?.role === 'store', N.pg ? N.pg.title + ' role=' + N.pg.role : 'no Postgres node'),
        chk('edges_labelled', edges.length > 0 && labelled === edges.length, labelled + '/' + edges.length + ' flow edges labelled' + (pointers ? ' (' + pointers + ' note pointer(s) exempt)' : '')),
        chk('fit', fitCall, fitCall || 'no fit'),
        linkCheck(ctx),
        chk('flow_order', order, 'axis ' + ax + '; frames along axis: ' + frameOrder.join(' -> ') + '; nodes found: ' + Object.entries(N).filter(([, n]) => n).map(([k]) => k).join(',')),
      ];
    },
  },
  E2: {
    title: 'Decision flow',
    prompt: () => 'Map out our password-reset flow so we can review the logic: request a reset, we email a link, the link expires after 30 minutes, a wrong or used token shows an error, success lets them set a new password.',
    tab: 'live',
    grade(ctx) {
      const { doc, wc } = ctx; const ns = doc ? topics(doc) : [];
      const roles = (r) => ns.filter((n) => n.role === r).length;
      const decisions = ns.filter((n) => n.role === 'decision');
      const out = decisions.flatMap((d) => doc.edges.filter((e) => e.source === d.id));
      const unl = out.filter((e) => !(e.label ?? '').trim());
      const lastWrite = Math.max(-1, ...wc.map((c, i) => (isLogicWrite(c) ? i : -1)));
      const dl = wc.map((c, i) => (c.name === 'describe_logic' ? i : -1)).filter((i) => i >= 0);
      const issues = ctx.logic?.issues ?? null;
      return [
        skillCheck(ctx),
        chk('roles_start_end_decision', roles('start') >= 1 && roles('end') >= 1 && roles('decision') >= 1, 'start ' + roles('start') + ', end ' + roles('end') + ', decision ' + roles('decision')),
        chk('decision_branches_labelled', decisions.length > 0 && out.length > 0 && unl.length === 0, out.length - unl.length + '/' + out.length + ' decision branches labelled'),
        chk('describe_logic_after_last_edit', dl.length > 0 && Math.max(...dl) > lastWrite, 'describe_logic calls at ' + dl.join(',') + '; last logic edit (layout-only calls excluded) at ' + lastWrite),
        chk('final_issues_none_or_explained', issues && (issues.length === 0 || /issue|unlabel|dead end|deliberate|intention/i.test(ctx.finalMsg)), issues ? issues.length + ' issues: ' + JSON.stringify(issues).slice(0, 200) : 'no logic'),
        chk('expiry_30_min_modelled', doc && /30\s*(min|minutes)/i.test(textOf(doc)), 'node/edge text mentions 30 minutes'),
        linkCheck(ctx),
      ];
    },
  },
  E3: {
    title: 'Read a person\'s flow and draft a BRD',
    seed: async (h) => { const d = await h.tool('create_document', { title: 'Refund process', template: 'blank', open: true }); const id = d.documentId ?? d.id ?? d.document?.id; await h.tool('create_diagram', { documentId: id, ...E3_SPEC, layout: 'lanes' }); return id; },
    prompt: (id) => 'Draft a one-page BRD from the diagram ' + id + ' on the canvas.',
    tab: 'live',
    grade(ctx) {
      const { wc } = ctx; const flagged = e3FlaggedLines(ctx.finalMsg);
      const writes = wc.filter(isWrite);
      return [
        skillCheck(ctx),
        chk('describe_logic_called', wc.some((c) => c.name === 'describe_logic' && c.args?.documentId === ctx.docId), 'describe_logic on ' + ctx.docId + ': ' + count(wc, 'describe_logic')),
        chk('no_edits', writes.length === 0 && ctx.unchanged, 'writes: ' + (writes.map((c) => c.name).join(',') || 'none') + '; document unchanged: ' + ctx.unchanged),
        chk('ambiguity_flagged', flagged.length > 0, flagged.length ? 'line: ' + flagged[0].slice(0, 220) : 'no line names the 30-day/declined branch with an open/unlabelled/confirm cue'),
      ];
    },
    info(ctx) { const m = ctx.finalMsg; return { lanes: ['Customer', 'Support', 'Finance'].filter((l) => m.includes(l)).length + '/3', store: /orders database/i.test(m), external: /payment provider/i.test(m), loop: /receipt/i.test(m) }; },
  },
  E4: {
    title: 'Codebase map',
    prompt: () => 'Map this codebase on the canvas.',
    tab: 'live', cwd: 'repo',
    grade(ctx) {
      const { doc, wc } = ctx; const firstWrite = ctx.calls.findIndex((c) => c.kind === 'mcp' && c.server === 'workflow-canvas' && isWrite(c));
      const reads = ctx.calls.slice(0, firstWrite < 0 ? ctx.calls.length : firstWrite).filter((c) => c.kind !== 'mcp' && /\bsrc\/|\.tsx?\b/.test(JSON.stringify(c.args)) && c.ok);
      const frames = doc ? framesWithMembers(doc) : [];
      const members = doc ? topics(doc).filter((n) => n.frameId) : [];
      const code = members.filter(e4IsCode); const exempt = members.filter((n) => !e4IsCode(n)).map((n) => n.title); const withPath = code.filter((n) => E4_PATH.test(n.subtitle ?? ''));
      const ids = members.map((n) => n.id).filter((id) => ctx.boxes[id]);
      let overlaps = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = ctx.boxes[ids[i]], b = ctx.boxes[ids[j]]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++; }
      return [
        skillCheck(ctx),
        chk('reads_code_before_drawing', reads.length > 0, reads.length + ' code reads before the first canvas write'),
        chk('recipes_consulted', ctx.recipesRead, ctx.recipesRead ? 'references/recipes.md read' : 'not read'),
        chk('frames_per_area', frames.length >= 2, frames.map((f) => f.title).join(', ')),
        chk('module_paths_in_subtitles', code.length > 0 && withPath.length === code.length, withPath.length + '/' + code.length + ' framed code topics have a path subtitle' + (exempt.length ? '; exempt (not code): ' + exempt.join(', ') : '') + (withPath.length < code.length ? '; missing: ' + code.filter((n) => !E4_PATH.test(n.subtitle ?? '')).map((n) => n.title).join(', ') : '')),
        chk('readable_no_overlaps', ids.length > 0 && overlaps === 0, overlaps + ' overlapping card pairs among ' + ids.length + ' visible cards'),
      ];
    },
    info(ctx) { return { capture_screenshot: count(ctx.wc, 'capture_screenshot') }; },
  },
  E5: {
    title: 'Canvas down, mind map',
    prompt: () => 'Put a mind map of our Q3 goals on the canvas: grow revenue, reduce churn, launch the mobile app, hire two engineers.',
    tab: 'after', stopFirst: true,
    grade(ctx) {
      const { doc, wc } = ctx; const ns = doc ? topics(doc) : [];
      const roots = ns.filter((n) => !n.parentId);
      const goals = [/revenue/i, /churn/i, /mobile/i, /hir|engineer/i];
      const root = roots.find((r) => goals.every((g) => ns.some((n) => n.parentId === r.id && g.test(n.title))));
      const tree = wc.some((c) => (c.name === 'create_document' && c.args?.template === 'mindmap') || (['create_diagram', 'auto_layout'].includes(c.name) && (c.args?.layout === 'tree' || c.args?.direction === 'mindmap')));
      const ensure = ctx.calls.some((c) => c.kind !== 'mcp' && /ensure-canvas\.sh/.test(JSON.stringify(c.args)));
      return [
        skillCheck(ctx),
        chk('canvas_started', ctx.containerRunningAfter && wc.length > 0 && wc[0].ok, 'container running after: ' + ctx.containerRunningAfter + '; started by ' + (ensure ? 'agent (ensure-canvas.sh)' : 'MCP launcher at session start') + '; first canvas call ' + (wc[0] ? wc[0].name + ' ok=' + wc[0].ok : 'none')),
        chk('mind_map_hierarchy', root, root ? 'root "' + root.title + '" has the 4 goals as children' : 'no root with all 4 goals as children'),
        chk('tree_layout', tree, tree ? 'mindmap template or tree layout used' : 'no mindmap template / tree layout'),
      ];
    },
  },
  E6: {
    title: 'Should not trigger',
    prompt: () => 'Give me a Mermaid flowchart snippet of a login flow that I can paste into my README.',
    tab: 'live',
    grade(ctx) {
      const writes = ctx.wc.filter(isWrite);
      return [
        chk('mermaid_in_answer', /\x60\x60\x60mermaid[\s\S]*?(flowchart|graph)/i.test(ctx.finalMsg), 'mermaid fenced block with flowchart/graph'),
        chk('no_canvas_writes', writes.length === 0 && ctx.docCountAfter === ctx.docCountBefore, 'writes: ' + (writes.map((c) => c.name).join(',') || 'none') + '; documents ' + ctx.docCountBefore + ' -> ' + ctx.docCountAfter),
      ];
    },
    info(ctx) { return { canvas_reads: ctx.wc.map((c) => c.name).join(',') || 'none', skill_loaded: ctx.skillLoaded }; },
  },
  E7: {
    title: 'Edit someone else\'s diagram',
    seed: async (h) => { const d = await h.tool('create_document', { title: 'Checkout services', template: 'blank', open: true }); const id = d.documentId ?? d.id ?? d.document?.id; await h.tool('add_nodes', { documentId: id, nodes: E7_NODES }); await h.tool('add_edges', { documentId: id, edges: E7_EDGES }); return id; },
    select: 'Orders service',
    prompt: (id) => 'Add a fraud check between the orders service and payments in diagram ' + id + '.',
    tab: 'live',
    grade(ctx) {
      const { doc, wc, seedDoc } = ctx; const firstWrite = wc.findIndex(isWrite);
      const readsBefore = wc.slice(0, firstWrite < 0 ? wc.length : firstWrite).map((c) => c.name);
      const fraud = doc ? find(doc, /fraud/i).find((n) => !seedDoc.nodes.some((s) => s.id === n.id)) : null;
      const id = (re) => seedDoc.nodes.find((n) => re.test(n.title))?.id;
      const O = id(/^Orders/), P = id(/^Payments/);
      const has = (s, t) => doc?.edges.some((e) => e.source === s && e.target === t);
      const L = e7Layout(seedDoc, doc);
      const c = (n) => ({ x: n.x + (n.width ?? 0) / 2, y: n.y + (n.height ?? 0) / 2 });
      const nearest = fraud ? seedDoc.nodes.filter((n) => n.kind !== 'frame').map((n) => ({ t: n.title, d: Math.hypot(c(n).x - c(fraud).x, c(n).y - c(fraud).y) })).sort((a, b) => a.d - b.d)[0] : null;
      const relayout = wc.filter((x) => (x.name === 'auto_layout' && !(x.args?.nodeIds?.length)) || (x.name === 'create_diagram' && x.args?.clear));
      return [
        skillCheck(ctx),
        chk('reads_first', firstWrite > 0 && readsBefore.some((n) => ['get_document', 'describe_logic', 'find_nodes', 'get_canvas_state'].includes(n)), 'before first write: ' + readsBefore.join(',')),
        chk('fraud_check_inserted', fraud && has(O, fraud.id) && has(fraud.id, P), fraud ? '"' + fraud.title + '" orders->fraud ' + has(O, fraud.id) + ', fraud->payments ' + has(fraud.id, P) : 'no new fraud node'),
        chk('placed_near_related', nearest && /^(Orders|Payments)/.test(nearest.t), nearest ? 'nearest existing node: ' + nearest.t : 'n/a'),
        chk('untouched_nodes_kept', doc && L.strayMoves.length === 0, L.strayMoves.length ? 'moved but not in the way: ' + L.strayMoves.join(', ') : 'in the way (' + L.ax + ' axis): ' + (L.inWay.join(', ') || 'none') + '; moved: ' + (L.moved.join('; ') || 'none')),
        chk('moved_nodes_share_axis_offset', doc && L.sharedAxisOffset, 'offsets dx,dy: ' + (L.offsets.join(' | ') || 'none') + ' (axis ' + L.ax + ')'),
        chk('no_resizing', doc && L.resized.length === 0, L.resized.join('; ') || 'all existing node sizes unchanged'),
        chk('no_whole_canvas_relayout', relayout.length === 0, relayout.map((x) => x.name).join(',') || 'none'),
      ];
    },
    info(ctx) { return { direct_orders_payments_edge_removed: !ctx.doc?.edges.some((e) => ctx.seedDoc.edges.some((s) => s.id === e.id && /charge/.test(s.label ?? ''))) }; },
  },
};
