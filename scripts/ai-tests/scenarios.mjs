// User-perspective AI scenarios for scripts/ai-tests/run.mjs.
// Prompts are phrased the way a person would ask: they name the document but never explain the tools.
// Only scenario E changes the (global) theme, and only at its end.
import fs from 'node:fs';
import path from 'node:path';
import { getInternalNodesBounds, getViewportForBounds } from '@xyflow/system';
import { tsImport } from 'tsx/esm/api';

const { documentFromExcalidraw } = await tsImport('../../src/shared/excalidraw.ts', import.meta.url);
const { SHORTCODES } = await tsImport('../../src/server/emoji.ts', import.meta.url);

const SRC_DIR = new URL('../../src', import.meta.url).pathname;

const titleOf = (doc, id) => doc.nodes.find((n) => n.id === id)?.title;
const byTitle = (doc, title) => doc.nodes.find((n) => n.title === title);
const text = (n) => [n.title, n.subtitle, n.notes, n.badge, ...(n.tags ?? [])].filter(Boolean).join(' ').toLowerCase();
const inside = (a, b, tol = 1) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.width <= b.x + b.width + tol && a.y + a.height <= b.y + b.height + tol;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const center = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
const onScreen = (r, pane, tol = 1) => !!r && r.x >= pane.x - tol && r.y >= pane.y - tol && r.x + r.w <= pane.x + pane.w + tol && r.y + r.h <= pane.y + pane.h + tol;
const okCalls = (c, tool) => c.calls.filter((x) => x.tool === tool && x.ok);
const screenshotCheck = (c, check) => check('AI took a screenshot of the canvas to verify its work', okCalls(c, 'capture_screenshot').length > 0, { calls: okCalls(c, 'capture_screenshot').length });

// Scenario C zoom check. Fit-all as the fit-view button does it (src/web/actions.ts fitView: padding 0.15, maxZoom 1.5) within the canvas
// minZoom, using React Flow's own fit math on React Flow's own store values.
const FIT_ALL = { padding: 0.15, maxZoom: 1.5 };
/** Page function: record React Flow's exact viewport, canvas size and measured node boxes whenever the view or the canvas size changes. */
export function installViewLog() {
  const findStore = () => {
    const el = document.querySelector('.react-flow__viewport');
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    for (let f = key ? el[key] : null; f; f = f.return) {
      const v = f.memoizedProps?.value;
      if (typeof v?.getState === 'function' && Array.isArray(v.getState().transform)) return v;
    }
    return null;
  };
  const snap = (s) => ({ t: Date.now(), transform: [...s.transform], width: s.width, height: s.height, minZoom: s.minZoom,
    nodes: [...s.nodeLookup.values()].map((n) => ({ id: n.id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? 0, h: n.measured?.height ?? 0, hidden: !!n.hidden })) });
  const store = findStore();
  if (!store) return { installed: false };
  const log = [snap(store.getState())];
  store.subscribe((s, prev) => { if (s.transform !== prev.transform || s.width !== prev.width || s.height !== prev.height) log.push(snap(s)); });
  window.__aiView = { read: () => ({ log, final: snap(store.getState()), sameStore: findStore() === store }) };
  return { installed: true, zoom: log[0].transform[2], canvas: log[0].width + 'x' + log[0].height };
}
export const readViewLog = () => window.__aiView?.read() ?? null;
export function fitAllZoom(s) {
  const nodes = new Map(s.nodes.filter((n) => n.w && n.h && !n.hidden).map((n) => [n.id, { id: n.id, internals: { positionAbsolute: { x: n.x, y: n.y } }, measured: { width: n.w, height: n.h } }]));
  return nodes.size ? getViewportForBounds(getInternalNodesBounds(nodes), s.width, s.height, s.minZoom, FIT_ALL.maxZoom, FIT_ALL.padding).zoom : null;
}
function canvasBox(s, id) {
  const n = s.nodes.find((x) => x.id === id);
  const [tx, ty, z] = s.transform;
  return n && { x: n.x * z + tx, y: n.y * z + ty, w: n.w * z, h: n.h * z };
}
/**
 * The view counts per AI call (the view when a call finished vs when the previous call finished), so a screenshot's temporary
 * fit-and-restore or a panel toggle never counts as zooming. The AI's last zoom change must be closer than fit-all for the canvas size
 * at that moment, still be the view when the AI finished, with both steps on screen. The fit-all model must equal the fit-view button.
 */
export function judgeZoomIn(view, calls, ids, fitButtonZoom) {
  if (!view?.log?.length || !view.final) return { pass: false, detail: { error: 'no view log from the watched tab', view } };
  const { log, final } = view;
  let prev = log[0], zoomed = null;
  for (const c of [...calls].sort((a, b) => a.endedMs - b.endedMs)) {
    const s = log.findLast((x) => x.t <= c.endedMs) ?? log[0];
    if (s.transform[2] !== prev.transform[2]) zoomed = { call: c.n + ' ' + c.tool, s };
    prev = s;
  }
  const fitThen = zoomed && fitAllZoom(zoomed.s), fitEnd = fitAllZoom(final);
  const shown = Object.fromEntries(ids.map((id) => [id, onScreen(canvasBox(final, id), { x: 0, y: 0, w: final.width, h: final.height })]));
  const pass = !!zoomed && view.sameStore === true && zoomed.s.transform[2] > fitThen && final.transform[2] === zoomed.s.transform[2] &&
    Object.values(shown).every(Boolean) && fitButtonZoom === fitEnd;
  return {
    pass,
    detail: {
      aiZoom: zoomed && { call: zoomed.call, zoom: zoomed.s.transform[2], canvas: zoomed.s.width + 'x' + zoomed.s.height, fitAllZoomForThatCanvas: fitThen },
      whenAiFinished: { zoom: final.transform[2], canvas: final.width + 'x' + final.height, fitAllZoomForThatCanvas: fitEnd, onScreen: shown },
      fitViewButton: { zoom: fitButtonZoom, matchesFitAllModel: fitButtonZoom === fitEnd },
      viewChangesRecorded: log.length - 1, sameStore: view.sameStore,
    },
  };
}

const DOC_EDIT_TOOLS = ['add_nodes', 'update_nodes', 'delete_nodes', 'move_nodes', 'duplicate_nodes', 'reparent_node', 'set_collapsed', 'add_edges', 'update_edges', 'delete_edges',
  'create_diagram', 'auto_layout', 'align_nodes', 'distribute_nodes', 'fit_frame_to_contents', 'import_content', 'update_document', 'undo', 'redo'];
