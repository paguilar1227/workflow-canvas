#!/usr/bin/env node
// Parallel, user-perspective AI integration tests for Workflow Canvas.
// Real AI agents (codex exec) drive the canvas over MCP, all at the same time, while one recorded browser tab
// per scenario watches its document live. Each scenario gets video, step screenshots, final screenshot,
// transcript and assertion results.
//
// A scenario may have several turns (separate codex exec runs on the same document); a turn's before() hook acts as
// the person in the recorded tab (e.g. clicking Save) between AI turns.
//
//   node scripts/ai-tests/run.mjs [--base http://localhost:8790] [--out <dir>] [--only A,C] [--timeout-min 25] [--headed]
//                                 [--container wfc-ai-test] [--expect-tools 35]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import nodeHttp from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { SCENARIOS } from './scenarios.mjs';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const args = parseArgs(process.argv.slice(2));
const BASE = String(args.base ?? process.env.WFC_BASE ?? 'http://localhost:8790').replace(/\/$/, '');
const OUT = path.resolve(String(args.out ?? path.join(REPO, 'test-results', 'ai')));
const TIMEOUT_MS = Number(args['timeout-min'] ?? 25) * 60_000;
const ONLY = args.only ? String(args.only).split(',').map((s) => s.trim().toUpperCase()) : null;
const FFMPEG = String(args.ffmpeg ?? (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg'));
const VIEW = { width: 1280, height: 800 };
const SETTLE_MS = 400; // the web client animates view changes for 350 ms (src/web/sync.ts DURATION)
const REASONING = 'medium';
const MCP_NAME = 'workflow_canvas';
const BASELINE_THEME = 'lens-dark';
const REQUIRED_AI_TOOLS = ['add_nodes', 'update_nodes', 'create_diagram', 'save_to_file'];
const EXPECTED_TOOL_COUNT = Number(args['expect-tools'] ?? 35);
const CONTAINER = args.container ? String(args.container) : null;

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [k, v] = argv[i].slice(2).split(/=(.*)/s);
    o[k] = v !== undefined ? v : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => { s = typeof s === 'string' ? s : JSON.stringify(s) ?? ''; return s.length > n ? s.slice(0, n) + '…' : s; };
const stamp = (t0) => '[+' + ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's]';

async function http(p, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', 'x-origin': 'user', 'x-client-name': 'ai-test-harness' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!res.ok) throw new Error(method + ' ' + p + ' -> HTTP ' + res.status + ': ' + raw.slice(0, 300));
  return data;
}
const tool = async (name, a = {}) => (await http('/api/tools/' + encodeURIComponent(name), { method: 'POST', body: a })).result;

function run(cmd, argv, { input, timeoutMs = 120_000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

function codexArgv(sc, prompt) {
  return ['exec', '--ignore-user-config', '--disable', 'apps', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only',
    '-m', sc.model, '-c', 'model_reasoning_effort="' + REASONING + '"',
    '-c', 'mcp_servers.' + MCP_NAME + '.url="' + (sc.mcpUrl ?? BASE + '/mcp') + '"',
    '-c', 'mcp_servers.' + MCP_NAME + '.default_tools_approval_mode="approve"',
    prompt];
}

function toolNames(text) {
  const payloads = /^\s*[{[]/.test(text) ? [text] : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5));
  const names = [];
  for (const p of payloads) {
    try { for (const m of [].concat(JSON.parse(p))) for (const t of m?.result?.tools ?? []) names.push(t.name); } catch { /* not JSON-RPC */ }
  }
  return names;
}

// Per-agent pass-through in front of BASE/mcp that records the tools/list responses delivered to that agent.
function startMcpTap(sc) {
  const target = new URL(BASE);
  const server = nodeHttp.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const listing = /"method"\s*:\s*"tools\/list"/.test(body.toString('utf8'));
      const headers = { ...req.headers, host: target.host };
      delete headers['accept-encoding'];
      const up = nodeHttp.request({ hostname: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers }, (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        let text = '';
        upRes.on('data', (c) => { if (listing) text += c; res.write(c); });
        upRes.on('end', () => { if (listing) sc.toolLists.push(toolNames(text)); res.end(); });
      });
      up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e)); });
      res.on('close', () => up.destroy());
      up.end(body);
    });
  });
  server.keepAliveTimeout = 0; // mirror src/server/app.ts so the pass-through adds no idle-socket close of its own
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port + '/mcp', close: () => { server.closeAllConnections(); server.close(); } })));
}

