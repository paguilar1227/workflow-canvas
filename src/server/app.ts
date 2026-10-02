import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { Store } from './store';
import { Hub } from './hub';
import { createTools, invokeTool, toolJsonSchemas } from './tools';
import { mountMcp, SERVER_INFO } from './mcp';
import { THEMES } from '../shared/themes';
import { exportMarkdown, exportMermaid } from '../shared/io';
import { isTrustedRequest, UNTRUSTED_MESSAGE } from './guard';

export interface AppOptions { dataDir: string; webDir?: string; dev?: boolean }

export async function createApp(opts: AppOptions) {
  const store = new Store(opts.dataDir);
  await store.init();
  const hub = new Hub(store);
  const tools = createTools(store, hub);
  const app = express();
  app.use((req, res, next) => { if (isTrustedRequest(req)) next(); else res.status(403).json({ ok: false, error: UNTRUSTED_MESSAGE }); });
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => { res.json({ ok: true, ...SERVER_INFO, documents: store.list().length, connectedUIs: hub.uiCount }); });
  app.get('/api/tools', (_req, res) => { res.json({ server: SERVER_INFO, tools: toolJsonSchemas(tools) }); });
  app.post('/api/tools/:name', async (req, res) => {
    try {
      const origin = req.header('x-origin') === 'user' ? 'user' : 'ai:' + (req.header('x-client-name') ?? 'rest');
      res.json({ ok: true, result: await invokeTool(tools, req.params.name, req.body, { origin }) });
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
  mountMcp(app, tools);

  const server = http.createServer(app);
  server.keepAliveTimeout = 0;
  hub.attach(server);

  if (opts.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    app.use(vite.middlewares);
  } else if (opts.webDir && existsSync(opts.webDir)) {
    app.use(express.static(opts.webDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => { if (req.method === 'GET' && req.accepts('html')) res.sendFile(path.join(opts.webDir!, 'index.html')); else next(); });
  }
  return { app, server, store, hub, tools };
}