// Same loop as the save_to_file race repro (work/repro-save-race.mjs) that confirmed the in-flight autosave fix.
const SAVE_RACE = { edits: 20, pauseMs: 300 };
// Scenario F: plain tabs (no file attached) on the same document during the AI's save turn (work/repro-multitab-save.mjs).
const F_EXTRA_TABS = 2;
const fExtraTabs = new Map();
async function openPlainTab(page, docId) {
  const tab = await page.context().newPage();
  await tab.goto(new URL('/?doc=' + encodeURIComponent(docId) + '&pin=1', page.url()).href);
  await tab.waitForFunction((id) => window.__wfc?.state().doc?.id === id && !!document.querySelector('.react-flow'), docId, { timeout: 30_000 });
  return tab;
}
const tabFileState = (tab) => tab.evaluate(() => {
  const s = window.__wfc.state();
  return { doc: s.doc?.id ?? null, file: s.file.state, name: s.file.name, saveButton: document.querySelector('[data-testid="save-file"]')?.dataset.state ?? null };
});
const plainTabsOk = (tabs, docId) => Array.isArray(tabs) && tabs.length === F_EXTRA_TABS && tabs.every((t) => t.doc === docId && t.file === 'none' && t.name === null);

/** Page init script: back the browser's save dialog with a real file in the origin-private file system (OPFS). */
function opfsSavePicker() {
  window.__wfcPicked = [];
  window.showSaveFilePicker = async (opts = {}) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(opts.suggestedName || 'canvas.excalidraw', { create: true });
    window.__wfcPicked.push(handle.name);
    return handle;
  };
}
const opfsFiles = (page) => page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const out = [];
  for await (const [name, h] of root.entries()) if (h.kind === 'file') out.push({ name, text: await (await h.getFile()).text() });
  return out;
});
const pickedFile = async (page) => (await page.evaluate(() => window.__wfcPicked ?? [])).at(-1) ?? null;
const saveState = (page) => page.locator('[data-testid="save-file"]').getAttribute('data-state');
const waitSaved = (page) => page.waitForFunction(() => document.querySelector('[data-testid="save-file"]')?.dataset.state === 'saved', null, { timeout: 20_000 });
function parseFile(f) {
  if (!f) return { found: false };
  try {
    const scene = JSON.parse(f.text);
    return { found: true, name: f.name, bytes: f.text.length, type: scene.type, workflowCanvasMeta: !!scene.workflowCanvas, doc: documentFromExcalidraw(f.text) };
  } catch (e) { return { found: true, name: f.name, bytes: f.text.length, parseError: String(e.message ?? e) }; }
}
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canon(v[k])])) : v);
const records = (items) => Object.fromEntries((items ?? []).map((x) => [x.id, JSON.stringify(canon(x))]));
function recordDiff(a, b) {
  const ra = records(a), rb = records(b);
  return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((id) => ra[id] !== rb[id]).map((id) => ({ id, file: ra[id] ?? null, server: rb[id] ?? null }));
}
function fEdits(d) {
  if (!d) return null;
  const write = d.nodes.find((n) => n.id === 'step-1');
  const sec = d.nodes.find((n) => /security sign-?off/i.test(n.title ?? ''));
  const conn = write && sec ? d.edges.find((e) => e.source === write.id && e.target === sec.id) : null;
  const sticky = d.nodes.find((n) => n.kind === 'sticky' && /ship on friday/i.test(n.title ?? ''));
  return { 'step-1': write?.title ?? null, securityStep: sec?.title ?? null, connector: conn ? { label: conn.label ?? null, style: conn.style ?? null } : null, sticky: sticky?.title ?? null };
}
const fLanded = (e) => !!e && e['step-1'] === 'Write release notes' && !!e.securityStep && /before merge/i.test(e.connector?.label ?? '') && e.connector?.style === 'dashed' && !!e.sticky;

