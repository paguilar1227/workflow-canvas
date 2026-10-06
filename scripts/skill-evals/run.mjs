#!/usr/bin/env node
// Skill evals: run real agents (Copilot CLI and codex exec) with the workflow-canvas plugin against an isolated canvas,
// then grade each case from the tool-call log and the final document. Usage:
//   DOCKER_CONFIG=... node scripts/skill-evals/run.mjs [--clients copilot,codex] [--only E1,E2] [--out DIR] [--repo DIR] [--ffmpeg PATH]
//     [--copilot-base http://127.0.0.1:8797 --copilot-container wfc-skill-eval] [--codex-base http://127.0.0.1:8798 --codex-container wfc-skill-eval-codex]
//   --repo is required when E4 runs: the small git repository the agent maps (it becomes the agent's working directory).
//   --ffmpeg defaults to `ffmpeg` on PATH (e.g. --ffmpeg /opt/homebrew/bin/ffmpeg); without it the case video stays .webm.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { CASES, BASELINE_DOCS, isWrite } from './cases.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', 'outputs/evidence/skill-evals'));
const ONLY = arg('only', 'E1,E2,E3,E4,E6,E7,E5').split(',');
const CLIENTS = arg('clients', 'copilot,codex').split(',');
const REPO = arg('repo') ? path.resolve(arg('repo')) : null;
const NEUTRAL = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-cwd-'));
const TIMEOUT_MS = Number(arg('timeout-min', 25)) * 60000; // harness safeguard only; not part of the rubric
const CODEX_MODEL = arg('codex-model', 'gpt-6-sol'), CODEX_EFFORT = arg('codex-effort', 'medium');
const LAUNCHER = arg('launcher', path.join(os.homedir(), '.codex/plugins/cache/workflow-canvas-plugins/workflow-canvas/0.1.0/skills/workflow-canvas/scripts/canvas-mcp.sh'));
const FFMPEG = arg('ffmpeg', 'ffmpeg');
const TARGET = {
  copilot: { base: arg('copilot-base', 'http://127.0.0.1:8797'), container: arg('copilot-container', 'wfc-skill-eval') },
  codex: { base: arg('codex-base', 'http://127.0.0.1:8798'), container: arg('codex-container', 'wfc-skill-eval-codex') },
};
const USER_CANVAS = 'http://127.0.0.1:8790';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', env: process.env }).trim();
const health = async (base) => { try { const r = await fetch(base + '/health', { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; } };
function api(base) {
  const tool = async (name, args = {}) => {
    const r = await fetch(base + '/api/tools/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    const j = await r.json(); if (!j.ok) throw new Error(name + ': ' + JSON.stringify(j).slice(0, 300));
    return j.result?.json ?? j.result?.text ?? j.result;
  };
  return { tool, doc: async (id) => { const r = await fetch(base + '/api/documents/' + id); return r.ok ? r.json() : null; } };
}
async function waitHealthy(base, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await health(base)) return true; await sleep(500); } return false; }

async function reset(h) {
  const list = await h.tool('list_documents');
  for (const d of list.documents) if (!BASELINE_DOCS.includes(d.id)) await h.tool('delete_document', { documentId: d.id });
  await h.tool('open_document', { documentId: 'launch-plan' });
  await h.tool('select', { mode: 'clear' }).catch(() => {});
  const st = await h.tool('get_canvas_state'); if (st.session.theme !== 'neon-flow') await h.tool('set_theme', { themeId: 'neon-flow' });
}

function clientArgv(client, prompt, t) {
  if (client === 'copilot') return { cmd: 'copilot', args: ['-p', prompt, '-s', '--allow-all-tools', '--allow-all-paths', '--output-format', 'json'], env: { WFC_URL: t.base, WFC_CONTAINER: t.container } };
  const env = '{WFC_URL="' + t.base + '",WFC_CONTAINER="' + t.container + '",DOCKER_CONFIG="' + (process.env.DOCKER_CONFIG ?? '') + '"}';
  return { cmd: 'codex', env: {}, args: ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-m', CODEX_MODEL, '-c', 'model_reasoning_effort="' + CODEX_EFFORT + '"',
    '-c', 'plugins.workflow-canvas@workflow-canvas-plugins.mcp_servers.workflow-canvas.enabled=false',
    '-c', 'mcp_servers.workflow-canvas.command="bash"', '-c', 'mcp_servers.workflow-canvas.args=["' + LAUNCHER + '"]', '-c', 'mcp_servers.workflow-canvas.default_tools_approval_mode="approve"', '-c', 'mcp_servers.workflow-canvas.env=' + env, prompt] };
}

