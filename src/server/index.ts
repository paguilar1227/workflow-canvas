import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8790);
const host = process.env.HOST ?? '0.0.0.0';
const dev = process.env.NODE_ENV !== 'production';
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
const webDir = path.resolve(process.env.WEB_DIR ?? path.join(here, '..', 'web'));

const { server } = await createApp({ dataDir, webDir, dev });
server.listen(port, host, () => {
  console.log('[workflow-canvas] ' + (dev ? 'dev' : 'production') + ' server on http://localhost:' + port);
  console.log('[workflow-canvas] MCP endpoint  http://localhost:' + port + '/mcp');
  console.log('[workflow-canvas] data dir      ' + dataDir);
});

