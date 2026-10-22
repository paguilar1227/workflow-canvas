import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { Store } from './store';
import { Hub } from './hub';
import { createTools, invokeTool, toolJsonSchemas } from './tools';
import { mountMcp, SERVER_INFO } from './mcp';
import { THEMES } from '../shared/themes';
import { exportMarkdown, exportMermaid } from '../shared/io';
import { isTrustedRequest, UNTRUSTED_MESSAGE } from './guard';
import { mountReadiness } from './readiness';
import { FileSaver, saveRoots } from './files';

export interface AppOptions { dataDir: string; webDir?: string; dev?: boolean; skillDir?: string; publicUrl?: () => string; allowedHosts?: () => string[] }

export async function createApp(opts: AppOptions) {
  const store = new Store(opts.dataDir);
  await store.init();
  const hub = new Hub(store);
  const files = new FileSaver(store, saveRoots(), path.join(opts.dataDir, 'files.json'));
  await files.init();
  const tools = createTools(store, hub, files);
  const app = express();
  if (process.env.DEMO_DEPLOYMENT_ID) app.set('trust proxy', true);
  const trusted = (req: http.IncomingMessage) => isTrustedRequest(req, opts.allowedHosts?.());
  app.use((req, res, next) => { if (trusted(req)) next(); else res.status(403).json({ ok: false, error: UNTRUSTED_MESSAGE }); });
  let closing = false;
  app.use((req, res, next) => { if (closing && req.method !== 'GET') res.status(503).json({ ok: false, error: 'The app is saving before shutdown.' }); else next(); });
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => { res.json({ ok: true, ...SERVER_INFO, documents: store.list().length, connectedUIs: hub.uiCount, ...(process.env.DEMO_DEPLOYMENT_ID ? { deploymentId: process.env.DEMO_DEPLOYMENT_ID, sourceSha: process.env.DEMO_DEPLOY_SOURCE_SHA } : {}) }); });
  app.get('/api/tools', (_req, res) => { res.json({ server: SERVER_INFO, tools: toolJsonSchemas(tools) }); });
  app.post('/api/tools/:name', async (req, res) => {
    try {
      const origin = req.header('x-origin') === 'user' ? 'user' : 'ai:' + (req.header('x-client-name') ?? 'rest');
      const canvasUrl = (opts.publicUrl?.() || req.header('x-canvas-url') || req.protocol + '://' + req.host).replace(/\/$/, '');
      res.json({ ok: true, result: await invokeTool(tools, req.params.name, req.body, { origin, canvasUrl }) });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });
  app.get('/api/documents', (_req, res) => { res.json(store.list()); });
  app.get('/api/documents/:id', (req, res) => {
    const doc = store.get(req.params.id);
    if (!doc) { res.status(404).json({ error: 'not found' }); return; }
    const format = req.query.format;
    if (format === 'markdown') { res.type('text/markdown').send(exportMarkdown(doc)); return; }
    if (format === 'mermaid') { res.type('text/plain').send(exportMermaid(doc)); return; }
    res.json(doc);
  });
  app.get('/api/session', (_req, res) => { res.json({ session: { ...store.session, selections: store.selectionsView() }, connectedUIs: hub.uiCount }); });
  app.get('/api/themes', (_req, res) => { res.json(THEMES); });
  app.get('/api/integration', async (_req, res) => {
    let skill = '';
    try { skill = await readFile(path.join(opts.skillDir || path.join(process.cwd(), 'plugins/workflow-canvas/skills/workflow-canvas'), 'SKILL.md'), 'utf8'); } catch {}
    res.json({ name: SERVER_INFO.name, version: SERVER_INFO.version, publicUrl: opts.publicUrl?.() || '', skill, toolCount: tools.length });
  });
  const closeMcp = mountMcp(app, tools, opts.publicUrl);
  mountReadiness(app);

  const server = http.createServer(app);
  server.keepAliveTimeout = 0;
  hub.attach(server, trusted);

  if (opts.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    app.use(vite.middlewares);
  } else if (opts.webDir && existsSync(opts.webDir)) {
    app.use(express.static(opts.webDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => { if (req.method === 'GET' && req.accepts('html')) res.sendFile(path.join(opts.webDir!, 'index.html')); else next(); });
  }
  function resume() { closing = false; hub.pause(false); }
  async function checkpoint() {
    closing = true;
    hub.pause(true);
    try {
      await files.flush();
      await store.flush();
    } catch (error) {
      closing = false;
      hub.pause(false);
      throw error;
    }
  }
  async function close() {
    await checkpoint();
    hub.close();
    await closeMcp();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
  return { app, server, store, hub, tools, files, close, checkpoint, resume };
}