function runClient(client, prompt, cwd, t, dir) {
  const { cmd, args, env } = clientArgv(client, prompt, t);
  fs.writeFileSync(path.join(dir, 'command.json'), JSON.stringify({ cmd, args: args.map((a) => (a === prompt ? '<prompt>' : a)), env: Object.keys(env), cwd }, null, 1));
  return new Promise((resolve) => {
    const t0 = Date.now(); const out = fs.createWriteStream(path.join(dir, 'events.jsonl')); const err = fs.createWriteStream(path.join(dir, 'stderr.txt'));
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(out); p.stderr.pipe(err);
    const timer = setTimeout(() => p.kill('SIGTERM'), TIMEOUT_MS);
    p.on('close', (code, signal) => { clearTimeout(timer); out.end(); err.end(); setTimeout(() => resolve({ code, signal, ms: Date.now() - t0, timedOut: Date.now() - t0 >= TIMEOUT_MS }), 300); });
  });
}

// Normalise both clients' JSONL into [{kind:'mcp'|'shell'|'tool', server, name, args, ok, out}] plus the final message.
function parseEvents(client, file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const calls = []; let finalMsg = ''; const msgs = [];
  if (client === 'codex') {
    for (const o of lines) {
      const it = o.item ?? {}; if (o.type !== 'item.completed') continue;
      if (it.type === 'mcp_tool_call') calls.push({ kind: 'mcp', server: it.server, name: it.tool, args: it.arguments, ok: it.status !== 'failed' && !it.error && !it.result?.isError, out: JSON.stringify(it.result ?? it.error ?? '').slice(0, 400) });
      else if (it.type === 'command_execution') calls.push({ kind: 'shell', name: 'shell', args: { command: it.command }, ok: it.exit_code === 0, out: (it.aggregated_output ?? '').slice(0, 400) });
      else if (it.type === 'agent_message') { msgs.push(it.text); finalMsg = it.text; }
    }
  } else {
    const byId = new Map();
    for (const o of lines) {
      const d = o.data ?? {};
      if (o.type === 'tool.execution_start') { const c = { kind: d.mcpServerName ? 'mcp' : 'tool', server: d.mcpServerName, name: d.mcpToolName ?? d.toolName, args: d.arguments, ok: null, out: '' }; byId.set(d.toolCallId, c); calls.push(c); }
      if (o.type === 'tool.execution_complete') { const c = byId.get(d.toolCallId); if (c) { c.ok = Boolean(d.success); c.out = JSON.stringify(d.result ?? d.error ?? '').slice(0, 400); } }
      if (o.type === 'assistant.message' && d.content) { msgs.push(d.content); finalMsg = d.content; }
    }
  }
  return { calls, finalMsg, msgs };
}

