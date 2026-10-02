// User-perspective AI scenarios for scripts/ai-tests/run.mjs.
// Prompts are phrased the way a person would ask: they name the document but never explain the tools.
// Only scenario E changes the (global) theme, and only at its end.

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

function hiddenIds(doc) {
  const hidden = new Set();
  const kids = new Map();
  for (const n of doc.nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
  const hide = (id) => { for (const k of kids.get(id) ?? []) { hidden.add(k); hide(k); } };
  for (const n of doc.nodes) if (n.collapsed) hide(n.id);
  return hidden;
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
    prompt: (c) => 'My Workflow Canvas document ' + c.docId + ' has a simple review workflow. Please update it: rename "Do the work" to "Write draft" and "Revise" to "Edit draft". ' +
      'Add a new decision diamond "Legal review needed?" after "Looks good?", connected from "Looks good?" with a dashed connector labeled "check legal". ' +
      'Then select "Write draft" and "Edit draft" and zoom the view in on just those two. Hide the outline panel and the minimap, and turn on snap to grid. ' +
      'Finally undo your last change and redo it so nothing is lost, and take a screenshot so I can check it.',
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
      const both = want.every((id) => onScreen(page.nodes[id], page.pane));
      check('view zoomed in on the two selected steps (both on screen, closer than fit-all)', both && page.zoom > c.fitZoom, { zoomWhenAiFinished: page.zoom, fitAllZoom: c.fitZoom, onScreen: both });
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
    title: 'Excalidraw interop: freehand pen highlight, export .excalidraw, import into a new document, hand-drawn theme',
    model: 'gpt-6-sol',
    changesTheme: 'excalidraw-sketch',
    async setup(h) {
      const r = await h.tool('create_document', { title: 'AI test E · Architecture to Excalidraw', template: 'architecture', open: false });
      return { docId: r.json.documentId };
    },
    prompt: (c) => 'My Workflow Canvas document ' + c.docId + ' has a small architecture diagram. Use the freehand pen to circle "API service" so it stands out. ' +
      'Then export the diagram as an Excalidraw file and import that file into a brand-new document called "Excalidraw round-trip", so I can check nothing gets lost on the way. ' +
      'Compare the two documents, then switch the app to the hand-drawn sketch theme and take a screenshot of the new document.',
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
      check('app switched to the hand-drawn sketch theme (shared session and live UI)', session.theme === 'excalidraw-sketch' && page.dataTheme === 'excalidraw-sketch', { session: session.theme, ui: page.dataTheme });
      const shotOfCopy = okCalls(c, 'capture_screenshot').filter((x) => copy && x.args?.documentId === copy.id);
      check('AI took a screenshot of the new document', shotOfCopy.length > 0, { screenshots: c.calls.filter((x) => x.tool === 'capture_screenshot').map((x) => ({ documentId: x.args?.documentId, ok: x.ok })) });
    },
  },
];