/** Environment probe: is Claude Code able to use this MCP server right now? (No auth changes are made.) */
async function probeClaude() {
  const status = await run('claude', ['auth', 'status'], { timeoutMs: 30_000 });
  if (status.code === -1) return { installed: false };
  let auth = null;
  try { const j = JSON.parse(status.stdout); auth = { loggedIn: j.loggedIn, authMethod: j.authMethod }; } catch { auth = { raw: clip(status.stdout, 200) }; }
  const cfg = JSON.stringify({ mcpServers: { 'workflow-canvas': { type: 'http', url: BASE + '/mcp' } } });
  const probe = await run('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--mcp-config', cfg, '--allowedTools', 'mcp__workflow-canvas__get_canvas_state'],
    { input: 'Call get_canvas_state once and reply with the number of documents.', timeoutMs: 180_000, cwd: os.tmpdir() });
  const events = probe.stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = events.find((e) => e.type === 'result');
  const toolUses = events.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => c.name);
  return { installed: true, auth, model: init?.model, mcpServers: init?.mcp_servers, toolUses, result: result ? { subtype: result.subtype, isError: result.is_error, text: clip(result.result ?? '', 300) } : null, exitCode: probe.code };
}

function readPageState() {
  const s = window.__wfc.state();
  const paneEl = document.querySelector('.react-flow');
  const pane = paneEl?.getBoundingClientRect();
  const nodes = {};
  for (const el of document.querySelectorAll('.react-flow__node')) {
    const r = el.getBoundingClientRect();
    nodes[el.getAttribute('data-id')] = { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  const vp = document.querySelector('.react-flow__viewport');
  const zoom = vp ? new DOMMatrixReadOnly(getComputedStyle(vp).transform).a : null;
  return {
    docId: s.docId, selection: s.selection, panels: s.session.panels, snapToGrid: s.session.snapToGrid, theme: s.session.theme,
    dataTheme: document.documentElement.dataset.theme, pane: pane && { x: pane.x, y: pane.y, w: pane.width, h: pane.height }, nodes, zoom,
    dom: { outline: !!document.querySelector('[data-testid="left-panel"]'), minimap: !!document.querySelector('.react-flow__minimap') },
  };
}

async function setCaption(page, label, line) {
  await page.evaluate(([label, line]) => {
    let el = document.getElementById('__ai_test_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__ai_test_caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;max-width:72%;' +
        'background:rgba(12,12,16,.86);color:#fff;font:12px/1.4 ui-monospace,Menlo,monospace;padding:6px 10px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.35)';
      document.body.appendChild(el);
    }
    el.replaceChildren();
    const a = document.createElement('div'); a.textContent = label; a.style.opacity = '.65';
    const b = document.createElement('div'); b.textContent = line; b.style.whiteSpace = 'nowrap'; b.style.overflow = 'hidden'; b.style.textOverflow = 'ellipsis';
    el.append(a, b);
  }, [label, line]).catch(() => {});
}

async function dockerImage(container) {
  const r = await run('docker', ['inspect', container, '--format', '{{.Image}}|{{.Config.Image}}|{{.State.StartedAt}}|{{json .NetworkSettings.Ports}}'], { timeoutMs: 30_000 });
  if (r.code !== 0) return { container, error: clip(r.stderr || r.stdout, 300) };
  const [id, image, startedAt, ports] = r.stdout.trim().split('|');
  let bindings = ports;
  try { bindings = Object.entries(JSON.parse(ports) ?? {}).flatMap(([p, bs]) => (bs ?? []).map((b) => b.HostIp + ':' + b.HostPort + '->' + p)); } catch { /* keep raw */ }
  return { container, image, id, containerStartedAt: startedAt, ports: bindings };
}

async function openWatcher(context, docId, initScript) {
  const page = await context.newPage();
  if (initScript) await page.addInitScript(initScript);
  await page.goto(BASE + '/?doc=' + encodeURIComponent(docId) + '&pin=1');
  await page.waitForFunction((id) => window.__wfc?.state().doc?.id === id && !!document.querySelector('.react-flow'), docId, { timeout: 30_000 });
  return page;
}

async function fitView(page) {
  const btn = page.locator('[data-testid="fit-view"]');
  if (await btn.isVisible().catch(() => false)) await btn.click();
  else { await page.mouse.click(VIEW.width / 2, VIEW.height / 2); await page.keyboard.press('Shift+Digit1'); }
  await sleep(SETTLE_MS + 300);
}

function ffmpeg(input, output) {
  return run(FFMPEG, ['-y', '-loglevel', 'error', '-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', output], { timeoutMs: 20 * 60_000 });
}

function resultParts(result) {
  const content = result?.content ?? [];
  const textOut = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json = result?.structured_content ?? result?.structuredContent ?? null;
  if (!json) { try { json = JSON.parse(textOut); } catch { json = null; } }
  return { textOut, json, images: content.filter((c) => c.type === 'image') };
}

async function main() {
  const health = await http('/health');
  const scenarios = SCENARIOS.filter((s) => !ONLY || ONLY.includes(s.id));
  if (!scenarios.length) throw new Error('No scenarios selected');
  const themeChangers = scenarios.filter((s) => s.changesTheme);
  if (themeChangers.length > 1) throw new Error('Only one scenario may change the global theme');
  fs.mkdirSync(OUT, { recursive: true });
  const toolList = (await http('/api/tools')).tools;
  const serverTools = toolList.map((t) => t.name);
  const readOnly = new Set(toolList.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name));
  const codexVersion = (await run('codex', ['--version'], { timeoutMs: 30_000 })).stdout.trim();
  const imageAtStart = CONTAINER ? await dockerImage(CONTAINER) : null;
  console.log('Workflow Canvas ' + BASE + ' (' + health.name + ' ' + health.version + ', ' + toolList.length + ' tools' + (imageAtStart ? ', ' + CONTAINER + ' on ' + imageAtStart.id : '') + ') · ' + codexVersion + ' · scenarios ' + scenarios.map((s) => s.id).join(','));

  const claudeProbe = probeClaude().catch((e) => ({ error: String(e) }));
  if (themeChangers.length) await tool('set_theme', { themeId: BASELINE_THEME });

  const browser = await chromium.launch({ headless: !args.headed });
  const videoTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfc-ai-video-'));
  const runStarted = new Date();

  for (const sc of scenarios) {
    sc.dir = path.join(OUT, sc.slug);
    fs.rmSync(path.join(sc.dir, 'steps'), { recursive: true, force: true });
    if (fs.existsSync(sc.dir)) for (const f of fs.readdirSync(sc.dir)) if (/^(ai-capture-.*\.png|final.*\.png|video.*\.mp4|attached-file.*\.excalidraw)$/.test(f)) fs.rmSync(path.join(sc.dir, f));
    fs.mkdirSync(path.join(sc.dir, 'steps'), { recursive: true });
    Object.assign(sc, await sc.setup({ tool, http }));
    sc.cwdDir = sc.cwd === 'repo' ? REPO : fs.mkdtempSync(path.join(os.tmpdir(), 'wfc-ai-' + sc.id + '-'));
    sc.turns = sc.turns ?? [{ prompt: sc.prompt }];
    sc.promptTexts = sc.turns.map((t) => t.prompt({ docId: sc.docId }));
    sc.toolLists = []; sc.stderrText = '';
    sc.tap = await startMcpTap(sc);
    sc.mcpUrl = sc.tap.url;
    sc.argv = codexArgv(sc, sc.promptTexts[0]);
    sc.context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir: path.join(videoTmp, sc.slug), size: VIEW } });
    sc.pages = [{ docId: sc.docId, page: await openWatcher(sc.context, sc.docId, sc.initScript) }];
    sc.label = sc.id + ' · ' + sc.title + ' — codex ' + sc.model;
    await setCaption(sc.pages[0].page, sc.label, 'waiting for the AI…');
    sc.calls = []; sc.transcript = []; sc.finalMessage = null; sc.finalMessages = []; sc.usage = null; sc.usages = []; sc.createdDocIds = []; sc.step = 0; sc.shots = Promise.resolve(); sc.aiImages = 0; sc.turn = 0; sc.data = {};
    console.log(sc.id + ': doc ' + sc.docId + ' ready');
  }

  const t0 = Date.now();
  await Promise.all(scenarios.map((sc) => runScenario(sc, { t0, readOnly, serverTools })));

  for (const sc of scenarios) {
    await sc.context.close();
    const videos = [];
    for (const [i, p] of sc.pages.entries()) {
      const webm = await p.page.video()?.path();
      if (!webm) continue;
      const name = i === 0 ? 'video.mp4' : 'video-' + p.docId + '.mp4';
      const r = await ffmpeg(webm, path.join(sc.dir, name));
      if (r.code === 0) { videos.push(name); fs.rmSync(webm, { force: true }); } else videos.push(name + ' (ffmpeg failed: ' + clip(r.stderr, 200) + ')');
    }
    sc.result.evidence.videos = videos;
    fs.writeFileSync(path.join(sc.dir, 'result.json'), JSON.stringify(sc.result, null, 2));
  }
  await browser.close();
  fs.rmSync(videoTmp, { recursive: true, force: true });

  const claude = await claudeProbe;
  const imageAtEnd = CONTAINER ? await dockerImage(CONTAINER) : null;
  const summary = {
    runStartedAt: runStarted.toISOString(),
    runFinishedAt: new Date().toISOString(),
    base: BASE,
    server: health,
    toolCount: toolList.length,
    expectedToolCount: EXPECTED_TOOL_COUNT,
    tools: serverTools,
    serverImage: imageAtStart && { ...imageAtStart, sameContainerThroughout: !!imageAtEnd && imageAtEnd.id === imageAtStart.id && imageAtEnd.containerStartedAt === imageAtStart.containerStartedAt, note: 'docker inspect ' + CONTAINER + ' at the start and the end of the run; the whole run executed against this image.' },
    parallel: true,
    aiClient: { name: 'codex exec', version: codexVersion, flags: codexArgv({ model: '<model>' }, '<prompt>').slice(0, -1), ignoreUserConfig: true, reasoningEffort: REASONING },
    pass: scenarios.every((s) => s.result.pass),
    scenarios: scenarios.map((s) => ({ id: s.id, slug: s.slug, title: s.title, model: s.model, turns: s.turns.length, documentId: s.docId, createdDocuments: s.result.createdDocuments, pass: s.result.pass, passed: s.result.checks.filter((c) => c.pass).length, failed: s.result.checks.filter((c) => !c.pass).map((c) => c.name), durationSec: s.result.durationSec, toolCalls: s.result.toolCalls.total, exit: s.result.exit, dir: s.dir })),
    environmentNotes: [
      { topic: 'Claude Code', probe: claude, note: 'Claude Code connects to the workflow-canvas MCP server, but cannot run a turn unless it is logged in; when not logged in, the cross-client scenario runs through codex exec with a different model instead.' },
      { topic: 'codex config', note: 'codex exec runs with --ignore-user-config --disable apps so only this MCP server is attached; MCP tools are auto-approved via mcp_servers.workflow_canvas.default_tools_approval_mode="approve" because exec has no interactive approvals.' },
      { topic: 'MCP tool exposure', note: 'Each agent reaches ' + BASE + '/mcp through its own local pass-through (127.0.0.1, random port) that records the tools/list responses delivered to that agent. Every scenario checks that the agent stderr has zero "Skipping MCP tool" lines and that the delivered list holds all ' + EXPECTED_TOOL_COUNT + ' server tools (the server lists ' + toolList.length + '), including ' + REQUIRED_AI_TOOLS.join(', ') + ', with none skipped. codex does not print its model-visible tool list, so delivered tools minus skipped tools is the exposed set.' },
      ...scenarios.filter((s) => s.environmentNote).map((s) => ({ topic: 'scenario ' + s.id, note: s.environmentNote })),
      { topic: 'global theme', note: themeChangers.length ? 'Theme is global (shared by every tab). Only scenario ' + themeChangers[0].id + ' changes it (to ' + themeChangers[0].changesTheme + ') near its end, so screenshots/videos of other scenarios taken after that moment show that theme. The run starts from ' + BASELINE_THEME + '.' : 'No scenario changes the theme.' },
      { topic: 'shared session', note: 'Panels and snap-to-grid live in one shared session and selection is kept per document (session.selections[docId]); only scenario C changes them, and the watcher tabs of other documents are unaffected.' },
    ],
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n' + scenarios.map((s) => (s.result.pass ? 'PASS ' : 'FAIL ') + s.id + ' ' + s.result.checks.filter((c) => c.pass).length + '/' + s.result.checks.length + ' checks, ' + s.result.toolCalls.total + ' tool calls, ' + s.result.durationSec + 's').join('\n'));
  console.log('Evidence: ' + OUT);
  process.exitCode = summary.pass ? 0 : 1;
}