function skillEvidence(calls) {
  const hits = calls.filter((c) => c.kind !== 'mcp' && /workflow-canvas/.test(JSON.stringify(c.args)) && /SKILL\.md|skill/i.test(c.name + JSON.stringify(c.args)));
  const ok = hits.filter((c) => c.ok && (c.name === 'skill' || /Workflow Canvas/.test(c.out)));
  const recipes = calls.some((c) => c.kind !== 'mcp' && /recipes\.md/.test(JSON.stringify(c.args)) && c.ok && /Recipes|Architecture|Codebase/.test(c.out));
  const misses = hits.filter((c) => !c.ok);
  return { skillLoaded: ok.length > 0, skillEvidence: ok.length ? ok[0].name + ' ' + JSON.stringify(ok[0].args).slice(0, 160) : hits.length ? 'only failed attempts: ' + hits.map((c) => JSON.stringify(c.args).slice(0, 120)).join(' | ') : 'no skill read', skillMisses: misses.length, skillMissPaths: misses.map((c) => JSON.stringify(c.args).slice(0, 200)), recipesRead: recipes };
}

async function boxesOf(page) {
  return page.$$eval('[data-testid^="node-"]', (els) => Object.fromEntries(els.map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.testid.slice(5), { x: r.x, y: r.y, w: r.width, h: r.height }]; })));
}

async function runCase(browser, client, id) {
  const C = CASES[id]; const t = TARGET[client]; const h = api(t.base); const dir = path.join(OUT, client, id); fs.mkdirSync(dir, { recursive: true });
  if (!(await health(t.base))) { docker('start', t.container); await waitHealthy(t.base); }
  await reset(h);
  const seedId = C.seed ? await C.seed(h) : null; const seedDoc = seedId ? await h.doc(seedId) : null;
  const before = (await h.tool('list_documents')).documents.map((d) => d.id);
  const ctxV = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: path.join(dir, 'video-raw'), size: { width: 1280, height: 800 } } });
  let page = null;
  if (C.tab === 'live') {
    page = await ctxV.newPage(); await page.goto(t.base + '/' + (seedId ? '?doc=' + seedId : ''), { waitUntil: 'networkidle' });
    if (C.select) { const n = seedDoc.nodes.find((x) => x.title === C.select); await page.click('[data-testid="node-' + n.id + '"]'); await sleep(500); }
  }
  if (C.stopFirst) { docker('stop', t.container); if (await health(t.base)) throw new Error('container still answering'); }
  const prompt = C.prompt(seedId); fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt + '\n');
  const userBefore = await health(USER_CANVAS);
  const proc = await runClient(client, prompt, C.cwd === 'repo' ? REPO : NEUTRAL, t, dir);
  const userAfter = await health(USER_CANVAS);
  const containerRunningAfter = docker('inspect', '-f', '{{.State.Running}}', t.container) === 'true';
  if (!containerRunningAfter) { docker('start', t.container); await waitHealthy(t.base); }
  const { calls, finalMsg, msgs } = parseEvents(client, path.join(dir, 'events.jsonl'));
  const wc = calls.filter((c) => c.kind === 'mcp' && c.server === 'workflow-canvas');
  const after = (await h.tool('list_documents')).documents;
  const created = after.filter((d) => !before.includes(d.id)).sort((a, b) => b.nodeCount - a.nodeCount);
  const docId = seedId ?? created[0]?.id ?? null; const doc = docId ? await h.doc(docId) : null;
  const logic = docId ? await h.tool('describe_logic', { documentId: docId, format: 'json' }).catch(() => null) : null;
  const strip = (d) => JSON.stringify({ n: d?.nodes, e: d?.edges });
  if (!page) { page = await ctxV.newPage(); }
  let boxes = {};
  if (docId) {
    await page.goto(t.base + '/?doc=' + docId + '&pin=1', { waitUntil: 'networkidle' }); await sleep(800);
    await h.tool('control_view', { documentId: docId, action: 'fit' }).catch(() => {}); await sleep(1200);
    await page.screenshot({ path: path.join(dir, 'final.png') }); boxes = await boxesOf(page);
  }
  const vid = page.video(); await ctxV.close(); const raw = vid ? await vid.path() : null;
  if (raw) { try { execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'video.mp4')]); fs.rmSync(path.join(dir, 'video-raw'), { recursive: true, force: true }); } catch (e) { /* keep webm */ } }
  const ctx = { client, canvasBase: t.base, calls, wc, finalMsg, doc, docId, seedDoc, logic, boxes, containerRunningAfter, unchanged: seedDoc ? strip(seedDoc) === strip(doc) : null,
    docCountBefore: before.length, docCountAfter: after.length, ...skillEvidence(calls) };
  fs.writeFileSync(path.join(dir, 'grade-input.json'), JSON.stringify({ ...ctx, wc: undefined, proc, created: created.map((d) => d.id), userCanvasDocs: [userBefore?.documents, userAfter?.documents] }));
  return finish(id, client, prompt, ctx, proc, created.map((d) => d.id), [userBefore?.documents, userAfter?.documents], dir, msgs);
}