function hiddenIds(doc) {
  const hidden = new Set();
  const kids = new Map();
  for (const n of doc.nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
  const hide = (id) => { for (const k of kids.get(id) ?? []) { hidden.add(k); hide(k); } };
  for (const n of doc.nodes) if (n.collapsed) hide(n.id);
  return hidden;
}

// Scenario G: Markdown + :shortcode: emoji. The person ticks "Order the cake"; the AI must find that and tick "Book the venue".
const G_SHORTCODES = ['tada', 'rocket', 'zap'];
const G_DONE = /order the cake/i;
const G_OPEN = /book the venue/i;
const G_READ_TOOLS = ['get_document', 'find_nodes', 'get_canvas_state', 'export_document'];
const MD_CODE = /(\x60{3,}[\s\S]*?(?:\x60{3,}|$)|\x60[^\x60\n]*\x60)/g;
const noVs = (s) => String(s ?? '').replace(/\uFE0F/g, '');
const hasEmoji = (t, code) => noVs(t).includes(noVs(SHORTCODES.get(code)));
/** :name: tokens outside Markdown code that are GitHub shortcodes (the server should have converted every one of them). */
function rawShortcodes(text) {
  const outside = String(text ?? '').split(MD_CODE).filter((_, i) => i % 2 === 0).join('\n');
  return [...outside.matchAll(/:([a-z0-9_+-]+):/gi)].filter((m) => SHORTCODES.has(m[1].toLowerCase())).map((m) => m[0]);
}
const docTexts = (d) => [d?.title, ...(d?.nodes ?? []).flatMap((n) => [n.title, n.subtitle, n.notes, n.badge, n.icon, ...(n.tags ?? [])]), ...(d?.edges ?? []).map((e) => e.label)].filter((t) => typeof t === 'string' && t);
const docRawShortcodes = (d) => docTexts(d).flatMap(rawShortcodes);
function taskLines(src) {
  return String(src ?? '').split('\n').map((l) => /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ checked: m[1] !== ' ', text: m[2] }));
}
function mdShape(src) {
  const s = String(src ?? '');
  return { heading: /^\s{0,3}#{1,6}\s+\S/m.test(s), bold: /(\*\*|__)(?=\S)[^\n]*?\S\1/.test(s), tasks: taskLines(s) };
}
const gTask = (tasks, re) => (tasks ?? []).find((t) => re.test(t.text));
function gFind(d) {
  const stickies = (d?.nodes ?? []).filter((n) => n.kind === 'sticky');
  return {
    sticky: stickies.find((n) => G_OPEN.test(n.title) && G_DONE.test(n.title)) ?? stickies[0] ?? null,
    edge: (d?.edges ?? []).find((e) => e.source === 'step-1' && e.target === 'done') ?? null,
  };
}
/** In the page: what the person's tab shows for the sticky and the connector label. */
function gRendered({ stickyId, edgeId }) {
  const node = stickyId ? document.querySelector('[data-testid="node-' + CSS.escape(stickyId) + '"]') : null;
  const label = edgeId ? document.querySelector('[data-testid="edge-label-' + CSS.escape(edgeId) + '"]') : null;
  const outsideCode = (el) => { const c = el.cloneNode(true); c.querySelectorAll('code, pre').forEach((x) => x.remove()); return c.textContent; };
  return {
    sticky: node && {
      headings: [...node.querySelectorAll('.md h1, .md h2, .md h3, .md h4, .md h5, .md h6')].map((h) => h.tagName + ' ' + h.textContent),
      strong: [...node.querySelectorAll('.md strong')].map((x) => x.textContent),
      tasks: [...node.querySelectorAll('input.md-task')].map((i) => ({ checked: i.checked, disabled: i.disabled, text: i.closest('li')?.textContent.trim() ?? '' })),
      text: node.innerText,
      textOutsideCode: outsideCode(node),
    },
    label: label && { strong: [...label.querySelectorAll('strong')].map((x) => x.textContent), text: label.innerText, textOutsideCode: outsideCode(label) },
  };
}
async function gWaitStored(p, stickyId, ok) {
  const deadline = Date.now() + 10_000;
  let title = null;
  for (;;) {
    const d = await p.http('/api/documents/' + encodeURIComponent(p.docId));
    title = d.nodes.find((n) => n.id === stickyId)?.title ?? null;
    if (ok(taskLines(title)) || Date.now() > deadline) return title;
    await p.page.waitForTimeout(250);
  }
}

export const SCENARIOS = [
  {
    id: 'A',
    slug: 'A-codebase-architecture',
    title: 'Codebase visualization: read the real source and draw its architecture as swimlanes',
    model: 'gpt-6-sol',
    cwd: 'repo',
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test A · Codebase architecture', open: false });
      return { docId: r.json.documentId };
    },
    prompt: (c) => 'I want to understand how the Workflow Canvas codebase is put together. Read the source code in ' + SRC_DIR +
      ' and draw its architecture in my Workflow Canvas document ' + c.docId + '. Organize it as at least 3 swimlanes (for example browser UI, server, shared model) with the main modules as boxes inside the right lane, ' +
      'and connect them with labeled connectors that say how they talk to each other. When you are done, fit the view so I can see the whole diagram and take a screenshot to check that it looks right. Do not modify any files.',
    verify(c, check) {
      const { doc, page } = c;
      const frames = doc.nodes.filter((n) => n.kind === 'frame');
      const members = doc.nodes.filter((n) => n.kind !== 'frame' && n.frameId);
      check('at least 3 swimlanes (frames)', frames.length >= 3, frames.map((f) => f.title));
      const empty = frames.filter((f) => !members.some((m) => m.frameId === f.id));
      check('every swimlane contains at least one module', frames.length > 0 && empty.length === 0, { empty: empty.map((f) => f.title) });
      const all = doc.nodes.map(text).join(' | ');
      const areas = {
        'src/server': ['hub', 'mcp', 'tools.ts', 'stdio', 'app.ts', 'express'],
        'src/shared': ['commands', 'layout', 'schema', 'templates', 'themes', 'io.ts', 'clipboard', 'graph.ts', 'excalidraw'],
        'src/web': ['sync', 'react flow', 'canvas.tsx', 'inspector', 'actions', 'keyboard', 'flowapi', 'topbar', 'leftpanel', 'app.tsx'],
      };
      const found = Object.fromEntries(Object.entries(areas).map(([k, words]) => [k, words.filter((w) => all.includes(w))]));
      check('diagram names real modules from src/server, src/shared and src/web', Object.values(found).every((v) => v.length > 0), found);
      const unlabeled = doc.edges.filter((e) => !e.label?.trim());
      check('has connectors and every connector is labeled', doc.edges.length > 0 && unlabeled.length === 0, { edges: doc.edges.length, unlabeled: unlabeled.map((e) => titleOf(doc, e.source) + ' -> ' + titleOf(doc, e.target)) });
      const escaped = members.filter((m) => { const f = frames.find((x) => x.id === m.frameId); return f && !inside(m, f); });
      check('every module box sits inside its swimlane', members.length > 0 && escaped.length === 0, escaped.map((m) => m.title));
      const clash = [];
      for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) if (overlaps(frames[i], frames[j])) clash.push(frames[i].title + ' x ' + frames[j].title);
      check('swimlanes do not overlap each other', clash.length === 0, clash);
      screenshotCheck(c, check);
      const offscreen = Object.entries(page.nodes).filter(([, r]) => !onScreen(r, page.pane)).map(([id]) => titleOf(doc, id) ?? id);
      check("whole diagram is visible in the user's view when the AI finished", Object.keys(page.nodes).length >= doc.nodes.length && offscreen.length === 0, { rendered: Object.keys(page.nodes).length, nodes: doc.nodes.length, offscreen });
    },
  },
  {
    id: 'B',
    slug: 'B-japan-trip-mindmap',
    title: 'Mind-map planning: 2-week Japan trip with colours, task markers, collapse and logic-chart layout',
    model: 'gpt-6-sol',
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test B · Japan trip', open: false });
      return { docId: r.json.documentId };
    },
    prompt: (c) => 'Help me plan a 2-week trip to Japan as a mind map in my Workflow Canvas document ' + c.docId + '. Put the trip in the center with at least 4 main branches (for example cities, transport, budget, packing), each with at least 3 subtopics. ' +
      'Give each branch its own color. Mark a few of the to-dos as todo and a few as done, and give the most urgent one a priority. Then collapse one of the branches, switch the map to the logic-chart layout (branches going to the right), and take a screenshot so I can see it.',
    verify(c, check) {
      const { doc, page } = c;
      const kids = (id) => doc.nodes.filter((n) => n.parentId === id);
      const roots = doc.nodes.filter((n) => n.kind === 'topic' && !n.parentId && kids(n.id).length);
      const root = roots.sort((a, b) => kids(b.id).length - kids(a.id).length)[0];
      const branches = root ? kids(root.id) : [];
      check('one central topic with at least 4 branches', !!root && branches.length >= 4, { root: root?.title, branches: branches.map((b) => b.title) });
      const thin = branches.filter((b) => kids(b.id).length < 3);
      check('every branch has at least 3 subtopics', branches.length > 0 && thin.length === 0, Object.fromEntries(branches.map((b) => [b.title, kids(b.id).length])));
      const colors = branches.map((b) => b.color ?? 'default');
      check('each branch has its own (distinct, non-default) color', branches.length > 0 && !colors.includes('default') && new Set(colors).size === colors.length, Object.fromEntries(branches.map((b) => [b.title, b.color ?? null])));
      const todo = doc.nodes.filter((n) => n.status === 'todo');
      const done = doc.nodes.filter((n) => n.status === 'done');
      check('some to-dos marked todo and some marked done', todo.length > 0 && done.length > 0, { todo: todo.map((n) => n.title), done: done.map((n) => n.title) });
      const prio = doc.nodes.filter((n) => n.priority && n.priority > 0);
      check('a priority marker is set', prio.length > 0, prio.map((n) => n.title + ' P' + n.priority));
      const collapsed = branches.filter((b) => b.collapsed);
      const leaked = collapsed.flatMap((b) => kids(b.id)).filter((k) => page.nodes[k.id]);
      check('a branch is collapsed and its subtopics are hidden in the UI', collapsed.length > 0 && collapsed.every((b) => page.nodes[b.id]) && leaked.length === 0, { collapsed: collapsed.map((b) => b.title), stillVisible: leaked.map((k) => k.title) });
      check('layout switched to logic chart (treeLayout=right)', doc.settings.treeLayout === 'right', doc.settings);
      const hidden = hiddenIds(doc);
      const left = root ? doc.nodes.filter((n) => n.id !== root.id && n.parentId && !hidden.has(n.id) && n.x < root.x + root.width) : [];
      check('every visible branch is laid out to the right of the center topic', !!root && left.length === 0, left.map((n) => n.title));
      screenshotCheck(c, check);
    },
  },
  {
    id: 'C',
    slug: 'C-coedit-and-ui-control',
    title: 'Co-editing existing content + UI control: rename, decision diamond, dashed connector, select/focus, panels, snap, undo/redo',
    model: 'gpt-6-sol',
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test C · Review workflow', template: 'workflow', open: false });
      const docId = r.json.documentId;
      await h.tool('select', { documentId: docId, mode: 'clear' });
      await h.tool('set_ui', { documentId: docId, outline: true, minimap: true, snapToGrid: false });
      return { docId };
    },
    turns: [{
      prompt: (c) => 'My Workflow Canvas document ' + c.docId + ' has a simple review workflow. Please update it: rename "Do the work" to "Write draft" and "Revise" to "Edit draft". ' +
        'Add a new decision diamond "Legal review needed?" after "Looks good?", connected from "Looks good?" with a dashed connector labeled "check legal". ' +
        'Then select "Write draft" and "Edit draft" and zoom the view in on just those two. Hide the outline panel and the minimap, and turn on snap to grid. ' +
        'Finally undo your last change and redo it so nothing is lost, and take a screenshot so I can check it.',
      async before(p) {
        const r = await p.page.evaluate(installViewLog);
        p.log('recording the view in the watched tab: ' + JSON.stringify(r));
        return { viewLogInstalled: r.installed };
      },
    }],
    async collect(p) { return { view: await p.page.evaluate(readViewLog) }; },
    verify(c, check) {
      const { doc, page, session } = c;
      const node = (id) => doc.nodes.find((n) => n.id === id);
      check('existing "Do the work" step renamed in place to "Write draft"', node('step-1')?.title === 'Write draft', { 'step-1': node('step-1')?.title });
      check('existing "Revise" step renamed in place to "Edit draft"', node('fix')?.title === 'Edit draft', { fix: node('fix')?.title });
      const legal = doc.nodes.find((n) => /legal review needed/i.test(n.title) && !['start', 'step-1', 'decide', 'fix', 'done'].includes(n.id));
      check('new decision diamond "Legal review needed?" added', legal?.shape === 'diamond', legal ? { id: legal.id, title: legal.title, shape: legal.shape } : null);
      const looksGood = byTitle(doc, 'Looks good?');
      const conn = legal && looksGood && doc.edges.find((e) => e.source === looksGood.id && e.target === legal.id);
      check('dashed connector labeled "check legal" from "Looks good?" to the diamond', conn?.style === 'dashed' && /check legal/i.test(conn?.label ?? ''), conn ?? null);
      const pairs = [['start', 'step-1'], ['step-1', 'decide'], ['decide', 'done'], ['decide', 'fix'], ['fix', 'step-1']];
      const lost = pairs.filter(([s, t]) => !doc.edges.some((e) => e.source === s && e.target === t)).map((p) => p.join('->'));
      check('existing steps and connectors were kept (same ids)', ['start', 'decide', 'done'].every(node) && lost.length === 0, { missingEdges: lost, ids: doc.nodes.map((n) => n.id) });
      const want = ['Write draft', 'Edit draft'].map((t) => byTitle(doc, t)?.id ?? '(missing ' + t + ')').sort();
      const same = (a) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify(want);
      const docSelection = session.selections?.[doc.id]?.nodes;
      check('"Write draft" and "Edit draft" are the selection (UI and the document\'s session selection)', same(page.selection.nodes) && same(docSelection), { want, ui: page.selection.nodes, session: docSelection ?? null, documentId: doc.id });
      const zoom = judgeZoomIn(c.data.view, c.calls, want, c.fitZoom);
      check('view zoomed in on the two selected steps (both on screen, closer than fit-all for the canvas size when the AI zoomed)', zoom.pass, zoom.detail);
      check('outline panel and minimap hidden in the UI', page.panels.outline === false && page.panels.minimap === false && !page.dom.outline && !page.dom.minimap, { panels: page.panels, dom: page.dom });
      check('snap to grid turned on', page.snapToGrid === true && session.snapToGrid === true, { ui: page.snapToGrid, session: session.snapToGrid });
      const ur = c.calls.filter((x) => x.tool === 'undo' || x.tool === 'redo');
      const iu = ur.findIndex((x) => x.tool === 'undo' && x.ok && x.resultJson?.ok === true);
      const redone = iu >= 0 && ur.slice(iu + 1).some((x) => x.tool === 'redo' && x.ok && x.resultJson?.ok === true);
      check('undo then redo both succeeded and the edits survived', redone && c.canRedo === false, { sequence: ur.map((x) => x.tool + (x.resultJson?.ok ? ':ok' : ':noop')), canRedo: c.canRedo });
      screenshotCheck(c, check);
    },
  },
  {
    id: 'D',
    slug: 'D-mermaid-cicd-import',
    title: 'Mermaid CI/CD import, top-to-bottom re-layout, risk sticky, Markdown export (different model)',
    model: 'gpt-6-astra',
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test D · Release pipeline', open: false });
      return { docId: r.json.documentId };
    },
    prompt: (c) => 'Import this Mermaid flowchart of our CI/CD pipeline into my Workflow Canvas document ' + c.docId + ':\n\n' +
      'flowchart LR\n  subgraph CI\n    push[Push to main] --> install[Install deps] --> test[Run tests]\n  end\n  subgraph CD\n    build[Build image] --> staging[Deploy to staging] --> smoke{Smoke tests pass?}\n' +
      '    smoke -->|yes| prod[Deploy to production]\n    smoke -->|no| rollback[Rollback]\n  end\n  test --> build\n\n' +
      'Then re-layout it top-to-bottom, add a sticky note next to the production deploy that calls out the biggest risk you see, and finally export the whole thing as Markdown and show me the Markdown.',
    verify(c, check) {
      const { doc } = c;
      const steps = ['Push to main', 'Install deps', 'Run tests', 'Build image', 'Deploy to staging', 'Smoke tests pass?', 'Deploy to production', 'Rollback'];
      const missing = steps.filter((t) => !byTitle(doc, t));
      check('all 8 pipeline steps imported', missing.length === 0, { missing });
      const ci = doc.nodes.find((n) => n.kind === 'frame' && n.title === 'CI');
      const cd = doc.nodes.find((n) => n.kind === 'frame' && n.title === 'CD');
      const wrong = steps.filter((t) => { const n = byTitle(doc, t); const f = steps.indexOf(t) < 3 ? ci : cd; return !n || !f || n.frameId !== f.id; });
      check('CI and CD subgraphs became frames holding their steps', !!ci && !!cd && wrong.length === 0, { ci: !!ci, cd: !!cd, wrongFrame: wrong });
      const smoke = byTitle(doc, 'Smoke tests pass?');
      check('"Smoke tests pass?" is a decision diamond', smoke?.shape === 'diamond', smoke?.shape ?? null);
      const lab = (t, l) => !!smoke && doc.edges.some((e) => e.source === smoke.id && e.target === byTitle(doc, t)?.id && e.label === l);
      check('yes/no branches kept as labeled connectors', lab('Deploy to production', 'yes') && lab('Rollback', 'no'), { edges: doc.edges.length });
      const chain = ['Push to main', 'Install deps', 'Run tests', 'Build image', 'Deploy to staging', 'Smoke tests pass?', 'Deploy to production'].map((t) => byTitle(doc, t));
      const ys = chain.map((n) => (n ? Math.round(center(n).y) : null));
      check('re-laid out top-to-bottom (each step below the previous one)', ys.every((y, i) => y !== null && (i === 0 || y > ys[i - 1])), ys);
      const stickies = doc.nodes.filter((n) => n.kind === 'sticky' && n.title.trim());
      check('a sticky note with a risk was added', stickies.length > 0, stickies.map((s) => s.title));
      const nearest = stickies.map((s) => steps.map((t) => byTitle(doc, t)).filter(Boolean).map((n) => ({ t: n.title, d: Math.hypot(center(n).x - center(s).x, center(n).y - center(s).y) })).sort((a, b) => a.d - b.d)[0]?.t);
      check('the sticky sits next to "Deploy to production" (nearest step)', nearest.includes('Deploy to production'), { nearestStep: nearest });
      const md = okCalls(c, 'export_document').filter((x) => x.args?.format === 'markdown');
      check('AI exported the document as Markdown', md.length > 0, { exports: c.calls.filter((x) => x.tool === 'export_document').map((x) => x.args?.format + (x.ok ? ':ok' : ':fail')) });
      const fm = c.finalMessage ?? '';
      check('the Markdown was shown to the user in the final answer', /Deploy to production/.test(fm) && /Rollback/.test(fm) && /^\s*(#|[-*] )/m.test(fm), { finalMessageChars: fm.length });
      const serverMd = c.markdown ?? '';
      check('server Markdown export contains every step', steps.every((t) => serverMd.includes(t)), { missing: steps.filter((t) => !serverMd.includes(t)) });
    },
  },
  {
    id: 'E',
    slug: 'E-excalidraw-roundtrip-sketch-theme',
    title: 'Excalidraw interop: freehand pen highlight, export .excalidraw, import into a new document, dark hand-drawn theme',
    model: 'gpt-6-sol',
    changesTheme: 'excalidraw-sketch-dark',
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test E · Architecture to Excalidraw', template: 'architecture', open: false });
      return { docId: r.json.documentId };
    },
    prompt: (c) => 'My Workflow Canvas document ' + c.docId + ' has a small architecture diagram. Use the freehand pen to circle "API service" so it stands out. ' +
      'Then export the diagram as an Excalidraw file and import that file into a brand-new document called "Excalidraw round-trip", so I can check nothing gets lost on the way. ' +
      'Compare the two documents, then switch the app to the dark hand-drawn sketch theme and take a screenshot of the new document.',
    verify(c, check) {
      const { doc, page, session } = c;
      const api = doc.nodes.find((n) => n.id === 'api');
      const pens = doc.nodes.filter((n) => n.kind === 'drawing' && (n.points?.length ?? 0) >= 2);
      check('freehand pen stroke drawn around "API service" in the original', !!api && pens.some((p) => overlaps(p, api)), pens.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.width, h: p.height, points: p.points?.length })));
      const exp = okCalls(c, 'export_document').filter((x) => x.args?.format === 'excalidraw');
      let scene = null;
      try { scene = JSON.parse(exp[0]?.resultText ?? 'null'); } catch { scene = null; }
      check('AI exported a valid Excalidraw scene', scene?.type === 'excalidraw' && Array.isArray(scene?.elements) && scene.elements.length > 0, { exports: exp.length, type: scene?.type, elements: scene?.elements?.length });
      const copy = c.createdDocs.find((d) => /excalidraw round-trip/i.test(d.title));
      check('a new document "Excalidraw round-trip" was created', !!copy, c.createdDocs.map((d) => d.title));
      const imp = okCalls(c, 'import_content').filter((x) => x.args?.format === 'excalidraw' && copy && x.args?.documentId === copy.id);
      check('AI imported the Excalidraw scene into the new document', imp.length > 0, { imports: c.calls.filter((x) => x.tool === 'import_content').map((x) => ({ format: x.args?.format, documentId: x.args?.documentId, ok: x.ok })) });
      if (copy) {
        const titles = (d, kind) => d.nodes.filter((n) => n.kind === kind).map((n) => n.title).sort();
        check('topics and swimlanes survived the round trip', JSON.stringify(titles(copy, 'topic')) === JSON.stringify(titles(doc, 'topic')) && JSON.stringify(titles(copy, 'frame')) === JSON.stringify(titles(doc, 'frame')),
          { original: { topics: titles(doc, 'topic'), frames: titles(doc, 'frame') }, copy: { topics: titles(copy, 'topic'), frames: titles(copy, 'frame') } });
        const subs = (d) => d.nodes.filter((n) => n.kind === 'frame').map((n) => n.title + ': ' + (n.subtitle ?? '')).sort();
        check('swimlane subtitles survived the round trip', subs(doc).some((s) => !s.endsWith(': ')) && JSON.stringify(subs(copy)) === JSON.stringify(subs(doc)), { original: subs(doc), copy: subs(copy) });
        const frameOf = (d, t) => { const n = byTitle(d, t); return n?.frameId ? titleOf(d, n.frameId) : null; };
        const moved = titles(doc, 'topic').filter((t) => frameOf(doc, t) !== frameOf(copy, t));
        check('every topic stayed in the same swimlane', moved.length === 0, { moved });
        const sig = (d) => d.edges.map((e) => titleOf(d, e.source) + ' -> ' + titleOf(d, e.target) + ' [' + (e.label ?? '') + ']').sort();
        check('connectors and their labels survived the round trip', JSON.stringify(sig(copy)) === JSON.stringify(sig(doc)), { original: sig(doc), copy: sig(copy) });
        check('the freehand pen stroke survived the round trip', copy.nodes.filter((n) => n.kind === 'drawing').length === pens.length && pens.length > 0, { original: pens.length, copy: copy.nodes.filter((n) => n.kind === 'drawing').length });
      }
      check('app switched to the dark hand-drawn sketch theme (shared session and live UI)', session.theme === 'excalidraw-sketch-dark' && page.dataTheme === 'excalidraw-sketch-dark', { session: session.theme, ui: page.dataTheme });
      const shotOfCopy = okCalls(c, 'capture_screenshot').filter((x) => copy && x.args?.documentId === copy.id);
      check('AI took a screenshot of the new document', shotOfCopy.length > 0, { screenshots: c.calls.filter((x) => x.tool === 'capture_screenshot').map((x) => ({ documentId: x.args?.documentId, ok: x.ok })) });
    },
  },
  {
    id: 'F',
    slug: 'F-save-to-attached-file',
    title: "Save to the person's .excalidraw file: no-file reason relayed, then AI edits land in the file the person attached",
    model: 'gpt-6-sol',
    environmentNote: "The recorded tab's save dialog (showSaveFilePicker) is backed by a real file in the browser's origin-private file system via page.addInitScript, because a headless browser cannot show the OS dialog. The person's Save click, autosave and save_to_file then run the app's real File System Access code path; the harness reads that file back in the same tab and parses it with documentFromExcalidraw (src/shared/excalidraw.ts). After the AI turns the harness repeats the save_to_file race repro (" + SAVE_RACE.edits + ' x edit then immediate save_to_file) on the Start node notes. Just before the person presses Save, the harness opens ' + F_EXTRA_TABS + ' extra plain tabs on the same document (no save dialog override, so no file is ever attached to them); they stay open through the AI save turn and the race loop. They are opened before the Save click because the Playwright-bundled chromium-headless-shell kills the browser when a tab opened after the file was attached reads the stored OPFS file handle back from IndexedDB (harness limitation; Google Chrome is fine).',
    initScript: opfsSavePicker,
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test F · Release checklist', template: 'workflow', open: false });
      return { docId: r.json.documentId };
    },
    turns: [
      { prompt: (c) => 'Please save my Workflow Canvas document ' + c.docId + ' to my .excalidraw file.' },
      {
        async before(p) {
          const filesBeforeSave = (await opfsFiles(p.page)).map((f) => f.name);
          const stateBeforeSave = await saveState(p.page);
          const tabs = [];
          fExtraTabs.set(p.docId, tabs);
          for (let i = 0; i < F_EXTRA_TABS; i++) tabs.push(await openPlainTab(p.page, p.docId));
          await p.page.bringToFront();
          p.log('opened ' + tabs.length + ' extra plain tabs on the document: ' + JSON.stringify(await Promise.all(tabs.map(tabFileState))));
          await p.caption('person presses Save and picks a file in the save dialog');
          await p.page.waitForTimeout(800);
          await p.page.locator('[data-testid="save-file"]').click();
          await waitSaved(p.page);
          const picked = await pickedFile(p.page);
          const file = (await opfsFiles(p.page)).find((f) => f.name === picked);
          fs.writeFileSync(path.join(p.dir, 'attached-file.after-person-save.excalidraw'), file?.text ?? '');
          p.log('pressed Save (button ' + stateBeforeSave + ' -> saved) and picked "' + picked + '" (' + (file?.text.length ?? 0) + ' bytes written)');
          await p.caption('person pressed Save · autosaving to ' + picked);
          const stateAfterSave = await saveState(p.page);
          const extraTabsBeforeAi = await Promise.all(tabs.map(tabFileState));
          p.log('extra tabs after the Save click, before the AI turn: ' + JSON.stringify(extraTabsBeforeAi));
          return { filesBeforeSave, stateBeforeSave, stateAfterSave, picked, baseline: parseFile(file), extraTabsBeforeAi };
        },
        prompt: (c) => 'I pressed Save in the browser and picked a file. Now update my Workflow Canvas document ' + c.docId + ': rename "Do the work" to "Write release notes", ' +
          'add a new step "Security sign-off" connected from "Write release notes" with a dashed connector labeled "before merge", and add a sticky note "Ship on Friday" next to "Done". ' +
          'Then save it to my file and tell me which file it went to.',
      },
    ],
    async collect(p) {
      await waitSaved(p.page).catch(() => {});
      const picked = await pickedFile(p.page);
      const afterAi = (await opfsFiles(p.page)).find((f) => f.name === picked);
      const serverAtFileRead = await p.http('/api/documents/' + encodeURIComponent(p.docId));
      const tabs = fExtraTabs.get(p.docId) ?? [];
      const extraTabsAfterAi = await Promise.all(tabs.map(tabFileState));
      fs.writeFileSync(path.join(p.dir, 'attached-file.after-ai.excalidraw'), afterAi?.text ?? '');
      p.log('after the AI turns the attached file "' + picked + '" has ' + (afterAi?.text.length ?? 0) + ' bytes; extra tabs ' + JSON.stringify(extraTabsAfterAi));
      await p.caption('harness: ' + SAVE_RACE.edits + ' x edit then immediate save_to_file');
      const results = [];
      const lastEdit = 'save-race edit ' + (SAVE_RACE.edits - 1);
      for (let i = 0; i < SAVE_RACE.edits; i++) {
        await p.tool('update_nodes', { documentId: p.docId, updates: [{ id: 'start', notes: 'save-race edit ' + i }] });
        results.push((await p.tool('save_to_file', { documentId: p.docId })).json);
        await p.page.waitForTimeout(SAVE_RACE.pauseMs);
      }
      await waitSaved(p.page).catch(() => {});
      const afterRace = (await opfsFiles(p.page)).find((f) => f.name === picked);
      fs.writeFileSync(path.join(p.dir, 'attached-file.excalidraw'), afterRace?.text ?? '');
      const raceFile = parseFile(afterRace);
      const fileStartNotes = raceFile.doc?.nodes.find((n) => n.id === 'start')?.notes ?? null;
      p.log('save race: ' + results.filter((r) => r?.ok === true).length + '/' + SAVE_RACE.edits + ' save_to_file ok; file Start notes = ' + JSON.stringify(fileStartNotes));
      const extraTabsAfterRace = await Promise.all(tabs.map(tabFileState));
      for (const tab of tabs) await tab.close().catch(() => {});
      fExtraTabs.delete(p.docId);
      return {
        attached: parseFile(afterAi), serverAtFileRead, extraTabsAfterAi, extraTabsAfterRace,
        race: { ...SAVE_RACE, results, lastEdit, file: raceFile.name ?? null, parseError: raceFile.parseError, fileStartNotes },
        evidenceFiles: ['attached-file.after-person-save.excalidraw', 'attached-file.after-ai.excalidraw', 'attached-file.excalidraw'],
      };
    },
    verify(c, check) {
      const { doc, data } = c;
      const reason = (x) => String(x.resultJson?.ui?.reason ?? '');
      const saves1 = c.calls.filter((x) => x.turn === 1 && x.tool === 'save_to_file');
      check('turn 1, no file attached: save_to_file returned ok:false with the "person must press Save" reason', saves1.length > 0 && saves1.every((x) => x.ok && x.resultJson?.ok === false && /press Save/i.test(reason(x))),
        saves1.map((x) => ({ ok: x.resultJson?.ok, reason: reason(x) })));
      const m1 = c.finalMessages[0] ?? '';
      const relayed = /\b(press|click|hit|tap|use)\w*\b[^.\n]{0,40}\bsave\b/i.test(m1);
      const claimed = /\b(I('ve| have) (successfully )?saved|successfully saved|saved successfully|is now saved|saved (it|the document|your document|your file) to)\b/i.test(m1);
      check('turn 1: AI relayed that the person must press Save and did not claim success', relayed && !claimed, { relayed, claimed, finalMessage: m1 });
      check('nothing was written to disk before the person pressed Save', Array.isArray(data.filesBeforeSave) && data.filesBeforeSave.length === 0 && data.stateBeforeSave === 'none',
        { filesBeforeSave: data.filesBeforeSave ?? null, saveButtonState: data.stateBeforeSave ?? null, personError: data.personError });
      const base = data.baseline;
      check('person pressed Save: the dialog returned a file and autosave turned on', !!data.picked && data.stateAfterSave === 'saved' && !!base?.doc && fEdits(base.doc)['step-1'] === 'Do the work',
        { picked: data.picked ?? null, saveButtonState: data.stateAfterSave ?? null, baseline: base && { bytes: base.bytes, parseError: base.parseError, edits: fEdits(base.doc) } });
      const be = fEdits(base?.doc);
      check('the file had none of the edits before the AI turn', !!be && be['step-1'] === 'Do the work' && !be.securityStep && !be.connector && !be.sticky, be);
      check("AI's edits are in the server document", fLanded(fEdits(doc)), fEdits(doc));
      const a = data.attached;
      check("AI's edits landed in the person's attached file (read from OPFS, parsed with documentFromExcalidraw)", !!a?.doc && a.name === data.picked && a.type === 'excalidraw' && fLanded(fEdits(a.doc)),
        { file: a?.name ?? null, picked: data.picked ?? null, type: a?.type, bytes: a?.bytes, parseError: a?.parseError ?? data.collectError, edits: fEdits(a?.doc) });
      const server = data.serverAtFileRead;
      const nodeDiff = a?.doc && server ? recordDiff(a.doc.nodes, server.nodes) : null;
      const edgeDiff = a?.doc && server ? recordDiff(a.doc.edges, server.edges) : null;
      check('the attached file holds the whole document exactly (every node and connector record equals the server copy)', !!nodeDiff && !!edgeDiff && nodeDiff.length === 0 && edgeDiff.length === 0 && a.doc.title === server.title && a.workflowCanvasMeta,
        { title: { file: a?.doc?.title, server: server?.title }, nodes: server?.nodes.length, edges: server?.edges.length, nodeDiff: nodeDiff?.slice(0, 5), edgeDiff: edgeDiff?.slice(0, 5) });
      const t2 = c.calls.filter((x) => x.turn === 2);
      const lastEditAt = t2.reduce((at, x, i) => (x.ok && DOC_EDIT_TOOLS.includes(x.tool) ? i : at), -1);
      const savesAfter = t2.filter((x, i) => i > lastEditAt && x.tool === 'save_to_file');
      check('turn 2: after its edits the AI called save_to_file, which reported ok and the attached file name', lastEditAt >= 0 && savesAfter.some((x) => x.ok && x.resultJson?.ok === true && x.resultJson?.ui?.file === data.picked),
        { picked: data.picked ?? null, savesAfterLastEdit: savesAfter.map((x) => ({ ok: x.resultJson?.ok, ui: x.resultJson?.ui })), sequence: t2.map((x) => x.tool + (x.ok ? '' : ' ✗')) });
      const m2 = c.finalMessages[1] ?? '';
      check('turn 2: AI told the person which file it saved to', !!data.picked && m2.includes(data.picked.replace(/\.excalidraw$/, '')), { file: data.picked ?? null, finalMessage: m2 });
      const saves2 = t2.filter((x) => x.tool === 'save_to_file');
      check('turn 2 with ' + F_EXTRA_TABS + ' extra plain tabs (no file) on the document: every AI save_to_file reported ok:true with the attached file name, and the file has the edits',
        plainTabsOk(data.extraTabsBeforeAi, doc.id) && plainTabsOk(data.extraTabsAfterAi, doc.id) && saves2.length > 0 && saves2.every((x) => x.ok && x.resultJson?.ok === true && x.resultJson?.ui?.file === data.picked)
          && savesAfter.length > 0 && a?.name === data.picked && fLanded(fEdits(a?.doc)),
        { picked: data.picked ?? null, extraTabsBeforeAi: data.extraTabsBeforeAi ?? null, extraTabsAfterAi: data.extraTabsAfterAi ?? null, aiSaves: saves2.map((x) => ({ ok: x.resultJson?.ok, ui: x.resultJson?.ui })), file: a?.name ?? null, edits: fEdits(a?.doc) });
      const race = data.race;
      const bad = (race?.results ?? []).map((r, i) => ({ i, r })).filter(({ r }) => r?.ok !== true || r?.ui?.file !== data.picked);
      check('save race: every edit-then-immediate save_to_file returned ok:true and the file has the last edit', !!race && race.results.length === race.edits && bad.length === 0 && race.file === data.picked && race.fileStartNotes === race.lastEdit,
        { edits: race?.edits, ok: race ? race.results.length - bad.length : 0, failures: bad.slice(0, 5), lastEdit: race?.lastEdit, fileStartNotes: race?.fileStartNotes, parseError: race?.parseError, extraTabsDuringRace: data.extraTabsAfterRace ?? null });
    },
  },
  {
    id: 'G',
    slug: 'G-markdown-emoji-tasks',
    title: 'Markdown sticky + :shortcode: emoji: AI writes it, the person ticks a task in the tab, the AI reads it back and ticks the other',
    model: 'gpt-6-sol',
    environmentNote: "Between the AI turns the harness acts as the person in the recorded tab: it fits the view, reads what the tab renders for the AI's sticky and connector label, then clicks the rendered \"Order the cake\" checkbox (input.md-task) with a real Playwright click and waits for the server copy to show that line as - [x].",
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test G · Launch party', template: 'workflow', open: false });
      return { docId: r.json.documentId };
    },
    turns: [
      {
        prompt: (c) => 'In my Workflow Canvas document ' + c.docId + ', add a sticky note next to "Done" for the launch party, written in Markdown: a heading "Launch party :tada:", ' +
          'a line with "Owner:" in bold followed by "Sam :rocket:", and a task list with two unchecked tasks, "Book the venue" and "Order the cake". ' +
          'Also connect "Do the work" to "Done" with a connector labeled "fast path" in bold followed by :zap:. Type the emoji as the shortcodes :tada:, :rocket: and :zap:.',
      },
      {
        async before(p) {
          const doc1 = await p.http('/api/documents/' + encodeURIComponent(p.docId));
          const { sticky, edge } = gFind(doc1);
          await p.caption("person looks at the AI's sticky and connector");
          await p.page.locator('[data-testid="fit-view"]').click().catch(() => {});
          await p.page.waitForTimeout(800);
          if (sticky) await p.page.waitForSelector('[data-testid="node-' + sticky.id + '"] .md', { timeout: 15_000 }).catch(() => {});
          const ids = { stickyId: sticky?.id ?? '', edgeId: edge?.id ?? '' };
          const rendered1 = await p.page.evaluate(gRendered, ids);
          await p.page.screenshot({ path: path.join(p.dir, 'person-1-rendered.png') });
          p.log('tab renders ' + JSON.stringify(rendered1));
          const tick = { clicked: false };
          if (sticky) {
            await p.caption('person ticks "Order the cake" in the sticky');
            await p.page.waitForTimeout(800);
            await p.page.locator('[data-testid="node-' + sticky.id + '"] li', { hasText: G_DONE }).locator('input.md-task').first().click({ timeout: 10_000 });
            tick.clicked = true;
            tick.storedAfter = await gWaitStored(p, sticky.id, (t) => gTask(t, G_DONE)?.checked === true);
            await p.page.waitForTimeout(400);
            tick.renderedAfter = await p.page.evaluate(gRendered, ids);
            await p.page.screenshot({ path: path.join(p.dir, 'person-2-ticked.png') });
            p.log('ticked "Order the cake": stored ' + JSON.stringify(taskLines(tick.storedAfter)) + ', tab ' + JSON.stringify(tick.renderedAfter?.sticky?.tasks));
            await p.caption('person ticked "Order the cake" · asking the AI which task is done');
          }
          return { doc1, sticky1: sticky, edge1: edge, rendered1, tick };
        },
        prompt: (c) => 'I just ticked one of the tasks on the launch party sticky in my Workflow Canvas document ' + c.docId + '. Which task did I mark as done? Please tick the remaining task for me as well.',
      },
    ],
    async collect(p) {
      const d = await p.http('/api/documents/' + encodeURIComponent(p.docId));
      const { sticky, edge } = gFind(d);
      if (sticky) await gWaitStored(p, sticky.id, (t) => t.length > 0 && t.every((x) => x.checked));
      await p.page.waitForTimeout(600);
      const renderedFinal = await p.page.evaluate(gRendered, { stickyId: sticky?.id ?? '', edgeId: edge?.id ?? '' });
      await p.page.screenshot({ path: path.join(p.dir, 'person-3-after-ai-tick.png') });
      p.log('after the AI turn the tab shows ' + JSON.stringify(renderedFinal?.sticky?.tasks));
      return { renderedFinal, evidenceFiles: ['person-1-rendered.png', 'person-2-ticked.png', 'person-3-after-ai-tick.png'] };
    },
    verify(c, check) {
      const { doc, data } = c;
      const s1 = data.sticky1;
      const e1 = data.edge1;
      const shape1 = mdShape(s1?.title);
      check('turn 1: the stored sticky is Markdown with a heading, bold text and two unchecked tasks ("Book the venue", "Order the cake")',
        !!s1 && shape1.heading && shape1.bold && shape1.tasks.length === 2 && shape1.tasks.every((t) => !t.checked) && !!gTask(shape1.tasks, G_OPEN) && !!gTask(shape1.tasks, G_DONE),
        { stickyId: s1?.id ?? null, title: s1?.title ?? null, ...shape1 });
      check('turn 1: connector "Do the work" -> "Done" has an inline-Markdown bold label', !!e1 && /(\*\*|__)(?=\S)[^\n]*?\S\1/.test(e1.label ?? ''), e1 ?? null);
      const t1Args = JSON.stringify(c.calls.filter((x) => x.turn === 1 && x.ok && DOC_EDIT_TOOLS.includes(x.tool)).map((x) => x.args));
      const sent = G_SHORTCODES.filter((k) => t1Args.includes(':' + k + ':'));
      const fin = doc.nodes.find((n) => n.id === s1?.id);
      const raw1 = docRawShortcodes(data.doc1);
      const rawFinal = docRawShortcodes(doc);
      check('AI sent :tada: :rocket: :zap: and the stored text has the emoji (sticky 🎉 🚀, label ⚡) with no raw :shortcodes: outside code, after both turns',
        sent.length === G_SHORTCODES.length && hasEmoji(s1?.title, 'tada') && hasEmoji(s1?.title, 'rocket') && hasEmoji(e1?.label, 'zap') && hasEmoji(fin?.title, 'tada') && hasEmoji(fin?.title, 'rocket') && raw1.length === 0 && rawFinal.length === 0,
        { shortcodesInAiArgs: sent, stickyAfterTurn1: s1?.title ?? null, labelAfterTurn1: e1?.label ?? null, stickyFinal: fin?.title ?? null, rawAfterTurn1: raw1, rawFinal });
      const r1 = data.rendered1;
      check("person's tab rendered the sticky: a heading, <strong>, two unchecked task checkboxes and the emoji (no raw shortcodes)",
        !!r1?.sticky && r1.sticky.headings.length > 0 && r1.sticky.strong.length > 0 && r1.sticky.tasks.length === 2 && r1.sticky.tasks.every((t) => !t.checked && !t.disabled)
          && hasEmoji(r1.sticky.text, 'tada') && hasEmoji(r1.sticky.text, 'rocket') && rawShortcodes(r1.sticky.textOutsideCode).length === 0,
        r1?.sticky ?? null);
      check("person's tab rendered the connector label with <strong> and ⚡ (no raw shortcodes)",
        !!r1?.label && r1.label.strong.length > 0 && hasEmoji(r1.label.text, 'zap') && rawShortcodes(r1.label.textOutsideCode).length === 0, r1?.label ?? null);
      const tk = data.tick ?? {};
      const stored = taskLines(tk.storedAfter);
      const shown = tk.renderedAfter?.sticky?.tasks;
      check('person clicked "Order the cake" in the tab: it shows checked, the stored line became "- [x]", and "Book the venue" stayed open',
        tk.clicked === true && gTask(stored, G_DONE)?.checked === true && gTask(stored, G_OPEN)?.checked === false && gTask(shown, G_DONE)?.checked === true && gTask(shown, G_OPEN)?.checked === false,
        { clicked: !!tk.clicked, stored, shown: shown ?? null, personError: data.personError });
      const t2 = c.calls.filter((x) => x.turn === 2);
      const firstWrite = t2.findIndex((x) => DOC_EDIT_TOOLS.includes(x.tool));
      const reads = t2.slice(0, firstWrite < 0 ? t2.length : firstWrite).filter((x) => x.ok && G_READ_TOOLS.includes(x.tool));
      const m2 = c.finalMessages[1] ?? '';
      check('turn 2: AI read the document before editing and reported "Order the cake" as the task the person ticked', reads.length > 0 && G_DONE.test(m2),
        { readsBeforeFirstEdit: reads.map((x) => x.tool), finalMessage: m2 });
      const ticks = t2.filter((x) => x.tool === 'update_nodes' && x.ok && x.resultJson?.ok !== false && (x.args?.updates ?? []).some((u) => u.id === s1?.id));
      const finShape = mdShape(fin?.title);
      check('turn 2: AI ticked "Book the venue" with update_nodes; the stored sticky has both tasks "- [x]" and kept its heading and bold text',
        ticks.length > 0 && finShape.tasks.length === 2 && finShape.tasks.every((t) => t.checked) && finShape.heading && finShape.bold,
        { updateNodes: ticks.map((x) => x.args), stickyFinal: fin?.title ?? null, tasks: finShape.tasks, sequence: t2.map((x) => x.tool + (x.ok ? '' : ' ✗')) });
      const rf = data.renderedFinal?.sticky;
      check("person's tab shows both tasks checked", !!rf && rf.tasks.length === 2 && rf.tasks.every((t) => t.checked), rf?.tasks ?? null);
    },
  },
];