async function runScenario(sc, { t0, readOnly, serverTools }) {
  const main = sc.pages[0].page;
  const log = (line) => sc.transcript.push(stamp(t0) + ' ' + line);
  const pageFor = (docId) => sc.pages.find((p) => p.docId === docId)?.page ?? main;
  const shot = (call) => {
    sc.shots = sc.shots.then(async () => {
      await sleep(SETTLE_MS);
      const n = String(++sc.step).padStart(2, '0');
      const file = path.join(sc.dir, 'steps', n + '-' + call.tool + (call.ok ? '' : '-failed') + '.png');
      await pageFor(call.args?.documentId).screenshot({ path: file }).catch(() => {});
    });
  };
  const follow = async (docId) => {
    if (sc.pages.some((p) => p.docId === docId)) return;
    const entry = { docId, page: null };
    sc.pages.push(entry);
    entry.page = await openWatcher(sc.context, docId, sc.initScript).catch((e) => { log('! could not open watcher tab for ' + docId + ': ' + e.message); return null; });
    if (entry.page) await setCaption(entry.page, sc.label, 'new document ' + docId + ' opened by the AI');
    else sc.pages.splice(sc.pages.indexOf(entry), 1);
  };

  const onEvent = (ev) => {
    const it = ev.item;
    if (ev.type === 'item.started' && it?.type === 'mcp_tool_call') {
      for (const p of sc.pages) if (p.page) setCaption(p.page, sc.label, 'AI → ' + it.tool + ' ' + clip(it.arguments, 160));
      return;
    }
    if (ev.type === 'item.completed' && it) {
      if (it.type === 'mcp_tool_call') {
        const { textOut, json, images } = resultParts(it.result);
        const isErr = !!(it.error || it.result?.is_error || it.result?.isError || it.status === 'failed');
        const call = { n: sc.calls.length + 1, turn: sc.turn, at: Math.round((Date.now() - t0) / 100) / 10, server: it.server, tool: it.tool, args: it.arguments, ok: !isErr, error: it.error?.message ?? (isErr ? clip(textOut, 400) : undefined), resultJson: json, resultText: textOut };
        if (it.server === MCP_NAME) sc.calls.push(call);
        for (const img of images) {
          const file = 'ai-capture-' + String(++sc.aiImages).padStart(2, '0') + '.png';
          fs.writeFileSync(path.join(sc.dir, file), Buffer.from(img.data, 'base64'));
          log('    (the AI received a ' + (img.mimeType ?? img.mime_type ?? 'image') + ' screenshot, saved as ' + file + ')');
        }
        log('→ mcp ' + it.server + '/' + it.tool + ' ' + clip(it.arguments, 400) + (call.ok ? '  ✓ ' + clip(textOut.replace(/\s+/g, ' '), 300) : '  ✗ ' + call.error));
        for (const p of sc.pages) if (p.page) setCaption(p.page, sc.label, (call.ok ? '✓ ' : '✗ ') + it.tool + ' ' + clip(json?.change ?? textOut.replace(/\s+/g, ' '), 140));
        if (call.ok && ['create_document', 'duplicate_document'].includes(it.tool) && json?.documentId) {
          sc.createdDocIds.push(json.documentId);
          sc.shots = sc.shots.then(() => follow(json.documentId));
        }
        if (it.server === MCP_NAME && (!readOnly.has(it.tool) || it.tool === 'capture_screenshot')) shot(call);
      } else if (it.type === 'agent_message') { sc.finalMessage = it.text; sc.finalMessages[sc.turn - 1] = it.text; log('AI: ' + it.text); }
      else if (it.type === 'command_execution') log('$ ' + clip(it.command, 300) + ' (exit ' + it.exit_code + ')');
      else if (it.type === 'reasoning') log('(thinking) ' + clip((it.text ?? '').replace(/\s+/g, ' '), 300));
      else if (it.type === 'error') log('! ' + it.message);
      else log('[' + it.type + '] ' + clip(it, 300));
      return;
    }
    if (ev.type === 'turn.completed') { sc.usage = ev.usage; sc.usages.push(ev.usage); log('turn completed · usage ' + JSON.stringify(ev.usage)); }
    else if (ev.type === 'turn.failed') log('! turn failed: ' + clip(ev.error?.message, 400));
    else if (ev.type === 'error') log('! ' + clip(ev.message, 400));
  };

  const stripImages = (ev) => {
    const content = ev.item?.result?.content;
    if (!Array.isArray(content) || !content.some((c) => c.type === 'image')) return ev;
    return { ...ev, item: { ...ev.item, result: { ...ev.item.result, content: content.map((c) => (c.type === 'image' ? { ...c, data: '[base64 omitted: ' + c.data.length + ' chars]' } : c)) } } };
  };

  const started = new Date();
  log('START ' + sc.id + ' with codex ' + sc.model + ' on document ' + sc.docId);
  const raw = fs.createWriteStream(path.join(sc.dir, 'transcript.raw.jsonl'));
  const errOut = fs.createWriteStream(path.join(sc.dir, 'agent-stderr.txt'));
  const runAgent = (argv) => new Promise((resolve) => {
    const child = spawn('codex', argv, { cwd: sc.cwdDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let buf = '', timedOut = false;
    const handle = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { log(line); return; }
      raw.write(JSON.stringify(stripImages(ev)) + '\n');
      try { onEvent(ev); } catch (e) { log('! harness could not process event: ' + e.message); }
    };
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; log('! TIMEOUT after ' + TIMEOUT_MS / 60000 + ' min, stopping the agent'); kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 10_000); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on('data', (d) => { sc.stderrText += d; errOut.write(d); });
    child.on('error', (e) => { clearTimeout(timer); log('! could not start codex: ' + e.message); resolve({ code: -1, signal: null, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); handle(buf); resolve({ code, signal, timedOut }); });
  });
  const person = { page: main, docId: sc.docId, log: (line) => log('PERSON: ' + line), caption: (line) => setCaption(main, sc.label, line), tool, http, dir: sc.dir };
  const exits = [];
  for (const [i, turn] of sc.turns.entries()) {
    sc.turn = i + 1;
    if (sc.turns.length > 1) { log('— turn ' + sc.turn + '/' + sc.turns.length); raw.write(JSON.stringify({ type: 'harness.turn', turn: sc.turn }) + '\n'); errOut.write('--- turn ' + sc.turn + '\n'); }
    if (turn.before) {
      try { Object.assign(sc.data, await turn.before(person)); } catch (e) { log('! person step failed: ' + e.message); sc.data.personError = String(e.message); }
    }
    const ex = await runAgent(codexArgv(sc, sc.promptTexts[i]));
    exits.push(ex);
    if (sc.turns.length > 1) log('turn ' + sc.turn + ' exit=' + ex.code + (ex.timedOut ? ' (timed out)' : ''));
    if (ex.code !== 0 || ex.timedOut) break;
  }
  raw.end(); errOut.end();
  const exit = exits.find((e) => e.code !== 0 || e.timedOut) ?? exits[exits.length - 1];
  const durationSec = Math.round((Date.now() - started.getTime()) / 100) / 10;
  log('END exit=' + exit.code + (exit.timedOut ? ' (timed out)' : '') + ' after ' + durationSec + 's');
  sc.tap.close();
  await sc.shots;
  await sleep(SETTLE_MS);
  if (sc.collect) {
    try { Object.assign(sc.data, await sc.collect({ ...person, log: (line) => log('HARNESS: ' + line) })); } catch (e) { log('! harness collection failed: ' + e.message); sc.data.collectError = String(e.stack ?? e); }
  }

  const page = await main.evaluate(readPageState);
  for (const p of sc.pages) if (p.page) await setCaption(p.page, sc.label, 'AI finished · final fit-to-screen by the test harness');
  await fitView(main);
  const fitZoom = (await main.evaluate(readPageState)).zoom;
  await main.screenshot({ path: path.join(sc.dir, 'final.png') });
  const finals = ['final.png'];
  for (const p of sc.pages.slice(1)) {
    if (!p.page) continue;
    await fitView(p.page);
    const name = 'final-' + p.docId + '.png';
    await p.page.screenshot({ path: path.join(sc.dir, name) });
    finals.push(name);
  }

  const doc = await http('/api/documents/' + encodeURIComponent(sc.docId));
  const session = (await http('/api/session')).session;
  const summaryText = (await tool('get_document', { documentId: sc.docId })).text ?? '';
  const canRedo = /canRedo=true/.test(summaryText) ? true : /canRedo=false/.test(summaryText) ? false : null;
  const markdown = await http('/api/documents/' + encodeURIComponent(sc.docId) + '?format=markdown');
  const createdDocs = [];
  for (const id of sc.createdDocIds) { try { createdDocs.push(await http('/api/documents/' + encodeURIComponent(id))); } catch { /* deleted by the AI */ } }

  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const multi = sc.turns.length > 1;
  check('agent finished on its own (exit 0, no timeout)' + (multi ? ' in all ' + sc.turns.length + ' turns' : ''), exits.length === sc.turns.length && exits.every((e) => e.code === 0 && !e.timedOut), multi ? exits : exit);
  const skipped = sc.stderrText.split('\n').filter((l) => l.includes('Skipping MCP tool'));
  check('agent stderr has zero "Skipping MCP tool" lines', skipped.length === 0, { skipped: skipped.length, lines: [...new Set(skipped.map((l) => l.replace(/^\S+\s+/, '')))] });
  const listed = [...new Set(sc.toolLists.flat())];
  const isSkipped = (t) => skipped.some((l) => l.includes('mcp__' + MCP_NAME + t + '`') || l.includes('mcp__' + MCP_NAME + '__' + t + '`'));
  const missing = [...new Set([...serverTools, ...REQUIRED_AI_TOOLS])].filter((t) => !listed.includes(t) || isSkipped(t));
  const extra = listed.filter((t) => !serverTools.includes(t));
  check('agent tool list has all ' + EXPECTED_TOOL_COUNT + ' server tools, incl. ' + REQUIRED_AI_TOOLS.join(', '), sc.toolLists.length > 0 && serverTools.length === EXPECTED_TOOL_COUNT && listed.length === EXPECTED_TOOL_COUNT && missing.length === 0 && extra.length === 0,
    { toolsListResponses: sc.toolLists.length, serverTools: serverTools.length, toolsListed: listed.length, expected: EXPECTED_TOOL_COUNT, required: REQUIRED_AI_TOOLS, missing, extra });
  try { sc.verify({ doc, session, page, fitZoom, calls: sc.calls, finalMessage: sc.finalMessage, finalMessages: sc.finalMessages, data: sc.data, canRedo, markdown, createdDocs }, check); }
  catch (e) { check('verification ran without crashing', false, String(e.stack ?? e)); }

  const byTool = {};
  for (const c of sc.calls) byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
  fs.writeFileSync(path.join(sc.dir, 'transcript.txt'), [
    'Scenario ' + sc.id + ': ' + sc.title,
    'Client: codex exec (' + sc.model + ', reasoning ' + REASONING + ') · MCP ' + BASE + '/mcp via recording pass-through ' + sc.mcpUrl + ' · document ' + sc.docId,
    'Command: codex ' + sc.argv.slice(0, -1).map((a) => (/[\s"]/.test(a) ? "'" + a + "'" : a)).join(' ') + ' "<prompt>"',
    '', ...(multi ? sc.promptTexts.flatMap((p, i) => ['Prompt (turn ' + (i + 1) + '):', p, '']) : ['Prompt:', sc.promptTexts[0], '']), 'Transcript:', ...sc.transcript, '',
  ].join('\n'));
  sc.result = {
    scenario: sc.id, slug: sc.slug, title: sc.title,
    client: { name: 'codex exec', model: sc.model, reasoningEffort: REASONING, ignoreUserConfig: true, argv: ['codex', ...sc.argv.slice(0, -1), '<prompt>'], mcpPassThrough: sc.mcpUrl, toolsListed: [...new Set(sc.toolLists.flat())] },
    server: BASE, documentId: sc.docId, createdDocuments: createdDocs.map((d) => ({ id: d.id, title: d.title, nodes: d.nodes.length, edges: d.edges.length })),
    prompt: multi ? sc.promptTexts : sc.promptTexts[0], startedAt: started.toISOString(), durationSec, exit, ...(multi ? { turns: exits, usages: sc.usages } : {}), usage: sc.usage,
    toolCalls: { total: sc.calls.length, failed: sc.calls.filter((c) => !c.ok).map((c) => ({ n: c.n, turn: c.turn, tool: c.tool, error: c.error })), byTool, sequence: sc.calls.map((c) => (multi ? 't' + c.turn + ':' : '') + c.tool + (c.ok ? '' : ' ✗')) },
    finalDocument: { title: doc.title, nodes: doc.nodes.length, edges: doc.edges.length, frames: doc.nodes.filter((n) => n.kind === 'frame').length, settings: doc.settings },
    finalAgentMessage: sc.finalMessage, ...(multi ? { finalAgentMessages: sc.finalMessages } : {}),
    pass: checks.every((c) => c.pass), checks,
    evidence: { dir: sc.dir, finalScreenshots: finals, steps: fs.readdirSync(path.join(sc.dir, 'steps')).sort().map((f) => 'steps/' + f), aiCaptures: fs.readdirSync(sc.dir).filter((f) => f.startsWith('ai-capture-')).sort(), transcript: 'transcript.txt', rawEvents: 'transcript.raw.jsonl', ...(sc.data.evidenceFiles ? { files: sc.data.evidenceFiles } : {}) },
  };
  console.log((sc.result.pass ? 'PASS ' : 'FAIL ') + sc.id + ' in ' + durationSec + 's (' + sc.calls.length + ' tool calls)');
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