// Grade (also used by --regrade, which re-reads grade-input.json and re-derives the call-based evidence).
function finish(id, client, prompt, ctx, proc, createdIds, userCanvasDocs, dir, msgs) {
  const C = CASES[id]; const { calls, wc, finalMsg, doc, logic, docId } = ctx;
  const checks = C.grade(ctx);
  const result = { case: id, title: C.title, client, prompt, docId, createdDocs: createdIds, exit: proc, durationS: Math.round(proc.ms / 1000),
    pass: checks.every((c) => c.pass), passed: checks.filter((c) => c.pass).length, total: checks.length, checks,
    info: { ...(C.info ? C.info(ctx) : {}), skillLoaded: ctx.skillLoaded, skillMisses: ctx.skillMisses, skillMissPaths: ctx.skillMissPaths, recipesRead: ctx.recipesRead, canvasCalls: wc.map((c) => c.name + (c.ok ? '' : '(failed)')), failedCanvasCalls: wc.filter((c) => !c.ok).length, otherCalls: calls.filter((c) => c.server !== 'workflow-canvas').length, writes: wc.filter(isWrite).length,
      links: finalMsg.match(/https?:\/\/[^\s)>\]]*\?doc=[\w-]+/g) ?? [], userCanvasDocs } };
  fs.writeFileSync(path.join(dir, 'calls.json'), JSON.stringify(calls, null, 1));
  fs.writeFileSync(path.join(dir, 'final.md'), finalMsg + '\n');
  if (doc) fs.writeFileSync(path.join(dir, 'doc.json'), JSON.stringify(doc, null, 1));
  if (logic) fs.writeFileSync(path.join(dir, 'logic.json'), JSON.stringify(logic, null, 1));
  fs.writeFileSync(path.join(dir, 'transcript.txt'), [('# ' + client + ' ' + id + ': ' + prompt), ...calls.map((c, i) => i + ' ' + (c.kind === 'mcp' ? c.server + '/' + c.name : c.name) + ' ' + JSON.stringify(c.args).slice(0, 300) + (c.ok ? '' : '  [FAILED]')), '## messages', ...msgs].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 1));
  console.log(client + ' ' + id + ' ' + (result.pass ? 'PASS' : 'FAIL') + ' ' + result.passed + '/' + result.total + ' (' + result.durationS + 's) ' + checks.filter((c) => !c.pass).map((c) => c.id).join(','));
  return result;
}

if (process.argv.includes('--regrade')) {
  const table = [];
  for (const c of CLIENTS) for (const id of ONLY) {
    const dir = path.join(OUT, c, id); const gi = path.join(dir, 'grade-input.json'); if (!fs.existsSync(gi)) continue;
    const ctx = JSON.parse(fs.readFileSync(gi, 'utf8')); const { calls, finalMsg, msgs } = parseEvents(c, path.join(dir, 'events.jsonl'));
    Object.assign(ctx, { calls, finalMsg, wc: calls.filter((x) => x.kind === 'mcp' && x.server === 'workflow-canvas'), ...skillEvidence(calls) });
    const r = finish(id, c, ctx.prompt ?? fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8').trim(), ctx, ctx.proc, ctx.created, ctx.userCanvasDocs, dir, msgs);
    table.push({ client: c, case: id, pass: r.pass, checks: r.passed + '/' + r.total, failed: r.checks.filter((x) => !x.pass).map((x) => x.id) });
  }
  const sp = path.join(OUT, 'summary.json'); const prev = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
  const keep = (prev.table ?? []).filter((r) => !table.some((t) => t.client === r.client && t.case === r.case));
  fs.writeFileSync(sp, JSON.stringify({ ...prev, regradedAt: new Date().toISOString(), table: [...keep, ...table] }, null, 1));
  console.log(JSON.stringify(table)); process.exit(0);
}
const needsRepo = ONLY.filter((id) => CASES[id]?.cwd === 'repo');
const sameCanvas = (a, b) => { const u = new URL(a), v = new URL(b); return u.port === v.port && ['localhost', '127.0.0.1', '::1'].includes(u.hostname) === ['localhost', '127.0.0.1', '::1'].includes(v.hostname); };
for (const c of CLIENTS) if (sameCanvas(TARGET[c].base, USER_CANVAS) || TARGET[c].container === 'workflow-canvas') {
  console.error('Refusing to run ' + c + ' against ' + TARGET[c].base + ' (' + TARGET[c].container + '): each case deletes every non-default document on the eval canvas. Start a throwaway container (e.g. docker run -d --name wfc-skill-eval -p 127.0.0.1:8797:8790 workflow-canvas:latest) and point --' + c + '-base/--' + c + '-container at it.');
  process.exit(2);
}
if (needsRepo.length && !(REPO && fs.statSync(REPO, { throwIfNoEntry: false })?.isDirectory())) {
  console.error(needsRepo.join(',') + ' maps a codebase: pass --repo DIR, a small git repository the agent runs in' + (REPO ? ' (' + REPO + ' is not a directory)' : '') + '.');
  process.exit(2);
}
const browser = await chromium.launch();
const meta = { startedAt: new Date().toISOString(), clients: {}, repo: REPO, launcher: LAUNCHER };
for (const c of CLIENTS) {
  const t = TARGET[c]; const hz = await health(t.base);
  meta.clients[c] = { ...t, image: docker('inspect', '-f', '{{.Image}}', t.container).slice(7, 19), docsAtStart: hz?.documents, version: execFileSync(c, ['--version'], { encoding: 'utf8' }).split('\n')[0], ...(c === 'codex' ? { model: CODEX_MODEL, effort: CODEX_EFFORT } : {}) };
}
meta.userCanvasDocsAtStart = (await health(USER_CANVAS))?.documents;
const results = await Promise.all(CLIENTS.map(async (c) => { const rs = []; for (const id of ONLY) { try { rs.push(await runCase(browser, c, id)); } catch (e) { console.log(c + ' ' + id + ' ERROR ' + e.message); rs.push({ case: id, client: c, error: e.message, pass: false }); } } return rs; }));
await browser.close();
meta.finishedAt = new Date().toISOString(); meta.userCanvasDocsAtEnd = (await health(USER_CANVAS))?.documents;
const flat = results.flat();
const sp = path.join(OUT, 'summary.json'); const prev = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
meta.clients = { ...(prev.clients ?? {}), ...meta.clients }; meta.runs = [...(prev.runs ?? []), { clients: CLIENTS, cases: ONLY, startedAt: meta.startedAt, finishedAt: meta.finishedAt }];
const summary = { ...prev, ...meta, table: (prev.table ?? []).filter((r) => !flat.some((f) => f.client === r.client && f.case === r.case)).concat(flat.map((r) => ({ client: r.client, case: r.case, pass: r.pass, checks: r.error ? 'error' : r.passed + '/' + r.total, failed: r.checks?.filter((c) => !c.pass).map((c) => c.id) ?? [r.error] }))) };
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.table));
